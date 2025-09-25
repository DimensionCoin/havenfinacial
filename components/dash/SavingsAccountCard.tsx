"use client";

import type React from "react";
import { useCallback, useEffect,  useState } from "react";
import { createPortal } from "react-dom";
import { X, Download, Upload } from "lucide-react";
import { toast } from "react-hot-toast";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useUser } from "@/providers/UserProvider";

/* --------------------------- Types for /api/fx --------------------------- */
type FxResponse = {
  base: "USD";
  target: string;
  rate: number;
  amount: number;
  converted: number;
  asOf?: string | null;
};

/* --------------------------- Local helpers/UI ---------------------------- */
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

/* ------------------------------ Component -------------------------------- */
const SavingsAccount: React.FC = () => {
  const { user, loading: userLoading, refresh: refreshUser } = useUser();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const { wallets } = useWallets();

  const walletAddress = user?.depositWallet?.address ?? null;
  const displayCurrency = (user?.displayCurrency || "USD").toUpperCase();

  const hasMarginfiAccount =
    !!user?.marginfi?.accountPk && !!user?.marginfi?.usdcBankPk;

  // local state
  const [savingsUsdc, setSavingsUsdc] = useState<number>(0);
  const [balLoading, setBalLoading] = useState<boolean>(false);
  const [fxLoading, setFxLoading] = useState<boolean>(false);
  const [fxRate, setFxRate] = useState<number>(1);
  const [err, setErr] = useState<string | null>(null);

  // modal state: for existing accounts (deposit/withdraw)
  type Modal = null | { kind: "deposit" | "withdraw" };
  const [modal, setModal] = useState<Modal>(null);
  const modalOpen = modal !== null;

  // modal state: for opening a new account
  const [openModal, setOpenModal] = useState(false);

  const loading = userLoading || balLoading || fxLoading;

  const refreshBalance = useCallback(async () => {
    if (!walletAddress || !hasMarginfiAccount) {
      setSavingsUsdc(0);
      return;
    }
    setBalLoading(true);
    try {
      const r = await fetch(
        `/api/savings/balance?owner58=${encodeURIComponent(walletAddress)}`,
        { cache: "no-store" }
      );
      if (!r.ok) throw new Error(await r.text());
      const j = (await r.json()) as { amountUi?: number };
      setSavingsUsdc(Number(j?.amountUi || 0));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBalLoading(false);
    }
  }, [walletAddress, hasMarginfiAccount]);

  useEffect(() => {
    if (!hasMarginfiAccount) return;
    void refreshBalance();
  }, [refreshBalance, hasMarginfiAccount]);

  /** Convert to user's display currency via /api/fx (USDC ~= USD) */
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
      if (!resp.ok) throw new Error(await resp.text());
      const data = (await resp.json()) as FxResponse;
      if (
        !data ||
        data.base !== "USD" ||
        !Number.isFinite(data.rate) ||
        data.rate <= 0
      ) {
        throw new Error("Bad FX payload");
      }
      return data;
    },
    [authenticated, getAccessToken]
  );

  useEffect(() => {
    if (!hasMarginfiAccount) return;
    if (!ready || !authenticated) return;
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
  }, [
    ready,
    authenticated,
    hasMarginfiAccount,
    savingsUsdc,
    displayCurrency,
    convertFx,
  ]);

  // Display value computed on the fly when needed; no memo required

  // Sign with Privy embedded Solana wallet (client-only)
  const signWithEmbedded = useCallback(
    async (txBase64: string): Promise<string> => {
      const sol = wallets.find((w) => {
        const r = (w as unknown) as Record<string, unknown>;
        return r.chainType === "solana" && r.walletClientType === "privy";
      }) as unknown as
        | { signTransaction?: (txBase64: string) => Promise<string> }
        | undefined;
      if (!sol?.signTransaction)
        throw new Error("No embedded Solana wallet available for signing");
      return await sol.signTransaction(txBase64);
    },
    [wallets]
  );

  /* ----------------------- Open + deposit in one go ---------------------- */
  const submitOpenAndDeposit = useCallback(
    async (amountUi: number) => {
      if (!walletAddress) return;
      try {
        // 1) backend builds initialize_account (+deposit) tx
        const prep = await fetch("/api/savings/open-and-deposit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            owner58: walletAddress,
            amountUi,
            decimals: 6,
          }),
          cache: "no-store",
        });
        if (!prep.ok) {
          const t = await prep.text();
          throw new Error(
            `Prepare open+deposit failed: ${prep.status} ${t || "(no body)"}`
          );
        }
        const { transaction } = (await prep.json()) as { transaction: string };

        // 2) sign in browser
        const userSigned = await signWithEmbedded(transaction);

        // 3) server pays gas & broadcasts (no fee charged)
        const send = await fetch("/api/savings/send", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ transaction: userSigned }),
          cache: "no-store",
        });
        const j = (await send.json()) as { signature?: string; error?: string };
        if (!send.ok || !j.signature)
          throw new Error(j?.error || "Send failed");

        toast.success("Savings account opened and funded", { icon: "✅" });
        setOpenModal(false);
        await Promise.all([refreshUser(), refreshBalance()]);
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Failed to open & fund account"
        );
      }
    },
    [walletAddress, signWithEmbedded, refreshUser, refreshBalance]
  );

  /* ----------------------- Deposit / Withdraw existing ------------------- */
  const onSubmitSavings = useCallback(
    async (kind: "deposit" | "withdraw", amountUi: number) => {
      if (!walletAddress) return;
      try {
        const url =
          kind === "deposit"
            ? "/api/savings/prepare-deposit"
            : "/api/savings/prepare-withdraw";
        const prep = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            owner58: walletAddress,
            amountUi,
            decimals: 6,
          }),
          cache: "no-store",
        });
        if (!prep.ok) {
          const t = await prep.text();
          throw new Error(
            `Prepare ${kind} failed: ${prep.status} ${t || "(no body)"}`
          );
        }
        const { transaction } = (await prep.json()) as { transaction: string };

        const userSigned = await signWithEmbedded(transaction);

        const send = await fetch("/api/savings/send", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ transaction: userSigned }),
          cache: "no-store",
        });
        const j = (await send.json()) as { signature?: string; error?: string };
        if (!send.ok || !j.signature)
          throw new Error(j?.error || "Send failed");

        toast.success(
          `${kind === "deposit" ? "Deposit" : "Withdrawal"} submitted`,
          { icon: "✅" }
        );
        setModal(null);
        await Promise.all([refreshUser(), refreshBalance()]);
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : `Failed to ${kind} savings`
        );
      }
    },
    [walletAddress, signWithEmbedded, refreshUser, refreshBalance]
  );

  const openDepositModal = useCallback(() => {
    if (hasMarginfiAccount) setModal({ kind: "deposit" });
  }, [hasMarginfiAccount]);
  const openWithdrawModal = useCallback(() => {
    if (hasMarginfiAccount) setModal({ kind: "withdraw" });
  }, [hasMarginfiAccount]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setModal(null);
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

  /* ─────────── NO ACCOUNT: only CTA card + modal to open & deposit ─────────── */
  if (!hasMarginfiAccount) {
    return (
      <div className="space-y-6 vision-perspective">
        {err && (
          <div className="vision-glass rounded-lg px-4 py-3 text-sm text-red-300 border-red-500/30">
            {err}
          </div>
        )}
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/20 via-transparent to-[rgb(182,255,62)]/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-700" />
          <div className="relative vision-window p-4 sm:p-6 lg:p-8 rounded-3xl border border-white/20 bg-black/40 backdrop-blur-[40px] backdrop-saturate-[200%] shadow-[0_32px_64px_rgba(0,0,0,0.4),0_16px_32px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(0,0,0,0.2)]">
            <div className="mb-2">
              <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-white tracking-tight">
                Savings Account
              </h3>
              <p className="text-xs sm:text-sm text-white/60 mt-1">
                Set up your USDC savings
              </p>
            </div>
            <div className="pt-4 sm:pt-6 border-t border-white/10 flex items-center justify-between gap-3">
              <div className="text-white/70 text-sm">
                You don’t have a savings account yet.
              </div>
              <button
                type="button"
                onClick={() => setOpenModal(true)}
                className="group relative overflow-hidden vision-button inline-flex items-center justify-center gap-2 px-4 py-2 rounded-2xl bg-[rgb(182,255,62)] text-black font-semibold hover:bg-[rgb(182,255,62)]/90 transition-all duration-300 shadow-[0_8px_32px_rgba(182,255,62,0.3)]"
              >
                <span>Open an account</span>
              </button>
            </div>
          </div>
        </div>

        {openModal && (
          <OpenAccountModal
            onClose={() => setOpenModal(false)}
            onSubmit={submitOpenAndDeposit}
          />
        )}
      </div>
    );
  }

  /* ─────────── HAS ACCOUNT: show balance + Deposit / Withdraw ─────────── */
  return (
    <div className="space-y-6 vision-perspective">
      {err && (
        <div className="vision-glass rounded-lg px-4 py-3 text-sm text-red-300 border-red-500/30">
          {err}
        </div>
      )}

      <div className="relative group">
        <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/20 via-transparent to-[rgb(182,255,62)]/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-700" />
        <div className="relative vision-window p-4 sm:p-6 lg:p-8 rounded-3xl border border-white/20 bg-black/40 backdrop-blur-[40px] backdrop-saturate-[200%] shadow-[0_32px_64px_rgba(0,0,0,0.4),0_16px_32px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(0,0,0,0.2)]">
          <div className="mb-6 sm:mb-8">
            <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-white tracking-tight">
              Savings Account
            </h3>
            <p className="text-xs sm:text-sm text-white/60 mt-1">
              USDC savings balance
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-3 sm:mb-6">
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 sm:gap-3">
                {loading ? (
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-24 sm:h-12 sm:w-32 bg-white/10 rounded-xl animate-pulse" />
                    <div className="h-4 w-8 sm:h-6 sm:w-12 bg-white/5 rounded-lg animate-pulse" />
                  </div>
                ) : (
                  <>
                    <span className="text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-black bg-gradient-to-br from-white via-white to-white/80 bg-clip-text text-transparent tracking-tight leading-none">
                      {formatFiatNarrow(savingsUsdc * fxRate, displayCurrency)}
                    </span>
                    <span className="text-sm sm:text-base lg:text-lg text-white/50 font-medium sm:pb-1 lg:pb-2">
                      {displayCurrency.toLowerCase()}
                    </span>
                  </>
                )}
              </div>
              <div className="text-xs text-white/60 mt-2">
                {savingsUsdc.toLocaleString(undefined, {
                  maximumFractionDigits: savingsUsdc < 1 ? 6 : 2,
                })}{" "}
                USDC
              </div>
            </div>
          </div>

          <div className="pt-4 sm:pt-6 border-t border-white/10">
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <ActionButton
                label="Deposit"
                icon={<Download size={16} aria-hidden />}
                onClick={openDepositModal}
              />
              <ActionButton
                label="Withdraw"
                icon={<Upload size={16} aria-hidden />}
                onClick={openWithdrawModal}
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
        />
      )}
    </div>
  );
};

export default SavingsAccount;

/* ------------------------------- Sub-UI ---------------------------------- */
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
}: {
  kind: "deposit" | "withdraw";
  onClose: () => void;
  onSubmit: (kind: "deposit" | "withdraw", amountUi: number) => Promise<void>;
}) {
  const [mounted, setMounted] = useState(false);
  const [amount, setAmount] = useState<string>("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const submit = async () => {
    const v = Number(amount);
    if (!Number.isFinite(v) || v <= 0)
      return toast.error("Enter a valid amount");
    setBusy(true);
    try {
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
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(40%_30%_at_10%_85%,rgba(182,255,62,0.15),transparent),radial-gradient(35%_25%_at_90%_10%,rgba(182,255,62,0.12),transparent)]" />
      </div>
      <div className="relative mx-auto flex min-h-screen items-center justify-center p-4 sm:p-6 overflow-y-auto overscroll-contain">
        <div className="pointer-events-auto w-full max-w-md vision-window vision-depth flex max-h-[90vh] flex-col overflow-hidden">
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
              Amount (USDC)
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
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-white/20 text-white/80 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                disabled={busy}
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
}: {
  onClose: () => void;
  onSubmit: (amountUi: number) => Promise<void>;
}) {
  const [mounted, setMounted] = useState(false);
  const [amount, setAmount] = useState<string>("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const submit = async () => {
    const v = Number(amount);
    if (!Number.isFinite(v) || v <= 0)
      return toast.error("Enter a valid amount");
    setBusy(true);
    try {
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
              Enter an initial USDC amount to fund your new savings account.
            </p>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Initial deposit (USDC)
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
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-white/20 text-white/80 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                disabled={busy}
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
