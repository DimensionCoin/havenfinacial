// app/api/email-claims/record/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Connection, PublicKey } from "@solana/web3.js";
import { randomUUID } from "node:crypto";

import { connect } from "@/lib/db";
import User from "@/models/User";
import EmailClaim from "@/models/EmailClaim";
import { verifySession } from "@/lib/auth";
import { signClaimToken } from "@/lib/claim-token";
import { sendClaimEmail } from "@/lib/resend";
import { PrivyClient } from "@privy-io/server-auth";

/* ----------------------------- env + constants ---------------------------- */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const SOLANA_RPC = required("NEXT_PUBLIC_SOLANA_RPC");
const USDC_MINT = new PublicKey(required("NEXT_PUBLIC_USDC_MINT"));
const TREASURY_OWNER = new PublicKey(
  required("NEXT_PUBLIC_APP_TREASURY_OWNER")
);

const ESCROW_OWNER_STR =
  process.env.NEXT_PUBLIC_HAVEN_ESCROW_OWNER ??
  process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS ??
  "";
if (!ESCROW_OWNER_STR) throw new Error("Escrow owner not configured");
const ESCROW_OWNER = new PublicKey(ESCROW_OWNER_STR);

const PRIVY_APP_ID = required("PRIVY_APP_ID");
const PRIVY_SECRET = required("PRIVY_SECRET_KEY");
// Only the private key is needed here (no authId) because we’re not sending txs
const PRIVY_AUTH_PRIVATE_KEY_B64 = required("PRIVY_AUTH_PRIVATE_KEY_B64");

const DECIMALS = 6;
const DEFAULT_FEE_UI = 0.015;
const FEE_UI = (() => {
  const raw =
    process.env.TRANSFER_FEE_UI ??
    process.env.NEXT_PUBLIC_TRANSFER_FEE_UI ??
    `${DEFAULT_FEE_UI}`;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_FEE_UI;
})();

/* ---------------------------------- schema -------------------------------- */

const Body = z.object({
  txSignature: z.string().min(32),
  recipientEmail: z.string().email(),
  amountUi: z.number().positive(),
  note: z.string().min(0).max(160).optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

/* --------------------------------- helpers -------------------------------- */

const jerr = (status: number, error: string, details?: unknown) =>
  NextResponse.json({ error, ...(details ? { details } : {}) }, { status });

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

/** Accept either our app session cookie OR a Privy access token. */
async function resolveSender(req: NextRequest): Promise<{
  userId: string;
  email: string;
  depositOwner58: string;
}> {
  // 1) Try our app session
  const token = req.cookies.get("__session")?.value;
  const claims = token ? verifySession(token) : null;
  if (claims?.userId && claims?.email) {
    await connect();
    const u = await User.findById(claims.userId).lean();
    if (!u?.depositWallet?.address) throw new Error("Sender wallet not set");
    return {
      userId: String(u._id),
      email: u.email,
      depositOwner58: u.depositWallet.address,
    };
  }

  // 2) Fall back to Privy access token + DB lookup
  const access = readAccessToken(req);
  if (!access) throw new Error("Unauthorized");

  const privy = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET, {
    walletApi: { authorizationPrivateKey: PRIVY_AUTH_PRIVATE_KEY_B64 },
  });
  const { userId: privyId } = await privy.verifyAuthToken(access);
  if (!privyId) throw new Error("Unauthorized");

  await connect();
  const u = await User.findOne({ privyId }).lean();
  if (!u?._id || !u?.email || !u?.depositWallet?.address) {
    throw new Error("Sender wallet not set");
  }
  return {
    userId: String(u._id),
    email: u.email,
    depositOwner58: u.depositWallet.address,
  };
}

/* ----------------------------------- POST ---------------------------------- */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const sender = await resolveSender(req);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success)
      return jerr(400, "Invalid body", parsed.error.flatten());
    const { txSignature, recipientEmail, amountUi, note, idempotencyKey } =
      parsed.data;

    // 1) Verify on-chain deltas for this signature (USDC only)
    const conn = new Connection(SOLANA_RPC, "confirmed");
    const tx = await conn.getParsedTransaction(txSignature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx || tx.meta?.err) {
      return jerr(422, "Transaction not found or failed on-chain");
    }

    const pre = tx.meta?.preTokenBalances ?? [];
    const post = tx.meta?.postTokenBalances ?? [];
    const preMap = new Map(pre.map((b) => [b.accountIndex, b]));

    const deltas = post
      .filter((p) => p.mint === USDC_MINT.toBase58())
      .map((postB) => {
        const preB = preMap.get(postB.accountIndex);
        const postAmt = BigInt(postB.uiTokenAmount.amount || "0");
        const preAmt = BigInt(preB?.uiTokenAmount.amount || "0");
        return {
          owner: postB.owner,
          diff: postAmt - preAmt, // +increase / -decrease
        };
      });

    const units = (ui: number) =>
      BigInt(Math.round(ui * Math.pow(10, DECIMALS)));
    const amountUnits = units(amountUi);
    const feeUnits = units(FEE_UI);

    const senderDec = deltas
      .filter((d) => d.owner === sender.depositOwner58)
      .reduce((a, d) => a + d.diff, BigInt(0));

    const escrowInc = deltas
      .filter((d) => d.owner === ESCROW_OWNER.toBase58())
      .reduce((a, d) => a + d.diff, BigInt(0));

    const treasuryInc = deltas
      .filter((d) => d.owner === TREASURY_OWNER.toBase58())
      .reduce((a, d) => a + d.diff, BigInt(0));

    if (
      senderDec !== -(amountUnits + feeUnits) ||
      escrowInc !== amountUnits ||
      treasuryInc !== feeUnits
    ) {
      return jerr(422, "On-chain transfer does not match expected amounts", {
        senderDec: senderDec.toString(),
        escrowInc: escrowInc.toString(),
        treasuryInc: treasuryInc.toString(),
        expected: {
          senderDec: (-(amountUnits + feeUnits)).toString(),
          escrowInc: amountUnits.toString(),
          treasuryInc: feeUnits.toString(),
        },
      });
    }

    // 2) Idempotency (optional)
    const recipNorm = recipientEmail.trim().toLowerCase();
    if (idempotencyKey) {
      const hit = await EmailClaim.findOne({
        idempotencyKey,
        status: "pending",
        recipientEmail: recipNorm,
        escrowSignature: txSignature,
      }).lean();
      if (hit) {
        return NextResponse.json({
          ok: true,
          claimId: String(hit._id),
          escrowSignature: txSignature,
          idempotencyHit: true,
        });
      }
    }

    // 3) Persist claim
    const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const tokenId = randomUUID();

    const doc = await EmailClaim.create({
      senderUserId: sender.userId,
      senderFromOwner: sender.depositOwner58,
      recipientEmail: recipNorm,
      amountUnits: Number(amountUnits), // store in base units
      currency: "USDC",
      escrowSignature: txSignature,
      escrowWalletAddress: ESCROW_OWNER.toBase58(),
      tokenId,
      tokenExpiresAt: expires,
      note: note?.trim() || undefined,
      idempotencyKey: idempotencyKey || undefined,
      status: "pending",
    });

    // 4) Email claim link
    const claimToken = signClaimToken({
      claimId: tokenId,
      recipientEmail: recipNorm,
      expiresAt: expires,
    });
    await sendClaimEmail({
      recipientEmail: recipNorm,
      amountUi,
      senderEmail: sender.email,
      claimToken,
      note,
    });

    return NextResponse.json({
      ok: true,
      claimId: String(doc._id),
      escrowSignature: txSignature,
    });
  } catch (e) {
    // If our auth helper threw a Response(401), let it bubble as 401
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    const isAuth =
      msg.toLowerCase().includes("unauthorized") ||
      msg.toLowerCase().includes("sender wallet not set");
    return jerr(isAuth ? 401 : 500, msg);
  }
}
