"use client";

import { useCallback, useState } from "react";
import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { useSolanaWallets } from "@privy-io/react-auth/solana";

export type TransferNotify = {
  toOwnerBase58: string;
  message?: string;
  amountUi?: number;
};

export type TransferInput = {
  fromOwnerBase58: string;
  toOwnerBase58: string;
  amountUi: number;
  accessToken?: string | null;
  backendUrl?: string;
  notify?: TransferNotify;
};

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC!;
const USDC_MINT = new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT!);
const HAVEN_FEEPAYER = new PublicKey(
  process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS!
);
const TREASURY_OWNER = new PublicKey(
  process.env.NEXT_PUBLIC_APP_TREASURY_OWNER!
);

// USDC(6)
const DECIMALS = 6;

async function detectTokenProgramId(conn: Connection, mint: PublicKey) {
  const info = await conn.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error("USDC mint not found on chain");
  return info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

export function useSponsoredUsdcTransfer() {
  const [loading, setLoading] = useState(false);
  const [lastSig, setLastSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { wallets } = useSolanaWallets();

  const send = useCallback(
    async ({
      fromOwnerBase58,
      toOwnerBase58,
      amountUi,
      accessToken,
      backendUrl,
      notify,
    }: TransferInput) => {
      setLoading(true);
      setError(null);
      setLastSig(null);

      try {
        if (!Number.isFinite(amountUi) || amountUi <= 0) {
          throw new Error("Enter an amount greater than 0");
        }

        const fromOwner = new PublicKey(fromOwnerBase58);
        const toOwner = new PublicKey(toOwnerBase58);

        // User’s embedded wallet (must match fromOwner)
        const userWallet = wallets.find((w) => w.address === fromOwnerBase58);
        if (!userWallet) throw new Error("Source wallet not available.");

        const conn = new Connection(RPC, "confirmed");
        const tokenProgramId = await detectTokenProgramId(conn, USDC_MINT);

        // ATAs (idempotent, payer = Haven)
        const fromAta = getAssociatedTokenAddressSync(
          USDC_MINT,
          fromOwner,
          false,
          tokenProgramId
        );
        const toAta = getAssociatedTokenAddressSync(
          USDC_MINT,
          toOwner,
          false,
          tokenProgramId
        );
        const treasuryAta = getAssociatedTokenAddressSync(
          USDC_MINT,
          TREASURY_OWNER,
          false,
          tokenProgramId
        );

        const ixs = [
          createAssociatedTokenAccountIdempotentInstruction(
            HAVEN_FEEPAYER,
            fromAta,
            fromOwner,
            USDC_MINT,
            tokenProgramId
          ),
          createAssociatedTokenAccountIdempotentInstruction(
            HAVEN_FEEPAYER,
            toAta,
            toOwner,
            USDC_MINT,
            tokenProgramId
          ),
          createAssociatedTokenAccountIdempotentInstruction(
            HAVEN_FEEPAYER,
            treasuryAta,
            TREASURY_OWNER,
            USDC_MINT,
            tokenProgramId
          ),
        ];

        // They receive amountUi; fee is charged ON TOP (sender pays)
        const amountUnits = Math.round(amountUi * 10 ** DECIMALS);

        const feeUi =
          Number(process.env.NEXT_PUBLIC_TRANSFER_FEE_UI) ||
          Number(process.env.TRANSFER_FEE_UI) ||
          0.015; // $0.015 USDC default
        const feeUnits = Math.round(feeUi * 10 ** DECIMALS);

        ixs.push(
          createTransferCheckedInstruction(
            fromAta,
            USDC_MINT,
            toAta,
            fromOwner,
            amountUnits,
            DECIMALS,
            [],
            tokenProgramId
          ),
          createTransferCheckedInstruction(
            fromAta,
            USDC_MINT,
            treasuryAta,
            fromOwner,
            feeUnits,
            DECIMALS,
            [],
            tokenProgramId
          )
        );

        // Fresh blockhash (processed is freshest to avoid expiration)
        const { blockhash } = await conn.getLatestBlockhash("processed");

        // Haven sponsors fees
        const msg = new TransactionMessage({
          payerKey: HAVEN_FEEPAYER,
          recentBlockhash: blockhash,
          instructions: ixs,
        }).compileToV0Message();

        const tx = new VersionedTransaction(msg);

        // User signs as token authority
        const signedByUser = await userWallet.signTransaction(tx);

        // Send to backend for Haven signature + broadcast
        const body: Record<string, unknown> = {
          transaction: Buffer.from(signedByUser.serialize()).toString("base64"),
        };
        if (notify) body.notify = notify;

        const headers: HeadersInit = {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        };

        const res = await fetch(backendUrl ?? "/api/transfer", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers,
          body: JSON.stringify(body),
        });

        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.signature) {
          throw new Error(j?.error || `HTTP ${res.status}`);
        }

        setLastSig(j.signature as string);
        return j.signature as string;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [wallets]
  );

  return { send, loading, lastSig, error };
}
