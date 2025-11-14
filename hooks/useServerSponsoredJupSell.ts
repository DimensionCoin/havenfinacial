// hooks/useServerSponsoredJupSell.ts
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
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

type SellInput = {
  fromOwnerBase58: string; // user token authority
  inputMint: string; // token to sell
  amountUi: number; // human units of input token
  inputDecimals: number; // decimals of input token
  slippageBps?: number;
  accessToken?: string | null;
};

type State = {
  loading: boolean;
  signature: string | null;
  error: string | null; // already user-friendly, ready for UI
};

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readStringProp(obj: JsonObject, key: string): string | null {
  return readString(obj[key]);
}

function extractErrorField(obj: JsonObject): string | null {
  const raw = (obj as any).error;
  if (raw instanceof Error) return raw.message;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "message" in raw) {
    const maybe = (raw as { message?: unknown }).message;
    if (typeof maybe === "string") return maybe;
  }
  return null;
}

function logsTail(obj: JsonObject, lines = 10): string | null {
  const raw = (obj as any).logs;
  if (!Array.isArray(raw)) return null;
  const logs = raw.filter(
    (entry: unknown): entry is string => typeof entry === "string"
  );
  return logs.length ? logs.slice(-lines).join("\n") : null;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const maybe = (err as { message?: unknown }).message;
    if (typeof maybe === "string") return maybe;
  }
  return fallback;
}

/**
 * Given a JSON error payload from the server, return a nicely formatted
 * user-facing string we can show directly in the UI.
 */
function formatServerError(obj: JsonObject, httpStatus: number): string {
  const userMessage = readStringProp(obj, "userMessage");
  const tip = readStringProp(obj, "tip");
  const code = readStringProp(obj, "code");
  const traceId = readStringProp(obj, "traceId");
  const rawError = extractErrorField(obj);

  const parts: string[] = [];

  if (userMessage) {
    parts.push(userMessage);
  } else if (rawError) {
    parts.push(rawError);
  } else {
    parts.push(`Sell failed (HTTP ${httpStatus}).`);
  }

  if (tip) {
    parts.push(`Tip: ${tip}`);
  }

  // Append a lightweight hint for support/debugging
  const meta: string[] = [];
  if (code) meta.push(`code=${code}`);
  if (traceId) meta.push(`traceId=${traceId}`);

  if (meta.length) {
    parts.push(
      `If this keeps happening, contact support and share: ${meta.join(" · ")}`
    );
  }

  return parts.join("\n\n");
}

export function useServerSponsoredJupSell() {
  const [{ loading, signature, error }, set] = useState<State>({
    loading: false,
    signature: null,
    error: null,
  });

  const { wallets } = useSolanaWallets();
  const inflight = useRef<AbortController | null>(null);

  const cleanup = () => {
    inflight.current?.abort();
    inflight.current = null;
  };

  /**
   * Background SOL sweep:
   *  - POST /api/booster/sweep-sol → unsigned sweep tx (Haven as fee payer)
   *  - user signs (no UI fee; Haven pays gas)
   *  - POST /api/booster/send → broadcast
   *
   * Runs AFTER a successful swap, but:
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
        const sweepRes = await fetch("/api/booster/sweep-sol", {
          method: "POST",
          headers,
          body: JSON.stringify({
            ownerBase58: payload.ownerBase58,
          }),
          cache: "no-store",
          credentials: "include",
        });

        const sweepJsonRaw = await sweepRes.json().catch(() => ({}));
        const sweepJson = isJsonObject(sweepJsonRaw) ? sweepJsonRaw : {};
        const txB64 = readStringProp(sweepJson, "transaction");

        console.log(
          "[JupSell:BoosterSweep] build",
          sweepRes.status,
          sweepRes.ok ? "OK" : "ERROR",
          sweepJson
        );

        // If nothing to sweep or build failed, just exit quietly.
        if (!sweepRes.ok || !txB64) {
          console.warn(
            "[JupSell:BoosterSweep] no sweep transaction built",
            sweepRes.status,
            sweepJson
          );
          return;
        }

        const userWallet = wallets.find(
          (w) => w.address === payload.ownerBase58
        );
        if (!userWallet) {
          console.warn(
            "[JupSell:BoosterSweep] user wallet not available for signing; skipping sweep"
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
        const sendRes = await fetch("/api/booster/send", {
          method: "POST",
          headers,
          body: JSON.stringify({ transaction: userSignedB64 }),
          cache: "no-store",
          credentials: "include",
        });

        const sendJsonRaw = await sendRes.json().catch(() => ({}));
        const sendJson = isJsonObject(sendJsonRaw) ? sendJsonRaw : {};
        const sig = readStringProp(sendJson, "signature");

        console.log(
          "[JupSell:BoosterSweep] send",
          sendRes.status,
          sendRes.ok ? "OK" : "ERROR",
          sendJson
        );

        if (!sendRes.ok || !sig) {
          console.warn(
            "[JupSell:BoosterSweep] sweep send failed",
            sendRes.status,
            sendJson
          );
          return;
        }

        console.log("[JupSell:BoosterSweep] success, signature", sig);
      } catch (e) {
        console.error("[JupSell:BoosterSweep] unhandled error", e);
      }
    },
    [wallets]
  );

  const sell = useCallback(
    async ({
      fromOwnerBase58,
      inputMint,
      amountUi,
      inputDecimals,
      slippageBps = 50,
      accessToken,
    }: SellInput) => {
      cleanup();
      set({ loading: true, signature: null, error: null });

      try {
        if (!RPC?.includes("mainnet")) {
          throw new Error("RPC must be a MAINNET endpoint.");
        }
        if (!fromOwnerBase58) {
          throw new Error("Missing owner address.");
        }
        if (!inputMint) {
          throw new Error("Missing token to sell.");
        }
        if (!Number.isFinite(amountUi) || amountUi <= 0) {
          throw new Error("Sell amount must be greater than zero.");
        }

        // find the user’s embedded wallet that matches the owner
        const userWallet = wallets.find((w) => w.address === fromOwnerBase58);
        if (!userWallet) throw new Error("Source wallet not available.");

        // 1) BUILD (server returns unsigned tx with payer=Haven and user as required signer)
        inflight.current = new AbortController();
        const headers: HeadersInit = {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        };

        const amountUnits = Math.floor(amountUi * 10 ** inputDecimals);

        const buildRes = await fetch("/api/jup/build-sell", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers,
          signal: inflight.current.signal,
          body: JSON.stringify({
            fromOwnerBase58,
            inputMint,
            amountUnits,
            slippageBps,
          }),
        });

        const buildJsonRaw = await buildRes.json().catch(() => ({}));
        const buildJson = isJsonObject(buildJsonRaw) ? buildJsonRaw : {};

        if (!buildRes.ok) {
          // Let server-drive UX: userMessage + tip + traceId
          const msg = formatServerError(buildJson, buildRes.status);
          // Helpful console log for devs
          console.error("[useServerSponsoredJupSell] build error", {
            status: buildRes.status,
            body: buildJson,
          });
          throw new Error(msg);
        }

        const transaction = readStringProp(buildJson, "transaction");
        if (!transaction) {
          throw new Error("Build failed: missing transaction payload.");
        }

        // 2) USER SIG — deserialize, user signs, re-serialize
        const unsigned = Buffer.from(transaction, "base64");
        const tx = VersionedTransaction.deserialize(unsigned);

        const userSigned = await userWallet.signTransaction(tx);
        const userSignedB64 = Buffer.from(userSigned.serialize()).toString(
          "base64"
        );

        // 3) SEND (server co-signs Haven and broadcasts)
        const sendRes = await fetch("/api/jup/send", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers,
          body: JSON.stringify({ transaction: userSignedB64 }),
        });

        const sendJsonRaw = await sendRes.json().catch(() => ({}));
        const sendJson = isJsonObject(sendJsonRaw) ? sendJsonRaw : {};
        const sig = readStringProp(sendJson, "signature");

        if (!sendRes.ok || !sig) {
          // send route doesn’t have userMessage/tip yet; we synthesize a decent message
          const parts: string[] = [];

          const errField = extractErrorField(sendJson);
          if (errField) parts.push(errField);

          const logs = logsTail(sendJson);
          if (logs) {
            parts.push(`Program logs (last lines):\n${logs}`);
          }

          if (!parts.length) {
            parts.push(
              `Broadcast failed (HTTP ${sendRes.status}). Try again in a moment.`
            );
          }

          // include traceId if present for support
          const traceId = readStringProp(sendJson, "traceId");
          if (traceId) {
            parts.push(
              `If this keeps happening, share this code with support: ${traceId}`
            );
          }

          const msg = parts.join("\n\n");
          console.error("[useServerSponsoredJupSell] send error", {
            status: sendRes.status,
            body: sendJson,
          });
          throw new Error(msg);
        }

        set({
          loading: false,
          signature: sig,
          error: null,
        });

        // ⏳ Schedule a SOL sweep 1.5s after successful swap (non-blocking)
        setTimeout(() => {
          console.log(
            "[JupSell:BoosterSweep] scheduling sweep 1.5s after successful sell"
          );
          void doSweepOnce({
            ownerBase58: fromOwnerBase58,
            accessToken: accessToken ?? null,
          });
        }, 1500);

        return sig;
      } catch (e: unknown) {
        const message = errorMessage(e, "Sell failed.");
        set({
          loading: false,
          signature: null,
          error: message,
        });
        console.error("[useServerSponsoredJupSell] failed:", message, e);
        throw e;
      } finally {
        cleanup();
      }
    },
    [wallets, doSweepOnce]
  );

  return useMemo(
    () => ({ sell, loading, signature, error }),
    [sell, loading, signature, error]
  );
}
