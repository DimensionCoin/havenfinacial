// app/api/transfer/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Connection, VersionedTransaction, PublicKey } from "@solana/web3.js";
import { PrivyClient } from "@privy-io/server-auth";
import { getCaip2 } from "@/lib/solana";
import { verifySession } from "@/lib/auth";
import { createNotificationForTarget } from "@/lib/notifications";
import User from "@/models/User";

/* -------------------------------------------------------------------------- */
/* Config                                                                      */
/* -------------------------------------------------------------------------- */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const SOLANA_RPC = required("NEXT_PUBLIC_SOLANA_RPC");
const PRIVY_APP_ID = required("PRIVY_APP_ID");
const PRIVY_SECRET = required("PRIVY_SECRET_KEY");
const PRIVY_AUTH_PK = required("PRIVY_AUTH_PRIVATE_KEY_B64");
const HAVEN_WALLET_ID = required("HAVEN_FEEPAYER_WALLET_ID");
const HAVEN_PUBKEY = new PublicKey(
  required("NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS")
);

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

type NotifyTarget = {
  toUserId?: string;
  toEmail?: string;
  toOwner?: string; // legacy
  toOwnerBase58?: string; // preferred

  // optional hints (fallbacks only)
  fromName?: string;
  fromOwner58?: string;

  message?: string;
  amountUi?: number; // USD for copy
};

type Body =
  | { transaction: string; notify?: NotifyTarget }
  | { toOwner?: string; amountUi?: number; notify?: NotifyTarget };

type SenderUserLean = {
  email?: string;
  displayName?: string;
  depositWallet?: { address?: string } | null;
} | null;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function readSender(req: NextRequest) {
  const token = req.cookies.get("__session")?.value ?? null;
  const claims = token ? verifySession(token) : null;
  return {
    userId: claims?.userId ?? null,
    email: claims?.email ?? null,
  };
}

async function confirmSig(conn: Connection, sig: string) {
  const bh = await conn.getLatestBlockhash("confirmed");
  const res = await conn.confirmTransaction(
    { signature: sig, ...bh },
    "confirmed"
  );
  if (res.value.err)
    throw new Error(`On-chain error: ${JSON.stringify(res.value.err)}`);
}

/** For v0 messages: the first `numRequiredSignatures` keys are signers.
 * Index 0 must be Haven (fee payer). The *user* sender is the other signer. */
function inferSenderFromTx(tx: VersionedTransaction): string | null {
  try {
    const msg = tx.message;
    const numSigners = msg.header.numRequiredSignatures;
    const signerKeys = msg.staticAccountKeys.slice(0, numSigners);
    const candidate = signerKeys.find((k) => !k.equals(HAVEN_PUBKEY));
    return candidate ? candidate.toBase58() : null;
  } catch {
    return null;
  }
}

/** Reverse-lookup a user by any wallet address fields you store. */
async function lookupUserByAddress(owner58: string) {
  const u = await User.findOne({
    $or: [
      { "depositWallet.address": owner58 },
      { "wallets.address": owner58 }, // keep only if your schema has it
      { "externalWallets.address": owner58 }, // keep only if your schema has it
      { "privyWallets.address": owner58 }, // keep only if your schema has it
    ],
  })
    .select("displayName email")
    .lean<{ displayName?: string; email?: string } | null>();
  return u;
}

/* -------------------------------------------------------------------------- */
/* Route                                                                       */
/* -------------------------------------------------------------------------- */

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body)
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

    const sender = readSender(req); // may be nullish; we’ll fall back to tx

    // Preferred path: client posts a base64-serialized, user-signed tx
    if ("transaction" in body && typeof body.transaction === "string") {
      const raw = Buffer.from(body.transaction, "base64");
      const tx = VersionedTransaction.deserialize(raw);

      // Enforce Haven as fee payer
      const feePayer = tx.message.staticAccountKeys[0];
      if (!feePayer.equals(HAVEN_PUBKEY)) {
        return NextResponse.json(
          { error: "Invalid fee payer (must be Haven)" },
          { status: 400 }
        );
      }

      // Send via Privy server wallet
      const appPrivy = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET, {
        walletApi: { authorizationPrivateKey: PRIVY_AUTH_PK },
      });
      const caip2 = getCaip2();
      const { hash } = await appPrivy.walletApi.solana.signAndSendTransaction({
        walletId: HAVEN_WALLET_ID,
        caip2,
        sponsor: false,
        transaction: tx,
      });

      // Confirm on-chain
      const conn = new Connection(SOLANA_RPC, "confirmed");
      await confirmSig(conn, hash);

      // Build recipient notification (best-effort; do not block)
      const notifyIn = (body.notify ?? undefined) as NotifyTarget | undefined;
      const targetOwner58 =
        notifyIn?.toOwnerBase58 ?? notifyIn?.toOwner ?? undefined;

      if (
        notifyIn &&
        (notifyIn.toUserId || notifyIn.toEmail || targetOwner58)
      ) {
        let senderDisplay: string | null = sender.email ?? null;
        let senderOwner58: string | null = null;

        // 1) Try session user → DB (fast path)
        try {
          const senderUser: SenderUserLean = sender.userId
            ? await User.findById(sender.userId)
                .select("displayName email depositWallet.address")
                .lean<SenderUserLean>()
            : sender.email
            ? await User.findOne({ email: sender.email })
                .select("displayName email depositWallet.address")
                .lean<SenderUserLean>()
            : null;

          if (senderUser) {
            senderDisplay =
              senderUser.displayName ?? senderUser.email ?? senderDisplay;
            senderOwner58 = senderUser.depositWallet?.address ?? null;
          }
        } catch {
          // ignore, keep falling back
        }

        // 2) Infer sender address from tx signers if missing
        if (!senderOwner58) senderOwner58 = inferSenderFromTx(tx);

        // 3) Reverse-lookup display name by address if we still don't have one
        if (senderOwner58 && !senderDisplay) {
          try {
            const match = await lookupUserByAddress(senderOwner58);
            if (match) {
              senderDisplay = match.displayName ?? match.email ?? senderDisplay;
            }
          } catch {
            // ignore lookup failures
          }
        }

        // 4) Accept client hints (last resort)
        if (!senderDisplay && notifyIn.fromName)
          senderDisplay = notifyIn.fromName;
        if (!senderOwner58 && notifyIn.fromOwner58)
          senderOwner58 = notifyIn.fromOwner58;

        // 5) Final fallback: shorten address for display
        if (!senderDisplay && senderOwner58 && senderOwner58.length >= 8) {
          senderDisplay = `${senderOwner58.slice(0, 4)}…${senderOwner58.slice(
            -4
          )}`;
        }

        const prettyAmount =
          typeof notifyIn.amountUi === "number"
            ? notifyIn.amountUi.toLocaleString(undefined, {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 2,
              })
            : null;

        const fallbackMsg = prettyAmount
          ? `You received ${prettyAmount} from ${senderDisplay ?? "a sender"}.`
          : `You received a transfer from ${senderDisplay ?? "a sender"}.`;

        // Fire & forget — denormalize sender fields into notification data
        createNotificationForTarget({
          userId: notifyIn.toUserId,
          email: notifyIn.toEmail,
          owner58: targetOwner58,
          message: notifyIn.message ?? fallbackMsg,
          type: "transfer_received",
          data: {
            signature: hash,
            amountUi: notifyIn.amountUi ?? null,
            fromName: senderDisplay ?? null,
            fromEmail: sender.email ?? null,
            fromOwner58: senderOwner58 ?? null,
          },
        }).catch((e) => console.error("notify error:", e));
      }

      return NextResponse.json({ signature: hash });
    }

    return NextResponse.json(
      { error: "Missing 'transaction' in body" },
      { status: 400 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
