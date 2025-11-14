// components/shared/Wrapper.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useUser } from "@/providers/UserProvider";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  NATIVE_MINT,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { toast } from "react-hot-toast";

/* ------------------------- config / constants ------------------------- */

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC!;

// We keep 0.0035 SOL unwrapped as a gas buffer
const MIN_NATIVE_SOL_BUFFER = 0.0035;
// Modal only shows if balance strictly above 0.004
const MODAL_THRESHOLD_SOL = 0.004;

const Wrapper: React.FC = () => {
  const { user, depositSolBalanceUi } = useUser();
  const hasDepositWallet = !!user?.depositWallet?.address;

  const { wallets } = useSolanaWallets();

  const [isOpen, setIsOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false); // only true after SUCCESSFUL wrap
  const [isWrapping, setIsWrapping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connection = useMemo(() => new Connection(RPC, "confirmed"), []);

  const shouldPrompt =
    hasDepositWallet && depositSolBalanceUi > MODAL_THRESHOLD_SOL && !dismissed;

  /* ---------------------- DEBUG LOGS FOR BALANCE ---------------------- */

  useEffect(() => {
    console.log("[Wrapper] user.depositWallet:", user?.depositWallet);
    console.log(
      "[Wrapper] depositSolBalanceUi:",
      depositSolBalanceUi,
      "hasDepositWallet:",
      hasDepositWallet,
      "dismissed:",
      dismissed,
      "shouldPrompt:",
      shouldPrompt
    );
  }, [user, depositSolBalanceUi, hasDepositWallet, dismissed, shouldPrompt]);

  /* -------------------------- open modal logic ------------------------- */

  useEffect(() => {
    if (shouldPrompt && !isOpen) {
      setIsOpen(true);
    }
  }, [shouldPrompt, isOpen]);

  /* --------------------------- wrap handler ---------------------------- */

  const handleWrap = useCallback(async () => {
    try {
      setIsWrapping(true);
      setError(null);

      if (!user?.depositWallet?.address) {
        throw new Error("No deposit wallet configured.");
      }

      if (!wallets || wallets.length === 0) {
        throw new Error("No Solana wallet available.");
      }

      const owner58 = user.depositWallet.address;
      const owner = new PublicKey(owner58);

      const userWallet = wallets.find((w) => w.address === owner58);
      if (!userWallet) {
        throw new Error("Deposit wallet not found in Privy wallets.");
      }

      // Re-check on-chain balance
      const lamports = await connection.getBalance(owner, "confirmed");
      console.log(
        "[Wrapper] on-chain lamports:",
        lamports,
        "=>",
        lamports / LAMPORTS_PER_SOL,
        "SOL"
      );

      const minKeepLamports = Math.ceil(
        MIN_NATIVE_SOL_BUFFER * LAMPORTS_PER_SOL
      );
      if (lamports <= minKeepLamports) {
        throw new Error(
          "Not enough SOL to wrap after keeping 0.0035 SOL for fees."
        );
      }

      // wSOL ATA
      const wsolAta = await getAssociatedTokenAddress(
        NATIVE_MINT,
        owner,
        false
      );
      const ataInfo = await connection.getAccountInfo(wsolAta, "confirmed");

      const ixs = [];
      let rentExemptLamports = 0;

      if (!ataInfo) {
        rentExemptLamports = await connection.getMinimumBalanceForRentExemption(
          ACCOUNT_SIZE
        );

        if (lamports <= minKeepLamports + rentExemptLamports) {
          throw new Error(
            "Not enough SOL to create a wSOL account and keep 0.0035 SOL for fees."
          );
        }

        ixs.push(
          createAssociatedTokenAccountInstruction(
            owner,
            wsolAta,
            owner,
            NATIVE_MINT
          )
        );
      }

      const maxWrapLamports = lamports - minKeepLamports - rentExemptLamports;
      if (maxWrapLamports <= 0) {
        throw new Error(
          "No SOL available to wrap after reserving rent and fee buffer."
        );
      }

      const desiredWrapLamports = Math.floor(
        Math.max(depositSolBalanceUi - MIN_NATIVE_SOL_BUFFER, 0) *
          LAMPORTS_PER_SOL
      );

      const wrapLamports = Math.min(
        maxWrapLamports,
        desiredWrapLamports > 0 ? desiredWrapLamports : maxWrapLamports
      );

      console.log(
        "[Wrapper] wrapLamports:",
        wrapLamports,
        "=>",
        wrapLamports / LAMPORTS_PER_SOL,
        "SOL"
      );

      if (wrapLamports <= 0) {
        throw new Error(
          "Nothing to wrap – your on-chain SOL is at or below the 0.0035 SOL buffer."
        );
      }

      ixs.push(
        SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey: wsolAta,
          lamports: wrapLamports,
        }),
        createSyncNativeInstruction(wsolAta)
      );

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("processed");

      const msg = new TransactionMessage({
        payerKey: owner,
        recentBlockhash: blockhash,
        instructions: ixs,
      }).compileToV0Message();

      const tx = new VersionedTransaction(msg);
      const signedTx = await userWallet.signTransaction(tx);

      const sig = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      console.log("Wrap SOL tx signature:", sig);
      toast.success("Wrapped SOL successfully.");

      // ✅ Only after success: close + never show again (until balance goes back up)
      setIsOpen(false);
      setDismissed(true);
    } catch (err: unknown) {
      console.error("Wrap SOL error:", err);

      let msg = "Failed to wrap SOL. Please try again.";

      if (err instanceof Error) {
        msg = err.message;
      } else if (typeof err === "string") {
        msg = err;
      }

      setError(msg);
      toast.error(msg);
    } finally {
      setIsWrapping(false);
    }
  }, [user, wallets, connection, depositSolBalanceUi]);

  /* --------------------------- render modal ---------------------------- */

  if (!isOpen) return null;

  const estimatedWrapUi = Math.max(
    depositSolBalanceUi - MIN_NATIVE_SOL_BUFFER,
    0
  );

  return (
    <div
      className="fixed inset-0 z-[9999] vision-perspective"
      aria-modal="true"
      role="dialog"
    >
      {/* Dark overlay (no click-to-dismiss!) */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-2xl backdrop-saturate-150" />

      {/* Gradient background glows (like booster modal) */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(40%_30%_at_10%_85%,rgba(182,255,62,0.15),transparent),radial-gradient(35%_25%_at_90%_10%,rgba(182,255,62,0.12),transparent)]" />
      </div>

      {/* Modal window */}
      <div className="pointer-events-auto w-full max-w-lg vision-window vision-depth rounded-3xl border border-white/20 bg-black/40 backdrop-blur-[40px] backdrop-saturate-[200%] shadow-[0_32px_64px_rgba(0,0,0,0.4)] p-6 fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
        {/* Subtle internal gradient */}
        <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/5 via-transparent to-transparent pointer-events-none" />

        <div className="relative space-y-5">
          {/* Header (no close button) */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs text-white/50 mb-1 uppercase tracking-wide">
                Smart wrap
              </div>
              <h2 className="text-xl font-bold text-white tracking-tight">
                Wrap your extra SOL
              </h2>
              <p className="text-xs text-white/60 mt-1 max-w-sm">
                To keep your Haven account gasless and safe, we automatically
                move any spare SOL into wSOL for you, while keeping a tiny
                buffer for fees.
              </p>
            </div>
          </div>

          {/* Content card */}
          <div className="rounded-2xl border border-white/15 bg-white/5 backdrop-blur-sm px-4 py-3 text-sm text-white/70 space-y-2">
            <p>
              You currently have{" "}
              <span className="font-mono text-white font-semibold">
                {depositSolBalanceUi.toFixed(4)} SOL
              </span>{" "}
              in your Haven Deposit Account.
            </p>

            <p>
              Haven will keep{" "}
              <span className="font-mono text-white font-semibold">
                {MIN_NATIVE_SOL_BUFFER.toFixed(4)} SOL
              </span>{" "}
              as a gas buffer and wrap the rest into wSOL for you.
            </p>

            {estimatedWrapUi > 0 && (
              <p className="text-emerald-300 text-sm">
                Estimated amount to wrap now:{" "}
                <span className="font-mono font-semibold">
                  {estimatedWrapUi.toFixed(4)} SOL
                </span>
              </p>
            )}

            {error && (
              <p className="text-xs text-red-400 border-t border-white/10 pt-2">
                {error}
              </p>
            )}
          </div>

          {/* Sub copy */}
          <div className="text-[0.7rem] text-white/45">
            This transaction will be signed with your Privy embedded Solana
            wallet. You&apos;ll pay the tiny Solana network fee directly. Haven
            does not charge any additional fee for wrapping.
          </div>

          {/* Single action button – user MUST wrap */}
          <div className="flex items-center justify-end pt-3 border-t border-white/10">
            <button
              type="button"
              className="group/btn relative overflow-hidden vision-button px-5 py-2.5 rounded-2xl text-xs sm:text-sm bg-[rgb(182,255,62)]/20 border border-[rgb(182,255,62)]/40 text-[rgb(182,255,62)] font-bold hover:bg-[rgb(182,255,62)]/30 hover:border-[rgb(182,255,62)]/60 hover:shadow-[0_8px_32px_rgba(182,255,62,0.3)] transition-all duration-300 backdrop-blur-sm disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleWrap}
              disabled={isWrapping || estimatedWrapUi <= 0}
            >
              <div className="absolute inset-0 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/15 to-transparent pointer-events-none" />
              <span className="relative z-10">
                {isWrapping ? "Wrapping…" : "Wrap SOL and continue"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Wrapper;
