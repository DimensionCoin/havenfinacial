// hooks/useSavingsDeposit.ts
"use client";

import { useCallback, useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { Buffer } from "buffer";

declare global {
  interface Window {
    Buffer?: typeof Buffer;
  }
}

// Ensure Buffer exists in the browser (Vite/Next sometimes need this)
if (typeof window !== "undefined") {
  window.Buffer = window.Buffer || Buffer;
}

type DepositParams = {
  owner58: string;
  amountUi: number;
  decimals?: number;
  privyId?: string;
  /** Optional: provide your own signer (e.g., Privy embedded wallet) */
  signer?: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
};

type DepositResult = {
  signature: string;
  marginfiAccount: string;
  userUsdcAta: string;
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

function readLogsTail(obj: JsonObject, max = 10): string | null {
  const raw = obj.logs;
  if (!Array.isArray(raw)) return null;
  const logs = raw.filter((entry): entry is string => typeof entry === "string");
  return logs.length ? logs.slice(-max).join("\n") : null;
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

function tailLogs(value: unknown, max = 10): string | null {
  return isJsonObject(value) ? readLogsTail(value, max) : null;
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

export function useSavingsDeposit() {
  const { signTransaction } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deposit = useCallback(
    async ({
      owner58,
      amountUi,
      decimals = 6,
      privyId,
      signer,
    }: DepositParams): Promise<DepositResult> => {
      setLoading(true);
      setError(null);

      const doOnce = async (): Promise<DepositResult> => {
        // 1) build server-paid tx
        const prepRes = await fetch("/api/savings/open-and-deposit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({ owner58, amountUi, decimals }),
        });

        const prepJsonRaw = await prepRes.json().catch(() => ({}));
        const prepJson = isJsonObject(prepJsonRaw) ? prepJsonRaw : {};
        const transaction = readStringProp(prepJson, "transaction");
        if (!prepRes.ok || !transaction) {
          const msg =
            extractErrorField(prepJson) ||
            `open-and-deposit failed (HTTP ${prepRes.status})`;
          throw new Error(msg);
        }

        const b64 = transaction;
        const marginfiAccount = readStringProp(prepJson, "marginfiAccount");
        if (!marginfiAccount) {
          throw new Error("Missing marginfiAccount in prepare response");
        }
        const userUsdcAta = readStringProp(prepJson, "userUsdcAta");
        if (!userUsdcAta) {
          throw new Error("Missing userUsdcAta in prepare response");
        }

        // 2) user co-signs
        const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
        const doSign = signer ?? signTransaction;
        if (!doSign) throw new Error("Wallet signer not available");
        const signedTx = await doSign(tx);
        const signedTxB64 = Buffer.from(signedTx.serialize()).toString(
          "base64"
        );

        // 3) server submits + (optionally) persists
        const sendRes = await fetch("/api/savings/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({
            signedTxB64, // key the route expects
            owner58, // for server-side lookups if needed
            marginfiAccount,
            userUsdcAta,
            usdcBankPk: process.env.NEXT_PUBLIC_MARGINFI_USDC_BANK,
            privyId,
          }),
        });

        const sendJsonRaw = await sendRes.json().catch(() => ({}));
        const sendJson = isJsonObject(sendJsonRaw) ? sendJsonRaw : {};
        const signature = readStringProp(sendJson, "signature");
        const sendOk = sendJson.ok === true;

        if (!sendRes.ok || !sendOk || !signature) {
          const parts: string[] = [];
          const errMsg = extractErrorField(sendJson);
          if (errMsg) parts.push(errMsg);
          const logs = tailLogs(sendJson);
          if (logs) parts.push(logs);
          const msg =
            parts.join("\n\n") || `submission failed (HTTP ${sendRes.status})`;
          throw new Error(msg);
        }

        return {
          signature,
          marginfiAccount,
          userUsdcAta,
        };
      };

      try {
        // First try
        return await doOnce();
      } catch (err: unknown) {
        // If the server co-sign complains about blockhash (HTTP 409), rebuild once
        const message = errorMessage(err, "");
        if (message.toLowerCase().includes("blockhash")) {
          try {
            return await doOnce();
          } catch (e2) {
            setError(
              errorMessage(e2, "deposit failed after blockhash retry")
            );
            throw e2;
          }
        }
        setError(message || "deposit failed");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [signTransaction]
  );

  return { deposit, loading, error };
}
