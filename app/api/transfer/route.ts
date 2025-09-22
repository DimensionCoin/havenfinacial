// app/api/transfer/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Connection, VersionedTransaction, PublicKey } from "@solana/web3.js";
import { PrivyClient } from "@privy-io/server-auth";
import { getCaip2 } from "@/lib/solana";

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

type Body =
  | { transaction: string } // client-signed path (recommended)
  // (optional) keep your server-built path signature if you still want it:
  | { toOwner?: string; amountUi?: number };

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body)
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

    // ---- Preferred path: client sends base64 transaction it already signed ----
    if ("transaction" in body && typeof body.transaction === "string") {
      const raw = Buffer.from(body.transaction, "base64");
      const tx = VersionedTransaction.deserialize(raw);

      // Sanity: tx fee payer must be Haven (so server can add fee-payer sig)
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
        walletId: HAVEN_WALLET_ID, // Haven fee payer
        caip2,
        sponsor: false, // we're *adding* the fee-payer sig here
        transaction: tx,
      });

      const conn = new Connection(SOLANA_RPC, "confirmed");
      await confirmSig(conn, hash);

      return NextResponse.json({ signature: hash });
    }

    // ---- (Optional) keep your server-built path here if you still need it ----
    return NextResponse.json(
      { error: "Missing 'transaction' in body" },
      { status: 400 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
