"use client";

import type React from "react";
import { useCallback, useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useUser } from "@/providers/UserProvider";
import { useBalances } from "@/providers/BalanceProvider";
import { usePrivy } from "@privy-io/react-auth";
import { toast } from "react-hot-toast";
import { Download, Upload, ArrowRightLeft, X } from "lucide-react";
import Buy from "@/components/actions/Buy";
import Deposit from "@/components/actions/Deposit";
import UserTransfer from "@/components/actions/UserTransfer";
import Sell from "@/components/actions/Sell";
import Withdraw from "@/components/actions/Withdraw";
import CancelTransfer from "@/components/actions/CancelTransfer";
import { PublicKey } from "@solana/web3.js";

/* --------------------------------- Utils --------------------------------- */
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
function mask(addr?: string | null): string {
  if (!addr || addr.length < 8) return "****-****-0000";
  return `${addr.slice(0, 4)}-****-****-${addr.slice(-4)}`;
}
function maskMobile(addr?: string | null): string {
  if (!addr || addr.length < 4) return "-****-0000";
  return `-****-${addr.slice(-4)}`;
}

/* --------------------------------- Types --------------------------------- */
type WithdrawConfig = {
  depositOwner: string;
  onSuccess?: (signature: string) => void;
};
type TransferConfig = {
  depositOwner?: string;
  onSuccess?: (signature: string) => void;
};
type DepositAccountProps = {
  disabled?: boolean;
  onDeposit?: () => void;
  onWithdraw?: () => void;
  onTransfer?: () => void;
  withdraw?: WithdrawConfig;
  transfer?: TransferConfig;
  onWithdrawOpen?: () => void;
  onTransferOpen?: () => void;
};
type ActiveModal = null | "deposit" | "withdraw" | "transfer";

/* ------------------------------ Main card ------------------------------- */
const DepositAccount: React.FC<DepositAccountProps> = ({
  disabled,
  onDeposit,
  onWithdraw,
  onTransfer,
  withdraw,
  transfer,
  onWithdrawOpen,
  onTransferOpen,
}) => {
  const { user, loading: userLoading } = useUser();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const balances = useBalances();

  // Source of truth: USD amount from the provider
  const depositCtx = balances.deposit; // { amountUsd, loading, error, refresh }
  const depositUsd = Number(depositCtx?.amountUsd ?? 0) || 0;

  // Target currency (USDC -> USD)
  const fiatCurrency = useMemo(() => {
    const raw = (user?.displayCurrency || "USD").toUpperCase();
    return raw === "USDC" ? "USD" : raw;
  }, [user?.displayCurrency]);

  // FX state (USD -> target)
  const [fxRate, setFxRate] = useState(1);
  const [fxLoading, setFxLoading] = useState(false);

  const fetchFx = useCallback(
    async (amountUsd: number, currency: string) => {
      if (currency === "USD") {
        setFxRate(1);
        return;
      }
      if (!ready || !authenticated) {
        setFxRate(1);
        return;
      }
      setFxLoading(true);
      try {
        const token = await getAccessToken().catch(() => null);
        // Use amount=1 so the URL is cacheable per currency; multiply locally
        const url = new URL("/api/fx", window.location.origin);
        url.searchParams.set("currency", currency);
        url.searchParams.set("amount", "1");
        const r = await fetch(url.toString(), {
          credentials: "include",
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const j = await r.json().catch(() => null);
        const rate = r.ok && j?.rate ? Number(j.rate) : 1;
        setFxRate(Number.isFinite(rate) && rate > 0 ? rate : 1);
      } catch {
        setFxRate(1);
      } finally {
        setFxLoading(false);
      }
    },
    [ready, authenticated, getAccessToken]
  );

  // Refresh FX when currency changes or on mount; USD amount multiplies locally
  useEffect(() => {
    void fetchFx(depositUsd, fiatCurrency);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fiatCurrency, fetchFx]);

  // Convert locally
  const depositFiat = useMemo(() => depositUsd * fxRate, [depositUsd, fxRate]);

  const walletAddress = user?.depositWallet?.address ?? null;

  const loading = Boolean(userLoading || depositCtx?.loading || fxLoading);
  const errRaw = depositCtx?.error; // string | null
  const errMsg: string | null = typeof errRaw === "string" ? errRaw : null;

  // Refresh just the deposit balance, then re-apply FX
  const manualRefresh = useCallback(async () => {
    await depositCtx?.refresh?.();
    // re-use cached FX (if any) by just calling fetchFx to ensure freshness
    void fetchFx(depositUsd, fiatCurrency);
  }, [depositCtx, fetchFx, depositUsd, fiatCurrency]);

  // Copy address
  const copyAccountNumber = useCallback(async () => {
    if (!walletAddress) return;
    try {
      await navigator.clipboard.writeText(walletAddress);
      toast.success("Wallet address copied");
    } catch {
      toast.error("Couldn't copy wallet address");
    }
  }, [walletAddress]);

  /* ------------------------------ Modal logic ------------------------------ */
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const modalOpen = activeModal !== null;

  const openDepositModal = useCallback(() => {
    if (disabled) return;
    onDeposit?.();
    setActiveModal("deposit");
  }, [disabled, onDeposit]);

  const openWithdrawModal = useCallback(() => {
    if (disabled) return;
    onWithdraw?.();
    onWithdrawOpen?.();
    setActiveModal("withdraw");
  }, [disabled, onWithdraw, onWithdrawOpen]);

  const openTransferModal = useCallback(() => {
    if (disabled) return;
    onTransfer?.();
    onTransferOpen?.();
    setActiveModal("transfer");
  }, [disabled, onTransfer, onTransferOpen]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setActiveModal(null);
    window.addEventListener("keydown", onKey);

    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [modalOpen]);

  return (
    <div className="space-y-6 vision-perspective">
      {errMsg && (
        <div className="vision-glass rounded-lg px-4 py-3 text-sm text-red-300 border-red-500/30">
          {errMsg}
        </div>
      )}

      <div className="relative group">
        {/* Background glow effect */}
        <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/20 via-transparent to-[rgb(182,255,62)]/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-700" />

        {/* Main glass window */}
        <div className="relative vision-window p-4 sm:p-6 lg:p-8 rounded-3xl border border-white/20 bg-black/40 backdrop-blur-[40px] backdrop-saturate-[200%] shadow-[0_32px_64px_rgba(0,0,0,0.4),0_16px_32px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(0,0,0,0.2)] hover:shadow-[0_40px_80px_rgba(0,0,0,0.5),0_20px_40px_rgba(0,0,0,0.3),inset_0_2px_0_rgba(255,255,255,0.12)] transition-all duration-500 transform-gpu">
          {/* Subtle inner glow */}
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/5 via-transparent to-transparent pointer-events-none" />

          {/* Header */}
          <div className="flex items-center justify-between gap-2 mb-6 sm:mb-8">
            <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
              <div className="relative flex-shrink-0">
                <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-[rgb(182,255,62)] shadow-[0_0_20px_rgba(182,255,62,0.6)] animate-pulse" />
                <div className="absolute inset-0 w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-[rgb(182,255,62)] animate-ping opacity-20" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-white tracking-tight truncate">
                  Deposit Account
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

          {/* Figures */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-3 sm:mb-6">
            <div className="flex-1 min-w-0">
              <div className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-3 flex-1 min-w-0">
                    {loading ? (
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-24 sm:h-12 sm:w-32 bg-white/10 rounded-xl animate-pulse" />
                        <div className="h-4 w-8 sm:h-6 sm:w-12 bg-white/5 rounded-lg animate-pulse" />
                      </div>
                    ) : (
                      <>
                        <span className="text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-black bg-gradient-to-br from-white via-white to-white/80 bg-clip-text text-transparent tracking-tight leading-none">
                          {formatFiatNarrow(depositFiat, fiatCurrency)}
                        </span>
                        <span className="text-sm sm:text-base lg:text-lg text-white/50 font-medium sm:self-end sm:pb-1 lg:pb-2">
                          {fiatCurrency.toLowerCase()}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Mobile account number */}
                  <div className="sm:hidden flex-shrink-0">
                    <button
                      onClick={copyAccountNumber}
                      className="group vision-button px-2 py-1 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-[rgb(182,255,62)]/30 transition-all duration-300 backdrop-blur-sm"
                      disabled={!walletAddress}
                      title={walletAddress || undefined}
                    >
                      <div className="text-xs font-mono text-white/70 group-hover:text-[rgb(182,255,62)] transition-colors">
                        {maskMobile(walletAddress)}
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Desktop account number */}
            <div className="hidden sm:block flex-shrink-0">
              <button
                onClick={copyAccountNumber}
                className="group vision-button p-3 sm:p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-[rgb(182,255,62)]/30 transition-all duration-300 backdrop-blur-sm"
                disabled={!walletAddress}
                title={walletAddress || undefined}
              >
                <div className="text-right">
                  <div className="text-xs sm:text-sm font-mono text-white/70 group-hover:text-[rgb(182,255,62)] transition-colors">
                    {mask(walletAddress)}
                  </div>
                  <div className="text-xs text-white/40 opacity-0 group-hover:opacity-100 transition-all duration-200 mt-1">
                    Click to copy account number
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="pt-4 sm:pt-6 border-t border-white/10">
            <div className="grid grid-cols-3 gap-3 sm:gap-4">
              <ActionButton
                label="Deposit"
                icon={<Download size={16} aria-hidden />}
                onClick={openDepositModal}
                disabled={disabled}
              />
              <ActionButton
                label="Withdraw"
                icon={<Upload size={16} aria-hidden />}
                onClick={openWithdrawModal}
                disabled={disabled}
              />
              <ActionButton
                label="Transfer"
                icon={<ArrowRightLeft size={16} aria-hidden />}
                onClick={openTransferModal}
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {activeModal === "deposit" && (
        <DepositModal onClose={() => setActiveModal(null)} />
      )}
      {activeModal === "withdraw" && (
        <WithdrawModal
          withdraw={withdraw}
          onClose={() => setActiveModal(null)}
        />
      )}
      {activeModal === "transfer" && (
        <TransferModal
          transfer={transfer}
          onClose={() => setActiveModal(null)}
        />
      )}
    </div>
  );
};

/* ------------------------------ UI bits ------------------------------ */
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
      <span className="text-sm sm:text-sm font-semibold tracking-wide relative z-10">
        {label}
      </span>
    </button>
  );
}

/* ------------------------------- Modals ------------------------------- */
const WithdrawAny = Withdraw as unknown as React.FC<{
  depositOwner?: string;
  onSuccess?: (sig: string) => void;
}>;
const UserTransferAny = UserTransfer as unknown as React.FC<{
  fromOwnerBase58?: string;
  onSuccess?: (sig: string) => void;
}>;

function DepositModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"bank" | "crypto">("bank");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] vision-perspective"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deposit-modal-title"
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
        <div className="pointer-events-auto w-full max-w-4xl vision-window vision-depth flex max-h-[90vh] flex-col overflow-hidden">
          <h2 id="deposit-modal-title" className="sr-only">
            Deposit funds
          </h2>
          <div className="flex items-center justify-between border-b border-white/10 px-4 sm:px-6 py-4 shrink-0">
            <div className="flex items-center gap-2">
              <Tab
                active={tab === "bank"}
                onClick={() => setTab("bank")}
                label="Bank deposit"
              />
              <Tab
                active={tab === "crypto"}
                onClick={() => setTab("crypto")}
                label="Crypto deposit"
              />
            </div>
            <button
              className="vision-button rounded-xl p-2 hover:bg-white/10 transition-all"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
            {tab === "bank" ? (
              <Buy />
            ) : (
              <div className="min-h-[320px]">
                <Deposit />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function WithdrawModal({
  onClose,
  withdraw,
}: {
  onClose: () => void;
  withdraw?: WithdrawConfig;
}) {
  const [tab, setTab] = useState<"bank" | "crypto">("bank");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const valid = useMemo(() => {
    if (!withdraw?.depositOwner) return true;
    try {
      new PublicKey(withdraw.depositOwner);
      return true;
    } catch {
      return false;
    }
  }, [withdraw]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] vision-perspective"
      role="dialog"
      aria-modal="true"
      aria-labelledby="withdraw-modal-title"
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
        <div className="pointer-events-auto w-full max-w-4xl vision-window vision-depth flex max-h-[90vh] flex-col overflow-hidden">
          <h2 id="withdraw-modal-title" className="sr-only">
            Withdraw funds
          </h2>
          <div className="flex items-center justify-between border-b border-white/10 px-4 sm:px-6 py-4 shrink-0">
            <div className="flex items-center gap-2">
              <Tab
                active={tab === "bank"}
                onClick={() => setTab("bank")}
                label="Bank withdraw"
              />
              <Tab
                active={tab === "crypto"}
                onClick={() => setTab("crypto")}
                label="Crypto withdraw"
              />
            </div>
            <button
              className="vision-button rounded-xl p-2 hover:bg-white/10 transition-all"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
            {tab === "bank" ? (
              <Sell />
            ) : !valid ? (
              <div className="text-xs text-red-400">
                Invalid deposit owner public key.
              </div>
            ) : (
              <div className="min-h-[320px]">
                <WithdrawAny
                  depositOwner={withdraw?.depositOwner ?? ""}
                  onSuccess={withdraw?.onSuccess}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function TransferModal({
  onClose,
  transfer,
}: {
  onClose: () => void;
  transfer?: TransferConfig;
}) {
  const [tab, setTab] = useState<"send" | "unclaimed">("send");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const keyValid = useMemo(() => {
    if (!transfer?.depositOwner) return true;
    try {
      new PublicKey(transfer.depositOwner);
      return true;
    } catch {
      return false;
    }
  }, [transfer]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] vision-perspective"
      role="dialog"
      aria-modal="true"
      aria-labelledby="transfer-modal-title"
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
        <div className="pointer-events-auto w-full max-w-4xl vision-window vision-depth flex max-h-[90vh] flex-col overflow-hidden">
          <h2 id="transfer-modal-title" className="sr-only">
            Transfer
          </h2>
          <div className="flex items-center justify-between border-b border-white/10 px-4 sm:px-6 py-4 shrink-0">
            <div className="flex items-center gap-2">
              <Tab
                active={tab === "send"}
                onClick={() => setTab("send")}
                label="Send"
              />
              <Tab
                active={tab === "unclaimed"}
                onClick={() => setTab("unclaimed")}
                label="Unclaimed (sent)"
              />
            </div>
            <button
              className="vision-button rounded-xl p-2 hover:bg-white/10 transition-all"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
            {tab === "send" ? (
              !keyValid ? (
                <div className="text-xs text-red-400">
                  Invalid deposit owner public key.
                </div>
              ) : (
                <div className="min-h-[320px]">
                  <UserTransferAny
                    fromOwnerBase58={transfer?.depositOwner}
                    onSuccess={(sig) => {
                      transfer?.onSuccess?.(sig);
                      onClose();
                    }}
                  />
                </div>
              )
            ) : (
              <div className="min-h-[320px]">
                <CancelTransfer />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Tab({
  label,
  active,
  onClick,
  badge,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-all duration-200 ${
        active
          ? "vision-button border-[rgb(182,255,62)]/30 bg-[rgb(182,255,62)]/15 text-[rgb(182,255,62)] shadow-lg"
          : "vision-button text-white/70 hover:bg-white/10 hover:text-white"
      }`}
    >
      {label}
      {badge}
    </button>
  );
}

export default DepositAccount;
