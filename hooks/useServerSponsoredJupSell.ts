// hooks/useServerSponsoredJupSell.ts
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";
import { useSolanaWallets } from "@privy-io/react-auth/solana";

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

        const buildJson = await buildRes.json().catch(() => ({}));
        if (!buildRes.ok || !buildJson?.transaction) {
          throw new Error(
            buildJson?.error || `Build failed: HTTP ${buildRes.status}`
          );
        }

        // 2) USER SIG — deserialize, user signs, re-serialize
        const unsigned = Buffer.from(buildJson.transaction as string, "base64");
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

        const sendJson = await sendRes.json().catch(() => ({}));
        if (!sendRes.ok || !sendJson?.signature) {
          const msg =
            sendJson?.error ||
            (sendJson?.logs
              ? `${sendJson.error}\n${(sendJson.logs as string[]).join("\n")}`
              : `Broadcast failed: HTTP ${sendRes.status}`);
          throw new Error(msg);
        }

        set({
          loading: false,
          signature: sendJson.signature as string,
          error: null,
        });
        return sendJson.signature as string;
      } catch (e: any) {
        set({
          loading: false,
          signature: null,
          error: e?.message || String(e),
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
