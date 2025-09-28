// app/api/transfer/cancel/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/requireUserId";
import { connect } from "@/lib/db";
import EmailClaim from "@/models/EmailClaim";
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { PrivyClient } from "@privy-io/server-auth";
import { getCaip2 } from "@/lib/solana";

/* ----------------------------- env + constants ---------------------------- */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOLANA_RPC = required("NEXT_PUBLIC_SOLANA_RPC");
const USDC_MINT = new PublicKey(required("NEXT_PUBLIC_USDC_MINT"));

// Escrow is your Haven fee payer / escrow wallet (same as claim route)
const ESCROW_PUBKEY = new PublicKey(
  (process.env.NEXT_PUBLIC_HAVEN_ESCROW_OWNER ??
    process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS)!
);
const ESCROW_WALLET_ID = required("HAVEN_FEEPAYER_WALLET_ID");

// Privy server-auth (same shape you used elsewhere)
const PRIVY_APP_ID = required("PRIVY_APP_ID");
const PRIVY_SECRET = required("PRIVY_SECRET_KEY");
const PRIVY_AUTH_PRIVATE_KEY_B64 = required("PRIVY_AUTH_PRIVATE_KEY_B64");

const DECIMALS = 6;
const MAX_PER_TX = 8;

/* --------------------------------- schema -------------------------------- */

const Body = z.object({
  /** Optional list. If omitted, cancels ALL your pending, unexpired claims. */
  claimIds: z.array(z.string().min(8)).optional(),
});

/* -------------------------------- helpers -------------------------------- */

const jerr = (status: number, error: string, extra?: unknown) =>
  NextResponse.json(extra ? { error, extra } : { error }, { status });

async function detectTokenProgramId(conn: Connection, mint: PublicKey) {
  const info = await conn.getAccountInfo(mint);
  if (!info) throw new Error("Mint not found on chain");
  return info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

/* ---------------------------------- POST --------------------------------- */

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req); // throws 401 if missing
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return jerr(400, "Invalid body");

    await connect();

    const now = new Date();
    const baseFilter: Record<string, unknown> = {
      senderUserId: userId,
      status: "pending",
      tokenExpiresAt: { $gt: now },
    };
    if (parsed.data.claimIds?.length) {
      baseFilter._id = { $in: parsed.data.claimIds };
    }

    // 1) Load candidates
    const candidates = await EmailClaim.find(baseFilter)
      .sort({ createdAt: 1 })
      .lean();

    if (candidates.length === 0) {
      return NextResponse.json({
        ok: true,
        canceledCount: 0,
        signatures: [],
      });
    }

    // 2) Soft lock rows to avoid race with the /email-claims/claim route
    const ids = candidates.map((c) => c._id);
    const lockRes = await EmailClaim.updateMany(
      { _id: { $in: ids }, status: "pending" },
      { $set: { status: "canceling", cancelingAt: new Date() } }
    );

    if (lockRes.modifiedCount === 0) {
      // Nothing left to cancel (race lost)
      return NextResponse.json({
        ok: true,
        canceledCount: 0,
        signatures: [],
        note: "No pending claims remained to cancel.",
      });
    }

    // Re-read only the rows we successfully locked
    const toRefund = await EmailClaim.find({
      _id: { $in: ids },
      status: "canceling",
    })
      .sort({ createdAt: 1 })
      .lean();

    if (toRefund.length === 0) {
      return NextResponse.json({
        ok: true,
        canceledCount: 0,
        signatures: [],
      });
    }

    // 3) Build & send refund transactions
    const conn = new Connection(SOLANA_RPC, "confirmed");
    const tokenProgramId = await detectTokenProgramId(conn, USDC_MINT);

    const escrowAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      ESCROW_PUBKEY,
      false,
      tokenProgramId
    );
    const ensureEscrowAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      ESCROW_PUBKEY,
      escrowAta,
      ESCROW_PUBKEY,
      USDC_MINT,
      tokenProgramId
    );

    // chunk claims
    const groups: (typeof toRefund)[] = [];
    for (let i = 0; i < toRefund.length; i += MAX_PER_TX) {
      groups.push(toRefund.slice(i, i + MAX_PER_TX));
    }

    const privy = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET, {
      walletApi: { authorizationPrivateKey: PRIVY_AUTH_PRIVATE_KEY_B64 },
    });
    const caip2 = getCaip2();
    const signatures: string[] = [];

    for (const group of groups) {
      // For efficiency, ensure each unique sender has an ATA
      const ixs: TransactionInstruction[] = [ensureEscrowAtaIx];
      const seenOwners = new Set<string>();

      for (const cl of group) {
        const owner = new PublicKey(cl.senderFromOwner);
        const owner58 = owner.toBase58();
        if (!seenOwners.has(owner58)) {
          const ownerAta = getAssociatedTokenAddressSync(
            USDC_MINT,
            owner,
            false,
            tokenProgramId
          );
          ixs.push(
            createAssociatedTokenAccountIdempotentInstruction(
              ESCROW_PUBKEY,
              ownerAta,
              owner,
              USDC_MINT,
              tokenProgramId
            )
          );
          seenOwners.add(owner58);
        }
      }

      // Now the refunds
      for (const cl of group) {
        const owner = new PublicKey(cl.senderFromOwner);
        const ownerAta = getAssociatedTokenAddressSync(
          USDC_MINT,
          owner,
          false,
          tokenProgramId
        );
        ixs.push(
          createTransferCheckedInstruction(
            escrowAta,
            USDC_MINT,
            ownerAta,
            ESCROW_PUBKEY,
            Number(cl.amountUnits), // stored in base units (int)
            DECIMALS,
            [],
            tokenProgramId
          )
        );
      }

      const { blockhash } = await conn.getLatestBlockhash("finalized");
      const msg = new TransactionMessage({
        payerKey: ESCROW_PUBKEY,
        recentBlockhash: blockhash,
        instructions: ixs,
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);

      // Sign & send via Privy server-auth (same as your claim route)
      const sent = await privy.walletApi.solana.signAndSendTransaction({
        walletId: ESCROW_WALLET_ID,
        caip2,
        transaction: tx,
      });

      signatures.push(sent.hash);

      // 4) Mark this group canceled (idempotent: only mutate 'canceling')
      const groupIds = group.map((g) => g._id);
      await EmailClaim.updateMany(
        { _id: { $in: groupIds }, status: "canceling" },
        {
          $set: {
            status: "canceled",
            refundSignature: sent.hash,
            refundedAt: new Date(),
          },
        }
      );
    }

    return NextResponse.json({
      ok: true,
      canceledCount: toRefund.length,
      signatures,
    });
  } catch (e) {
    // Best-effort rollback for any rows stuck in 'canceling'
    try {
      const json = await req.json().catch(() => ({}));
      const parsed = Body.safeParse(json);
      await connect();
      const now = new Date();
      const filter: Record<string, unknown> = {
        status: "canceling",
        tokenExpiresAt: { $gt: now },
      };
      const userId = await requireUserId(req).catch(() => null);
      if (userId) filter["senderUserId"] = userId;
      if (parsed.success && parsed.data.claimIds?.length) {
        filter["_id"] = { $in: parsed.data.claimIds };
      }
      await EmailClaim.updateMany(filter, {
        $set: { status: "pending" },
        $unset: { cancelingAt: 1 },
      });
    } catch {
      /* ignore rollback failures */
    }

    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.toLowerCase().includes("unauthorized") ? 401 : 500;
    console.error("[/api/transfer/cancel] error:", msg);
    return NextResponse.json({ error: msg }, { status: code });
  }
}
