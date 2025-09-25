// hooks/useSavingsActions.ts
"use client";

import { useCallback, useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { Buffer } from "buffer";

// Ensure Buffer exists in the browser
if (typeof window !== "undefined") {
  // @ts-ignore
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

function tailLogs(j: any, max = 10) {
  const logs = Array.isArray(j?.logs) ? (j.logs as string[]) : [];
  return logs.length ? logs.slice(-max).join("\n") : null;
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

        const prepJson = await prepRes.json().catch(() => ({}));
        if (!prepRes.ok || !prepJson?.transaction) {
          const msg =
            prepJson?.error ||
            `prepare-deposit failed (HTTP ${prepRes.status})`;
          throw new Error(msg);
        }

        const b64: string = prepJson.transaction;
        const mfiAccount: string = prepJson.marginfiAccount;
        const userUsdcAta: string | undefined = prepJson.userUsdcAta;

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

        const sendJson = await sendRes.json().catch(() => ({}));
        if (!sendRes.ok || !sendJson?.ok || !sendJson?.signature) {
          const parts: string[] = [];
          if (sendJson?.error) parts.push(String(sendJson.error));
          const logs = tailLogs(sendJson);
          if (logs) parts.push(logs);
          const msg =
            parts.join("\n\n") || `submission failed (HTTP ${sendRes.status})`;
          throw new Error(msg);
        }

        return {
          signature: sendJson.signature as string,
          marginfiAccount: mfiAccount,
          userUsdcAta: userUsdcAta ?? null,
        };
      };

      try {
        return await doOnce();
      } catch (err: any) {
        // One automatic retry if blockhash expired (server uses 409 for that)
        const low = String(err?.message || "").toLowerCase();
        if (low.includes("blockhash")) {
          try {
            return await doOnce();
          } catch (e2) {
            setError(
              (e2 as Error)?.message || "deposit failed after blockhash retry"
            );
            throw e2;
          }
        }
        setError(err?.message || "deposit failed");
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

        const prepJson = await prepRes.json().catch(() => ({}));
        if (!prepRes.ok || !prepJson?.transaction) {
          const msg =
            prepJson?.error ||
            `prepare-withdraw failed (HTTP ${prepRes.status})`;
          throw new Error(msg);
        }

        const b64: string = prepJson.transaction;
        const mfiAccount: string = prepJson.marginfiAccount;
        const userUsdcAta: string | undefined = prepJson.userUsdcAta;

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

        const sendJson = await sendRes.json().catch(() => ({}));
        if (!sendRes.ok || !sendJson?.ok || !sendJson?.signature) {
          const parts: string[] = [];
          if (sendJson?.error) parts.push(String(sendJson.error));
          const logs = tailLogs(sendJson);
          if (logs) parts.push(logs);
          const msg =
            parts.join("\n\n") || `submission failed (HTTP ${sendRes.status})`;
          throw new Error(msg);
        }

        return {
          signature: sendJson.signature as string,
          marginfiAccount: mfiAccount,
          userUsdcAta: userUsdcAta ?? null,
        };
      };

      try {
        return await doOnce();
      } catch (err: any) {
        const low = String(err?.message || "").toLowerCase();
        if (low.includes("blockhash")) {
          try {
            return await doOnce();
          } catch (e2) {
            setError(
              (e2 as Error)?.message || "withdraw failed after blockhash retry"
            );
            throw e2;
          }
        }
        setError(err?.message || "withdraw failed");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [signTransaction]
  );

  return { deposit, withdraw, loading, error };
}
