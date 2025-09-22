// components/actions/Withdraw.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useSponsoredUsdcTransfer } from "@/hooks/useSponsoredUsdcTransfer";
import { usePrivy } from "@privy-io/react-auth";
import { useUser } from "@/providers/UserProvider";
import { useRouter } from "next/navigation";
import { toast } from "react-hot-toast";

const EXPLORER_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "devnet";

// Keep UI fee display in sync with server via NEXT_PUBLIC_TRANSFER_FEE_UI
const FEE_USDC: number = (() => {
  const raw = process.env.NEXT_PUBLIC_TRANSFER_FEE_UI ?? "0.015";
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0.015;
})();

const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

export type WithdrawProps = {
  /** Optional override; otherwise uses user.depositWallet.address */
  depositOwner?: string;
  onSuccess?: (signature: string) => void;
};

export default function Withdraw({ depositOwner, onSuccess }: WithdrawProps) {
  const router = useRouter();
  const { user } = useUser();
  const { getAccessToken } = usePrivy();
  const { send, loading, lastSig, error } = useSponsoredUsdcTransfer();

  // Sender (chequing/deposit)
  const fromOwner58 = depositOwner || user?.depositWallet?.address || "";
  const fromPk = useMemo(() => {
    try {
      return fromOwner58 ? new PublicKey(fromOwner58) : null;
    } catch {
      return null;
    }
  }, [fromOwner58]);

  // Currency / FX (map USDC -> USD display like the rest of your app)
  const displayCurrency = (user?.displayCurrency || "USD").toUpperCase();
  const targetCurrency = displayCurrency === "USDC" ? "USD" : displayCurrency;

  const [rate, setRate] = useState<number | null>(null);
  const [fxLoading, setFxLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFxLoading(true);
      try {
        const token = await getAccessToken().catch(() => null);
        const r = await fetch(
          `/api/fx?currency=${encodeURIComponent(targetCurrency)}&amount=1`,
          {
            credentials: "include",
            cache: "no-store",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }
        );
        const j = r.ok ? await r.json() : { rate: 1 };
        if (!cancelled) setRate(Number(j?.rate || 1));
      } catch {
        if (!cancelled) setRate(1);
      } finally {
        if (!cancelled) setFxLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetCurrency, getAccessToken]);

  const fmt = useCallback(
    (v: number | null | undefined) => {
      if (v == null || !isFinite(Number(v))) return "—";
      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: targetCurrency,
          maximumFractionDigits: 2,
        }).format(Number(v));
      } catch {
        return `${targetCurrency} ${Number(v).toFixed(2)}`;
      }
    },
    [targetCurrency]
  );

  // Form state
  const [recipient, setRecipient] = useState("");
  const [amountLocalStr, setAmountLocalStr] = useState("");

  // Validate recipient address
  let recipientPk: PublicKey | null = null;
  let recipientErr: string | null = null;
  try {
    if (recipient) recipientPk = new PublicKey(recipient);
  } catch {
    if (recipient) recipientErr = "Invalid wallet address";
  }

  // Derived amounts (fee is charged ON TOP; recipient gets full amount)
  const amountLocal = Number(amountLocalStr);
  const validLocal = isFinite(amountLocal) && amountLocal > 0;
  const feeLocal = rate ? FEE_USDC * rate : null;
  const youPayLocal =
    rate == null || !validLocal ? null : amountLocal + (feeLocal ?? 0);
  const theyReceiveLocal = rate == null || !validLocal ? null : amountLocal;

  const disabled =
    loading ||
    fxLoading ||
    !fromPk ||
    !recipientPk ||
    !!recipientErr ||
    !validLocal ||
    rate == null ||
    rate <= 0;

  const submit = async () => {
    if (disabled || !recipientPk || !fromPk || !rate) return;
    const toastId = toast.loading("Submitting withdrawal…");

    try {
      // Convert local → USDC UI; backend charges fee to treasury on top
      const amountUi = round6(amountLocal / rate);

      const sig = await send({
        fromOwnerBase58: fromPk.toBase58(),
        toOwnerBase58: recipientPk.toBase58(),
        amountUi, // amount recipient wallet receives
      });

      onSuccess?.(sig);

      toast.success("Withdrawal submitted", { id: toastId });
      setTimeout(() => {
        router.refresh();
        if (typeof window !== "undefined") window.location.reload();
      }, 250);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Withdrawal failed";
      toast.error(msg, { id: toastId });
    }
  };

  const explorerHref = (tx: string) =>
    EXPLORER_CLUSTER === "mainnet"
      ? `https://explorer.solana.com/tx/${tx}`
      : `https://explorer.solana.com/tx/${tx}?cluster=${EXPLORER_CLUSTER}`;

  return (
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900/80 backdrop-blur-xl p-6 space-y-6 shadow-2xl">
      <h3 className="text-xl font-semibold text-white">Withdraw to Wallet</h3>

      {!fromPk && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-200">
          Your deposit wallet isn’t ready yet. Please finish onboarding.
        </div>
      )}

      {/* Source */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/80">
        <div className="font-medium">From: Chequing account</div>
        <div className="mt-1 break-all text-xs opacity-80">
          {fromOwner58 || "—"}
        </div>
      </div>

      {/* Recipient */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-300">
          Recipient Wallet Address (Solana)
        </label>
        <input
          type="text"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value.trim())}
          placeholder="Paste a Solana address"
          className={`w-full rounded-xl border px-4 py-3 bg-zinc-800/50 text-white placeholder-zinc-500 focus:outline-none transition-all ${
            recipientErr
              ? "border-red-500/60 focus:ring-2 focus:ring-red-500/40"
              : "border-zinc-700 focus:ring-2 focus:ring-[rgb(182,255,62)]/50 focus:border-[rgb(182,255,62)]"
          }`}
        />
        {recipientErr && (
          <div className="text-xs text-red-400">{recipientErr}</div>
        )}
      </div>

      {/* Amount */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-zinc-300">
          Amount ({targetCurrency})
        </label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={amountLocalStr}
          onChange={(e) => setAmountLocalStr(e.target.value)}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/50 focus:border-[rgb(182,255,62)] transition-all"
          placeholder="0.00"
          inputMode="decimal"
        />

        <div className="bg-zinc-800/30 rounded-lg p-3 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">You pay (incl. fee):</span>
            <span className="text-white font-medium">{fmt(youPayLocal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Processing fee:</span>
            <span className="text-white font-medium">{fmt(feeLocal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">They receive:</span>
            <span className="text-[rgb(182,255,62)] font-semibold">
              {fmt(theyReceiveLocal)}
            </span>
          </div>
          <div className="text-[10px] text-zinc-500 mt-1">
            Network fees are covered. A small processing fee (
            {FEE_USDC.toFixed(3)} USDC) is charged to you on top.
          </div>
        </div>
      </div>

      {/* Submit */}
      <button
        type="button"
        disabled={disabled}
        onClick={submit}
        className="w-full rounded-xl bg-[rgb(182,255,62)] text-black py-4 font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[rgb(182,255,62)]/90 transition-all duration-200 shadow-lg shadow-[rgb(182,255,62)]/20"
      >
        {loading
          ? "Withdrawing…"
          : `Withdraw ${fmt(validLocal ? amountLocal : 0)}`}
      </button>

      {/* Status */}
      {lastSig && (
        <div className="bg-green-900/20 border border-green-700/30 rounded-lg p-3">
          <div className="text-sm text-green-400 font-medium mb-1">
            Withdrawal Submitted
          </div>
          <div className="text-xs text-zinc-400 break-all">
            Transaction: {lastSig}
          </div>
          <a
            href={explorerHref(lastSig)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-[rgb(182,255,62)] hover:underline mt-1 inline-block"
          >
            View on Blockchain Explorer →
          </a>
        </div>
      )}

      {error && (
        <div className="bg-red-900/20 border border-red-700/30 rounded-lg p-3">
          <div className="text-sm text-red-400">Withdrawal Failed: {error}</div>
        </div>
      )}

      <p className="text-xs text-zinc-500 text-center">
        Network fees are covered. A small processing fee applies.
      </p>
    </div>
  );
}
