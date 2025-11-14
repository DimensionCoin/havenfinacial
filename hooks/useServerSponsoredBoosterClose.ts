// hooks/useServerSponsoredBoosterClose.ts
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

/* ----------------------------- types ----------------------------- */

export type BoosterCloseInput = {
  ownerBase58: string;
  symbol: "BTC" | "ETH" | "SOL";
  side: "long" | "short";
  priceSlippageBps?: number; // optional, default 500 (5%)
  entirePosition?: boolean; // default true

  /**
   * Optional deltas for partial closes, in USDC 1e6 units.
   *
   * - For partial closes: at least one of these must be > 0.
   * - For full closes: these are ignored and always sent as 0,
   *   because Jupiter derives the full close from on-chain position
   *   when `entire_position = Some(true)`.
   */
  sizeUsdDeltaUnits?: number;
  collateralUsdDeltaUnits?: number;

  /**
   * The user's *payout basis* in USDC 1e6 units,
   * BEFORE Haven's 0.5% close fee is applied.
   *
   * Example (full close):
   *   netCloseUsdUnits = Math.floor(netUsdValue * 1e6)
   *
   * This is what the backend uses to compute the 0.5% fee
   * and pull it into Haven's USDC ATA.
   *
   * For full closes this is REQUIRED.
   */
  netCloseUsdUnits?: number;

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

export type BoosterCloseAttemptDebug = {
  attemptId: string;
  startedAt: string;
  inputs: {
    ownerBase58: string;
    symbol: string;
    side: string;
    priceSlippageBps: number;
    entirePosition: boolean;
    sizeUsdDeltaUnits: number;
    collateralUsdDeltaUnits: number;
    netCloseUsdUnits: number;
  };
  close?: HttpDebug & { endpoint: "close" };
  send?: HttpDebug & { endpoint: "send" };
};

type BoosterState = {
  loading: boolean;
  signature: string | null;
  error: string | null;
  last?: BoosterCloseAttemptDebug;
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
  return readString(obj[key]);
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

function printAttemptToConsole(tag: string, dbg: BoosterCloseAttemptDebug) {
  const title = `[${tag}] booster close attempt ${dbg.attemptId}`;
  console.groupCollapsed(title);
  console.log("inputs", dbg.inputs);

  if (dbg.close) {
    console.groupCollapsed(
      "close",
      `${dbg.close.status} ${dbg.close.ok ? "OK" : "ERROR"} • ${
        dbg.close.durationMs
      }ms`
    );
    console.log("request", { url: dbg.close.url, method: dbg.close.method });
    console.log("response.headers", dbg.close.headers);
    console.log("response.json", dbg.close.json);
    if (!dbg.close.json && dbg.close.rawText) {
      console.log("response.text", dbg.close.rawText);
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
  if (typeof obj.userMessage === "string") return obj.userMessage;

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

  // 2) Insufficient balance / margin style issues
  if (combined.includes("insufficient usdc")) {
    return {
      message:
        "You don't have enough USDC in your deposit wallet to complete this boosted trade.",
      tip: "Add more USDC or reduce the size and try again.",
    };
  }

  if (
    combined.includes("insufficient funds") ||
    combined.includes("insufficient balance")
  ) {
    return {
      message: "You don't have enough balance to complete this boosted trade.",
      tip: "Check your wallet balance or try a smaller amount.",
    };
  }

  // 3) Simulation failure
  if (combined.includes("simulation failed")) {
    return {
      message: "This boosted trade couldn't be executed safely on-chain.",
      tip: "Try lowering the amount, or wait a bit and try again.",
    };
  }

  // 4) Co-sign / Privy issues
  if (combined.includes("privy") && combined.includes("signtransaction")) {
    return {
      message:
        "We couldn't co-sign this boosted transaction with Haven's wallet.",
      tip: "Please try again. If it keeps failing, contact support.",
    };
  }

  // 5) Signature verification / signer mismatch
  if (combined.includes("signature verification failure")) {
    return {
      message: "The boosted transaction signatures were not valid.",
      tip: "Refresh the page and try again.",
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

export function useServerSponsoredBoosterClose() {
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
   * Core "close" flow:
   *  1) POST /api/booster/close → unsigned v0 tx (Haven as fee payer)
   *  2) user signs via Privy
   *  3) POST /api/booster/send → Haven co-signs, simulates, broadcasts
   */
  const doOnce = useCallback(
    async (payload: {
      ownerBase58: string;
      symbol: "BTC" | "ETH" | "SOL";
      side: "long" | "short";
      priceSlippageBps: number;
      entirePosition: boolean;
      sizeUsdDeltaUnits: number;
      collateralUsdDeltaUnits: number;
      netCloseUsdUnits: number;
      accessToken?: string | null;
      attemptId: string;
      inputsForDebug: BoosterCloseAttemptDebug["inputs"];
    }) => {
      const attempt: BoosterCloseAttemptDebug = {
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

      /* 1) CLOSE (build unsigned tx) */
      const close = await fetchWithDebug("/api/booster/close", {
        method: "POST",
        headers,
        body: JSON.stringify({
          ownerBase58: payload.ownerBase58,
          symbol: payload.symbol,
          side: payload.side,
          priceSlippageBps: payload.priceSlippageBps,
          entirePosition: payload.entirePosition,
          sizeUsdDeltaUnits: payload.sizeUsdDeltaUnits || 0,
          collateralUsdDeltaUnits: payload.collateralUsdDeltaUnits || 0,
          netCloseUsdUnits: payload.netCloseUsdUnits || 0,
        }),
        cache: "no-store",
        credentials: "include",
        signal: inflight.current.signal,
      });

      attempt.close = { ...close, endpoint: "close" };
      setState((s) => ({
        ...s,
        last: { ...(s.last || attempt), close: attempt.close },
      }));
      printAttemptToConsole("CLOSE", attempt);

      const closeJson = isJsonObject(close.json) ? close.json : {};
      const transaction = readStringProp(closeJson, "transaction");

      if (!close.ok || !transaction) {
        const nice = humanizeServerBoosterError(closeJson);
        const fallback =
          extractErrorField(closeJson) || `Close failed: HTTP ${close.status}`;
        const msg = nice?.tip
          ? `${nice.message} ${nice.tip}`
          : nice?.message || fallback;

        throw markError(new Error(msg), { __server: close.json });
      }

      /* 2) USER SIGN (embedded wallet) */
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
          "Built booster close transaction is missing the user as a required signer."
        );
      }

      const userSignedTx = await userWallet.signTransaction(unsignedTx);
      const userSignedB64 = Buffer.from(userSignedTx.serialize()).toString(
        "base64"
      );

      /* 3) SEND (Haven co-signs + broadcasts) */
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
          // fallbackRaw available if you want to inspect later
        } as AugmentedError);
      }

      return signature;
    },
    [wallets]
  );

  /**
   * Background SOL sweep:
   *  - POST /api/booster/sweep-sol → unsigned sweep tx (Haven as fee payer)
   *  - user signs (no extra UI fees, Haven pays gas)
   *  - POST /api/booster/send → broadcast
   *
   * Runs AFTER a successful close, but:
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
          "[BoosterSweep] build",
          sweep.status,
          sweep.ok ? "OK" : "ERROR"
        );

        const sweepJson = isJsonObject(sweep.json) ? sweep.json : {};
        const txB64 = readStringProp(sweepJson, "transaction");

        if (!sweep.ok || !txB64) {
          console.warn(
            "[BoosterSweep] failed to build sweep transaction",
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
            "[BoosterSweep] user wallet not available for signing; skipping"
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
          "[BoosterSweep] send",
          send.status,
          send.ok ? "OK" : "ERROR"
        );

        const sendJson = isJsonObject(send.json) ? send.json : {};
        const sig = readStringProp(sendJson, "signature");

        if (!send.ok || !sig) {
          console.warn(
            "[BoosterSweep] sweep send failed",
            send.status,
            send.json
          );
          return;
        }

        console.log("[BoosterSweep] success, signature", sig);
      } catch (e) {
        console.error("[BoosterSweep] unhandled error", e);
      }
    },
    [wallets]
  );

  const closeBoosterPosition = useCallback(
    async ({
      ownerBase58,
      symbol,
      side,
      priceSlippageBps,
      entirePosition,
      sizeUsdDeltaUnits,
      collateralUsdDeltaUnits,
      netCloseUsdUnits,
      accessToken,
    }: BoosterCloseInput) => {
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

        const effectiveSlippage = Number.isFinite(priceSlippageBps ?? 0)
          ? priceSlippageBps ?? 500
          : 500; // default 5%

        const entire = entirePosition ?? true;

        let sizeDelta = Number.isFinite(sizeUsdDeltaUnits ?? 0)
          ? sizeUsdDeltaUnits ?? 0
          : 0;
        let collateralDelta = Number.isFinite(collateralUsdDeltaUnits ?? 0)
          ? collateralUsdDeltaUnits ?? 0
          : 0;

        let payoutBasisUnits = Number.isFinite(netCloseUsdUnits ?? 0)
          ? netCloseUsdUnits ?? 0
          : 0;

        // clamp to non-negative integers
        sizeDelta = Math.max(0, Math.floor(sizeDelta));
        collateralDelta = Math.max(0, Math.floor(collateralDelta));
        payoutBasisUnits = Math.max(0, Math.floor(payoutBasisUnits));

        if (entire) {
          // 🔑 Full close:
          // - We REQUIRE a positive size delta for Jup.
          // - Caller should normally pass the notional (position.sizeUsd * 1e6).
          // - If they didn't, fall back to payout basis as a rough proxy.
          if (payoutBasisUnits <= 0) {
            throw new Error(
              "Missing netCloseUsdUnits for full close. Provide the user's payout (in USDC 1e6) before Haven's 0.5% close fee."
            );
          }

          if (sizeDelta <= 0 && collateralDelta <= 0) {
            // fallback: use payout basis as size delta
            sizeDelta = payoutBasisUnits;
          }

          if (sizeDelta <= 0) {
            throw new Error(
              "Full close must have a positive sizeUsdDeltaUnits value."
            );
          }
          // collateralDelta can stay 0; program will settle margin.
        } else {
          // Partial close: must have some non-zero delta
          if (sizeDelta <= 0 && collateralDelta <= 0) {
            throw new Error(
              "For partial closes, you must provide size and/or collateral deltas."
            );
          }
          // netCloseUsdUnits is optional for partial closes
        }

        const inputsForDebug: BoosterCloseAttemptDebug["inputs"] = {
          ownerBase58,
          symbol,
          side,
          priceSlippageBps: effectiveSlippage,
          entirePosition: entire,
          sizeUsdDeltaUnits: sizeDelta,
          collateralUsdDeltaUnits: collateralDelta,
          netCloseUsdUnits: payoutBasisUnits,
        };

        // First attempt
        try {
          const sig = await doOnce({
            ownerBase58,
            symbol,
            side,
            priceSlippageBps: effectiveSlippage,
            entirePosition: entire,
            sizeUsdDeltaUnits: sizeDelta,
            collateralUsdDeltaUnits: collateralDelta,
            netCloseUsdUnits: payoutBasisUnits,
            accessToken: effectiveAccessToken,
            attemptId,
            inputsForDebug,
          });

          setState((s) => ({ ...s, loading: false, signature: sig }));

          // ⏳ Fire SOL sweep 1.25s after successful CLOSE (non-blocking)
          setTimeout(() => {
            console.log(
              "[BoosterSweep:close] scheduling sweep 1.25s after successful close"
            );
            void doSweepOnce({
              ownerBase58,
              accessToken: effectiveAccessToken ?? undefined,
            });
          }, 1250);

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
              priceSlippageBps: effectiveSlippage,
              entirePosition: entire,
              sizeUsdDeltaUnits: sizeDelta,
              collateralUsdDeltaUnits: collateralDelta,
              netCloseUsdUnits: payoutBasisUnits,
              accessToken: effectiveAccessToken,
              attemptId: attemptId + "-retry",
              inputsForDebug,
            });

            setState((s) => ({ ...s, loading: false, signature: sig }));

            // ⏳ Fire SOL sweep 1.25s after successful CLOSE (retry)
            setTimeout(() => {
              console.log(
                "[BoosterSweep:close] scheduling sweep 1.25s after successful close (retry)"
              );
              void doSweepOnce({
                ownerBase58,
                accessToken: effectiveAccessToken ?? undefined,
              });
            }, 1250);

            return sig;
          }
          throw err;
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        setState((s) => ({ ...s, loading: false, error: message }));
        console.error(
          "[useServerSponsoredBoosterClose] failed:",
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

  return { closeBoosterPosition, reset, ...state };
}
