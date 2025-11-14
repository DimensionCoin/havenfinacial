// hooks/useServerSponsoredBoosterOpen.ts
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
const USDC_DECIMALS = 6;

/* ----------------------------- types ----------------------------- */

export type BoosterInput = {
  ownerBase58: string;
  symbol: "BTC" | "ETH" | "SOL";
  side: "long" | "short";
  marginDisplay: number; // user-entered "boost" amount in display currency
  fxRate: number; // display -> USD
  priceSlippageBps?: number; // optional, default 500 (5%)
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
  json: unknown;
};

export type BoosterAttemptDebug = {
  attemptId: string;
  startedAt: string;
  inputs: {
    ownerBase58: string;
    symbol: string;
    side: string;
    marginDisplay: number;
    fxRate: number;
    marginUnits: number;
    priceSlippageBps: number;
  };
  open?: HttpDebug & { endpoint: "open" };
  send?: HttpDebug & { endpoint: "send" };
};

type BoosterState = {
  loading: boolean;
  signature: string | null;
  error: string | null;
  last?: BoosterAttemptDebug;
};

type JsonObject = Record<string, unknown>;

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

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readStringProp(obj: JsonObject, key: string): string | null {
  return readString((obj as any)[key]);
}

function shortLogs(input: unknown, maxLines = 10) {
  if (!isJsonObject(input) || !Array.isArray((input as any).logs)) return null;
  const logs = (input as any).logs.filter(
    (item: unknown): item is string => typeof item === "string"
  );
  if (!logs.length) return null;
  const tail = logs.slice(-maxLines);
  return tail.join("\n");
}

function printAttemptToConsole(tag: string, dbg: BoosterAttemptDebug) {
  const title = `[${tag}] booster attempt ${dbg.attemptId}`;
  console.groupCollapsed(title);
  console.log("inputs", dbg.inputs);

  if (dbg.open) {
    console.groupCollapsed(
      "open",
      `${dbg.open.status} ${dbg.open.ok ? "OK" : "ERROR"} • ${
        dbg.open.durationMs
      }ms`
    );
    console.log("request", { url: dbg.open.url, method: dbg.open.method });
    console.log("response.headers", dbg.open.headers);
    console.log("response.json", dbg.open.json);
    if (!dbg.open.json && dbg.open.rawText) {
      console.log("response.text", dbg.open.rawText);
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
    if (isJsonObject(sendJson) && isJsonObject((sendJson as any).debug)) {
      debugInfo = (sendJson as any).debug;
    }
    if (debugInfo && "ixSummary" in debugInfo) {
      console.log("ixSummary", (debugInfo as any).ixSummary);
    }
    if (debugInfo && "alts" in debugInfo) {
      console.log("alts", (debugInfo as any).alts);
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

function extractErrorField(obj: JsonObject): string | null {
  // We prefer `userMessage` from your booster APIs
  if (typeof (obj as any).userMessage === "string")
    return (obj as any).userMessage;

  const raw = (obj as any).error;
  if (raw instanceof Error) return raw.message;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "message" in raw) {
    const maybe = (raw as { message?: unknown }).message;
    if (typeof maybe === "string") return maybe;
  }
  return null;
}

/* ---------------------- human-readable errors --------------------- */

type HumanReadableError = {
  message: string;
  tip?: string;
};

function humanizeServerBoosterError(
  serverJson: JsonObject | null
): HumanReadableError | null {
  if (!serverJson) return null;

  const errorField = extractErrorField(serverJson) || "";
  const reason =
    typeof (serverJson as any).reason === "string"
      ? (serverJson as any).reason
      : "";
  const logsTail = shortLogs(serverJson) || "";

  const combined = [errorField, reason, logsTail]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  // 1) Expired / bad blockhash
  if (
    combined.includes("blockhash not found") ||
    combined.includes("expired")
  ) {
    return {
      message: "This boosted trade took too long to sign and expired.",
      tip: "Please try again and approve the transaction promptly.",
    };
  }

  // 2) Not enough USDC margin + Haven fee (from /booster/open guard)
  if (combined.includes("insufficient usdc")) {
    return {
      message:
        "You don't have enough USDC in your deposit wallet to open this boosted trade.",
      tip: "Add more USDC or reduce the boost amount and try again.",
    };
  }

  // 3) Fee rounded to zero / margin too small
  if (
    combined.includes("fee rounded to zero") ||
    combined.includes("fee too")
  ) {
    return {
      message: "This boosted trade is too small for the minimum fee.",
      tip: "Try a slightly larger boost size.",
    };
  }

  // 4) Generic insufficient balance
  if (
    combined.includes("insufficient funds") ||
    combined.includes("insufficient balance")
  ) {
    return {
      message: "You don't have enough balance to complete this boosted trade.",
      tip: "Check your wallet balance or try a smaller amount.",
    };
  }

  // 5) Simulation failure
  if (combined.includes("simulation failed")) {
    return {
      message: "This boosted trade couldn't be executed safely on-chain.",
      tip: "Try lowering the amount, or wait a bit and try again.",
    };
  }

  // 6) Co-sign / Privy issues
  if (combined.includes("privy") && combined.includes("signtransaction")) {
    return {
      message:
        "We couldn't co-sign this boosted transaction with Haven's wallet.",
      tip: "Please try again. If it keeps failing, contact support.",
    };
  }

  // 7) Signature verification / signer mismatch
  if (combined.includes("signature verification failure")) {
    return {
      message: "The boosted transaction signatures were not valid.",
      tip: "Refresh the page and try opening the position again.",
    };
  }

  return null;
}

/* -------------------------- error tagging ------------------------- */

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

export function useServerSponsoredBoosterOpen() {
  const [{ loading, signature, error, last }, setState] =
    useState<BoosterState>({
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

  /**
   * Core "open" flow:
   *  1) POST /api/booster/open → unsigned v0 tx
   *  2) user signs via Privy
   *  3) POST /api/booster/send → Haven co-signs, simulates, broadcasts
   */
  const doOnce = useCallback(
    async (payload: {
      ownerBase58: string;
      symbol: "BTC" | "ETH" | "SOL";
      side: "long" | "short";
      marginUnits: number;
      priceSlippageBps: number;
      accessToken?: string | null;
      attemptId: string;
      inputsForDebug: BoosterAttemptDebug["inputs"];
    }) => {
      const attempt: BoosterAttemptDebug = {
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

      /* 1) OPEN (server returns an unsigned v0 tx base64 with Haven as fee payer) */
      const open = await fetchWithDebug("/api/booster/open", {
        method: "POST",
        headers,
        body: JSON.stringify({
          ownerBase58: payload.ownerBase58,
          symbol: payload.symbol,
          side: payload.side,
          marginUnits: payload.marginUnits,
          priceSlippageBps: payload.priceSlippageBps,
        }),
        cache: "no-store",
        credentials: "include",
        signal: inflight.current.signal,
      });

      attempt.open = { ...open, endpoint: "open" };
      setState((s) => ({
        ...s,
        last: { ...(s.last || attempt), open: attempt.open },
      }));
      printAttemptToConsole("OPEN", attempt);

      const openJson = isJsonObject(open.json) ? open.json : {};
      const transaction = readStringProp(openJson, "transaction");

      if (!open.ok || !transaction) {
        const nice = humanizeServerBoosterError(openJson);
        const fallback =
          extractErrorField(openJson) || `Open failed: HTTP ${open.status}`;
        const msg = nice?.tip
          ? `${nice.message} ${nice.tip}`
          : nice?.message || fallback;

        throw markError(new Error(msg), { __server: open.json });
      }

      /* 2) USER SIG (client) — sign VersionedTransaction with user's embedded wallet */
      const userWallet = wallets.find((w) => w.address === payload.ownerBase58);
      if (!userWallet) {
        throw new Error("Source wallet not available for signing.");
      }

      const unsignedBytes = Buffer.from(transaction, "base64");
      const unsignedTx = VersionedTransaction.deserialize(unsignedBytes);

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
        (k) => k.toBase58() === payload.ownerBase58
      );
      if (!userIsSigner) {
        throw new Error(
          "Built booster transaction is missing the user as a required signer."
        );
      }

      const userSignedTx = await userWallet.signTransaction(unsignedTx);
      const userSignedB64 = Buffer.from(userSignedTx.serialize()).toString(
        "base64"
      );

      /* 3) SEND (server) — Haven co-signs as fee payer, simulates, and broadcasts */
      const send = await fetchWithDebug("/api/booster/send", {
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

      const sendJson = isJsonObject(send.json) ? send.json : {};

      // optional: if your backend uses 440 for session issues
      if (send.status === 440) {
        const msg = extractErrorField(sendJson) || "User session expired.";
        throw markError(new Error(msg), {
          __retryableSession: true,
          __server: send.json,
        });
      }

      const signature = readStringProp(sendJson, "signature");
      if (!send.ok || !signature) {
        const nice = humanizeServerBoosterError(sendJson);
        const fallbackParts: string[] = [];
        const errorField = extractErrorField(sendJson);
        if (errorField) fallbackParts.push(errorField);
        const tail = shortLogs(sendJson);
        if (tail) fallbackParts.push(tail);
        const fallbackRaw = fallbackParts.join("\n\n") || "";

        const baseMessage =
          nice?.message ||
          "We couldn't complete this boosted trade. Please try again.";
        const msg =
          nice?.tip && nice.tip.length
            ? `${baseMessage} ${nice.tip}`
            : baseMessage;

        throw markError(new Error(msg), {
          __server: send.json,
          // fallbackRaw is available here if you want it later
        } as AugmentedError);
      }

      return signature;
    },
    [wallets]
  );

  /**
   * Background SOL sweep (OPEN):
   *  - POST /api/booster/sweep-sol → unsigned sweep tx (Haven as fee payer)
   *  - user signs (Haven pays gas)
   *  - POST /api/booster/send → broadcast
   *
   * Runs AFTER a successful open, but:
   *  - doesn't block UI
   *  - doesn't touch loading/error state
   *  - just logs to console
   */
  const doSweepOnce = useCallback(
    async (payload: { ownerBase58: string; accessToken?: string | null }) => {
      try {
        const headers: HeadersInit = {
          "Content-Type": "application/json",
          ...(payload.accessToken
            ? { Authorization: `Bearer ${payload.accessToken}` }
            : {}),
        };

        // 1) Build sweep transaction
        const sweep = await fetchWithDebug("/api/booster/sweep-sol", {
          method: "POST",
          headers,
          body: JSON.stringify({
            ownerBase58: payload.ownerBase58,
          }),
          cache: "no-store",
          credentials: "include",
        });

        console.log(
          "[BoosterSweep:open] build",
          sweep.status,
          sweep.ok ? "OK" : "ERROR"
        );

        const sweepJson = isJsonObject(sweep.json) ? sweep.json : {};
        const txB64 = readStringProp(sweepJson, "transaction");

        // If nothing to sweep or build failed, just exit quietly.
        if (!sweep.ok || !txB64) {
          console.warn(
            "[BoosterSweep:open] no sweep transaction built",
            sweep.status,
            sweep.json
          );
          return;
        }

        const userWallet = wallets.find(
          (w) => w.address === payload.ownerBase58
        );
        if (!userWallet) {
          console.warn(
            "[BoosterSweep:open] user wallet not available for signing; skipping sweep"
          );
          return;
        }

        const unsignedBytes = Buffer.from(txB64, "base64");
        const unsignedTx = VersionedTransaction.deserialize(unsignedBytes);

        const userSignedTx = await userWallet.signTransaction(unsignedTx);
        const userSignedB64 = Buffer.from(userSignedTx.serialize()).toString(
          "base64"
        );

        // 2) Send sweep transaction
        const send = await fetchWithDebug("/api/booster/send", {
          method: "POST",
          headers,
          body: JSON.stringify({ transaction: userSignedB64 }),
          cache: "no-store",
          credentials: "include",
        });

        console.log(
          "[BoosterSweep:open] send",
          send.status,
          send.ok ? "OK" : "ERROR"
        );

        const sendJson = isJsonObject(send.json) ? send.json : {};
        const sig = readStringProp(sendJson, "signature");

        if (!send.ok || !sig) {
          console.warn(
            "[BoosterSweep:open] sweep send failed",
            send.status,
            send.json
          );
          return;
        }

        console.log("[BoosterSweep:open] success, signature", sig);
      } catch (e) {
        console.error("[BoosterSweep:open] unhandled error", e);
      }
    },
    [wallets]
  );

  const openBoosterPosition = useCallback(
    async ({
      ownerBase58,
      symbol,
      side,
      marginDisplay,
      fxRate,
      priceSlippageBps,
      accessToken,
    }: BoosterInput) => {
      cleanupInflight();
      setState({
        loading: true,
        signature: null,
        error: null,
        last: undefined,
      });

      const attemptId = makeAttemptId();
      let effectiveAccessToken: string | null | undefined = accessToken ?? null;

      try {
        if (!RPC?.includes("mainnet")) {
          throw new Error("RPC must be a MAINNET endpoint.");
        }
        if (!ownerBase58) throw new Error("Missing owner address.");
        if (!symbol) throw new Error("Missing symbol.");
        if (side !== "long" && side !== "short") {
          throw new Error("Side must be 'long' or 'short'.");
        }

        // Convert display -> USD -> USDC base units (margin)
        const marginUsd =
          Number.isFinite(marginDisplay) && marginDisplay > 0
            ? marginDisplay / (fxRate || 1)
            : 0;

        if (marginUsd <= 0) {
          throw new Error("Margin must be greater than zero.");
        }

        const marginUnits = Math.floor(marginUsd * 10 ** USDC_DECIMALS);
        if (!Number.isFinite(marginUnits) || marginUnits <= 0) {
          throw new Error("Margin amount is too small.");
        }

        const effectiveSlippage = Number.isFinite(priceSlippageBps || 0)
          ? priceSlippageBps || 500
          : 500; // default 5%

        const inputsForDebug: BoosterAttemptDebug["inputs"] = {
          ownerBase58,
          symbol,
          side,
          marginDisplay,
          fxRate,
          marginUnits,
          priceSlippageBps: effectiveSlippage,
        };

        // first attempt
        try {
          const sig = await doOnce({
            ownerBase58,
            symbol,
            side,
            marginUnits,
            priceSlippageBps: effectiveSlippage,
            accessToken: effectiveAccessToken,
            attemptId,
            inputsForDebug,
          });

          setState((s) => ({ ...s, loading: false, signature: sig }));

          // ⏳ 1.5 seconds after successful OPEN, start SOL sweep in background
          setTimeout(() => {
            console.log(
              "[BoosterSweep:open] scheduling sweep 1.5s after successful open"
            );
            void doSweepOnce({
              ownerBase58,
              accessToken: effectiveAccessToken ?? undefined,
            });
          }, 1500);

          return sig;
        } catch (err: unknown) {
          const enriched = err as AugmentedError;
          if (enriched.__retryableSession) {
            // refresh user session and retry once
            await login();
            const fresh = await getAccessToken();
            effectiveAccessToken = fresh ?? null;

            const sig = await doOnce({
              ownerBase58,
              symbol,
              side,
              marginUnits,
              priceSlippageBps: effectiveSlippage,
              accessToken: effectiveAccessToken,
              attemptId: attemptId + "-retry",
              inputsForDebug,
            });

            setState((s) => ({ ...s, loading: false, signature: sig }));

            // ⏳ 1.5 seconds after successful OPEN (retry), sweep SOL
            setTimeout(() => {
              console.log(
                "[BoosterSweep:open] scheduling sweep 1.5s after successful open (retry)"
              );
              void doSweepOnce({
                ownerBase58,
                accessToken: effectiveAccessToken ?? undefined,
              });
            }, 1500);

            return sig;
          }
          throw err;
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        setState((s) => ({ ...s, loading: false, error: message }));
        console.error(
          "[useServerSponsoredBoosterOpen] failed:",
          message,
          (e as AugmentedError)?.__server || {}
        );
        throw e;
      } finally {
        cleanupInflight();
      }
    },
    [doOnce, doSweepOnce, getAccessToken, login]
  );

  const reset = useCallback(() => {
    cleanupInflight();
    setState({
      loading: false,
      signature: null,
      error: null,
      last: undefined,
    });
  }, []);

  const state = useMemo(
    () => ({ loading, signature, error, last }),
    [loading, signature, error, last]
  );

  return { openBoosterPosition, reset, ...state };
}
