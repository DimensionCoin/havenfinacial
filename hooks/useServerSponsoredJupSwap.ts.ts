// hooks/useServerSponsoredJupSwap.ts
"use client";

import { useCallback, useState } from "react";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { useSponsoredUsdcTransfer } from "./useSponsoredUsdcTransfer";

// ----- CONSTANTS: hard-enforce MAINNET + USDC-in -----
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC!; // MUST be a mainnet endpoint
const JUP_QUOTE_BASE = "https://lite-api.jup.ag/swap/v1/quote";
const JUP_SWAP_BASE = "https://lite-api.jup.ag/swap/v1/swap";
const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;
const FLAT_FEE_USD = 0.2;

type SwapInput = {
  fromOwnerBase58: string; // user's embedded wallet owner
  outputMint: string; // token to buy (mainnet mint)
  amountDisplay: number; // what they typed in local currency
  fxRate: number; // local -> USD (e.g. 1 EUR = 1.07 USD => fxRate=1.07)
  accessToken?: string | null;
};

export function useServerSponsoredJupSwap() {
  const [loading, setLoading] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { wallets } = useSolanaWallets();
  const { send: sendFee } = useSponsoredUsdcTransfer();

  const findWallet = useCallback(
    (addr: string) => wallets.find((w) => w.address === addr),
    [wallets]
  );

  const swap = useCallback(
    async ({
      fromOwnerBase58,
      outputMint,
      amountDisplay,
      fxRate,
      accessToken,
    }: SwapInput) => {
      setLoading(true);
      setError(null);
      setSignature(null);

      try {
        // ---- guardrails: mainnet + mints required ----
        if (!RPC || !RPC.includes("mainnet")) {
          throw new Error("RPC must be a MAINNET endpoint.");
        }
        if (!outputMint) throw new Error("Missing output mint.");
        const userWallet = findWallet(fromOwnerBase58);
        if (!userWallet)
          throw new Error("Wallet not available in this session.");

        // ---- 1) USD math: gross -> (deduct flat fee) -> net ----
        const amountUsdGross =
          Number.isFinite(amountDisplay) && amountDisplay > 0
            ? amountDisplay / (fxRate || 1)
            : 0;
        if (amountUsdGross <= FLAT_FEE_USD) {
          throw new Error("Amount must exceed the processing fee.");
        }
        const amountUsdNet = amountUsdGross - FLAT_FEE_USD;
        const inAmountUnits = Math.floor(amountUsdNet * 10 ** USDC_DECIMALS);
        if (inAmountUnits <= 0) throw new Error("Net amount too small.");

        // ---- 2) Charge flat $0.20 fee first (sponsored) ----
        await sendFee({
          fromOwnerBase58,
          toOwnerBase58: process.env.NEXT_PUBLIC_APP_TREASURY_OWNER!,
          amountUi: FLAT_FEE_USD, // 0.20 USDC
          accessToken,
          notify: {
            toOwnerBase58: process.env.NEXT_PUBLIC_APP_TREASURY_OWNER!,
            amountUi: FLAT_FEE_USD,
            message: "Processing fee",
          },
        });

        // ---- 3) Get quote USDC -> token (mainnet) ----
        const quoteUrl =
          `${JUP_QUOTE_BASE}?` +
          new URLSearchParams({
            inputMint: USDC_MAINNET,
            outputMint,
            amount: String(inAmountUnits),
            slippageBps: "50",
            restrictIntermediateTokens: "true",
            dynamicSlippage: "true",
          });
        const qRes = await fetch(quoteUrl, { cache: "no-store" });
        if (!qRes.ok) throw new Error(`Quote failed: ${qRes.status}`);
        const quoteResponse = await qRes.json();

        // ---- 4) Ask Jupiter for a fully-built serialized swap tx ----
        const swapRes = await fetch(JUP_SWAP_BASE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quoteResponse,
            userPublicKey: fromOwnerBase58,
            // better landing:
            dynamicComputeUnitLimit: true,
            dynamicSlippage: true,
            prioritizationFeeLamports: {
              priorityLevelWithMaxLamports: {
                maxLamports: 1_000_000,
                priorityLevel: "veryHigh",
              },
            },
          }),
        });
        if (!swapRes.ok) {
          const t = await swapRes.text().catch(() => "");
          throw new Error(`Swap build failed: ${swapRes.status} ${t}`);
        }
        const swapJson = await swapRes.json();
        const txBase64: string = swapJson.swapTransaction;
        if (!txBase64) throw new Error("Empty swap transaction from Jupiter.");

        // ---- 5) Deserialize -> user signs (no wallet modal wording) ----
        const tx = VersionedTransaction.deserialize(
          Buffer.from(txBase64, "base64")
        );
        const recentBlockhash = (tx.message as any).recentBlockhash as
          | string
          | undefined;
        const signedByUser = await userWallet.signTransaction(tx);

        // ---- 6) POST to your backend to add fee-payer signature + broadcast ----
        const headers: HeadersInit = {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        };
        const sendRes = await fetch("/api/jup/swap", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers,
          body: JSON.stringify({
            transaction: Buffer.from(signedByUser.serialize()).toString(
              "base64"
            ),
          }),
        });
        const sendJ = await sendRes.json().catch(() => ({}));
        if (!sendRes.ok || !sendJ?.signature) {
          throw new Error(sendJ?.error || `HTTP ${sendRes.status}`);
        }

        const sig: string = sendJ.signature;

        // ---- 7) Optional: blockhash-based confirmation (types-safe) ----
        const conn = new Connection(RPC, "confirmed");
        const strategy = {
          signature: sig,
          blockhash: recentBlockhash || swapJson?.recentBlockhash || "", // recent blockhash in the tx
          lastValidBlockHeight: swapJson?.lastValidBlockHeight,
        };
        if (!strategy.blockhash || !strategy.lastValidBlockHeight) {
          // fallback if Jupiter shape changes; confirm by signature only (less strict)
          await conn.confirmTransaction(sig, "finalized");
        } else {
          const conf = await conn.confirmTransaction(strategy, "finalized");
          if (conf.value.err) {
            throw new Error(
              `Swap failed: ${JSON.stringify(
                conf.value.err
              )}\nhttps://solscan.io/tx/${sig}`
            );
          }
        }

        setSignature(sig);
        return sig;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [findWallet, sendFee]
  );

  return { swap, loading, signature, error };
}
