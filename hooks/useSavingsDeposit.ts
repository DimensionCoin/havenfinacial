// hooks/useSavingsDeposit.ts
"use client";

import { useCallback, useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { Buffer } from "buffer";

// Ensure Buffer exists in the browser (Vite/Next sometimes need this)
if (typeof window !== "undefined") {
  // @ts-ignore
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

function tailLogs(j: any, max = 10) {
  const logs = Array.isArray(j?.logs) ? (j.logs as string[]) : [];
  return logs.length ? logs.slice(-max).join("\n") : null;
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

        const prepJson = await prepRes.json().catch(() => ({}));
        if (!prepRes.ok || !prepJson?.transaction) {
          const msg =
            prepJson?.error ||
            `open-and-deposit failed (HTTP ${prepRes.status})`;
          throw new Error(msg);
        }

        const b64: string = prepJson.transaction;
        const marginfiAccount: string = prepJson.marginfiAccount;
        const userUsdcAta: string = prepJson.userUsdcAta;

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
          marginfiAccount,
          userUsdcAta,
        };
      };

      try {
        // First try
        return await doOnce();
      } catch (err: any) {
        // If the server co-sign complains about blockhash (HTTP 409), rebuild once
        if (
          String(err?.message || "")
            .toLowerCase()
            .includes("blockhash")
        ) {
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

  return { deposit, loading, error };
}
