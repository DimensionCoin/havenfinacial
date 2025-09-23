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
    <div className="w-full max-w-2xl mx-auto space-y-6 vision-perspective">
      {/* Header */}
      <div className="text-center space-y-2">
        <h3 className="text-2xl sm:text-3xl font-bold bg-gradient-to-br from-white via-white to-white/80 bg-clip-text text-transparent tracking-tight">
          Withdraw to Wallet
        </h3>
        <p className="text-sm text-white/60">
          Send funds directly to any Solana wallet address
        </p>
      </div>

      {/* Main form container */}
      <div className="relative group">
        {/* Background glow effect */}
        <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/20 via-transparent to-[rgb(182,255,62)]/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-700" />

        {/* Main glass container */}
        <div className="relative vision-window p-4 sm:p-6 lg:p-8 rounded-3xl border border-white/20 bg-black/40 backdrop-blur-[40px] backdrop-saturate-[200%] shadow-[0_32px_64px_rgba(0,0,0,0.4),0_16px_32px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(0,0,0,0.2)] hover:shadow-[0_40px_80px_rgba(0,0,0,0.5),0_20px_40px_rgba(0,0,0,0.3),inset_0_2px_0_rgba(255,255,255,0.12)] transition-all duration-500 transform-gpu">
          {/* Subtle inner glow */}
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/5 via-transparent to-transparent pointer-events-none" />

          <div className="relative space-y-6">
            {!fromPk && (
              <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 backdrop-blur-sm p-4 text-sm text-yellow-200">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse flex-shrink-0" />
                  <span>
                    Your deposit wallet isn&#39;t ready yet. Please finish
                    onboarding.
                  </span>
                </div>
              </div>
            )}

            {/* From account info */}
            <div className="vision-window rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-4 sm:p-6">
              <div className="space-y-3">
                <div className="text-sm font-semibold text-white/90">
                  From: Chequing account
                </div>
                <div className="text-xs text-white/60 font-mono break-all bg-black/20 rounded-lg p-3">
                  {fromOwner58 || "—"}
                </div>
              </div>
            </div>

            {/* Recipient */}
            <div className="space-y-3">
              <label className="block text-sm font-semibold text-white/90">
                Recipient Wallet Address (Solana)
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value.trim())}
                  placeholder="Paste a Solana address"
                  className={`w-full rounded-2xl border px-4 py-4 sm:px-6 sm:py-4 bg-white/5 backdrop-blur-sm text-white placeholder-white/40 focus:outline-none transition-all duration-300 text-base ${
                    recipientErr
                      ? "border-red-500/60 focus:ring-2 focus:ring-red-500/40 focus:border-red-500"
                      : "border-white/20 focus:ring-2 focus:ring-[rgb(182,255,62)]/50 focus:border-[rgb(182,255,62)] hover:border-white/30"
                  }`}
                />
              </div>
              {recipientErr && (
                <div className="flex items-center gap-2 text-sm text-red-400">
                  <div className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
                  <span>{recipientErr}</span>
                </div>
              )}
            </div>

            {/* Amount */}
            <div className="space-y-4">
              <label className="block text-sm font-semibold text-white/90">
                Amount ({targetCurrency})
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amountLocalStr}
                onChange={(e) => setAmountLocalStr(e.target.value)}
                className="w-full rounded-2xl border border-white/20 bg-white/5 backdrop-blur-sm px-4 py-4 sm:px-6 sm:py-4 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/50 focus:border-[rgb(182,255,62)] hover:border-white/30 transition-all duration-300 text-base text-2xl sm:text-3xl font-bold"
                placeholder="0.00"
                inputMode="decimal"
              />

              {/* Fee breakdown */}
              <div className="vision-window rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-4 sm:p-6 space-y-3">
                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-white/60">
                      You pay (incl. fee):
                    </span>
                    <span className="text-lg font-bold text-white">
                      {fmt(youPayLocal)}
                    </span>
                  </div>

                  <div className="flex justify-between items-center py-2 border-t border-white/10">
                    <span className="text-sm text-white/60">
                      Processing fee:
                    </span>
                    <span className="text-base font-semibold text-white/80">
                      {fmt(feeLocal)}
                    </span>
                  </div>

                  <div className="flex justify-between items-center py-3 border-t border-white/20 bg-[rgb(182,255,62)]/5 rounded-xl px-3">
                    <span className="text-sm font-semibold text-white/90">
                      They receive:
                    </span>
                    <span className="text-xl font-bold text-[rgb(182,255,62)]">
                      {fmt(theyReceiveLocal)}
                    </span>
                  </div>
                </div>

                <div className="text-xs text-white/40 leading-relaxed pt-2 border-t border-white/5">
                  Network fees are covered. A small processing fee (
                  {FEE_USDC.toFixed(3)} USDC) is charged to you on top.
                </div>
              </div>
            </div>

            {/* Submit button */}
            <button
              type="button"
              disabled={disabled}
              onClick={submit}
              className="group relative w-full overflow-hidden rounded-2xl bg-[rgb(182,255,62)] text-black py-4 sm:py-5 font-bold text-lg sm:text-xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[rgb(182,255,62)]/90 transition-all duration-300 shadow-[0_8px_32px_rgba(182,255,62,0.3)] hover:shadow-[0_12px_48px_rgba(182,255,62,0.4)] transform hover:scale-[1.02] active:scale-[0.98] disabled:hover:scale-100"
            >
              {/* Button shimmer effect */}
              <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/20 to-transparent" />

              <div className="relative flex items-center justify-center gap-3">
                {loading && (
                  <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                )}
                <span>
                  {loading
                    ? "Withdrawing…"
                    : `Withdraw ${fmt(validLocal ? amountLocal : 0)}`}
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Status blocks */}
      {lastSig && (
        <div className="vision-window rounded-2xl border border-green-500/30 bg-green-500/10 backdrop-blur-sm p-4 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse flex-shrink-0 mt-1" />
            <div className="flex-1 space-y-2">
              <div className="text-base font-semibold text-green-400">
                Withdrawal Submitted
              </div>
              <div className="text-sm text-white/60 break-all font-mono">
                Transaction: {lastSig}
              </div>
              <a
                href={explorerHref(lastSig)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm text-[rgb(182,255,62)] hover:text-[rgb(182,255,62)]/80 transition-colors group"
              >
                <span>View on Blockchain Explorer</span>
                <svg
                  className="w-4 h-4 transition-transform group-hover:translate-x-1"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 8l4 4m0 0l-4 4m4-4H3"
                  />
                </svg>
              </a>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="vision-window rounded-2xl border border-red-500/30 bg-red-500/10 backdrop-blur-sm p-4 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="w-3 h-3 rounded-full bg-red-400 flex-shrink-0 mt-1" />
            <div className="text-sm text-red-400 leading-relaxed">{error}</div>
          </div>
        </div>
      )}
    </div>
  );
}
