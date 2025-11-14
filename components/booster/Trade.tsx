// app/components/booster/Trade.tsx
"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { TrendingUp, TrendingDown, Info, AlertCircle } from "lucide-react";
import { useUser } from "@/providers/UserProvider";
import { useServerSponsoredBoosterOpen } from "@/hooks/useServerSponsoredBoosterOpen";

type CoinSymbol = "BTC" | "SOL" | "ETH";

type TradeProps = {
  selectedCoin: CoinSymbol;
  side: "long" | "short";
  setSide: (s: "long" | "short") => void;

  currency: string;
  depositUsd: number;
  depositLoading: boolean;
  depositErr: string | null;
  onRefreshDeposit: () => void;

  // fxRate is USD → display (e.g. 1 USD * fxRate = local currency)
  fxRate: number;
  priceUsd: number | null; // current price in USD

  disclaimerAccepted: boolean;

  /** 🔹 Called after a successful open so parent can refresh Positions */
  onPositionChange?: () => void;
};

const FIXED_LEVERAGE = 1.5;
const MIN_MARGIN_USD = 14.25; // min margin (user deposit, before fee)
const FEE_RATE = 0.02; // 2% fee
const DEPOSIT_STALE_MS = 11_000; // consider deposit stale after 11s

function formatMoney(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

function toNum(v: string) {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Safely extract the deposit wallet address from the UserProvider `user`
 * regardless of whether the field is `depositWallet.address` or
 * `depositWalletAddress`.
 */
function getOwnerBase58FromUser(user: unknown): string {
  if (!user) return "";

  const typed = user as {
    depositWallet?: { address?: string | null } | null;
    depositWalletAddress?: string | null;
  };

  return typed.depositWallet?.address ?? typed.depositWalletAddress ?? "";
}

export default function Trade({
  selectedCoin,
  side,
  setSide,
  currency,
  depositUsd,
  depositLoading,
  depositErr,
  onRefreshDeposit,
  fxRate,
  priceUsd,
  disclaimerAccepted,
  onPositionChange,
}: TradeProps) {
  const { user } = useUser();
  const [depositAmount, setDepositAmount] = useState<string>("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [lastSignature, setLastSignature] = useState<string | null>(null);
  const [lastDepositRefreshAt, setLastDepositRefreshAt] = useState<
    number | null
  >(null);

  const {
    openBoosterPosition,
    loading: boosterLoading,
    error: boosterError,
  } = useServerSponsoredBoosterOpen();

  const fx = fxRate || 1;
  const formatLocal = useCallback(
    (n: number) => formatMoney(n, currency),
    [currency]
  );
  const availableLocal = useMemo(() => depositUsd * fx, [depositUsd, fx]);

  /* ---------- Booster math (using props + local input) ---------- */

  const depositLocal = toNum(depositAmount); // user input in display currency
  const depositUsdFromInput = fx > 0 ? depositLocal / fx : depositLocal || 0; // gross deposit in USD

  // Fee and net margin
  const feeUsd = depositUsdFromInput * FEE_RATE;
  const feeLocal = feeUsd * fx;

  const marginUsd = Math.max(depositUsdFromInput - feeUsd, 0); // margin after 2% fee
  const marginLocal = marginUsd * fx;

  const boostedUsd = marginUsd * FIXED_LEVERAGE;
  const boostedLocal = boostedUsd * fx;
  const extraLocal = boostedLocal - marginLocal;

  const qtyAtCurrentPrice =
    priceUsd && priceUsd > 0 ? boostedUsd / priceUsd : 0;

  const liquidationUsd =
    priceUsd && priceUsd > 0 && qtyAtCurrentPrice > 0
      ? side === "long"
        ? priceUsd - marginUsd / qtyAtCurrentPrice
        : priceUsd + marginUsd / qtyAtCurrentPrice
      : 0;

  const liquidationLocal = liquidationUsd * fx;

  const minMarginLocal = MIN_MARGIN_USD * fx;
  const belowMinMargin =
    depositUsdFromInput > 0 && depositUsdFromInput < MIN_MARGIN_USD;

  const depositExceedsBalance =
    depositUsdFromInput > depositUsd && depositLocal > 0;

  const hasValidPrice = !!priceUsd && priceUsd > 0;

  const canTrade =
    depositUsdFromInput > 0 &&
    !depositExceedsBalance &&
    !belowMinMargin &&
    hasValidPrice &&
    disclaimerAccepted;

  /* ------------------------ Refresh helpers ------------------------ */

  const safeRefreshDeposit = useCallback(() => {
    if (depositLoading) return;
    try {
      onRefreshDeposit();
      setLastDepositRefreshAt(Date.now());
    } catch (e) {
      // swallow; error surfaced via depositErr
      console.error("[Trade] refresh deposit failed", e);
    }
  }, [depositLoading, onRefreshDeposit]);

  // On mount, get a fresh balance snapshot
  useEffect(() => {
    safeRefreshDeposit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh deposit when tab comes back into view (user returns after idle)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        safeRefreshDeposit();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [safeRefreshDeposit]);

  // Periodic refresh while active to avoid stale balances/sessions
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        safeRefreshDeposit();
      }
    }, DEPOSIT_STALE_MS);
    return () => clearInterval(id);
  }, [safeRefreshDeposit]);

  /* ------------------------ Handlers ------------------------ */

  const handleTrade = useCallback(async () => {
    setLocalError(null);

    const ownerBase58 = getOwnerBase58FromUser(user);

    if (!ownerBase58) {
      setLocalError("No deposit wallet available. Please reconnect Haven.");
      return;
    }

    if (!hasValidPrice) {
      setLocalError(
        "Price data is out of date. Please wait a moment while we refresh."
      );
      safeRefreshDeposit();
      return;
    }

    if (!canTrade) return;

    // If deposit is stale, trigger a quick refresh before sending the tx.
    const now = Date.now();
    if (
      lastDepositRefreshAt === null ||
      now - lastDepositRefreshAt > DEPOSIT_STALE_MS
    ) {
      safeRefreshDeposit();
    }

    try {
      const sig = await openBoosterPosition({
        ownerBase58,
        symbol: selectedCoin,
        side,
        // marginDisplay is the *user's deposit* in display currency.
        // The 2% fee is taken from this deposit on our side.
        marginDisplay: depositLocal,
        fxRate,
        priceSlippageBps: 500, // 5% slippage
      });

      setLastSignature(sig || null);
      setDepositAmount("");
      // After a successful open, refresh balance again so UI is accurate
      safeRefreshDeposit();

      // 🔹 Notify parent so Positions can refetch immediately
      onPositionChange?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLocalError(msg);
    }
  }, [
    user,
    hasValidPrice,
    canTrade,
    lastDepositRefreshAt,
    openBoosterPosition,
    selectedCoin,
    side,
    depositLocal,
    fxRate,
    safeRefreshDeposit,
    onPositionChange,
  ]);

  // Clear local error when user changes amount or direction
  useEffect(() => {
    if (localError) {
      setLocalError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositAmount, side]);

  /* ------- Auto-clear success message after 10 seconds ------- */

  useEffect(() => {
    if (!lastSignature) return;

    const id = setTimeout(() => {
      setLastSignature(null);
    }, 10_000);

    return () => clearTimeout(id);
  }, [lastSignature]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <h2 className="text-white font-bold text-lg sm:text-xl mb-4 text-balance">
          Boost Your Crypto
        </h2>

        {/* Balance */}
        <div className="p-3 sm:p-4 rounded-2xl bg-white/5 border border-white/10 mb-4 sm:mb-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-white/60 text-[0.65rem] sm:text-xs mb-1 font-medium">
                Available Balance
              </div>
              {depositErr ? (
                <div className="text-xs text-red-300">{depositErr}</div>
              ) : depositLoading ? (
                <div className="h-6 w-28 sm:w-32 rounded-md bg-white/10 animate-pulse" />
              ) : (
                <div className="text-white font-bold text-lg sm:text-xl">
                  {formatLocal(availableLocal)}
                </div>
              )}
            </div>
            <button
              onClick={safeRefreshDeposit}
              className="px-3 py-1.5 text-[0.65rem] sm:text-xs rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white/70 hover:text-white transition-all duration-300 disabled:opacity-50 font-semibold whitespace-nowrap"
              disabled={depositLoading}
              aria-label="Refresh balance"
            >
              {depositLoading ? "…" : "Refresh"}
            </button>
          </div>
        </div>
      </div>

      {/* Direction */}
      <div>
        <label className="block text-white/80 text-[0.65rem] sm:text-xs font-semibold mb-2 sm:mb-3 uppercase tracking-wider">
          Direction
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => setSide("long")}
            className={[
              "flex-1 py-2.5 sm:py-3 rounded-xl transition-all duration-300 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 sm:gap-2",
              side === "long"
                ? "bg-[rgb(182,255,62)]/15 border border-[rgb(182,255,62)]/30 text-[rgb(182,255,62)] shadow-[0_6px_18px_rgba(182,255,62,0.2)]"
                : "bg-white/5 border border-white/10 text-white/70 hover:bg-white/10",
            ].join(" ")}
            aria-pressed={side === "long"}
          >
            <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            Long
          </button>
          <button
            onClick={() => setSide("short")}
            className={[
              "flex-1 py-2.5 sm:py-3 rounded-xl transition-all duration-300 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 sm:gap-2",
              side === "short"
                ? "bg-red-500/15 border border-red-500/30 text-red-400 shadow-[0_6px_18px_rgba(239,68,68,0.2)]"
                : "bg-white/5 border border-white/10 text-white/70 hover:bg-white/10",
            ].join(" ")}
            aria-pressed={side === "short"}
          >
            <TrendingDown className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            Short
          </button>
        </div>
      </div>

      {/* Amount */}
      <div>
        <label className="block text-white/80 text-[0.65rem] sm:text-xs font-semibold mb-2 sm:mb-3 uppercase tracking-wider">
          Amount to boost ({currency})
        </label>
        <div className="relative group/input">
          <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/20 via-transparent to-[rgb(182,255,62)]/20 rounded-2xl blur-xl opacity-0 group-focus-within/input:opacity-100 transition-all duration-500 pointer-events-none" />
          <input
            type="text"
            inputMode="decimal"
            value={depositAmount}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "" || /^\d*\.?\d*$/.test(val)) {
                setDepositAmount(val);
              }
            }}
            placeholder="0.00"
            className="relative w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-white/5 backdrop-blur-sm border border-white/20 rounded-2xl text-sm sm:text-lg text-white font-semibold placeholder-white/50 focus:outline-none focus:border-[rgb(182,255,62)]/50 focus:bg-white/10 transition-all duration-300"
            aria-label="Deposit amount to boost"
          />
        </div>

        {/* Quick-fill */}
        <div className="flex gap-1.5 sm:gap-2 mt-2 sm:mt-3">
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              disabled={depositLoading || depositUsd <= 0}
              onClick={() => {
                const amountLocal = (availableLocal * pct) / 100;
                setDepositAmount(amountLocal.toFixed(2));
              }}
              className="flex-1 py-1.5 sm:py-2 rounded-lg bg-white/5 border border-white/10 text-white/70 text-[0.65rem] sm:text-xs font-semibold hover:bg-white/10 hover:border-white/20 transition-all disabled:opacity-50"
              aria-label={`Set ${pct}% of balance`}
            >
              {pct}%
            </button>
          ))}
        </div>

        {/* Validation */}
        {depositExceedsBalance && (
          <div className="mt-2 sm:mt-3 p-2.5 sm:p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-[0.65rem] sm:text-xs text-red-300">
            Amount exceeds available balance
          </div>
        )}

        {belowMinMargin && !depositExceedsBalance && (
          <div className="mt-2 sm:mt-3 p-2.5 sm:p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-[0.65rem] sm:text-xs text-yellow-300">
            Minimum margin is {formatLocal(minMarginLocal)} (≈ $
            {MIN_MARGIN_USD.toFixed(2)} before fees).
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="p-3 sm:p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2.5 sm:space-y-3">
        <div className="flex justify-between text-[0.7rem] sm:text-sm">
          <span className="text-white/60">Your deposit</span>
          <span className="text-white font-semibold">
            {formatLocal(depositLocal || 0)}
          </span>
        </div>
        <div className="flex justify-between text-[0.7rem] sm:text-sm">
          <span className="text-white/60">Haven fee (2%)</span>
          <span className="text-white/80 font-semibold">
            {formatLocal(feeLocal || 0)}
          </span>
        </div>
        <div className="flex justify-between text-[0.7rem] sm:text-sm">
          <span className="text-white/60">Net margin after fee</span>
          <span className="text-white font-semibold">
            {formatLocal(marginLocal || 0)}
          </span>
        </div>
        <div className="flex justify-between text-[0.7rem] sm:text-sm pt-2 border-t border-white/10">
          <span className="text-white/60">Trading Power (1.5×)</span>
          <span className="text-[rgb(182,255,62)] font-semibold">
            {formatLocal(boostedLocal || 0)}
          </span>
        </div>
        <div className="flex justify-between text-[0.7rem] sm:text-sm">
          <span className="text-white/60">Extra Exposure from Booster</span>
          <span className="text-[rgb(182,255,62)]/90 font-semibold">
            {formatLocal(extraLocal > 0 ? extraLocal : 0)}
          </span>
        </div>
        <div className="border-t border-white/10 pt-2 sm:pt-3 space-y-1.5">
          <div className="flex justify-between text-[0.7rem] sm:text-sm">
            <span className="text-white/60">Est. Position Size</span>
            <span className="text-white/90 font-semibold">
              {qtyAtCurrentPrice > 0
                ? `${qtyAtCurrentPrice.toFixed(4)} ${selectedCoin}`
                : "-"}
            </span>
          </div>
          <div className="flex justify-between text-[0.7rem] sm:text-sm">
            <span className="text-white/60">Estimated Liquidation Price</span>
            <span
              className={side === "long" ? "text-red-400" : "text-blue-400"}
            >
              {liquidationLocal > 0 ? formatLocal(liquidationLocal) : "-"}
            </span>
          </div>
        </div>
      </div>

      {/* CTA */}
      <button
        onClick={handleTrade}
        disabled={!canTrade || boosterLoading}
        className={[
          "group/btn relative overflow-hidden w-full py-3 sm:py-4 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 backdrop-blur-sm font-bold text-base sm:text-lg flex items-center justify-center gap-2",
          side === "long"
            ? "bg-[rgb(182,255,62)]/20 border border-[rgb(182,255,62)]/40 hover:bg-[rgb(182,255,62)]/30 hover:border-[rgb(182,255,62)]/60 hover:shadow-[0_8px_32px_rgba(182,255,62,0.3)] text-[rgb(182,255,62)]"
            : "bg-red-500/20 border border-red-500/40 hover:bg-red-500/30 hover:border-red-500/60 hover:shadow-[0_8px_32px_rgba(239,68,68,0.3)] text-red-400",
        ].join(" ")}
        aria-disabled={!canTrade || boosterLoading}
      >
        <div className="absolute inset-0 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/15 to-transparent pointer-events-none" />
        <div className="relative flex items-center justify-center gap-2">
          {boosterLoading ? (
            <span className="text-sm sm:text-base">
              Opening boosted position…
            </span>
          ) : side === "long" ? (
            <>
              <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5" />
              <span>Boost Long</span>
            </>
          ) : (
            <>
              <TrendingDown className="w-4 h-4 sm:w-5 sm:h-5" />
              <span>Boost Short</span>
            </>
          )}
        </div>
      </button>

      {/* Errors / success / info */}
      {(localError || boosterError) && (
        <div className="p-2.5 sm:p-3 rounded-xl bg-red-500/10 border border-red-500/30 flex gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-[0.65rem] sm:text-xs text-red-200">
            {localError || boosterError}
          </p>
        </div>
      )}

      {lastSignature && (
        <div className="p-2.5 sm:p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-[0.65rem] sm:text-xs text-emerald-200 break-all">
          Position opened. Tx:{" "}
          <a
            href={`https://solscan.io/tx/${lastSignature}`}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-emerald-400"
          >
            {lastSignature}
          </a>{" "}
          <span className="text-emerald-300/70">
            (this message will disappear in 10 seconds)
          </span>
        </div>
      )}

      {!disclaimerAccepted && (
        <div className="p-2.5 sm:p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/30 flex gap-2">
          <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
          <p className="text-[0.65rem] sm:text-xs text-yellow-500/90 font-medium">
            Please accept the Trade Booster terms before placing a leveraged
            trade.
          </p>
        </div>
      )}

      <div className="p-2.5 sm:p-3 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex gap-2">
        <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
        <p className="text-[0.65rem] sm:text-xs text-blue-500/90">
          💡 Trade Booster increases the amount of crypto you hold by 1.5× on
          your{" "}
          <span className="font-semibold">net margin after a 2% Haven fee</span>
          . The fee is taken from your deposit before boosting. Only boost what
          you can afford to lose.
        </p>
      </div>
    </div>
  );
}
