// hooks/useServerSponsoredJupSwap.ts
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { VersionedTransaction, PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";

declare global {
  interface Window {
    Buffer?: typeof Buffer;
  }
}

if (typeof window !== "undefined") {
  window.Buffer = window.Buffer || Buffer;
}

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC!;
const FLAT_FEE_USD = 0.25;
const USDC_DECIMALS = 6;

/* ----------------------------- types ----------------------------- */

export type SwapInput = {
  fromOwnerBase58: string;
  outputMint: string;
  amountDisplay: number; // user-entered in display currency
  fxRate: number; // display -> USD
  accessToken?: string | null;
};

type HttpDebug = {
  url: string;
  method: string;
  status: number;
  ok: boolean;
  durationMs: number;
  headers: Record<string, string>;
  rawText: string | null;
  json: unknown; // best-effort parsed
};

export type SwapAttemptDebug = {
  attemptId: string;
  startedAt: string;
  inputs: {
    fromOwnerBase58: string;
    outputMint: string;
    amountDisplay: number;
    fxRate: number;
    netInAmountUnits: number;
  };
  build?: HttpDebug & { endpoint: "build" };
  send?: HttpDebug & { endpoint: "send" };
};

type SwapState = {
  loading: boolean;
  signature: string | null;
  error: string | null;
  last?: SwapAttemptDebug;
};

/* --------------------------- utils/debug -------------------------- */

function headersToRecord(h: Headers) {
  const rec: Record<string, string> = {};
  for (const [k, v] of h.entries()) rec[k.toLowerCase()] = v;
  return rec;
}

async function fetchWithDebug(
  url: string,
  init: RequestInit
): Promise<HttpDebug & { res: Response }> {
  const t0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const res = await fetch(url, init);
  const rawText = await res.text().catch(() => null);
  let json: unknown = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {}
  const t1 =
    typeof performance !== "undefined" ? performance.now() : Date.now();

  return {
    res,
    url,
    method: (init.method || "GET").toUpperCase(),
    status: res.status,
    ok: res.ok,
    durationMs: Math.round(t1 - t0),
    headers: headersToRecord(res.headers),
    rawText,
    json,
  };
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function shortLogs(input: unknown, maxLines = 10) {
  if (!isJsonObject(input) || !Array.isArray(input.logs)) return null;
  const logs = input.logs.filter(
    (item): item is string => typeof item === "string"
  );
  if (!logs.length) return null;
  const tail = logs.slice(-maxLines);
  return tail.join("\n");
}

function printAttemptToConsole(tag: string, dbg: SwapAttemptDebug) {
  const title = `[${tag}] swap attempt ${dbg.attemptId}`;
  console.groupCollapsed(title);
  console.log("inputs", dbg.inputs);

  if (dbg.build) {
    console.groupCollapsed(
      "build",
      `${dbg.build.status} ${dbg.build.ok ? "OK" : "ERROR"} • ${
        dbg.build.durationMs
      }ms`
    );
    console.log("request", { url: dbg.build.url, method: dbg.build.method });
    console.log("response.headers", dbg.build.headers);
    console.log("response.json", dbg.build.json);
    if (!dbg.build.json && dbg.build.rawText) {
      console.log("response.text", dbg.build.rawText);
    }
    console.groupEnd();
  }

  if (dbg.send) {
    const sendJson = dbg.send.json;
    console.groupCollapsed(
      "send",
      `${dbg.send.status} ${dbg.send.ok ? "OK" : "ERROR"} • ${
        dbg.send.durationMs
      }ms`
    );
    console.log("request", { url: dbg.send.url, method: dbg.send.method });
    console.log("response.headers", dbg.send.headers);
    console.log("response.json", sendJson);

    let debugInfo: JsonObject | null = null;
    if (isJsonObject(sendJson) && isJsonObject(sendJson.debug)) {
      debugInfo = sendJson.debug;
    }
    if (debugInfo && "ixSummary" in debugInfo) {
      console.log("ixSummary", debugInfo.ixSummary);
    }
    if (debugInfo && "alts" in debugInfo) {
      console.log("alts", debugInfo.alts);
    }

    const logsTail = shortLogs(sendJson);
    if (logsTail) {
      console.log("logs (tail)", logsTail);
    }

    if (!sendJson && dbg.send.rawText) {
      console.log("response.text", dbg.send.rawText);
    }
    console.groupEnd();
  }
  console.groupEnd();
}

function makeAttemptId() {
  return Math.random().toString(36).slice(2, 10);
}

function readStringProp(obj: JsonObject, key: string): string | null {
  return readString(obj[key]);
}

function extractErrorField(obj: JsonObject): string | null {
  const raw = obj.error;
  if (raw instanceof Error) return raw.message;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "message" in raw) {
    const maybe = (raw as { message?: unknown }).message;
    if (typeof maybe === "string") return maybe;
  }
  return null;
}

type AugmentedError = Error & {
  __retryableSession?: boolean;
  __server?: unknown;
};

function markError<T extends Error>(err: T, extra: Partial<AugmentedError>) {
  const enriched = err as AugmentedError;
  Object.assign(enriched, extra);
  return enriched;
}

/* ---------------------------- main hook --------------------------- */

export function useServerSponsoredJupSwap() {
  const [{ loading, signature, error, last }, setState] = useState<SwapState>({
    loading: false,
    signature: null,
    error: null,
    last: undefined,
  });

  const { login, getAccessToken } = usePrivy();
  const { wallets } = useSolanaWallets();
  const inflight = useRef<AbortController | null>(null);

  const cleanupInflight = () => {
    inflight.current?.abort();
    inflight.current = null;
  };

  const doOnce = useCallback(
    async (payload: {
      fromOwnerBase58: string;
      outputMint: string;
      inAmountUnits: number;
      accessToken?: string | null;
      attemptId: string;
      inputsForDebug: SwapAttemptDebug["inputs"];
    }) => {
      const attempt: SwapAttemptDebug = {
        attemptId: payload.attemptId,
        startedAt: new Date().toISOString(),
        inputs: payload.inputsForDebug,
      };

      setState((s) => ({ ...s, last: attempt }));

      const headers: HeadersInit = {
        "Content-Type": "application/json",
        ...(payload.accessToken
          ? { Authorization: `Bearer ${payload.accessToken}` }
          : {}),
      };

      inflight.current = new AbortController();

      /* 1) BUILD (server returns an **unsigned** v0 tx base64 with Haven as fee payer) */
      const build = await fetchWithDebug("/api/jup/build", {
        method: "POST",
        headers,
        body: JSON.stringify({
          fromOwnerBase58: payload.fromOwnerBase58,
          outputMint: payload.outputMint,
          amountUnits: payload.inAmountUnits,
          slippageBps: 50,
        }),
        cache: "no-store",
        credentials: "include",
        signal: inflight.current.signal,
      });

      attempt.build = { ...build, endpoint: "build" };
      setState((s) => ({
        ...s,
        last: { ...(s.last || attempt), build: attempt.build },
      }));
      printAttemptToConsole("BUILD", attempt);

      const buildJson = isJsonObject(build.json) ? build.json : {};
      const transaction = readStringProp(buildJson, "transaction");
      if (!build.ok || !transaction) {
        const msg =
          extractErrorField(buildJson) || `Build failed: HTTP ${build.status}`;
        throw markError(new Error(msg), { __server: build.json });
      }

      /* 2) USER SIG (client) — sign the VersionedTransaction with the user's embedded wallet */
      // Find the user's wallet by address
      const userWallet = wallets.find(
        (w) => w.address === payload.fromOwnerBase58
      );
      if (!userWallet) {
        throw new Error("Source wallet not available for signing.");
      }

      // Deserialize → sign → serialize
      const unsignedBytes = Buffer.from(transaction, "base64");
      const unsignedTx = VersionedTransaction.deserialize(unsignedBytes);

      // Safety: make sure the user’s pubkey is actually one of the required signers
      type MessageWithKeys = {
        header?: { numRequiredSignatures?: number };
        staticAccountKeys?: PublicKey[];
      };

      const message = unsignedTx.message as unknown as MessageWithKeys;
      const required = Number(message.header?.numRequiredSignatures ?? 0);
      const staticKeys = Array.isArray(message.staticAccountKeys)
        ? message.staticAccountKeys
        : [];
      const signerKeys = staticKeys
        .slice(0, required)
        .map((k) => (k instanceof PublicKey ? k : new PublicKey(k)));
      const userIsSigner = signerKeys.some(
        (k) => k.toBase58() === payload.fromOwnerBase58
      );
      if (!userIsSigner) {
        throw new Error(
          "Built transaction is missing the user as a required signer."
        );
      }

      const userSignedTx = await userWallet.signTransaction(unsignedTx);
      const userSignedB64 = Buffer.from(userSignedTx.serialize()).toString(
        "base64"
      );

      /* 3) SEND (server) — Haven co-signs as fee payer, simulates, and broadcasts */
      const send = await fetchWithDebug("/api/jup/send", {
        method: "POST",
        headers,
        body: JSON.stringify({ transaction: userSignedB64 }),
        cache: "no-store",
        credentials: "include",
        signal: inflight.current!.signal,
      });

      attempt.send = { ...send, endpoint: "send" };
      setState((s) => ({
        ...s,
        last: { ...(s.last || attempt), send: attempt.send },
      }));
      printAttemptToConsole("SEND", attempt);

      // special case: expired user session (if your server uses it)
      const sendJson = isJsonObject(send.json) ? send.json : {};
      if (send.status === 440) {
        const msg = extractErrorField(sendJson) || "User session expired";
        throw markError(new Error(msg), {
          __retryableSession: true,
          __server: send.json,
        });
      }

      const signature = readStringProp(sendJson, "signature");
      if (!send.ok || !signature) {
        const parts: string[] = [];
        const errorField = extractErrorField(sendJson);
        if (errorField) parts.push(errorField);
        const tail = shortLogs(sendJson);
        if (tail) parts.push(tail);
        if (
          isJsonObject(sendJson.debug) &&
          sendJson.debug !== null &&
          "ixSummary" in sendJson.debug
        ) {
          parts.push(
            "ixSummary: " +
              JSON.stringify(
                (sendJson.debug as Record<string, unknown>).ixSummary
              )
          );
        }
        const msg = parts.length
          ? parts.join("\n\n")
          : `Broadcast failed: HTTP ${send.status}\n${send.rawText ?? ""}`;
        throw markError(new Error(msg), { __server: send.json });
      }

      return signature;
    },
    [wallets]
  );

  const swap = useCallback(
    async ({
      fromOwnerBase58,
      outputMint,
      amountDisplay,
      fxRate,
      accessToken,
    }: SwapInput) => {
      cleanupInflight();
      setState({
        loading: true,
        signature: null,
        error: null,
        last: undefined,
      });

      const attemptId = makeAttemptId();
      try {
        if (!RPC?.includes("mainnet")) {
          throw new Error("RPC must be a MAINNET endpoint.");
        }
        if (!outputMint) throw new Error("Missing output mint.");
        if (!fromOwnerBase58) throw new Error("Missing user owner address.");

        // Convert display → USD → minus flat fee → USDC base units
        const grossUsd =
          Number.isFinite(amountDisplay) && amountDisplay > 0
            ? amountDisplay / (fxRate || 1)
            : 0;
        if (grossUsd <= FLAT_FEE_USD) {
          throw new Error("Amount must exceed the $0.25 fee.");
        }
        const netUsd = grossUsd - FLAT_FEE_USD;
        const inAmountUnits = Math.floor(netUsd * 10 ** USDC_DECIMALS);
        if (inAmountUnits <= 0) throw new Error("Net amount too small.");

        const inputsForDebug: SwapAttemptDebug["inputs"] = {
          fromOwnerBase58,
          outputMint,
          amountDisplay,
          fxRate,
          netInAmountUnits: inAmountUnits,
        };

        // first attempt
        try {
          const sig = await doOnce({
            fromOwnerBase58,
            outputMint,
            inAmountUnits,
            accessToken,
            attemptId,
            inputsForDebug,
          });
          setState((s) => ({ ...s, loading: false, signature: sig }));
          return sig;
        } catch (err: unknown) {
          const enriched = err as AugmentedError;
          if (enriched.__retryableSession) {
            // refresh user session and retry once
            await login();
            const fresh = await getAccessToken();

            const sig = await doOnce({
              fromOwnerBase58,
              outputMint,
              inAmountUnits,
              accessToken: fresh,
              attemptId: attemptId + "-retry",
              inputsForDebug,
            });
            setState((s) => ({ ...s, loading: false, signature: sig }));
            return sig;
          }
          throw err;
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        setState((s) => ({ ...s, loading: false, error: message }));
        // eslint-disable-next-line no-console
        console.error(
          "[useServerSponsoredJupSwap] failed:",
          message,
          (e as AugmentedError)?.__server || {}
        );
        throw e;
      } finally {
        cleanupInflight();
      }
    },
    [doOnce, getAccessToken, login]
  );

  const reset = useCallback(() => {
    cleanupInflight();
    setState({ loading: false, signature: null, error: null, last: undefined });
  }, []);

  const state = useMemo(
    () => ({ loading, signature, error, last }),
    [loading, signature, error, last]
  );

  return { swap, reset, ...state };
}
