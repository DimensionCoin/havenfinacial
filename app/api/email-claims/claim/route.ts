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
  SendTransactionError,
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

// Accept either the classic token path or a "claim all for me" path
const Body = z.union([
  z.object({ token: z.string().min(10), all: z.never().optional() }),
  z.object({ all: z.literal(true) }),
]);

/* ------------------------------- helpers -------------------------------- */

type ErrPayload = {
  ok?: false;
  code: string;
  error: string;
  hint?: string;
  traceId: string;
  details?: unknown;
  partial?: { claimedCount: number; signatures: string[] };
};

const normEmail = (s: string) => s.trim().toLowerCase();

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
    const created = await User.create({ privyId, email });
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

function respond(
  status: number,
  payload: Omit<ErrPayload, "traceId"> & { traceId?: string },
  log?: unknown
) {
  const traceId = payload.traceId ?? randomUUID();
  const body = { ...payload, traceId };
  if (status >= 400) {
    console.error("[/api/email-claims/claim] error", {
      traceId,
      status,
      body,
      log,
    });
  }
  return NextResponse.json(body, { status });
}

type PrivyErrorLike = {
  bodyAsString?: () => string;
  body?: unknown;
  message?: unknown;
};

function extractPrivyErrorBody(error: unknown): string {
  if (!error) return "";
  const maybe = error as PrivyErrorLike;
  if (typeof maybe.bodyAsString === "function") {
    try {
      const result = maybe.bodyAsString();
      if (typeof result === "string") return result;
    } catch {
      /* ignore */
    }
  }
  if (typeof maybe.body === "string") return maybe.body;
  if (typeof maybe.message === "string") return maybe.message;
  return String(error);
}

/* ---------------------------------- POST -------------------------------- */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const traceId = randomUUID();

  try {
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return respond(400, {
        ok: false,
        code: "INVALID_BODY",
        error:
          'The request body is missing or malformed. Send either { "token": "<string from email link>" } or { "all": true }.',
        traceId,
      });
    }

    // Require user (session or bearer); auto-provision if needed
    let session;
    try {
      session = await requireUser(req);
    } catch (e) {
      return respond(401, {
        ok: false,
        code: "UNAUTHORIZED",
        error: "Please sign in to claim funds.",
        hint: "Open the link while signed in to the invited email, or claim from your dashboard.",
        details: e instanceof Error ? e.message : String(e),
        traceId,
      });
    }

    // Determine claim mode + target email
    let targetEmail: string | null = null;
    if ("token" in parsed.data) {
      // TOKEN MODE (existing behavior preserved)
      const payload = verifyClaimToken(parsed.data.token);
      if (!payload?.recipientEmail || !payload?.expiresAt) {
        return respond(401, {
          ok: false,
          code: "TOKEN_INVALID",
          error: "This claim link is invalid or expired.",
          hint: "Request a new email invite from the sender.",
          traceId,
        });
      }
      // Signed-in email must match token recipient
      const tokenEmail = normEmail(payload.recipientEmail);
      if (normEmail(session.email) !== tokenEmail) {
        return respond(403, {
          ok: false,
          code: "EMAIL_MISMATCH",
          error: "Signed-in email doesn’t match the invitation.",
          hint: `Sign in with ${tokenEmail} to claim these funds.`,
          details: { expected: tokenEmail, got: normEmail(session.email) },
          traceId,
        });
      }

      // If token expired → mark pending as expired and stop
      if (Date.now() > new Date(payload.expiresAt).getTime()) {
        try {
          await connect();
          const maybe = await EmailClaim.findOne({ tokenId: payload.claimId });
          if (maybe && maybe.status === "pending") {
            maybe.status = "expired";
            await maybe.save();
          }
        } catch (e) {
          console.warn("[claim] failed to mark expired", {
            traceId,
            err: String(e),
          });
        }
        return respond(410, {
          ok: false,
          code: "TOKEN_EXPIRED",
          error: "This claim link has expired.",
          hint: "Ask the sender to resend the invite.",
          traceId,
        });
      }

      targetEmail = tokenEmail;
    } else {
      // DASHBOARD MODE: claim all pending for the signed-in user's email
      targetEmail = normEmail(session.email);
    }

    await connect();

    // Ensure embedded deposit wallet
    const dbUser = await User.findById(session.userId);
    if (!dbUser) {
      return respond(404, {
        ok: false,
        code: "USER_NOT_FOUND",
        error: "We couldn’t find your user record.",
        hint: "Sign out and sign back in, then retry.",
        traceId,
      });
    }

    const privy = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET, {
      walletApi: { authorizationPrivateKey: PRIVY_AUTH_PRIVATE_KEY_B64 },
    });

    if (!dbUser.depositWallet?.address) {
      try {
        // Discover or create embedded wallet
        let pUser = await privy.getUser(session.privyId);
        let sol = extractEmbeddedSolanaFromPrivyUser(pUser);
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
        if (!sol?.address) {
          return respond(409, {
            ok: false,
            code: "EMBEDDED_WALLET_CREATE_FAILED",
            error: "Couldn’t create a wallet to receive funds.",
            hint: "Retry in a moment, or contact support if this persists.",
            traceId,
          });
        }
        dbUser.depositWallet = {
          chainType: "solana",
          walletId: sol.walletId,
          address: sol.address,
        };
        await dbUser.save();
      } catch (e) {
        return respond(502, {
          ok: false,
          code: "EMBEDDED_WALLET_CREATE_FAILED",
          error: "Wallet provisioning failed.",
          hint: "Retry in a moment. If it keeps failing, contact support.",
          details: e instanceof Error ? e.message : String(e),
          traceId,
        });
      }
    }

    const recipientOwner = new PublicKey(dbUser.depositWallet!.address!);

    // Collect pending claims for the target email
    const now = new Date();
    const pending = await EmailClaim.find({
      recipientEmail: targetEmail,
      status: "pending",
      tokenExpiresAt: { $gt: now },
    }).sort({ createdAt: 1 });

    const onboarded =
      dbUser.status === "active" && dbUser.kycStatus === "approved";
    const redirect = onboarded ? "/dashboard" : "/onboarding";

    if (pending.length === 0) {
      return NextResponse.json({
        ok: true,
        claimedCount: 0,
        signatures: [],
        redirect,
        traceId,
      });
    }

    // Build & send escrow → recipient transfers (batched)
    const conn = new Connection(SOLANA_RPC, "confirmed");
    let tokenProgramId;
    try {
      tokenProgramId = await detectTokenProgramId(conn, USDC_MINT);
    } catch (e) {
      return respond(404, {
        ok: false,
        code: "MINT_NOT_FOUND",
        error: "USDC mint not found on the connected network.",
        hint: "Check your network and USDC mint configuration.",
        details: e instanceof Error ? e.message : String(e),
        traceId,
      });
    }

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

    // chunk claims
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

      try {
        const sent = await (async () => {
          try {
            return await privy.walletApi.solana.signAndSendTransaction({
              walletId: HAVEN_ESCROW_WALLET_ID,
              caip2,
              transaction: tx,
            });
          } catch (err: unknown) {
            // Attempt to decode Privy server error for better UX
            const body = extractPrivyErrorBody(err);
            const low = body.toLowerCase();

            if (
              low.includes("blockhash not found") ||
              low.includes("expired")
            ) {
              throw respond(409, {
                ok: false,
                code: "RPC_BLOCKHASH_EXPIRED",
                error: "The transaction blockhash expired before submission.",
                hint: "Retry now (we’ll refresh and resend).",
                details: { idx, body },
                traceId,
                partial: { claimedCount: signatures.length, signatures },
              });
            }
            if (low.includes("signature verification failure")) {
              throw respond(400, {
                ok: false,
                code: "SIGNATURE_VERIFICATION_FAILURE",
                error: "Signature verification failed while sending.",
                hint: "Please retry. If it repeats, contact support.",
                details: { idx, body },
                traceId,
                partial: { claimedCount: signatures.length, signatures },
              });
            }
            if (low.includes("insufficient funds")) {
              throw respond(402, {
                ok: false,
                code: "ESCROW_FUNDS_INSUFFICIENT",
                error:
                  "Escrow does not hold enough USDC to complete this claim.",
                hint: "Ask the sender to retry or contact support.",
                details: { idx, body },
                traceId,
                partial: { claimedCount: signatures.length, signatures },
              });
            }
            if (low.includes("rate limit")) {
              throw respond(429, {
                ok: false,
                code: "PRIVY_RATE_LIMITED",
                error: "Too many requests right now.",
                hint: "Wait a moment and retry.",
                details: { idx, body },
                traceId,
                partial: { claimedCount: signatures.length, signatures },
              });
            }

            // Unknown Privy error
            throw respond(502, {
              ok: false,
              code: "PRIVY_SIGN_SEND_FAILED",
              error: "Signing or sending failed.",
              hint: "Retry. If this persists, contact support.",
              details: { idx, body },
              traceId,
              partial: { claimedCount: signatures.length, signatures },
            });
          }
        })();

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
      } catch (resp) {
        // If we threw a NextResponse via respond(), bubble it
        if (resp instanceof Response) return resp;

        // Try to detect and attach simulation logs if available
        if (resp instanceof Error) {
          const maybe = resp.message?.toLowerCase?.() ?? "";
          if (maybe.includes("simulation failed")) {
            try {
              const err = resp as unknown as SendTransactionError;
              const logs = await err.getLogs?.(conn);
              return respond(400, {
                ok: false,
                code: "SIMULATION_FAILED",
                error: "Transaction simulation failed.",
                hint: "Retry later. If persistent, contact support.",
                details: { idx, logs },
                traceId,
                partial: { claimedCount: signatures.length, signatures },
              });
            } catch {
              // fallthrough
            }
          }
        }

        // Generic failure
        return respond(500, {
          ok: false,
          code: "SEND_FAILED",
          error: "We couldn’t complete the claim right now.",
          hint: "Retry in a moment. If it persists, contact support.",
          details: { idx, message: String(resp) },
          traceId,
          partial: { claimedCount: signatures.length, signatures },
        });
      }
    }

    return NextResponse.json({
      ok: true,
      claimedCount: pending.length,
      signatures,
      redirect,
      traceId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const low = msg.toLowerCase();

    const isAuth =
      low.includes("unauthorized") || low.includes("user not found");
    if (isAuth) {
      return respond(401, {
        ok: false,
        code: "UNAUTHORIZED",
        error: "Please sign in to claim funds.",
        hint: "Open the link while signed in to the invited email.",
        details: msg,
        traceId,
      });
    }

    return respond(500, {
      ok: false,
      code: "UNHANDLED",
      error: "Unexpected error while claiming funds.",
      hint: "Retry in a moment. If this keeps happening, contact support.",
      details: msg,
      traceId,
    });
  }
}
