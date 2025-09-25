// app/api/jup/send/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  SendTransactionError,
  VersionedTransaction,
} from "@solana/web3.js";
import { PrivyClient } from "@privy-io/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────── env ───────── */
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

/* ───────── helper types (to avoid `any`) ───────── */
type MaybeFn = (() => unknown) | unknown;
type ErrorLike = {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  body?: unknown;
  bodyAsString?: MaybeFn;
};

type MessageV0Subset = {
  staticAccountKeys?: (PublicKey | string)[];
  recentBlockhash?: string;
  header?: { numRequiredSignatures?: number };
  compiledInstructions?: Array<{
    programIdIndex: number;
    accountKeyIndexes: number[];
    data: string;
  }>;
  addressTableLookups?: Array<{
    accountKey: PublicKey;
    writableIndexes: number[];
    readonlyIndexes: number[];
  }>;
  getAccountKeys?: (opts: {
    addressLookupTableAccounts: AddressLookupTableAccount[];
  }) => {
    toArray?: () => (PublicKey | string)[];
    staticAccountKeys?: (PublicKey | string)[];
    accountKeysFromLookups?: {
      writable?: (PublicKey | string)[];
      readonly?: (PublicKey | string)[];
    };
  };
};

type HasSignatures = { signatures?: Uint8Array[] };

type RpcClientShim = {
  _rpcRequest: (method: string, args: unknown[]) => Promise<unknown>;
};

/* ───────── helpers ───────── */
const log = (tag: string, obj: unknown) =>
  console.error(
    `[jup/send] ${tag}`,
    typeof obj === "string" ? obj : JSON.stringify(obj, null, 2)
  );

const shapeErr = (e: unknown) => {
  const r = (e ?? {}) as ErrorLike;
  let message = "";
  try {
    const bas = r.bodyAsString;
    if (typeof bas === "function") message = String(bas());
    else if (typeof r.body === "string") message = r.body;
    else if (typeof r.message === "string") message = r.message;
    else message = String(e);
  } catch {
    message = String(e);
  }
  return {
    name: typeof r.name === "string" ? r.name : "Error",
    message,
    stack: typeof r.stack === "string" ? r.stack : undefined,
  };
};

function json(status: number, body: Record<string, unknown>) {
  log(status >= 400 ? "error" : "info", body);
  return NextResponse.json(body, { status });
}

function summarizeIxs(allKeys: PublicKey[], tx: VersionedTransaction) {
  const msg = tx.message as unknown as MessageV0Subset;
  const list = Array.isArray(msg.compiledInstructions)
    ? msg.compiledInstructions
    : [];
  return list.map((ix, i) => ({
    i,
    program: allKeys[ix.programIdIndex]?.toBase58(),
    accounts: (ix.accountKeyIndexes || [])
      .slice(0, 12)
      .map((idx) => allKeys[idx]?.toBase58()),
    dataLen: typeof ix.data === "string" ? ix.data.length : null,
  }));
}

async function resolveAllMessageKeys(
  conn: Connection,
  tx: VersionedTransaction
) {
  const msgL = tx.message as unknown as MessageV0Subset;
  const lookups = msgL.addressTableLookups ?? [];

  const altAccounts: AddressLookupTableAccount[] = [];
  for (const l of lookups) {
    const { value } = await conn.getAddressLookupTable(l.accountKey);
    if (value) altAccounts.push(value);
  }

  // Try modern accessor first
  const mk = msgL.getAccountKeys?.({
    addressLookupTableAccounts: altAccounts,
  });

  if (mk?.toArray) {
    const arr = mk.toArray() as (PublicKey | string)[];
    const keys = arr.map((k) =>
      k instanceof PublicKey ? k : new PublicKey(k)
    );
    return { keys, alts: altAccounts.map((a) => a.key.toBase58()) };
  }

  // Fallback shape
  const staticSrc: (PublicKey | string)[] =
    mk?.staticAccountKeys ??
    (tx.message as unknown as { staticAccountKeys?: (PublicKey | string)[] })
      .staticAccountKeys ??
    [];
  const staticKeys: PublicKey[] = staticSrc.map((k) =>
    k instanceof PublicKey ? k : new PublicKey(k)
  );

  const fromLut = mk?.accountKeysFromLookups ?? { writable: [], readonly: [] };
  const writable: PublicKey[] = (fromLut.writable ?? []).map((k) =>
    k instanceof PublicKey ? k : new PublicKey(k as string)
  );
  const readonly: PublicKey[] = (fromLut.readonly ?? []).map((k) =>
    k instanceof PublicKey ? k : new PublicKey(k as string)
  );

  return {
    keys: [...staticKeys, ...writable, ...readonly],
    alts: altAccounts.map((a) => a.key.toBase58()),
  };
}

function anyZero(sig: Uint8Array | number[]): boolean {
  for (let i = 0; i < sig.length; i++) if (sig[i] !== 0) return false;
  return true;
}

/* ───────── type guards for Privy signTransaction response ───────── */
function hasSerialize(x: unknown): x is { serialize: () => Uint8Array } {
  return !!x && typeof (x as { serialize?: unknown }).serialize === "function";
}
function hasSignedTransaction(x: unknown): x is { signedTransaction: unknown } {
  return !!x && typeof x === "object" && "signedTransaction" in x;
}
function numberArray(x: unknown): x is number[] {
  return Array.isArray(x) && x.every((n) => typeof n === "number");
}
function toSignedBytes(resp: unknown): Uint8Array {
  // raw base64 string
  if (typeof resp === "string") {
    return new Uint8Array(Buffer.from(resp, "base64"));
  }
  // VersionedTransaction | Transaction-like with serialize
  if (hasSerialize(resp)) {
    return new Uint8Array(resp.serialize());
  }
  // Uint8Array
  if (resp instanceof Uint8Array) {
    return resp;
  }
  // number[] (Node fetch/json sometimes returns arrays)
  if (numberArray(resp)) {
    return new Uint8Array(resp);
  }
  // Object wrapper { signedTransaction: ... }
  if (hasSignedTransaction(resp)) {
    const st = (resp as { signedTransaction: unknown }).signedTransaction;
    if (typeof st === "string") {
      return new Uint8Array(Buffer.from(st, "base64"));
    }
    if (hasSerialize(st)) {
      return new Uint8Array(st.serialize());
    }
    if (st instanceof Uint8Array) {
      return st;
    }
    if (numberArray(st)) {
      return new Uint8Array(st);
    }
  }
  throw new Error("Unexpected signTransaction return type");
}

/* ───────── route ───────── */
export async function POST(req: NextRequest) {
  const traceId = Math.random().toString(36).slice(2, 10);

  try {
    const parsed = (await req.json().catch(() => null)) as {
      transaction?: string;
    } | null;

    const transaction = parsed?.transaction;

    if (!transaction) {
      return json(400, { error: "Missing 'transaction' (base64)", traceId });
    }

    // Decode
    const raw = Buffer.from(transaction, "base64");
    if (raw.length === 0) {
      return json(400, { error: "Invalid transaction encoding", traceId });
    }

    // Deserialize user-signed tx
    let userSignedTx: VersionedTransaction;
    try {
      userSignedTx = VersionedTransaction.deserialize(raw);
    } catch {
      return json(400, { error: "Invalid VersionedTransaction", traceId });
    }

    // Fee payer must be Haven
    const msgShape = userSignedTx.message as unknown as MessageV0Subset;
    const payerRaw = msgShape.staticAccountKeys?.[0];
    const payerPk = (() => {
      try {
        return payerRaw instanceof PublicKey
          ? payerRaw
          : payerRaw
          ? new PublicKey(payerRaw)
          : null;
      } catch {
        return null;
      }
    })();

    if (!payerPk || !payerPk.equals(HAVEN_PUBKEY)) {
      return json(400, {
        error: "Invalid fee payer (must be Haven sponsor wallet)",
        feePayer:
          payerPk?.toBase58() ??
          (typeof payerRaw === "string" ? payerRaw : String(payerRaw ?? null)),
        traceId,
      });
    }

    // Reject dummy blockhash
    const recentBlockhash = msgShape.recentBlockhash;
    if (
      !recentBlockhash ||
      recentBlockhash === "11111111111111111111111111111111"
    ) {
      return json(400, {
        error: "Transaction has invalid/dummy recentBlockhash",
        traceId,
      });
    }

    const conn = new Connection(SOLANA_RPC, "confirmed");

    // Gather pre-cosign debug
    const { keys: allKeys, alts } = await resolveAllMessageKeys(
      conn,
      userSignedTx
    );
    const ixSummary = summarizeIxs(allKeys, userSignedTx);
    const header = msgShape.header ?? {};
    const requiredSignatures: number = header.numRequiredSignatures ?? 0;
    const preSigSlots = (userSignedTx as unknown as HasSignatures).signatures;
    const preSigPresent =
      preSigSlots?.map((s) => (s ? !anyZero(s) : false)) ?? [];

    const baseDebug = {
      traceId,
      feePayer: HAVEN_PUBKEY.toBase58(),
      recentBlockhash,
      requiredSignatures,
      alts,
      ixSummary,
      preSignaturesPresent: preSigPresent as boolean[], // e.g., [userHasSig, payerHasSig?] before co-sign
    };

    // Privy co-sign
    const appPrivy = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET, {
      walletApi: { authorizationPrivateKey: PRIVY_AUTH_PK },
    });

    let coSignedBytes: Uint8Array;
    try {
      const resp = await appPrivy.walletApi.solana.signTransaction({
        walletId: HAVEN_WALLET_ID,
        transaction: userSignedTx, // pass VersionedTransaction
      });

      // Narrow all possible return shapes to Uint8Array without unsafe casts
      coSignedBytes = toSignedBytes(resp);
    } catch (err: unknown) {
      const e = (err ?? {}) as ErrorLike;
      const details =
        (typeof e.bodyAsString === "function" && String(e.bodyAsString())) ||
        (typeof e.body === "string" && e.body) ||
        (typeof e.message === "string" && e.message) ||
        "";
      const low = details.toLowerCase();

      if (low.includes("blockhash not found") || low.includes("expired")) {
        return json(409, {
          error: "Blockhash not found",
          traceId,
          debug: baseDebug,
        });
      }
      if (low.includes("signature verification failure")) {
        return json(400, {
          error:
            "Signature verification failure (message mutated or signer order)",
          traceId,
          debug: baseDebug,
        });
      }

      return json(500, {
        error: "Privy signTransaction failed",
        details: details || "no details",
        traceId,
        debug: baseDebug,
      });
    }

    // After co-sign, verify both signatures are present (no all-zero slots)
    const cosignedTx = VersionedTransaction.deserialize(coSignedBytes);
    const postSigSlots = (cosignedTx as unknown as HasSignatures)
      .signatures as Uint8Array[];
    const postSigPresent = postSigSlots.map((s) => (s ? !anyZero(s) : false));

    // If any required signature slot is empty, fail early with strong debug
    if (
      requiredSignatures > 0 &&
      postSigPresent.slice(0, requiredSignatures).some((v) => !v)
    ) {
      return json(400, {
        error: "Missing required signature(s) after co-sign",
        traceId,
        debug: {
          ...baseDebug,
          postSignaturesPresent: postSigPresent,
          signerKeys: allKeys
            .slice(0, requiredSignatures)
            .map((k) => k.toBase58()),
        },
      });
    }

    // SIMULATE — two-pass, then raw JSON-RPC fallback to surface logs
    try {
      const sim1 = await conn.simulateTransaction(cosignedTx, {
        replaceRecentBlockhash: false,
        commitment: "processed",
        sigVerify: true,
      });
      if (sim1.value.err) {
        const sim2 = await conn.simulateTransaction(cosignedTx, {
          replaceRecentBlockhash: false,
          commitment: "processed",
          sigVerify: false,
        });
        return json(400, {
          error: "Simulation failed",
          simErr: sim2.value.err ?? sim1.value.err,
          logs: sim2.value.logs ?? sim1.value.logs ?? [],
          traceId,
          debug: {
            ...baseDebug,
            postSignaturesPresent: postSigPresent,
          },
        });
      }
    } catch (e1: unknown) {
      // Try again with sigVerify:false to at least get program logs
      try {
        const sim2 = await conn.simulateTransaction(cosignedTx, {
          replaceRecentBlockhash: false,
          commitment: "processed",
          sigVerify: false,
        });
        return json(400, {
          error: "Simulation failed",
          simErr: sim2.value.err ?? shapeErr(e1),
          logs: sim2.value.logs ?? [],
          traceId,
          debug: {
            ...baseDebug,
            postSignaturesPresent: postSigPresent,
          },
        });
      } catch (e2: unknown) {
        // Raw RPC fallback (private client)
        try {
   
          const raw = await (conn as unknown as RpcClientShim)._rpcRequest(
            "simulateTransaction",
            [
              Buffer.from(cosignedTx.serialize()).toString("base64"),
              {
                encoding: "base64",
                commitment: "processed",
                replaceRecentBlockhash: false,
                sigVerify: false,
              },
            ]
          );
          return json(400, {
            error: "Simulation threw",
            rawRpc: raw as Record<string, unknown>,
            traceId,
            debug: {
              ...baseDebug,
              postSignaturesPresent: postSigPresent,
              throws: { first: shapeErr(e1), second: shapeErr(e2) },
            },
          });
        } catch (e3: unknown) {
          return json(400, {
            error: "Simulation threw (raw fallback also threw)",
            traceId,
            debug: {
              ...baseDebug,
              postSignaturesPresent: postSigPresent,
              throws: {
                first: shapeErr(e1),
                second: shapeErr(e2),
                third: shapeErr(e3),
              },
            },
          });
        }
      }
    }

    // SEND
    let signature: string;
    try {
      signature = await conn.sendRawTransaction(coSignedBytes, {
        skipPreflight: false,
        maxRetries: 3,
      });
    } catch (err: unknown) {
      // get simulation logs if possible
      const asSendErr = err as SendTransactionError;
      if (typeof asSendErr?.getLogs === "function") {
        const logs = (await asSendErr.getLogs(conn).catch(() => null)) ?? [];
        return json(400, {
          error: "Send failed",
          reason:
            (typeof (err as ErrorLike)?.message === "string" &&
              (err as ErrorLike).message) ||
            "Simulation failed. See logs for details.",
          logs,
          traceId,
          debug: {
            ...baseDebug,
            postSignaturesPresent: postSigPresent,
          },
        });
      }
      return json(400, {
        error: "Send failed",
        reason:
          (typeof (err as ErrorLike)?.message === "string" &&
            (err as ErrorLike).message) ||
          "unknown",
        logs: [],
        traceId,
        debug: {
          ...baseDebug,
          postSignaturesPresent: postSigPresent,
        },
      });
    }

    // Best-effort confirm
    try {
      const bh = await conn.getLatestBlockhash("confirmed");
      await conn.confirmTransaction({ signature, ...bh }, "confirmed");
    } catch {
      // ignore
    }

    const ok = { signature, traceId };
    log("sent", ok);
    return NextResponse.json(ok);
  } catch (e: unknown) {
    return json(500, { error: shapeErr(e), traceId });
  }
}
