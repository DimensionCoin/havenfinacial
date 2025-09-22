// app/api/email-claims/claim/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
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

import { connect } from "@/lib/db";
import User from "@/models/User";
import EmailClaim from "@/models/EmailClaim";
import { verifySession } from "@/lib/auth";
import { verifyClaimToken } from "@/lib/claim-token";
import { getCaip2 } from "@/lib/solana";

/* ----------------------------- env / constants ---------------------------- */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const SOLANA_RPC = required("NEXT_PUBLIC_SOLANA_RPC");
const USDC_MINT = new PublicKey(required("NEXT_PUBLIC_USDC_MINT"));
const HAVEN_ESCROW_PUBKEY = new PublicKey(
  (process.env.NEXT_PUBLIC_HAVEN_ESCROW_OWNER ??
    process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS)!
);
const HAVEN_ESCROW_WALLET_ID = required("HAVEN_FEEPAYER_WALLET_ID");

const PRIVY_APP_ID = required("PRIVY_APP_ID");
const PRIVY_SECRET = required("PRIVY_SECRET_KEY");
const PRIVY_AUTH_PRIVATE_KEY_B64 = required("PRIVY_AUTH_PRIVATE_KEY_B64");

const DECIMALS = 6;
const MAX_PER_TX = 8;

/* -------------------------------- schema -------------------------------- */

const Body = z.object({ token: z.string().min(10) });

/* ------------------------------- helpers -------------------------------- */

const jerr = (status: number, error: string, extra?: unknown) =>
  NextResponse.json(extra ? { error, extra } : { error }, { status });

function readAccessToken(req: NextRequest): string | null {
  const authz = req.headers.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ")) return authz.slice(7).trim();
  const cookie = req.headers.get("cookie") || "";
  const part = cookie
    .split(";")
    .map((s) => s.trim())
    .find((c) => c.toLowerCase().startsWith("privy-token="));
  return part
    ? decodeURIComponent(part.substring("privy-token=".length))
    : null;
}

const normEmail = (s: string) => s.trim().toLowerCase();

function extractPrimaryEmailFromPrivyUser(u: unknown): string | null {
  const obj = (u ?? {}) as Record<string, unknown>;
  const list = Array.isArray(obj["linkedAccounts"])
    ? (obj["linkedAccounts"] as unknown[])
    : [];

  for (const item of list) {
    const acc = item as Record<string, unknown>;
    const type = (acc["type"] ?? acc["kind"]) as string | undefined;
    if (type === "email") {
      const email = (acc["address"] ?? acc["email"]) as string | undefined;
      if (email && email.includes("@")) return email.toLowerCase();
    }
  }
  const maybe = (obj["email"] ?? obj["primaryEmail"]) as string | undefined;
  return maybe && maybe.includes("@") ? maybe.toLowerCase() : null;
}

// SAFE extractor that works across Privy union types
type AnyRec = Record<string, unknown>;

function extractEmbeddedSolanaFromPrivyUser(
  u: unknown
): { walletId?: string; address?: string } | undefined {
  const list = Array.isArray((u as AnyRec)?.["linkedAccounts"])
    ? ((u as AnyRec)["linkedAccounts"] as unknown[])
    : [];

  for (const item of list) {
    const acc = item as AnyRec;

    const type = (acc["type"] ?? acc["kind"]) as string | undefined;
    const chain = (acc["chainType"] ?? acc["chain"]) as string | undefined;
    const client = (acc["walletClientType"] ??
      acc["clientType"] ??
      acc["connectorType"] ??
      acc["provider"]) as string | undefined;

    const walletId = (acc["walletId"] ?? acc["id"]) as string | undefined;
    const address = (acc["address"] ?? acc["walletAddress"]) as
      | string
      | undefined;

    const isWallet = type === "wallet";
    const isSol = chain === "solana";
    const isEmbedded = client === "embedded" || client === "privy";

    if (isWallet && isSol && isEmbedded && address) {
      return { walletId, address };
    }
  }
  return undefined;
}

/** Accept __session or Privy token; auto-create User if missing. */
async function requireUser(req: NextRequest): Promise<{
  userId: string;
  privyId: string;
  email: string;
}> {
  // 1) App session cookie
  const token = req.cookies.get("__session")?.value ?? null;
  const claims = token ? verifySession(token) : null;
  if (claims?.userId && claims?.privyId && claims?.email) {
    return {
      userId: claims.userId,
      privyId: claims.privyId,
      email: claims.email,
    };
  }

  // 2) Privy access token
  const access = readAccessToken(req);
  if (!access) throw new Error("Unauthorized");

  const privy = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET, {
    walletApi: { authorizationPrivateKey: PRIVY_AUTH_PRIVATE_KEY_B64 },
  });
  const { userId: privyId } = await privy.verifyAuthToken(access);
  if (!privyId) throw new Error("Unauthorized");

  await connect();
  let dbUser = await User.findOne({ privyId }).lean();

  if (!dbUser) {
    const pUser = await privy.getUser(privyId);
    const email = extractPrimaryEmailFromPrivyUser(pUser);
    if (!email) throw new Error("Unauthorized");
    const created = await User.create({
      privyId,
      email,
      // rely on model defaults
    });
    dbUser = (await User.findById(created._id).lean())!;
  }

  return { userId: String(dbUser._id), privyId, email: dbUser.email };
}

async function detectTokenProgramId(conn: Connection, mint: PublicKey) {
  const info = await conn.getAccountInfo(mint);
  if (!info) throw new Error("Mint not found on chain");
  return info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

/* ---------------------------------- POST -------------------------------- */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return jerr(400, "Invalid body");

    // Verify token from email link
    const payload = verifyClaimToken(parsed.data.token);
    if (!payload?.recipientEmail || !payload?.expiresAt) {
      return jerr(401, "Invalid or expired token");
    }

    // Require user (session or bearer); auto-provision if needed
    const session = await requireUser(req);

    // Email must match token’s intended recipient
    const tokenEmail = normEmail(payload.recipientEmail);
    if (normEmail(session.email) !== tokenEmail) {
      return jerr(403, "Email mismatch. Sign in with the invited email.", {
        expected: tokenEmail,
        got: normEmail(session.email),
      });
    }

    // Expired? Mark pending claim (if any) expired
    if (Date.now() > new Date(payload.expiresAt).getTime()) {
      await connect();
      const maybe = await EmailClaim.findOne({ tokenId: payload.claimId });
      if (maybe && maybe.status === "pending") {
        maybe.status = "expired";
        await maybe.save();
      }
      return jerr(410, "This claim link has expired");
    }

    await connect();

    // Ensure the recipient has an embedded Solana deposit wallet
    const dbUser = await User.findById(session.userId);
    if (!dbUser) return jerr(404, "User record not found");

    const privy = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET, {
      walletApi: { authorizationPrivateKey: PRIVY_AUTH_PRIVATE_KEY_B64 },
    });

    if (!dbUser.depositWallet?.address) {
      // Discover existing embedded wallet
      let pUser = await privy.getUser(session.privyId);
      let sol = extractEmbeddedSolanaFromPrivyUser(pUser);

      // If none, create one then refresh
      if (!sol?.address) {
        const created = await privy.walletApi.createWallet({
          chainType: "solana",
          owner: { userId: session.privyId },
          idempotencyKey: randomUUID(),
        });
        pUser = await privy.getUser(session.privyId);
        sol = extractEmbeddedSolanaFromPrivyUser(pUser) ?? {
          walletId: created.id,
          address: created.address,
        };
      }

      if (!sol?.address)
        return jerr(409, "Unable to create embedded wallet — try again.");

      dbUser.depositWallet = {
        chainType: "solana",
        walletId: sol.walletId,
        address: sol.address,
      };
      await dbUser.save();
    }

    const recipientOwner = new PublicKey(dbUser.depositWallet!.address!);

    // Gather ALL pending, non-expired claims for this email
    const now = new Date();
    const pending = await EmailClaim.find({
      recipientEmail: tokenEmail,
      status: "pending",
      tokenExpiresAt: { $gt: now },
    }).sort({ createdAt: 1 });

    // Redirect hint
    const onboarded =
      dbUser.status === "active" && dbUser.kycStatus === "approved";
    const redirect = onboarded ? "/dashboard" : "/onboarding";

    if (pending.length === 0) {
      return NextResponse.json({
        ok: true,
        claimedCount: 0,
        signatures: [],
        redirect,
      });
    }

    // Build & send escrow → recipient transfers (batched)
    const conn = new Connection(SOLANA_RPC, "confirmed");
    const tokenProgramId = await detectTokenProgramId(conn, USDC_MINT);

    const escrowAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      HAVEN_ESCROW_PUBKEY,
      false,
      tokenProgramId
    );
    const recipientAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      recipientOwner,
      false,
      tokenProgramId
    );

    const ensureEscrowAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      HAVEN_ESCROW_PUBKEY,
      escrowAta,
      HAVEN_ESCROW_PUBKEY,
      USDC_MINT,
      tokenProgramId
    );
    const ensureRecipientAtaIx =
      createAssociatedTokenAccountIdempotentInstruction(
        HAVEN_ESCROW_PUBKEY,
        recipientAta,
        recipientOwner,
        USDC_MINT,
        tokenProgramId
      );

    const caip2 = getCaip2();
    const signatures: string[] = [];

    // chunk claims to keep tx size reasonable
    const chunks: (typeof pending)[] = [];
    for (let i = 0; i < pending.length; i += MAX_PER_TX) {
      chunks.push(pending.slice(i, i + MAX_PER_TX));
    }

    for (let idx = 0; idx < chunks.length; idx++) {
      const group = chunks[idx];

      const transferIxs: TransactionInstruction[] = group.map((cl) =>
        createTransferCheckedInstruction(
          escrowAta,
          USDC_MINT,
          recipientAta,
          HAVEN_ESCROW_PUBKEY,
          Number(cl.amountUnits),
          DECIMALS,
          [],
          tokenProgramId
        )
      );

      const instructions: TransactionInstruction[] =
        idx === 0
          ? [ensureEscrowAtaIx, ensureRecipientAtaIx, ...transferIxs]
          : transferIxs;

      const { blockhash } = await conn.getLatestBlockhash("finalized");
      const msg = new TransactionMessage({
        payerKey: HAVEN_ESCROW_PUBKEY,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);

      const sent = await privy.walletApi.solana.signAndSendTransaction({
        walletId: HAVEN_ESCROW_WALLET_ID,
        caip2,
        transaction: tx,
      });

      signatures.push(sent.hash);

      // Mark batch claimed (idempotent: only mutate status:pending)
      const ids = group.map((g) => g._id);
      await EmailClaim.updateMany(
        { _id: { $in: ids }, status: "pending" },
        {
          $set: {
            status: "claimed",
            claimedByUserId: dbUser._id,
            claimSignature: sent.hash,
            claimedAt: new Date(),
          },
        }
      );
    }

    return NextResponse.json({
      ok: true,
      claimedCount: pending.length,
      signatures,
      redirect,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isAuth =
      msg.toLowerCase().includes("unauthorized") ||
      msg.toLowerCase().includes("user not found");
    return jerr(isAuth ? 401 : 500, msg);
  }
}
