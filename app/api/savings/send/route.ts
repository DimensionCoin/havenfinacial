// app/api/savings/send/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  SendTransactionError,
  VersionedTransaction,
} from "@solana/web3.js";
import { PrivyClient } from "@privy-io/server-auth";

// 🔐 DB
import { connect } from "@/lib/db";
import User from "@/models/User";

/* ───────── env ───────── */
function required(name: string) {
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
// Optional convenience; used as a fallback if client doesn't pass usdcBankPk
const DEFAULT_USDC_BANK_PK = process.env.NEXT_PUBLIC_MARGINFI_USDC_BANK || "";

/* ───────── helpers ───────── */
type ErrorLike = {
  message?: unknown;
  body?: unknown;
  bodyAsString?: unknown;
};

function json(status: number, body: Record<string, unknown>) {
  if (status >= 400) console.error("[/api/savings/send]", body);
  return NextResponse.json(body, { status });
}

function toSignedBytes(resp: unknown): Uint8Array {
  if (typeof resp === "string")
    return new Uint8Array(Buffer.from(resp, "base64"));
  if (resp instanceof Uint8Array) return resp;
  if (Array.isArray(resp) && resp.every((n) => typeof n === "number"))
    return new Uint8Array(resp);
  if (resp && typeof resp === "object" && "serialize" in resp) {
    return new Uint8Array(
      (resp as { serialize: () => Uint8Array }).serialize()
    );
  }
  if (resp && typeof resp === "object" && "signedTransaction" in resp) {
    const st = (resp as { signedTransaction: unknown }).signedTransaction;
    return toSignedBytes(st);
  }
  throw new Error("Unexpected signTransaction return type");
}

async function resolveAllMessageKeys(
  conn: Connection,
  tx: VersionedTransaction
): Promise<PublicKey[]> {
  const message = tx.message;
  const lookups = message.addressTableLookups ?? [];
  const alts: AddressLookupTableAccount[] = [];
  for (const l of lookups) {
    const { value } = await conn.getAddressLookupTable(l.accountKey);
    if (value) alts.push(value);
  }
  if (message.version === 0) {
    const resolved = message.resolveAddressTableLookups(alts);
    return [
      ...message.staticAccountKeys,
      ...(resolved?.writable ?? []),
      ...(resolved?.readonly ?? []),
    ];
  }
  return message.staticAccountKeys ?? [];
}

/* ───────── route ───────── */
export async function POST(req: NextRequest) {
  try {
    const parsed = (await req.json().catch(() => null)) as {
      signedTxB64?: string; // preferred
      transaction?: string; // legacy key accepted
      owner58?: string; // user's wallet (authority)
      marginfiAccount?: string;
      userUsdcAta?: string;
      usdcBankPk?: string; // optional override
      privyId?: string; // optional: stronger lookup key
    } | null;

    const signedTxB64 = parsed?.signedTxB64 ?? parsed?.transaction;
    if (!signedTxB64)
      return json(400, { error: "Missing 'signedTxB64' (base64)" });

    // --- decode & basic validation ---
    const raw = Buffer.from(signedTxB64, "base64");
    if (!raw.length)
      return json(400, { error: "Invalid transaction encoding" });

    let userSignedTx: VersionedTransaction;
    try {
      userSignedTx = VersionedTransaction.deserialize(raw);
    } catch {
      return json(400, { error: "Invalid VersionedTransaction" });
    }

    // Haven must be the payer (sponsored fees)
    const payerRaw = userSignedTx.message.staticAccountKeys?.[0];
    const payer =
      payerRaw instanceof PublicKey
        ? payerRaw
        : payerRaw
        ? new PublicKey(payerRaw)
        : null;
    if (!payer || !payer.equals(HAVEN_PUBKEY)) {
      return json(400, {
        error: "Invalid fee payer (must be Haven sponsor wallet)",
        feePayer: payer?.toBase58() ?? String(payerRaw ?? null),
      });
    }

    // Reject dummy/empty blockhash
    const recentBlockhash = userSignedTx.message.recentBlockhash;
    if (
      !recentBlockhash ||
      recentBlockhash === "11111111111111111111111111111111"
    ) {
      return json(400, { error: "Transaction has invalid recentBlockhash" });
    }

    const conn = new Connection(SOLANA_RPC, "confirmed");

    // Optional debug to force ALT resolution (no-op if none)
    await resolveAllMessageKeys(conn, userSignedTx).catch(() => null);

    // --- co-sign with Privy as fee payer ---
    const appPrivy = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET, {
      walletApi: { authorizationPrivateKey: PRIVY_AUTH_PK },
    });

    let cosignedBytes: Uint8Array;
    try {
      const resp = await appPrivy.walletApi.solana.signTransaction({
        walletId: HAVEN_WALLET_ID,
        transaction: userSignedTx,
      });
      cosignedBytes = toSignedBytes(resp);
    } catch (e: unknown) {
      const errorLike = e as ErrorLike;
      let msg: string | undefined;

      if (typeof errorLike?.bodyAsString === "function") {
        try {
          msg = String(errorLike.bodyAsString());
        } catch {
          msg = undefined;
        }
      }

      if (!msg && errorLike?.message != null) {
        msg = String(errorLike.message);
      }

      if (!msg) msg = "Privy signTransaction failed";
      const low = msg.toLowerCase();
      if (low.includes("blockhash not found") || low.includes("expired"))
        return json(409, { error: "Blockhash not found" });
      return json(500, { error: "Privy signTransaction failed", details: msg });
    }

    // --- simulate for clearer errors (non-fatal if simulate throws) ---
    try {
      const sim = await conn.simulateTransaction(
        VersionedTransaction.deserialize(cosignedBytes),
        {
          replaceRecentBlockhash: false,
          commitment: "processed",
          sigVerify: true,
        }
      );
      if (sim.value.err) {
        return json(400, {
          error: "Simulation failed",
          logs: sim.value.logs ?? [],
        });
      }
    } catch {
      // ignore; continue to send
    }

    // --- broadcast ---
    let signature: string;
    try {
      signature = await conn.sendRawTransaction(cosignedBytes, {
        skipPreflight: false,
        maxRetries: 3,
      });
    } catch (err) {
      const se = err as SendTransactionError;
      if (typeof se?.getLogs === "function") {
        const logs = (await se.getLogs(conn).catch(() => null)) ?? [];
        return json(400, { error: "Send failed", logs });
      }
      const details = err instanceof Error ? err.message : String(err);
      return json(400, {
        error: "Send failed",
        details,
      });
    }

    // best-effort confirm (don't block)
    try {
      const bh = await conn.getLatestBlockhash("confirmed");
      await conn.confirmTransaction({ signature, ...bh }, "confirmed");
    } catch {}

    // --- persist linkage in Mongo (non-fatal) ---
    const saved: {
      owner58: string | null;
      marginfiAccount: string | null;
      userUsdcAta: string | null;
      usdcBankPk: string | null;
      privyId: string | null;
      updated: boolean;
    } = {
      owner58: parsed?.owner58 ?? null,
      marginfiAccount: parsed?.marginfiAccount ?? null,
      userUsdcAta: parsed?.userUsdcAta ?? null,
      usdcBankPk: parsed?.usdcBankPk ?? (DEFAULT_USDC_BANK_PK || null),
      privyId: parsed?.privyId ?? null,
      updated: false,
    };

    try {
      // only attempt if we have *some* way to find the user
      const findQuery =
        (saved.privyId && { privyId: saved.privyId }) ||
        (saved.owner58 && { "depositWallet.address": saved.owner58 }) ||
        null;

      if (findQuery) {
        await connect();

        const $set: Record<string, unknown> = {};
        if (saved.owner58) $set["depositWallet.address"] = saved.owner58;
        if (saved.marginfiAccount)
          $set["marginfi.accountPk"] = saved.marginfiAccount;
        if (saved.usdcBankPk) $set["marginfi.usdcBankPk"] = saved.usdcBankPk;
        if (saved.userUsdcAta)
          $set["tokenAccounts.usdc2022.depositAta"] = saved.userUsdcAta;

        if (Object.keys($set).length > 0) {
          const updated = await User.findOneAndUpdate(
            findQuery,
            { $set },
            { new: true }
          ).lean();
          saved.updated = !!updated;
          if (!updated) {
            console.warn(
              "[/api/savings/send] User not found for update",
              findQuery
            );
          }
        }
      } else {
        console.warn(
          "[/api/savings/send] No privyId/owner58 provided; skipping DB update"
        );
      }
    } catch (dbErr) {
      // never fail the on-chain success due to DB write
      console.error("[/api/savings/send] DB update error", dbErr);
    }

    // --- done ---
    return NextResponse.json({
      ok: true,
      signature,
      saved,
    });
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    return json(500, { error: errorMessage });
  }
}
