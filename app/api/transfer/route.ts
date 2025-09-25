// app/api/transfer/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  VersionedTransaction,
  PublicKey,
  SendOptions,
  SendTransactionError,
} from "@solana/web3.js";
import { PrivyClient } from "@privy-io/server-auth";
import { verifySession } from "@/lib/auth";
import { createNotificationForTarget } from "@/lib/notifications";
import User from "@/models/User";

/* ───────── Config ───────── */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// MUST match the client RPC used to fetch the blockhash
const SOLANA_RPC = required("NEXT_PUBLIC_SOLANA_RPC");

// Privy server-auth app that owns the Haven fee payer wallet
const PRIVY_APP_ID = required("PRIVY_APP_ID");
const PRIVY_SECRET = required("PRIVY_SECRET_KEY");
const PRIVY_AUTH_PK = required("PRIVY_AUTH_PRIVATE_KEY_B64");
const HAVEN_WALLET_ID = required("HAVEN_FEEPAYER_WALLET_ID");

// Public address of the Haven fee payer (must be tx.payerKey)
const HAVEN_PUBKEY = new PublicKey(
  required("NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS")
);

/* ───────── Types & helpers (no `any`) ───────── */

type NotifyTarget = {
  toUserId?: string;
  toEmail?: string;
  toOwner?: string; // legacy
  toOwnerBase58?: string; // preferred
  fromName?: string;
  fromOwner58?: string;
  message?: string;
  amountUi?: number;
};

type Body = { transaction: string; notify?: NotifyTarget };

type ErrorLike = {
  message?: unknown;
  body?: unknown;
  bodyAsString?: unknown;
};

type MessageV0Subset = {
  staticAccountKeys: PublicKey[];
  header: { numRequiredSignatures: number };
  recentBlockhash?: string;
};

type SignResp =
  | string
  | Uint8Array
  | number[]
  | { serialize: () => Uint8Array }
  | {
      signedTransaction:
        | string
        | Uint8Array
        | number[]
        | { serialize: () => Uint8Array };
    };

// Normalize Privy signTransaction return into bytes
function toSignedBytes(resp: unknown): Uint8Array {
  const asObj = resp as Record<string, unknown> | null;

  const payload =
    asObj && "signedTransaction" in asObj
      ? (asObj.signedTransaction as unknown)
      : resp;

  if (typeof payload === "string") {
    return new Uint8Array(Buffer.from(payload, "base64"));
  }
  if (payload instanceof Uint8Array) {
    return payload;
  }
  if (Array.isArray(payload) && payload.every((n) => typeof n === "number")) {
    return new Uint8Array(payload as number[]);
  }
  if (
    payload &&
    typeof payload === "object" &&
    "serialize" in payload &&
    typeof (payload as { serialize: unknown }).serialize === "function"
  ) {
    return new Uint8Array(
      (payload as { serialize: () => Uint8Array }).serialize()
    );
  }

  throw new Error("Unexpected signTransaction return type");
}

function readSender(req: NextRequest) {
  const token = req.cookies.get("__session")?.value ?? null;
  const claims = token ? verifySession(token) : null;
  return { userId: claims?.userId ?? null, email: claims?.email ?? null };
}

async function confirmSig(conn: Connection, signature: string) {
  try {
    const bh = await conn.getLatestBlockhash("confirmed");
    const res = await conn.confirmTransaction(
      { signature, ...bh },
      "confirmed"
    );
    if (res.value.err) throw new Error(JSON.stringify(res.value.err));
  } catch {
    const res2 = await conn.confirmTransaction(signature, "confirmed");
    if (res2.value.err) throw new Error(JSON.stringify(res2.value.err));
  }
}

/** v0: first `numRequiredSignatures` keys are signers; index 0 is fee payer */
function inferSenderFromTx(tx: VersionedTransaction): string | null {
  try {
    const n = tx.message.header.numRequiredSignatures;
    const signers = tx.message.staticAccountKeys.slice(0, n);
    const other = signers.find((k) => !k.equals(HAVEN_PUBKEY));
    return other ? other.toBase58() : null;
  } catch {
    return null;
  }
}

/* ───────── Route ───────── */

export async function POST(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 }
    );
  }

  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.transaction || typeof body.transaction !== "string") {
      return NextResponse.json(
        { error: "Missing 'transaction' in body" },
        { status: 400 }
      );
    }

    // Keep raw bytes, also a deserialized copy for validation/notify
    const raw = Buffer.from(body.transaction, "base64");
    if (raw.length === 0) {
      return NextResponse.json(
        { error: "Invalid transaction encoding" },
        { status: 400 }
      );
    }

    let userSignedTx: VersionedTransaction;
    try {
      userSignedTx = VersionedTransaction.deserialize(Buffer.from(raw));
    } catch {
      return NextResponse.json(
        { error: "Invalid VersionedTransaction" },
        { status: 400 }
      );
    }

    // Validate Haven fee payer
    const feePayer = userSignedTx.message.staticAccountKeys[0];
    if (!feePayer.equals(HAVEN_PUBKEY)) {
      return NextResponse.json(
        { error: "Invalid fee payer (must be Haven sponsor wallet)" },
        { status: 400 }
      );
    }

    // Reject dummy/empty blockhash
    const recentBlockhash = (userSignedTx.message as unknown as MessageV0Subset)
      .recentBlockhash;
    if (
      !recentBlockhash ||
      recentBlockhash === "11111111111111111111111111111111"
    ) {
      return NextResponse.json(
        { error: "Transaction has invalid/dummy recentBlockhash" },
        { status: 400 }
      );
    }

    // Co-sign via Privy SDK (server-auth). No REST headers, no rpcUrl option.
    const appPrivy = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET, {
      walletApi: { authorizationPrivateKey: PRIVY_AUTH_PK },
    });

    let coSignedBytes: Uint8Array;
    try {
      const resp: unknown = await appPrivy.walletApi.solana.signTransaction({
        walletId: HAVEN_WALLET_ID,
        transaction: userSignedTx, // pass the object, not bytes
      });

      coSignedBytes = toSignedBytes(resp as SignResp);
    } catch (err: unknown) {
      const e = err as ErrorLike;
      const details =
        (typeof e.bodyAsString === "function" &&
          String((e.bodyAsString as () => unknown)())) ||
        (typeof e.body === "string" && e.body) ||
        (typeof e.message === "string" && e.message) ||
        "";
      const low = (details || "").toLowerCase();

      if (low.includes("blockhash not found") || low.includes("expired")) {
        return NextResponse.json(
          { error: "Blockhash not found" },
          { status: 409 }
        );
      }
      if (low.includes("signature verification failure")) {
        return NextResponse.json(
          {
            error:
              "Signature verification failure (message mutated or signer order)",
          },
          { status: 400 }
        );
      }

      console.error("[/api/transfer] Privy signTransaction failed", {
        details,
      });
      return NextResponse.json(
        {
          error: "Privy signTransaction failed",
          details: details || "no details",
        },
        { status: 500 }
      );
    }

    // Broadcast via YOUR RPC (same RPC client used for blockhash)
    const conn = new Connection(SOLANA_RPC, "confirmed");
    const sendOpts: SendOptions = { skipPreflight: false, maxRetries: 3 };

    let signature: string;
    try {
      signature = await conn.sendRawTransaction(coSignedBytes, sendOpts);
    } catch (err: unknown) {
      const msg = String(
        (err as { message?: unknown })?.message ?? err
      ).toLowerCase();

      if (msg.includes("blockhash not found") || msg.includes("expired")) {
        return NextResponse.json(
          { error: "Blockhash not found" },
          { status: 409 }
        );
      }

      if (typeof (err as SendTransactionError)?.getLogs === "function") {
        try {
          const logs = await (err as SendTransactionError).getLogs(conn);
          console.error("[/api/transfer] Simulation logs:", logs);
          return NextResponse.json(
            { error: "Simulation failed", logs: logs ?? [] },
            { status: 400 }
          );
        } catch {
          // ignore getLogs failures
        }
      }

      console.error("[/api/transfer] sendRawTransaction error:", err);
      return NextResponse.json(
        {
          error: "Broadcast failed",
          details: String((err as { message?: unknown })?.message ?? err),
        },
        { status: 500 }
      );
    }

    // Confirm best-effort
    await confirmSig(conn, signature);

    // Optional: notify recipient
    const notify = body.notify;
    if (
      notify &&
      (notify.toUserId ||
        notify.toEmail ||
        notify.toOwnerBase58 ||
        notify.toOwner)
    ) {
      const sender = readSender(req);
      let senderDisplay: string | null = sender.email ?? null;
      const senderOwner58: string | null = inferSenderFromTx(userSignedTx);

      if (senderOwner58 && !senderDisplay) {
        try {
          const u = await User.findOne({
            $or: [
              { "depositWallet.address": senderOwner58 },
              { "wallets.address": senderOwner58 },
              { "externalWallets.address": senderOwner58 },
              { "privyWallets.address": senderOwner58 },
            ],
          })
            .select("displayName email")
            .lean<{ displayName?: string; email?: string } | null>();
          senderDisplay = u?.displayName ?? u?.email ?? senderDisplay;
        } catch {
          // ignore lookup error
        }
      }
      if (!senderDisplay && senderOwner58 && senderOwner58.length >= 8) {
        senderDisplay = `${senderOwner58.slice(0, 4)}…${senderOwner58.slice(
          -4
        )}`;
      }

      const prettyAmount =
        typeof notify.amountUi === "number"
          ? notify.amountUi.toLocaleString(undefined, {
              style: "currency",
              currency: "USD",
              maximumFractionDigits: 2,
            })
          : null;

      const fallbackMsg = prettyAmount
        ? `You received ${prettyAmount} from ${senderDisplay ?? "a sender"}.`
        : `You received a transfer from ${senderDisplay ?? "a sender"}.`;

      createNotificationForTarget({
        userId: notify.toUserId,
        email: notify.toEmail,
        owner58: notify.toOwnerBase58 ?? notify.toOwner ?? undefined,
        message: notify.message ?? fallbackMsg,
        type: "transfer_received",
        data: {
          signature,
          amountUi: notify.amountUi ?? null,
          fromName: senderDisplay ?? null,
          fromEmail: sender.email ?? null,
          fromOwner58: senderOwner58 ?? null,
        },
      }).catch((e) => console.error("notify error:", e));
    }

    return NextResponse.json({ signature });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/transfer] Unhandled error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
