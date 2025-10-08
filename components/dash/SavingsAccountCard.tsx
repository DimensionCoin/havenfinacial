// SavingsAccount.tsx
"use client";

import type React from "react";
import { useCallback, useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Download, Upload } from "lucide-react";
import { toast } from "react-hot-toast";
import { usePrivy } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { useUser } from "@/providers/UserProvider";
import type { VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { useSavingsDeposit } from "@/hooks/useSavingsDeposit";
import { useSavingsActions } from "@/hooks/useSavingsActions";
import { useBalances } from "@/providers/BalanceProvider";
import { useSavingsInterest } from "@/hooks/useSavingsInterest";

// Ensure Buffer exists in the browser
if (typeof window !== "undefined") {
  const globalWindow = window as Window & { Buffer?: typeof Buffer };
  globalWindow.Buffer = globalWindow.Buffer ?? Buffer;
}

/* --------------------------- Types --------------------------- */
type FxResponse = {
  base: "USD";
  target: string;
  rate: number; // USD -> target
  amount: number;
  converted: number;
  asOf?: string | null;
};

type ApyApiResponse = {
  apy?: number; // e.g. 0.0874 for 8.74%
  error?: string;
  note?: string;
};

/* --------------------------- Helpers ------------------------- */
function formatFiatNarrow(n: number, currency: string) {
  try {
    const nf = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 2,
    });
    const parts = nf.formatToParts(n);
    const sym = parts.find((p) => p.type === "currency")?.value ?? "";
    const number = parts
      .filter((p) => p.type !== "currency")
      .map((p) => p.value)
      .join("");
    return `${sym}${number}`;
  } catch {
    return n.toFixed(2);
  }
}
function formatPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  const digits = Math.abs(n) >= 1 ? 1 : 2;
  return `${n.toFixed(digits)}%`;
}
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      }
    );
  });
}

/* ---------------------------- Page --------------------------- */
const SavingsAccount: React.FC = () => {
  const { user, loading: userLoading, refresh: refreshUser } = useUser();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const { wallets: solWallets } = useSolanaWallets();
  const balances = useBalances();

  // First-time "open & deposit"
  const {
    deposit: openAndDepositHook,
    loading: hookLoading,
    error: hookErr,
  } = useSavingsDeposit();

  // Later deposits/withdrawals
  const {
    deposit: depositAction,
    withdraw: withdrawAction,
    loading: actionsLoading,
    error: actionsErr,
  } = useSavingsActions();

  const walletAddress = user?.depositWallet?.address ?? null;
  const displayCurrency = useMemo(() => {
    const c = (user?.displayCurrency || "USD").toUpperCase();
    return c === "USDC" ? "USD" : c;
  }, [user?.displayCurrency]);

  const hasMarginfiAccount = !!user?.marginfi?.accountPk;
  const cachedAccountPk = user?.marginfi?.accountPk || null;

  // Read savings balance from BalanceProvider (USD/USDC-pegged)
  const savingsSlice = balances.savings;
  const savingsUsdc = Number(savingsSlice?.amountUsd ?? 0) || 0;

  // Interest via hook (baseline from Mongo, balance from provider)
  const {
    interestUsd,
    loading: interestLoading,
    error: interestErr,
    refresh: refreshInterest,
  } = useSavingsInterest();

  // local flags (FX + page-level)
  const [fxLoading, setFxLoading] = useState<boolean>(false);
  const [fxRate, setFxRate] = useState<number>(1); // USD -> displayCurrency
  const [err, setErr] = useState<string | null>(null);

  // APY (display-only)
  const [apyLoading, setApyLoading] = useState<boolean>(false);
  const [apyPct, setApyPct] = useState<number | null>(null);

  // modal state
  type Modal = null | { kind: "deposit" | "withdraw" };
  const [modal, setModal] = useState<Modal>(null);
  const [openModal, setOpenModal] = useState(false);

  // combine loading
  const loading =
    userLoading ||
    savingsSlice.loading ||
    fxLoading ||
    hookLoading ||
    actionsLoading ||
    interestLoading;

  /* --------------------- APY (display only) ---------------------- */
  const refreshApy = useCallback(async (): Promise<void> => {
    if (!hasMarginfiAccount) {
      setApyPct(null);
      return;
    }
    setApyLoading(true);
    try {
      const r = await fetch(`/api/savings/apy`, { cache: "no-store" });
      const raw = await r.text();
      const j = JSON.parse(raw) as ApyApiResponse;
      if (!r.ok) throw new Error(j?.error || "Failed to fetch APY");
      const apyDecimal = typeof j.apy === "number" ? j.apy : null;
      setApyPct(apyDecimal != null ? apyDecimal * 100 : null);
    } catch {
      setApyPct(null);
    } finally {
      setApyLoading(false);
    }
  }, [hasMarginfiAccount]);
  useEffect(() => {
    void refreshApy();
  }, [refreshApy]);

  /* --------------------- FX ---------------------- */
  const convertFx = useCallback(
    async (amount: number, currency: string): Promise<FxResponse> => {
      const accessToken = authenticated
        ? await getAccessToken().catch(() => null)
        : null;
      const url = `/api/fx?amount=${encodeURIComponent(
        amount
      )}&currency=${encodeURIComponent(currency)}`;
      const resp = await withTimeout(
        fetch(url, {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          headers: accessToken
            ? { Authorization: `Bearer ${accessToken}` }
            : {},
        }),
        8_000,
        "FX fetch"
      );
      const raw = await resp.text();
      if (!resp.ok) throw new Error(raw);
      return JSON.parse(raw) as FxResponse;
    },
    [authenticated, getAccessToken]
  );

  useEffect(() => {
    if (!hasMarginfiAccount) return;
    let cancelled = false;
    (async () => {
      setErr(null);
      if (displayCurrency === "USD") {
        setFxRate(1);
        return;
      }
      setFxLoading(true);
      try {
        const fx = await convertFx(savingsUsdc, displayCurrency);
        if (!cancelled) setFxRate(fx.rate);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setFxLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasMarginfiAccount, savingsUsdc, displayCurrency, convertFx]);

  // balances in user's local currency
  const fiatValue = useMemo(() => savingsUsdc * fxRate, [savingsUsdc, fxRate]);
  const interestFiat = useMemo(
    () => interestUsd * fxRate,
    [interestUsd, fxRate]
  );
  // Refresh via provider slice + APY + our hook
  const manualRefresh = useCallback(async () => {
    setErr(null);
    await Promise.all([
      savingsSlice?.refresh?.(),
      refreshApy(),
      refreshInterest(),
      refreshUser(),
    ]);
  }, [savingsSlice, refreshApy, refreshInterest, refreshUser]);

  // Convert a local amount to USD for on-chain (USDC)
  const toUsd = useCallback(
    (amountLocal: number) => {
      if (displayCurrency === "USD") return amountLocal;
      const r = Number(fxRate);
      if (!Number.isFinite(r) || r <= 0) return amountLocal; // fallback
      return amountLocal / r;
    },
    [displayCurrency, fxRate]
  );

  /* ----------------- Embedded wallet signer (Privy) ----------------- */
  const signWithPrivy = useCallback(
    async (tx: VersionedTransaction): Promise<VersionedTransaction> => {
      const primary =
        solWallets.find((w) => {
          if (!walletAddress) return false;
          return w.address.toLowerCase() === walletAddress.toLowerCase();
        }) ?? solWallets.find((w) => w.walletClientType === "privy");

      if (!primary?.signTransaction) {
        throw new Error("Embedded Solana wallet not available for signing");
      }
      return await primary.signTransaction(tx);
    },
    [solWallets, walletAddress]
  );

  /* -------------------- Open + deposit (first time) -------------------- */
  const onOpenAndDeposit = useCallback(
    async (amountLocalUi: number): Promise<void> => {
      if (!walletAddress) return void toast.error("Missing wallet address");
      if (!ready || !authenticated) return void toast.error("Please sign in");

      try {
        const amountUsdUi = toUsd(amountLocalUi);

        await openAndDepositHook({
          owner58: walletAddress,
          amountUi: amountUsdUi,
          privyId: user?.privyId,
          signer: signWithPrivy,
        });

        toast.success("Savings account opened and funded ✅");
        setOpenModal(false);
        await Promise.all([
          refreshUser(),
          savingsSlice.refresh(),
          refreshApy(),
          refreshInterest(), // will set baseline and interest properly
        ]);
      } catch (e: unknown) {
        const message =
          e instanceof Error ? e.message : "Failed to open & fund account";
        toast.error(message);
      }
    },
    [
      walletAddress,
      ready,
      authenticated,
      openAndDepositHook,
      signWithPrivy,
      user?.privyId,
      refreshUser,
      savingsSlice,
      refreshApy,
      refreshInterest,
      toUsd,
    ]
  );

  /* -------------------- Deposit / Withdraw (later) -------------------- */
  const onSubmitSavings = useCallback(
    async (
      kind: "deposit" | "withdraw",
      amountLocalUi: number
    ): Promise<void> => {
      if (!walletAddress) return void toast.error("Missing wallet address");
      if (!ready || !authenticated) return void toast.error("Please sign in");

      try {
        const amountUsdUi = toUsd(amountLocalUi);

        if (kind === "deposit") {
          await depositAction({
            owner58: walletAddress,
            amountUi: amountUsdUi,
            decimals: 6,
            ensureAta: true,
            marginfiAccount: cachedAccountPk,
            privyId: user?.privyId,
            signer: signWithPrivy,
          });
          toast.success("Deposit submitted ✅");
        } else {
          await withdrawAction({
            owner58: walletAddress,
            amountUi: amountUsdUi,
            decimals: 6,
            ensureAta: true,
            marginfiAccount: cachedAccountPk,
            privyId: user?.privyId,
            signer: signWithPrivy,
          });
          toast.success("Withdrawal submitted ✅");
        }

        setModal(null);
        await Promise.all([
          refreshUser(),
          savingsSlice.refresh(),
          refreshApy(),
          refreshInterest(), // recompute interest from baseline + new balance
        ]);
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : `Failed to ${kind} savings`
        );
      }
    },
    [
      walletAddress,
      ready,
      authenticated,
      user?.privyId,
      cachedAccountPk,
      refreshUser,
      savingsSlice,
      refreshApy,
      refreshInterest,
      depositAction,
      withdrawAction,
      signWithPrivy,
      toUsd,
    ]
  );

  const openDepositModal = useCallback(() => {
    if (hasMarginfiAccount) setModal({ kind: "deposit" });
  }, [hasMarginfiAccount]);
  const openWithdrawModal = useCallback(() => {
    if (hasMarginfiAccount) setModal({ kind: "withdraw" });
  }, [hasMarginfiAccount]);

  // If no account yet, show "open an account" card
  if (!hasMarginfiAccount) {
    return (
      <div className="space-y-6 vision-perspective">
        {(err || hookErr) && (
          <div className="vision-glass rounded-lg px-4 py-3 text-sm text-red-300 border-red-500/30">
            {err || hookErr}
          </div>
        )}
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/20 via-transparent to-[rgb(182,255,62)]/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-700" />
          <div className="relative vision-window p-4 sm:p-6 lg:p-8 rounded-3xl border border-white/20 bg-black/40 backdrop-blur-[40px]">
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/5 via-transparent to-transparent pointer-events-none" />
            <div className="flex items-center justify-between gap-2 mb-6 sm:mb-8">
              <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                <div className="relative flex-shrink-0">
                  <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-[rgb(182,255,62)] shadow-[0_0_20px_rgba(182,255,62,0.6)] animate-pulse" />
                  <div className="absolute inset-0 w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-[rgb(182,255,62)] animate-ping opacity-20" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-white tracking-tight truncate">
                    Savings Account
                  </h3>
                  <p className="text-xs sm:text-sm text-white/60 mt-1">
                    Available Funds
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-4 sm:pt-6 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex-1">
                <div className="text-white/70 text-sm mb-2 sm:mb-0">
                  You don&apos;t have a savings account yet.
                </div>
                {apyPct && (
                  <div className="text-xs text-white/50">
                    Earn up to {formatPct(apyPct)} APY
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!ready || !authenticated) {
                    toast.error("Please sign in");
                    return;
                  }
                  setOpenModal(true);
                }}
                disabled={!ready || !authenticated || !walletAddress || loading}
                className="group relative overflow-hidden vision-button inline-flex items-center justify-center gap-2 px-4 py-2 rounded-2xl bg-[rgb(182,255,62)] text-black font-semibold"
              >
                <span>{loading ? "Preparing…" : "Open an account"}</span>
              </button>
            </div>
          </div>
        </div>

        {openModal && (
          <OpenAccountModal
            onClose={() => setOpenModal(false)}
            onSubmit={onOpenAndDeposit}
            apyPct={apyPct}
            displayCurrency={displayCurrency}
            fxRate={fxRate}
          />
        )}
      </div>
    );
  }

  // Show any actions hook errors too
  const compositeErr =
    actionsErr || hookErr || savingsSlice.error || interestErr || null;

  // Account exists → show balance + actions
  return (
    <div className="space-y-6 vision-perspective">
      {(err || compositeErr) && (
        <div className="vision-glass rounded-lg px-4 py-3 text-sm text-red-300 border-red-500/30">
          {err || compositeErr}
        </div>
      )}

      <div className="relative group">
        <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/20 via-transparent to-[rgb(182,255,62)]/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-700" />
        <div className="relative vision-window p-4 sm:p-6 lg:p-8 rounded-3xl border border-white/20 bg-black/40 backdrop-blur-[40px]">
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/5 via-transparent to-transparent pointer-events-none" />

          <div className="flex items-center justify-between gap-2 mb-6 sm:mb-8">
            <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
              <div className="relative flex-shrink-0">
                <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-[rgb(182,255,62)] shadow-[0_0_20px_rgba(182,255,62,0.6)] animate-pulse" />
                <div className="absolute inset-0 w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-[rgb(182,255,62)] animate-ping opacity-20" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-white tracking-tight truncate">
                  Savings Account
                </h3>
                <p className="text-xs sm:text-sm text-white/60 mt-1">
                  Available Funds
                </p>
              </div>
            </div>

            <button
              onClick={() => void manualRefresh()}
              disabled={loading || !walletAddress}
              className="vision-button px-3 py-2 sm:px-6 sm:py-3 text-xs sm:text-sm text-[rgb(182,255,62)] disabled:opacity-60 font-medium rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-[rgb(182,255,62)]/30 transition-all duration-300 backdrop-blur-sm flex-shrink-0"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 sm:w-4 sm:h-4 border-2 border-[rgb(182,255,62)]/30 border-t-[rgb(182,255,62)] rounded-full animate-spin" />
                  <span className="hidden sm:inline">Refreshing…</span>
                  <span className="sm:hidden">…</span>
                </div>
              ) : (
                "Refresh"
              )}
            </button>
          </div>

          {/* Amount row with interest directly under amount */}
          <div className="flex px-2 sm:flex-row sm:items-end justify-between gap-2 mb-3 sm:mb-6">
            <div className="flex-1 min-w-0">
              <div className="flex flex-col">
                {/* Top row: balance + currency */}
                <div className="flex items-baseline gap-2 sm:gap-3">
                  {loading ? (
                    <>
                      <div className="h-8 w-24 sm:h-12 sm:w-32 bg-white/10 rounded-xl animate-pulse" />
                      <div className="h-4 w-8 sm:h-6 sm:w-12 bg-white/5 rounded-lg animate-pulse" />
                    </>
                  ) : (
                    <>
                      <span className="text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-black bg-gradient-to-br from-white via-white to-white/80 bg-clip-text text-transparent tracking-tight leading-none">
                        {formatFiatNarrow(fiatValue, displayCurrency)}
                      </span>
                      <span className="text-sm sm:text-base lg:text-lg text-white/50 font-medium pb-0.5 sm:pb-1 lg:pb-2">
                        {displayCurrency.toLowerCase()}
                      </span>
                    </>
                  )}
                </div>

                {/* Tiny gap, interest sits just under balance */}
                <div className="mt-0.5 sm:mt-1">
                  {loading ? (
                    <span className="inline-block h-3 w-20 bg-white/10 rounded animate-pulse" />
                  ) : (
                    <span
                      className={[
                        "text-[11px] sm:text-xs tracking-tight whitespace-nowrap",
                        interestLoading
                          ? "text-white/50"
                          : (interestFiat ?? 0) > 0
                          ? "text-[rgb(182,255,62)]/90"
                          : "text-white/50",
                      ].join(" ")}
                      title="Interest earned since baseline"
                    >
                      interest earned{" "}
                      {interestLoading
                        ? "…"
                        : (() => {
                            const v = Number.isFinite(interestFiat)
                              ? Math.max(0, interestFiat)
                              : 0;
                            const formatted = formatFiatNarrow(
                              v,
                              displayCurrency
                            );
                            return v > 0 ? `+${formatted}` : formatted;
                          })()}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Right-side stats: keep APY only */}
            <div className="flex flex-col gap-2 sm:gap-3">
              <div className="group vision-button p-3 sm:p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-[rgb(182,255,62)]/30 transition-all duration-300 backdrop-blur-sm">
                <div className="text-right">
                  <div className="text-xs sm:text-sm font-mono text-white/70 group-hover:text-[rgb(182,255,62)] transition-colors">
                    {!apyLoading ? `APY ${formatPct(apyPct)}` : "APY …"}
                  </div>
                  <div className="hidden sm:block text-xs text-white/40 opacity-0 group-hover:opacity-100 transition-all duration-200 mt-1">
                    Current annual percentage yield
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 sm:pt-6 border-t border-white/10">
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <ActionButton
                label="Deposit"
                icon={<Download size={16} aria-hidden />}
                onClick={openDepositModal}
                disabled={!ready || !authenticated || loading}
              />
              <ActionButton
                label="Withdraw"
                icon={<Upload size={16} aria-hidden />}
                onClick={openWithdrawModal}
                disabled={!ready || !authenticated || loading}
              />
            </div>
          </div>
        </div>
      </div>

      {modal && (
        <AmountModal
          kind={modal.kind}
          onClose={() => setModal(null)}
          onSubmit={onSubmitSavings}
          displayCurrency={displayCurrency}
          fxRate={fxRate}
        />
      )}
    </div>
  );
};

export default SavingsAccount;

/* ----------------------------- Sub-UI (unchanged) ----------------------------- */
function ActionButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="group relative overflow-hidden vision-button flex flex-col items-center justify-center gap-2 sm:gap-3 px-2 py-4 sm:px-3 sm:py-4 text-white/90 disabled:opacity-50 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-[rgb(182,255,62)]/30 hover:text-[rgb(182,255,62)] transition-all duration-300 backdrop-blur-sm transform hover:scale-[1.02] active:scale-[0.98] hover:shadow-[0_8px_32px_rgba(182,255,62,0.15)]"
    >
      <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[rgb(182,255,62)]/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      <div className="hidden sm:flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 group-hover:bg-[rgb(182,255,62)]/20 group-hover:shadow-[0_0_20px_rgba(182,255,62,0.3)] transition-all duration-300 relative z-10">
        {icon}
      </div>
      <span className="text-sm font-semibold tracking-wide relative z-10">
        {label}
      </span>
    </button>
  );
}

function AmountModal({
  kind,
  onClose,
  onSubmit,
  displayCurrency,
  fxRate, // USD -> display
}: {
  kind: "deposit" | "withdraw";
  onClose: () => void;
  onSubmit: (
    kind: "deposit" | "withdraw",
    amountUiLocal: number
  ) => Promise<void>;
  displayCurrency: string;
  fxRate: number;
}) {
  const [mounted, setMounted] = useState(false);
  const [amount, setAmount] = useState<string>("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const num = Number(amount);
  const valid = Number.isFinite(num) && num > 0;
  const usdApprox =
    displayCurrency === "USD"
      ? num
      : valid && Number.isFinite(fxRate) && fxRate > 0
      ? num / fxRate
      : NaN;

  const submit = async () => {
    const v = Number(amount);
    if (!Number.isFinite(v) || v <= 0)
      return toast.error("Enter a valid amount");
    setBusy(true);
    try {
      // parent converts local -> USD for on-chain
      await onSubmit(kind, v);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] vision-perspective"
      role="dialog"
      aria-modal="true"
      aria-labelledby="savings-modal-title"
    >
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-2xl backdrop-saturate-150"
        onClick={onClose}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 -z-10 ">
        <div className="absolute inset-0 bg-[radial-gradient(40%_30%_at_10%_85%,rgba(182,255,62,0.15),transparent),radial-gradient(35%_25%_at_90%_10%,rgba(182,255,62,0.12),transparent)]" />
      </div>
      <div className="relative mx-auto flex min-h-screen items-center justify-center p-4 sm:p-6 overflow-y-auto overscroll-contain">
        <div className="pointer-events-auto w-full max-w-md vision-window vision-depth flex max-h-[90vh] flex-col overflow-hidden border-2 rounded-lg ">
          <h2 id="savings-modal-title" className="sr-only">
            {kind === "deposit"
              ? "Deposit to savings"
              : "Withdraw from savings"}
          </h2>
          <div className="flex items-center justify-between border-b border-white/10 px-4 sm:px-6 py-4 shrink-0">
            <div className="text-white font-semibold">
              {kind === "deposit"
                ? "Deposit to Savings"
                : "Withdraw from Savings"}
            </div>
            <button
              className="vision-button rounded-xl p-2 hover:bg-white/10 transition-all"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
          <div className="p-4 sm:p-6">
            <label className="block text-sm font-medium text-white/80 mb-2">
              Amount ({displayCurrency})
            </label>
            <input
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/50"
              placeholder="0.00"
              inputMode="decimal"
            />
            <div className="mt-2 text-xs text-white/60">
              {valid ? (
                <span>
                  ≈{" "}
                  <span className="font-mono">
                    {Number.isFinite(usdApprox) ? usdApprox.toFixed(2) : "—"}
                  </span>{" "}
                  USDC
                </span>
              ) : (
                <span>Enter an amount</span>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-white/20 text-white/80 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                disabled={busy || !valid}
                onClick={submit}
                className="px-5 py-2 rounded-2xl bg-[rgb(182,255,62)] text-black font-semibold hover:bg-[rgb(182,255,62)]/90 disabled:opacity-50"
              >
                {busy
                  ? kind === "deposit"
                    ? "Depositing…"
                    : "Withdrawing…"
                  : kind === "deposit"
                  ? "Deposit"
                  : "Withdraw"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function OpenAccountModal({
  onClose,
  onSubmit,
  apyPct,
  displayCurrency,
  fxRate, // USD -> display
}: {
  onClose: () => void;
  onSubmit: (amountUiLocal: number) => Promise<void>;
  apyPct?: number | null;
  displayCurrency: string;
  fxRate: number;
}) {
  const [mounted, setMounted] = useState(false);
  const [amount, setAmount] = useState<string>("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const num = Number(amount);
  const valid = Number.isFinite(num) && num > 0;
  const usdApprox =
    displayCurrency === "USD"
      ? num
      : valid && Number.isFinite(fxRate) && fxRate > 0
      ? num / fxRate
      : NaN;

  const submit = async () => {
    const v = Number(amount);
    if (!Number.isFinite(v) || v <= 0)
      return toast.error("Enter a valid amount");
    setBusy(true);
    try {
      // parent converts local -> USD for on-chain
      await onSubmit(v);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] vision-perspective"
      role="dialog"
      aria-modal="true"
      aria-labelledby="open-savings-modal-title"
    >
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-2xl backdrop-saturate-150"
        onClick={onClose}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(40%_30%_at_10%_85%,rgba(182,255,62,0.15),transparent),radial-gradient(35%_25%_at_90%_10%,rgba(182,255,62,0.12),transparent)]" />
      </div>
      <div className="relative mx-auto flex min-h-screen items-center justify-center p-4 sm:p-6 overflow-y-auto overscroll-contain">
        <div className="pointer-events-auto w-full max-w-md vision-window vision-depth flex max-h-[90vh] flex-col overflow-hidden">
          <h2 id="open-savings-modal-title" className="sr-only">
            Open savings account
          </h2>
          <div className="flex items-center justify-between border-b border-white/10 px-4 sm:px-6 py-4 shrink-0">
            <div className="text-white font-semibold">Open Savings Account</div>
            <button
              className="vision-button rounded-xl p-2 hover:bg-white/10 transition-all"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
          <div className="p-4 sm:p-6">
            <p className="text-sm text-white/70 mb-4">
              Enter an initial amount in your currency. We’ll convert it to USDC
              behind the scenes.
              {apyPct && (
                <span className="block mt-2 text-[rgb(182,255,62)] font-medium">
                  Earn up to {formatPct(apyPct)} APY on your savings.
                </span>
              )}
            </p>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Initial deposit ({displayCurrency})
            </label>
            <input
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/50"
              placeholder="0.00"
              inputMode="decimal"
            />

            {/* live “≈ USDC” preview */}
            <div className="mt-2 text-xs text-white/60">
              {valid ? (
                <span>
                  ≈{" "}
                  <span className="font-mono">
                    {Number.isFinite(usdApprox) ? usdApprox.toFixed(2) : "—"}
                  </span>{" "}
                  USDC
                </span>
              ) : (
                <span>Enter an amount</span>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-white/20 text-white/80 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                disabled={busy || !valid}
                onClick={submit}
                className="px-5 py-2 rounded-2xl bg-[rgb(182,255,62)] text-black font-semibold hover:bg-[rgb(182,255,62)]/90 disabled:opacity-50"
              >
                {busy ? "Opening…" : "Open & deposit"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
