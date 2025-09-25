// hooks/useServerSponsoredJupSwap.ts
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { VersionedTransaction, PublicKey } from "@solana/web3.js";

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
  json: any; // best-effort parsed
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
  let json: any = null;
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

function shortLogs(j: any, maxLines = 10) {
  const logs = Array.isArray(j?.logs) ? (j.logs as string[]) : [];
  if (!logs.length) return null;
  const tail = logs.slice(-maxLines);
  return tail.join("\n");
}

function printAttemptToConsole(tag: string, dbg: SwapAttemptDebug) {
  const title = `[${tag}] swap attempt ${dbg.attemptId}`;
  // eslint-disable-next-line no-console
  console.groupCollapsed(title);
  // eslint-disable-next-line no-console
  console.log("inputs", dbg.inputs);

  if (dbg.build) {
    // eslint-disable-next-line no-console
    console.groupCollapsed(
      "build",
      `${dbg.build.status} ${dbg.build.ok ? "OK" : "ERROR"} • ${
        dbg.build.durationMs
      }ms`
    );
    // eslint-disable-next-line no-console
    console.log("request", { url: dbg.build.url, method: dbg.build.method });
    // eslint-disable-next-line no-console
    console.log("response.headers", dbg.build.headers);
    // eslint-disable-next-line no-console
    console.log("response.json", dbg.build.json);
    if (!dbg.build.json && dbg.build.rawText) {
      // eslint-disable-next-line no-console
      console.log("response.text", dbg.build.rawText);
    }
    // eslint-disable-next-line no-console
    console.groupEnd();
  }

  if (dbg.send) {
    // eslint-disable-next-line no-console
    console.groupCollapsed(
      "send",
      `${dbg.send.status} ${dbg.send.ok ? "OK" : "ERROR"} • ${
        dbg.send.durationMs
      }ms`
    );
    // eslint-disable-next-line no-console
    console.log("request", { url: dbg.send.url, method: dbg.send.method });
    // eslint-disable-next-line no-console
    console.log("response.headers", dbg.send.headers);
    // eslint-disable-next-line no-console
    console.log("response.json", dbg.send.json);

    const ixSummary = dbg.send.json?.debug?.ixSummary;
    if (ixSummary) {
      // eslint-disable-next-line no-console
      console.log("ixSummary", ixSummary);
    }
    const alts = dbg.send.json?.debug?.alts;
    if (alts) {
      // eslint-disable-next-line no-console
      console.log("alts", alts);
    }

    const logsTail = shortLogs(dbg.send.json);
    if (logsTail) {
      // eslint-disable-next-line no-console
      console.log("logs (tail)", logsTail);
    }

    if (!dbg.send.json && dbg.send.rawText) {
      // eslint-disable-next-line no-console
      console.log("response.text", dbg.send.rawText);
    }
    // eslint-disable-next-line no-console
    console.groupEnd();
  }
  // eslint-disable-next-line no-console
  console.groupEnd();
}

function makeAttemptId() {
  return Math.random().toString(36).slice(2, 10);
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

      if (!build.ok || !build.json?.transaction) {
        const msg = build.json?.error || `Build failed: HTTP ${build.status}`;
        const err: any = new Error(msg);
        err.__server = build.json;
        throw err;
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
      const unsignedBytes = Buffer.from(build.json.transaction, "base64");
      const unsignedTx = VersionedTransaction.deserialize(unsignedBytes);

      // Safety: make sure the user’s pubkey is actually one of the required signers
      const required =
        (unsignedTx.message.header.numRequiredSignatures ?? 0) >>> 0;
      const staticKeys = (unsignedTx.message as any)
        .staticAccountKeys as PublicKey[];
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
      if (send.status === 440) {
        const err: any = new Error(send.json?.error || "User session expired");
        err.__retryableSession = true;
        err.__server = send.json;
        throw err;
      }

      if (!send.ok || !send.json?.signature) {
        const parts: string[] = [];
        if (send.json?.error) parts.push(String(send.json.error));
        const tail = shortLogs(send.json);
        if (tail) parts.push(tail);
        if (send.json?.debug?.ixSummary) {
          parts.push("ixSummary: " + JSON.stringify(send.json.debug.ixSummary));
        }
        const msg = parts.length
          ? parts.join("\n\n")
          : `Broadcast failed: HTTP ${send.status}\n${send.rawText ?? ""}`;
        const err: any = new Error(msg);
        err.__server = send.json;
        throw err;
      }

      return send.json.signature as string;
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
        } catch (err: any) {
          if (err?.__retryableSession) {
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
      } catch (e: any) {
        const message = e?.message || String(e);
        setState((s) => ({ ...s, loading: false, error: message }));
        // eslint-disable-next-line no-console
        console.error(
          "[useServerSponsoredJupSwap] failed:",
          message,
          e?.__server || {}
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
