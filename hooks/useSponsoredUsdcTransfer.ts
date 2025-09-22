// hooks/useSponsoredUsdcTransfer.ts
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
  /** recipient owner (base58) so the server can resolve the user */
  toOwnerBase58: string;
  /** optional custom copy; server has a nice default */
  message?: string;
  /** optional for templating a friendly “You received $X” server message */
  amountUi?: number;
};

export type TransferInput = {
  /** sender authority; pass user.depositWallet.address */
  fromOwnerBase58: string;
  /** recipient owner */
  toOwnerBase58: string;
  /** amount the recipient should receive (USDC, UI) */
  amountUi: number;
  /** optional bearer; cookie fallback works too */
  accessToken?: string | null;
  /** optional override; default /api/transfer */
  backendUrl?: string;
  /** ask server to create a notification for the recipient */
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

// Keep in sync with your server’s TRANSFER_FEE_UI
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
      notify, // <-- include notify in params
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

        // Find the embedded wallet that matches the sender address
        const userWallet = wallets.find((w) => w.address === fromOwnerBase58);
        if (!userWallet) {
          throw new Error("Source wallet not available in this session.");
        }

        const conn = new Connection(RPC, "confirmed");
        const tokenProgramId = await detectTokenProgramId(conn, USDC_MINT);

        // ATAs
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

        // Create ATAs idempotently (payer = Haven)
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

        // Amount the recipient should receive
        const amountUnits = Math.round(amountUi * 10 ** DECIMALS);

        // Fee charged ON TOP (sender pays amount + fee)
        const feeUiEnv =
          Number(process.env.NEXT_PUBLIC_TRANSFER_FEE_UI) ||
          Number(process.env.TRANSFER_FEE_UI) ||
          0.015;
        const feeUnits = Math.round(feeUiEnv * 10 ** DECIMALS);

        // Two transfers; authority = sender (user)
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

        // Build with Haven as fee payer (server will add that signature)
        const { blockhash } = await conn.getLatestBlockhash("finalized");
        const msg = new TransactionMessage({
          payerKey: HAVEN_FEEPAYER,
          recentBlockhash: blockhash,
          instructions: ixs,
        }).compileToV0Message();

        const tx = new VersionedTransaction(msg);

        // User signs as authority
        const signedByUser = await userWallet.signTransaction(tx);

        // Ship to backend for Haven fee-payer signature + broadcast
        const bodyObj: any = {
          transaction: Buffer.from(signedByUser.serialize()).toString("base64"),
        };
        if (notify) bodyObj.notify = notify; // <-- forward notify (includes amountUi if provided)

        const headers: HeadersInit = {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        };

        const res = await fetch(backendUrl ?? "/api/transfer", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers,
          body: JSON.stringify(bodyObj),
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
