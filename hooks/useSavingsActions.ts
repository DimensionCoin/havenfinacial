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

if (typeof window !== "undefined") {
  window.Buffer = window.Buffer || Buffer;
}

/* ───────── helpers ───────── */
type JsonObject = Record<string, unknown>;

const isJsonObject = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null;

const readString = (v: unknown): string | null =>
  typeof v === "string" ? v : null;

const readStringProp = (o: JsonObject, k: string): string | null =>
  readString(o[k]);

const readNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const readNumberProp = (o: JsonObject, k: string): number | null =>
  readNumber(o[k]);

const readLogsTail = (o: JsonObject, max = 10): string | null => {
  const raw = (o as any)?.logs;
  if (!Array.isArray(raw)) return null;
  const logs = raw.filter((e: unknown): e is string => typeof e === "string");
  return logs.length ? logs.slice(-max).join("\n") : null;
};

const extractErrorField = (o: JsonObject): string | null => {
  const raw = (o as any)?.error;
  if (raw instanceof Error) return raw.message;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "message" in raw) {
    const maybe = (raw as { message?: unknown }).message;
    if (typeof maybe === "string") return maybe;
  }
  return null;
};

const tailLogs = (v: unknown, max = 10): string | null =>
  isJsonObject(v) ? readLogsTail(v, max) : null;

const errorMessage = (err: unknown, fallback: string): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const maybe = (err as { message?: unknown }).message;
    if (typeof maybe === "string") return maybe;
  }
  return fallback;
};

// Keep DB math consistent with on-chain UI units (USDC 6dp)
const floorUsdc = (n: number) => Math.floor(n * 1e6) / 1e6;

// If your server records at a different endpoint, change this:
const RECORD_URL = "/api/savings/actions";

/* ───────── types ───────── */
type CommonParams = {
  owner58: string;
  decimals?: number; // default 6
  privyId?: string; // optional
  signer?: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
};

type DepositParams = CommonParams & {
  amountUi: number;
  ensureAta?: boolean; // default true
  marginfiAccount?: string | null; // optional override
};

type WithdrawParams = CommonParams & {
  amountUi?: number; // optional when withdrawAll=true
  withdrawAll?: boolean; // default false
  ensureAta?: boolean; // default true (ATA for destination)
  marginfiAccount?: string | null; // required by API
};

type TxResult = {
  signature: string;
  marginfiAccount: string;
  userUsdcAta?: string | null;
  settledAmountUi?: number | null; // optional from server for withdrawAll/exactness
};

export function useSavingsActions() {
  const { signTransaction } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Build → user-sign → server-send → record (Deposit) */
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
        // 1) prepare
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
        const mfiAccount = readStringProp(prepJson, "marginfiAccount");
        if (!mfiAccount)
          throw new Error("Missing marginfiAccount in prepare response");
        const userUsdcAta = readStringProp(prepJson, "userUsdcAta");

        // 2) user signs
        const tx = VersionedTransaction.deserialize(
          Buffer.from(transaction, "base64")
        );
        const doSign = signer ?? signTransaction;
        if (!doSign) throw new Error("Wallet signer not available");
        const signedTx = await doSign(tx);
        const signedTxB64 = Buffer.from(signedTx.serialize()).toString(
          "base64"
        );

        // 3) send
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
        const sendOk = (sendJson as any)?.ok === true;
        const settledAmountUi =
          readNumberProp(sendJson, "settledAmountUi") ?? null; // optional (if server returns)

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

        // 4) record (non-fatal)
        try {
          await fetch(RECORD_URL, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            cache: "no-store",
            body: JSON.stringify({
              kind: "deposit",
              owner58,
              marginfiAccount: mfiAccount,
              txSig: signature,
              amountUi: floorUsdc(
                typeof settledAmountUi === "number" ? settledAmountUi : amountUi
              ),
            }),
          });
        } catch {
          // swallow: chain send succeeded; you can retry recording later
        }

        return {
          signature,
          marginfiAccount: mfiAccount,
          userUsdcAta: userUsdcAta ?? null,
          settledAmountUi,
        };
      };

      try {
        return await doOnce();
      } catch (err: unknown) {
        const msg = errorMessage(err, "");
        if (msg.toLowerCase().includes("blockhash")) {
          try {
            return await doOnce();
          } catch (e2) {
            setError(errorMessage(e2, "deposit failed after blockhash retry"));
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

  /** Build → user-sign → server-send → record (Withdraw) */
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
        // 1) prepare
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
            marginfiAccount,
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
        const mfiAccount = readStringProp(prepJson, "marginfiAccount");
        if (!mfiAccount)
          throw new Error("Missing marginfiAccount in prepare response");
        const userUsdcAta = readStringProp(prepJson, "userUsdcAta");

        // 2) user signs
        const tx = VersionedTransaction.deserialize(
          Buffer.from(transaction, "base64")
        );
        const doSign = signer ?? signTransaction;
        if (!doSign) throw new Error("Wallet signer not available");
        const signedTx = await doSign(tx);
        const signedTxB64 = Buffer.from(signedTx.serialize()).toString(
          "base64"
        );

        // 3) send
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
        const sendOk = (sendJson as any)?.ok === true;
        // Prefer exact settled amount from server (especially for withdrawAll)
        const settledAmountUi =
          readNumberProp(sendJson, "settledAmountUi") ?? null;

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

        // 4) record (non-fatal)
        try {
          const amountForRecord =
            typeof settledAmountUi === "number"
              ? settledAmountUi
              : withdrawAll
              ? 0 // server should compute true amount when withdrawAll=true
              : amountUi ?? 0;

          await fetch(RECORD_URL, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            cache: "no-store",
            body: JSON.stringify({
              kind: "withdraw",
              owner58,
              marginfiAccount: mfiAccount,
              txSig: signature,
              withdrawAll,
              amountUi: floorUsdc(amountForRecord),
            }),
          });
        } catch {
          // swallow; can re-sync from chain later
        }

        return {
          signature,
          marginfiAccount: mfiAccount,
          userUsdcAta: userUsdcAta ?? null,
          settledAmountUi,
        };
      };

      try {
        return await doOnce();
      } catch (err: unknown) {
        const msg = errorMessage(err, "");
        if (msg.toLowerCase().includes("blockhash")) {
          try {
            return await doOnce();
          } catch (e2) {
            setError(errorMessage(e2, "withdraw failed after blockhash retry"));
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
