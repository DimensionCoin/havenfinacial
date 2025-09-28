// hooks/useSavingsActions.ts
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

// Ensure Buffer exists in the browser
if (typeof window !== "undefined") {
  window.Buffer = window.Buffer || Buffer;
}

type CommonParams = {
  owner58: string;
  decimals?: number; // default 6
  privyId?: string; // optional; helps server link user for DB update
  signer?: (tx: VersionedTransaction) => Promise<VersionedTransaction>; // optional override (Privy)
};

type DepositParams = CommonParams & {
  amountUi: number;
  ensureAta?: boolean; // default true
  marginfiAccount?: string | null; // optional override; otherwise server looks up in DB
};

type WithdrawParams = CommonParams & {
  amountUi?: number; // optional if withdrawAll=true
  withdrawAll?: boolean; // default false
  ensureAta?: boolean; // default true (creates destination ATA if needed)
  marginfiAccount?: string | null; // required by API; pass if you have it
};

type TxResult = {
  signature: string;
  marginfiAccount: string;
  userUsdcAta?: string | null;
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

export function useSavingsActions() {
  const { signTransaction } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Build → user-sign → server-cosign+send (Deposit) */
  const deposit = useCallback(
    async ({
      owner58,
      amountUi,
      decimals = 6,
      ensureAta = true,
      marginfiAccount = null,
      privyId,
      signer,
    }: DepositParams): Promise<TxResult> => {
      setLoading(true);
      setError(null);

      const doOnce = async (): Promise<TxResult> => {
        // 1) Build server-paid tx
        const prepRes = await fetch("/api/savings/prepare-deposit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({
            owner58,
            amountUi,
            decimals,
            ensureAta,
            marginfiAccount,
          }),
        });

        const prepJsonRaw = await prepRes.json().catch(() => ({}));
        const prepJson = isJsonObject(prepJsonRaw) ? prepJsonRaw : {};
        const transaction = readStringProp(prepJson, "transaction");
        if (!prepRes.ok || !transaction) {
          const msg =
            extractErrorField(prepJson) ||
            `prepare-deposit failed (HTTP ${prepRes.status})`;
          throw new Error(msg);
        }

        const b64 = transaction;
        const mfiAccount = readStringProp(prepJson, "marginfiAccount");
        if (!mfiAccount) {
          throw new Error("Missing marginfiAccount in prepare response");
        }
        const userUsdcAta = readStringProp(prepJson, "userUsdcAta");

        // 2) User signs (wallet or provided signer)
        const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
        const doSign = signer ?? signTransaction;
        if (!doSign) throw new Error("Wallet signer not available");
        const signedTx = await doSign(tx);
        const signedTxB64 = Buffer.from(signedTx.serialize()).toString(
          "base64"
        );

        // 3) Server co-signs (Haven) + sends + persists
        const sendRes = await fetch("/api/savings/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({
            signedTxB64,
            owner58,
            marginfiAccount: mfiAccount,
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
          marginfiAccount: mfiAccount,
          userUsdcAta: userUsdcAta ?? null,
        };
      };

      try {
        return await doOnce();
      } catch (err: unknown) {
        // One automatic retry if blockhash expired (server uses 409 for that)
        const msg = errorMessage(err, "");
        const low = msg.toLowerCase();
        if (low.includes("blockhash")) {
          try {
            return await doOnce();
          } catch (e2) {
            setError(
              errorMessage(e2, "deposit failed after blockhash retry")
            );
            throw e2;
          }
        }
        setError(msg || "deposit failed");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [signTransaction]
  );

  /** Withdraw: build → user-sign → server-cosign+send (mirrors deposit) */
  const withdraw = useCallback(
    async ({
      owner58,
      amountUi,
      withdrawAll = false,
      decimals = 6,
      ensureAta = true,
      marginfiAccount = null,
      privyId,
      signer,
    }: WithdrawParams): Promise<TxResult> => {
      setLoading(true);
      setError(null);

      const doOnce = async (): Promise<TxResult> => {
        // 1) Build server-paid withdraw tx
        const prepRes = await fetch("/api/savings/prepare-withdraw", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({
            owner58,
            amountUi: withdrawAll ? 0 : amountUi, // server ignores when withdrawAll=true
            decimals,
            ensureAta,
            marginfiAccount, // required by API (existing account)
            withdrawAll,
          }),
        });

        const prepJsonRaw = await prepRes.json().catch(() => ({}));
        const prepJson = isJsonObject(prepJsonRaw) ? prepJsonRaw : {};
        const transaction = readStringProp(prepJson, "transaction");
        if (!prepRes.ok || !transaction) {
          const msg =
            extractErrorField(prepJson) ||
            `prepare-withdraw failed (HTTP ${prepRes.status})`;
          throw new Error(msg);
        }

        const b64 = transaction;
        const mfiAccount = readStringProp(prepJson, "marginfiAccount");
        if (!mfiAccount) {
          throw new Error("Missing marginfiAccount in prepare response");
        }
        const userUsdcAta = readStringProp(prepJson, "userUsdcAta");

        // 2) User signs
        const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
        const doSign = signer ?? signTransaction;
        if (!doSign) throw new Error("Wallet signer not available");
        const signedTx = await doSign(tx);
        const signedTxB64 = Buffer.from(signedTx.serialize()).toString(
          "base64"
        );

        // 3) Server co-signs (Haven) + sends + persists
        const sendRes = await fetch("/api/savings/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({
            signedTxB64,
            owner58,
            marginfiAccount: mfiAccount,
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
          marginfiAccount: mfiAccount,
          userUsdcAta: userUsdcAta ?? null,
        };
      };

      try {
        return await doOnce();
      } catch (err: unknown) {
        const msg = errorMessage(err, "");
        const low = msg.toLowerCase();
        if (low.includes("blockhash")) {
          try {
            return await doOnce();
          } catch (e2) {
            setError(
              errorMessage(e2, "withdraw failed after blockhash retry")
            );
            throw e2;
          }
        }
        setError(msg || "withdraw failed");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [signTransaction]
  );

  return { deposit, withdraw, loading, error };
}
