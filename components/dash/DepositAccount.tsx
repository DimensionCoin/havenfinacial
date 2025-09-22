"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useUser } from "@/providers/UserProvider";
import { toast } from "react-hot-toast";
import { Download, Upload, ArrowRightLeft, X } from "lucide-react";
import Buy from "@/components/actions/Buy";
import Deposit from "@/components/actions/Deposit";
import UserTransfer from "@/components/actions/UserTransfer";
import Sell from "@/components/actions/Sell";
import Withdraw from "@/components/actions/Withdraw";
import CancelTransfer from "@/components/actions/CancelTransfer";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

/* ----------------------------- ENV (public) ------------------------------ */
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC!;
const USDC_MINT = (() => {
  const m = process.env.NEXT_PUBLIC_USDC_MINT;
  return m ? new PublicKey(m) : null;
})();

/* --------------------------- Types from /api/fx --------------------------- */
type FxResponse = {
  base: "USD";
  target: string;
  rate: number; // USD -> target
  amount: number; // USDC amount converted
  converted: number; // amount * rate
  asOf?: string | null;
};

/* --------------------------------- Utils --------------------------------- */
/** "$2.00" using narrow symbol, independent of locale currency placement */
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
    return `${sym}${number}`; // e.g. "$2.00"
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

function mask(addr?: string | null) {
  if (!addr || addr.length < 4) return "****-****-0000";
  return `****-****-${addr.slice(-4)}`;
}

/* ---------------------------- SPL helpers -------------------------------- */
const programIdCache = new Map<string, PublicKey>();

async function detectTokenProgramForMint(
  conn: Connection,
  mint: PublicKey
): Promise<PublicKey> {
  const key = mint.toBase58();
  const cached = programIdCache.get(key);
  if (cached) return cached;

  const info = await conn.getAccountInfo(mint, "confirmed");
  const owner = info?.owner?.toBase58();
  const pid =
    owner === TOKEN_2022_PROGRAM_ID.toBase58()
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

  programIdCache.set(key, pid);
  return pid;
}

async function getAtaUiBalanceWithProgram(
  conn: Connection,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgramId: PublicKey
): Promise<number> {
  try {
    const ata = getAssociatedTokenAddressSync(
      mint,
      owner,
      false,
      tokenProgramId
    );
    const bal = await conn.getTokenAccountBalance(ata, "confirmed");
    return Number(bal?.value?.uiAmount ?? 0);
  } catch {
    return 0;
  }
}

async function fetchUsdcBalanceForOwner(
  conn: Connection,
  mint: PublicKey,
  owner58?: string | null,
  cachedAta?: string | null
): Promise<number> {
  if (!owner58) return 0;
  const owner = new PublicKey(owner58);

  // Try cached ATA (if you stored it in user.tokenAccounts.usdc2022.depositAta)
  const viaCached = (async () => {
    if (!cachedAta) return 0;
    try {
      const bal = await conn.getTokenAccountBalance(
        new PublicKey(cachedAta),
        "confirmed"
      );
      return Number(bal?.value?.uiAmount ?? 0);
    } catch {
      return 0;
    }
  })();

  const detectedProgram = await detectTokenProgramForMint(conn, mint);
  const viaDetected = getAtaUiBalanceWithProgram(
    conn,
    mint,
    owner,
    detectedProgram
  );

  const otherProgram = detectedProgram.equals(TOKEN_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
  const viaOther = getAtaUiBalanceWithProgram(conn, mint, owner, otherProgram);

  const [a, b, c] = await Promise.all([viaCached, viaDetected, viaOther]);
  return Math.max(a, b, c);
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

  const walletAddress = user?.depositWallet?.address ?? null;
  const displayCurrency = (user?.displayCurrency || "USD").toUpperCase();

  // local balance state (no reliance on UserProvider balances)
  const [depositUsdc, setDepositUsdc] = useState<number>(0);
  const [balLoading, setBalLoading] = useState<boolean>(false);

  const [fxLoading, setFxLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fxRate, setFxRate] = useState(1);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const modalOpen = activeModal !== null;

  const loading = userLoading || balLoading || fxLoading;

  // Build Solana connection once
  const [conn] = useState(() => new Connection(RPC, "confirmed"));

  // read balance when wallet or envs ready
  const refreshBalances = useCallback(async () => {
    if (!USDC_MINT) return;
    setBalLoading(true);
    try {
      const cachedAta = user?.tokenAccounts?.usdc2022?.depositAta ?? null;
      const amt = await fetchUsdcBalanceForOwner(
        conn,
        USDC_MINT,
        walletAddress,
        cachedAta
      );
      setDepositUsdc(amt);
    } catch (e) {
      console.error("balance fetch error", e);
    } finally {
      setBalLoading(false);
    }
  }, [conn, walletAddress, user?.tokenAccounts?.usdc2022?.depositAta]);

  useEffect(() => {
    if (!walletAddress || !USDC_MINT) return;
    void refreshBalances();
  }, [walletAddress, refreshBalances]);

  /** Call /api/fx (USDC ≈ USD) to convert to local currency */
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

  // compute FX when balance/currency changes
  useEffect(() => {
    if (!ready || !authenticated) return;
    let cancelled = false;

    const run = async () => {
      setErr(null);
      if (displayCurrency === "USD") {
        setFxRate(1);
        return;
      }
      setFxLoading(true);
      try {
        const fx = await convertFx(depositUsdc, displayCurrency);
        if (!cancelled) setFxRate(fx.rate);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setFxLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, depositUsdc, displayCurrency, convertFx]);

  const fiatValue = useMemo(() => depositUsdc * fxRate, [depositUsdc, fxRate]);

  const copyAccountNumber = useCallback(async () => {
    if (!walletAddress) return;
    try {
      await navigator.clipboard.writeText(walletAddress);
      toast.success("Wallet address copied");
    } catch {
      toast.error("Couldn’t copy wallet address");
    }
  }, [walletAddress]);

  const manualRefresh = useCallback(async () => {
    setErr(null);
    await refreshBalances();
  }, [refreshBalances]);

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

  // Quick guard for misconfig
  if (!USDC_MINT) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
        Missing <code className="font-mono">NEXT_PUBLIC_USDC_MINT</code> env.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {err && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {err}
        </div>
      )}

      {/* Deposit card */}
      <div className="rounded-2xl border border-white/10 bg-black/20 backdrop-blur-xl p-6 text-white shadow-2xl hover:border-[rgb(182,255,62)]/30 transition-all duration-300">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-3 h-3 rounded-full bg-[rgb(182,255,62)]" />
            <h3 className="text-lg font-semibold text-white">Deposits</h3>
          </div>
          <button
            onClick={() => void manualRefresh()}
            disabled={loading || !walletAddress}
            className="border border-[rgb(182,255,62)]/20 bg-[rgb(182,255,62)]/10 px-3 py-1.5 text-xs text-[rgb(182,255,62)] hover:bg-[rgb(182,255,62)]/20 disabled:opacity-60 transition-all duration-200 font-medium rounded-full mb-4"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="flex items-center justify-between mb-1">
          <div>
            {/* Balance: "$2.00" + tiny "cad" to the right */}
            <div className="text-3xl font-bold text-white mb-1 flex items-baseline gap-1">
              {loading ? (
                <span>...</span>
              ) : (
                <>
                  <span>{formatFiatNarrow(fiatValue, displayCurrency)}</span>
                  <span className="text-[10px] leading-5 text-zinc-400">
                    {displayCurrency.toLowerCase()}
                  </span>
                </>
              )}
            </div>
          </div>

          <button
            onClick={copyAccountNumber}
            className="text-sm text-zinc-400 hover:text-[rgb(182,255,62)] transition-colors font-mono group cursor-pointer text-right"
            disabled={!walletAddress}
            title={walletAddress || undefined}
          >
            <span className="group-hover:text-[rgb(182,255,62)]">
              {mask(walletAddress)}
            </span>
            <div className="text-xs opacity-0 group-hover:opacity-100 transition-opacity mt-1">
              (Click to copy)
            </div>
          </button>
        </div>

        {/* Quick actions */}
        <div className="mt-6 pt-4 border-t border-white/10">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <ActionButton
              label="Deposit"
              icon={<Download size={12} aria-hidden />}
              onClick={openDepositModal}
              disabled={disabled}
            />
            <ActionButton
              label="Withdraw"
              icon={<Upload size={12} aria-hidden />}
              onClick={openWithdrawModal}
              disabled={disabled}
            />
            <ActionButton
              label="Transfer"
              icon={<ArrowRightLeft size={12} aria-hidden />}
              onClick={openTransferModal}
              disabled={disabled}
            />
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
      className="group flex flex-1 items-center justify-center gap-2 border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85 transition-all hover:border-[rgb(182,255,62)]/30 hover:bg-[rgb(182,255,62)]/10 disabled:opacity-50 rounded-full hover:shadow-xs shadow-[rgb(182,255,62)]"
    >
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-black/30">
        {icon}
      </span>
      <span className="text-xs md:text-md lg:text-md">{label}</span>
    </button>
  );
}

/* ------------------------------- Modals ------------------------------- */
// Cast action components to accept props (their TS types may be empty)
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
      className="fixed inset-0 z-[9999]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deposit-modal-title"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-xl backdrop-saturate-150"
        onClick={onClose}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(40%_30%_at_10%_85%,rgba(182,255,62,0.10),transparent),radial-gradient(35%_25%_at_90%_10%,rgba(182,255,62,0.08),transparent)]" />
      </div>
      <div className="relative mx-auto flex min-h-screen items-center justify-center p-4 overflow-y-auto overscroll-contain">
        <div className="pointer-events-auto w-full max-w-3xl rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl flex max-h-[90vh] flex-col overflow-hidden">
          <h2 id="deposit-modal-title" className="sr-only">
            Deposit funds
          </h2>
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 shrink-0">
            <div className="flex items-center gap-1">
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
              className="rounded-lg border border-white/10 bg:white/5 bg-white/5 p-1.5 hover:bg-white/10 transition"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 md:p-6">
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
      className="fixed inset-0 z-[9999]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="withdraw-modal-title"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-xl backdrop-saturate-150"
        onClick={onClose}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(40%_30%_at_10%_85%,rgba(182,255,62,0.10),transparent),radial-gradient(35%_25%_at_90%_10%,rgba(182,255,62,0.08),transparent)]" />
      </div>
      <div className="relative mx-auto flex min-h-screen items-center justify-center p-4 overflow-y-auto overscroll-contain">
        <div className="pointer-events-auto w-full max-w-3xl rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl flex max-h-[90vh] flex-col overflow-hidden">
          <h2 id="withdraw-modal-title" className="sr-only">
            Withdraw funds
          </h2>
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 shrink-0">
            <div className="flex items-center gap-1">
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
              className="rounded-lg border border-white/10 bg-white/5 p-1.5 hover:bg-white/10 transition"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 md:p-6">
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
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  type TransferTab = "send" | "unclaimed";
  const [tab, setTab] = useState<TransferTab>("send");

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
      className="fixed inset-0 z-[9999]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="transfer-modal-title"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-xl backdrop-saturate-150"
        onClick={onClose}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(40%_30%_at_10%_85%,rgba(182,255,62,0.10),transparent),radial-gradient(35%_25%_at_90%_10%,rgba(182,255,62,0.08),transparent)]" />
      </div>
      <div className="relative mx-auto flex min-h-screen items-center justify-center p-4 overflow-y-auto overscroll-contain">
        <div className="pointer-events-auto w-full max-w-3xl rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl flex max-h-[90vh] flex-col overflow-hidden">
          <h2 id="transfer-modal-title" className="sr-only">
            Transfer
          </h2>
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 shrink-0">
            <div className="flex items-center gap-1">
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
              className="rounded-lg border border-white/10 bg-white/5 p-1.5 hover:bg-white/10 transition"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 md:p-6">
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
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition border ${
        active
          ? "border-[rgb(182,255,62)]/30 bg-[rgb(182,255,62)]/15 text-[rgb(182,255,62)]"
          : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
      }`}
    >
      {label}
      {badge}
    </button>
  );
}

export default DepositAccount;
