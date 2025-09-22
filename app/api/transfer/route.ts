// app/api/transfer/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Connection, VersionedTransaction, PublicKey } from "@solana/web3.js";
import { PrivyClient } from "@privy-io/server-auth";
import { getCaip2 } from "@/lib/solana";
// NOTE: we only used this to show the sender in the fallback message;
// if it returns null, we just show "a sender".
import { verifySession } from "@/lib/auth";
import { createNotificationForTarget } from "@/lib/notifications";

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

async function confirmSig(conn: Connection, sig: string) {
  const bh = await conn.getLatestBlockhash("confirmed");
  const res = await conn.confirmTransaction(
    { signature: sig, ...bh },
    "confirmed"
  );
  if (res.value.err)
    throw new Error(`On-chain error: ${JSON.stringify(res.value.err)}`);
}

// 🔧 Extend to accept `toOwnerBase58` (what the client sends)
type NotifyTarget = {
  toUserId?: string;
  toEmail?: string;
  /** legacy name your route used earlier */
  toOwner?: string;
  /** new name your client sends; both are supported */
  toOwnerBase58?: string;
  message?: string;
  amountUi?: number;
};

type Body =
  | {
      transaction: string;
      notify?: NotifyTarget;
    }
  | {
      toOwner?: string;
      amountUi?: number;
      notify?: NotifyTarget;
    };

function readSender(req: NextRequest) {
  const token = req.cookies.get("__session")?.value ?? null;
  const claims = token ? verifySession(token) : null;
  return {
    userId: claims?.userId ?? null,
    email: claims?.email ?? null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body)
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

    const sender = readSender(req); // may be null; that's OK for the message

    // ---- Preferred path: client sends a base64-serialized, user-signed tx ----
    if ("transaction" in body && typeof body.transaction === "string") {
      const raw = Buffer.from(body.transaction, "base64");
      const tx = VersionedTransaction.deserialize(raw);

      // Sanity: Haven must be fee payer (server adds fee-payer sig)
      const feePayer = tx.message.staticAccountKeys[0];
      if (!feePayer.equals(HAVEN_PUBKEY)) {
        return NextResponse.json(
          { error: "Invalid fee payer (must be Haven)" },
          { status: 400 }
        );
      }

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

      const conn = new Connection(SOLANA_RPC, "confirmed");
      await confirmSig(conn, hash);

      // ---- Create recipient notification (best-effort, non-blocking) ----
      const notifyIn = body.notify as NotifyTarget | undefined;

      // Accept *either* `toOwnerBase58` (new) or `toOwner` (legacy)
      const owner58 = notifyIn?.toOwnerBase58 ?? notifyIn?.toOwner ?? undefined;

      if (notifyIn && (notifyIn.toUserId || notifyIn.toEmail || owner58)) {
        const prettyAmount =
          typeof notifyIn.amountUi === "number"
            ? notifyIn.amountUi.toLocaleString(undefined, {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 2,
              })
            : null;

        const fallbackMsg = prettyAmount
          ? `You received ${prettyAmount} from ${sender.email ?? "a sender"}.`
          : `You received a transfer from ${sender.email ?? "a sender"}.`;

        // Fire-and-forget — do not block the response
        createNotificationForTarget({
          userId: notifyIn.toUserId,
          email: notifyIn.toEmail,
          owner58, // <-- resolved from toOwnerBase58 or toOwner
          message: notifyIn.message ?? fallbackMsg,
          type: "transfer_received",
          data: {
            signature: hash,
            from: sender.email ?? sender.userId ?? null,
            toOwner: owner58 ?? null,
            amountUi: notifyIn.amountUi ?? null,
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
