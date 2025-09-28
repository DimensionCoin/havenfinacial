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
  error: string | null;
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
  const raw = obj.error;
  if (raw instanceof Error) return raw.message;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "message" in raw) {
    const maybe = (raw as { message?: unknown }).message;
    if (typeof maybe === "string") return maybe;
  }
  return null;
}

function logsTail(obj: JsonObject, lines = 10): string | null {
  const raw = obj.logs;
  if (!Array.isArray(raw)) return null;
  const logs = raw.filter((entry): entry is string => typeof entry === "string");
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
        // find the user’s embedded wallet that matches the owner
        const userWallet = wallets.find((w) => w.address === fromOwnerBase58);
        if (!userWallet) throw new Error("Source wallet not available.");

        // 1) BUILD (server returns unsigned tx with payer=Haven and user as required signer)
        inflight.current = new AbortController();
        const headers: HeadersInit = {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        };

        const buildRes = await fetch("/api/jup/build-sell", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers,
          signal: inflight.current.signal,
          body: JSON.stringify({
            fromOwnerBase58,
            inputMint,
            // convert UI -> base units for server build
            amountUnits: Math.floor(amountUi * 10 ** inputDecimals),
            slippageBps,
          }),
        });

        const buildJsonRaw = await buildRes.json().catch(() => ({}));
        const buildJson = isJsonObject(buildJsonRaw) ? buildJsonRaw : {};
        const transaction = readStringProp(buildJson, "transaction");
        if (!buildRes.ok || !transaction) {
          const msg =
            extractErrorField(buildJson) || `Build failed: HTTP ${buildRes.status}`;
          throw new Error(msg);
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
        const signature = readStringProp(sendJson, "signature");
        if (!sendRes.ok || !signature) {
          const parts: string[] = [];
          const errField = extractErrorField(sendJson);
          if (errField) parts.push(errField);
          const logs = logsTail(sendJson);
          if (logs) parts.push(logs);
          const msg =
            parts.join("\n\n") || `Broadcast failed: HTTP ${sendRes.status}`;
          throw new Error(msg);
        }

        set({
          loading: false,
          signature,
          error: null,
        });
        return signature;
      } catch (e: unknown) {
        const message = errorMessage(e, "Sell failed");
        set({
          loading: false,
          signature: null,
          error: message,
        });
        throw e;
      } finally {
        cleanup();
      }
    },
    [wallets]
  );

  return useMemo(
    () => ({ sell, loading, signature, error }),
    [sell, loading, signature, error]
  );
}
