// components/actions/UserTransfer.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { toast } from "react-hot-toast";
import { useUser } from "@/providers/UserProvider";
import { useResolveDepositOwnerByEmail } from "@/hooks/useResolveDepositOwnerByEmail";
import { useSponsoredUsdcTransfer } from "@/hooks/useSponsoredUsdcTransfer";
import { useBalances } from "@/providers/BalanceProvider";

/* ------------------------------- NEW: contacts ---------------------------- */
import Contacts from "@/components/shared/Contacts";

/* ------------------------------- constants -------------------------------- */

const EXPLORER_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "devnet";

// UI fee display (must match server TRANSFER_FEE_UI)
const FEE_USDC: number = (() => {
  const raw = process.env.NEXT_PUBLIC_TRANSFER_FEE_UI ?? "0.015";
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0.015;
})();

// Escrow owner (public)
const ESCROW_OWNER =
  process.env.NEXT_PUBLIC_HAVEN_ESCROW_OWNER ||
  process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS ||
  "";

const isEmail = (s: string) => /\S+@\S+\.\S+/.test(s.trim().toLowerCase());
const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

type RecipientState = "idle" | "checking" | "user" | "nonuser" | "error";

/* -------------------------------- component ------------------------------- */

export default function UserTransfer({
  onSuccess,
}: {
  onSuccess?: (sig: string) => void;
}) {
  const router = useRouter();
  const { user } = useUser();
  const { getAccessToken } = usePrivy();
  const balances = useBalances();

  // Sender (self-send guard)
  const fromOwner = user?.depositWallet?.address ?? null;
  const fromPk = useMemo(() => {
    try {
      return fromOwner ? new PublicKey(fromOwner) : null;
    } catch {
      return null;
    }
  }, [fromOwner]);

  /* ----------------------------- currency / FX ---------------------------- */

  const displayCurrency = (user?.displayCurrency || "USD").toUpperCase();
  const targetCurrency = displayCurrency === "USDC" ? "USD" : displayCurrency;

  const [rate, setRate] = useState<number | null>(null); // USD -> target
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

  /* ------------------------------- form state ----------------------------- */

  const [email, setEmail] = useState(""); // keeping email-based resolve; label says "Recipient"
  const [amountLocalStr, setAmountLocalStr] = useState("");

  const amountLocal = Number(amountLocalStr);
  const validLocal = isFinite(amountLocal) && amountLocal > 0;

  /* ----------------------------- recipient check -------------------------- */

  const {
    resolve,
    loading: resolving,
    error: resolveErr,
    setError: setResolveErr,
  } = useResolveDepositOwnerByEmail();

  const [recipientState, setRecipientState] = useState<RecipientState>("idle");
  const [resolvedPk, setResolvedPk] = useState<PublicKey | null>(null);

  useEffect(() => {
    setResolvedPk(null);
    setResolveErr(null);
    setRecipientState("idle");
    if (!isEmail(email)) return;

    let cancelled = false;
    const t = setTimeout(async () => {
      setRecipientState("checking");
      try {
        const pk = await resolve(email.trim().toLowerCase());
        if (!cancelled) {
          setResolvedPk(pk);
          setRecipientState("user");
        }
      } catch (e) {
        const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
        if (!cancelled) {
          if (msg.includes("not found")) {
            setResolvedPk(null);
            setRecipientState("nonuser");
          } else {
            setRecipientState("error");
          }
        }
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [email, resolve, setResolveErr]);

  /* ------------------------- deposit balance (USD) ------------------------ */
  const depositUsd = Number(balances.deposit.amountUsd || 0);
  const depositLocal = useMemo(
    () => (rate ? depositUsd * rate : null),
    [depositUsd, rate]
  );

  // Fee in local currency (charged on top)
  const feeLocal = rate ? FEE_USDC * rate : null;

  // Required USDC in the wallet for this transfer = amountUi + FEE_USDC
  const amountUi = rate ? amountLocal / rate : NaN; // local -> USD/USDC
  const requiredUsdc = validLocal && rate ? amountUi + FEE_USDC : NaN;

  // Do they have enough? (compare to depositUsd)
  const hasEnough = validLocal && rate ? depositUsd >= requiredUsdc : false;

  // Helpful: "use max" (leaves room for the fee)
  const fillMax = useCallback(() => {
    if (!rate) return;
    const maxUi = Math.max(0, depositUsd - FEE_USDC); // USDC
    const maxLocal = maxUi * rate; // back to local currency
    setAmountLocalStr(
      maxLocal > 0 ? String(Math.floor(maxLocal * 100) / 100) : "0"
    );
  }, [depositUsd, rate]);

  /* ---------------------------- derived amounts --------------------------- */

  const youPayLocal =
    rate == null || !validLocal ? null : amountLocal + (feeLocal ?? 0);
  const theyReceiveLocal = rate == null || !validLocal ? null : amountLocal;

  const sendingToSelf =
    recipientState === "user" &&
    !!resolvedPk &&
    !!fromPk &&
    resolvedPk.equals(fromPk);

  const meetsMin = validLocal;

  /* -------------------------------- actions ------------------------------- */

  const {
    send,
    loading: sending,
    lastSig,
    error: sendErr,
  } = useSponsoredUsdcTransfer();
  const [inviteSig, setInviteSig] = useState<string | null>(null);

  const disabled =
    !fromPk ||
    sending ||
    resolving ||
    fxLoading ||
    rate == null ||
    rate <= 0 ||
    !isEmail(email) ||
    !meetsMin ||
    recipientState === "checking" ||
    recipientState === "error" ||
    sendingToSelf ||
    !hasEnough;

  const { getAccessToken: getToken } = usePrivy();

  const explorerHref = (tx: string) =>
    EXPLORER_CLUSTER === "mainnet"
      ? `https://explorer.solana.com/tx/${tx}`
      : `https://explorer.solana.com/tx/${tx}?cluster=${EXPLORER_CLUSTER}`;

  const submit = async () => {
    if (disabled || !rate || !fromPk) return;

    if (!ESCROW_OWNER) {
      toast.error("Escrow wallet is not configured");
      return;
    }

    const toastId = toast.loading("Sending…");

    try {
      const amountUi = round6(amountLocal / rate); // local → USDC UI
      const accessToken = (await getToken().catch(() => null)) ?? null;

      if (recipientState === "user" && resolvedPk) {
        const sig = await send({
          fromOwnerBase58: fromPk.toBase58(),
          toOwnerBase58: resolvedPk.toBase58(),
          amountUi,
          accessToken,
          notify: {
            toOwnerBase58: resolvedPk.toBase58(),
            amountUi,
          },
        });
        if (sig) onSuccess?.(sig);
      } else if (recipientState === "nonuser") {
        const chainSig = await send({
          fromOwnerBase58: fromPk.toBase58(),
          toOwnerBase58: ESCROW_OWNER,
          amountUi,
          accessToken,
        });

        const idempotencyKey =
          (typeof crypto !== "undefined" && crypto.randomUUID?.()) ||
          `email-claim-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const res = await fetch("/api/email-claims/record", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            txSignature: chainSig,
            recipientEmail: email.trim().toLowerCase(),
            amountUi,
            idempotencyKey,
          }),
        });

        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.ok) {
          throw new Error(j?.error || `HTTP ${res.status}`);
        }

        setInviteSig(chainSig);
        onSuccess?.(chainSig);
      } else {
        throw new Error("Unable to determine recipient type.");
      }

      toast.success("Transfer sent", { id: toastId });
      setTimeout(() => {
        router.refresh();
        if (typeof window !== "undefined") window.location.reload();
      }, 250);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Transfer failed";
      toast.error(msg, { id: toastId });
    }
  };

  /* ------------------------------- keypad UX ------------------------------ */

  const pressKey = (k: string) => {
    setAmountLocalStr((prev) => {
      if (k === "DEL") return prev.slice(0, -1);
      if (k === "CLR") return "";
      if (k === ".") {
        if (!prev) return "0.";
        if (prev.includes(".")) return prev;
        return prev + ".";
      }
      // digits
      const next = (prev || "") + k;
      // prevent too many decimals
      const [, dec] = next.split("."); 
      if (dec && dec.length > 2) return prev;
      // prevent leading zeros like "00"
      if (!prev && k === "0") return "0";
      // sanity: max length
      return next.length > 12 ? prev : next;
    });
  };

  /* --------------------------------- render ------------------------------- */

  return (
    <div className="w-full max-w-md mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white/90">Send money</h3>
        <span className="text-xs px-2 py-1 rounded-full bg-white/5 border border-white/10 text-white/70">
          Balance: {fmt(depositLocal)}
        </span>
      </div>

      {/* Card */}
      <div className="rounded-3xl bg-black/60 border border-white/10 overflow-hidden">
        {/* Recipient */}
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/70 text-sm">
              {email?.trim()?.[0]?.toUpperCase() || "@"}
            </div>
            <div className="flex-1">
              <div className="text-sm text-white/80">Recipient</div>
              <div className="text-xs text-white/50">
                {recipientState === "user" && "Haven user"}
                {recipientState === "nonuser" && "Will receive claim link"}
                {recipientState === "checking" && "Looking up…"}
                {recipientState === "idle" && "Enter username/email"}
                {recipientState === "error" && (resolveErr || "Lookup failed")}
              </div>
            </div>

            <Contacts
              buttonLabel="Contacts"
              onPick={(c) => setEmail(c.email)}
              className="text-xs rounded-full border border-white/10 px-3 py-1 text-white/80 hover:bg-white/10"
            />
          </div>

          <div className="mt-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="username or email"
              className={`w-full rounded-xl bg-white/5 border px-3 py-3 text-white placeholder-white/40 outline-none transition ${
                recipientState === "error"
                  ? "border-red-500/50 focus:ring-2 focus:ring-red-500/30"
                  : "border-white/10 focus:ring-2 focus:ring-white/15 hover:border-white/20"
              }`}
            />
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-white/10" />

        {/* Amount Display */}
        <div className="px-6 pt-6 pb-2">
          <div className="text-center">
            <input
              readOnly
              value={amountLocalStr}
              placeholder="0"
              className="w-full text-center bg-transparent outline-none border-0 text-5xl font-semibold tracking-tight text-white placeholder-white/20"
            />
            <div className="mt-2 text-xs text-white/50">
              {feeLocal != null
                ? `You pay ${fmt(youPayLocal)} (incl. ${fmt(feeLocal)} fee)`
                : "Total updates as you type"}
            </div>
          </div>
        </div>

        {/* Balance & Use max row */}
        <div className="px-6 pb-3 flex items-center justify-between text-xs">
          <div className="text-white/60">
            Available:{" "}
            <span className="text-white/80">{fmt(depositLocal)}</span>
          </div>
          <button
            type="button"
            onClick={fillMax}
            className="text-white/80 hover:text-white underline underline-offset-2 disabled:opacity-40"
            disabled={!rate || depositUsd <= FEE_USDC}
          >
            Use max
          </button>
        </div>

        {/* Keypad */}
        <div className="px-4 pb-5">
          <div className="grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "DEL"].map(
              (k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => pressKey(k)}
                  className={`rounded-2xl py-4 text-lg font-semibold border transition ${
                    k === "DEL"
                      ? "border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
                      : "border-white/10 bg-white/5 text-white hover:bg-white/10"
                  }`}
                >
                  {k === "DEL" ? "⌫" : k}
                </button>
              )
            )}
          </div>
          <div className="mt-3">
            <button
              type="button"
              onClick={() => pressKey("CLR")}
              className="w-full rounded-xl py-2 text-xs text-white/60 hover:text-white/80 hover:bg-white/5 border border-white/10"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Summary row */}
        <div className="px-6 pb-4">
          <div className="rounded-xl bg-white/5 border border-white/10 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/60">They receive</span>
              <span className="font-semibold text-white">
                {fmt(theyReceiveLocal)}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-white/60">You pay (incl. fee)</span>
              <span className="font-semibold text-white">
                {fmt(youPayLocal)}
              </span>
            </div>
          </div>

          {/* Insufficient funds */}
          {validLocal && !hasEnough && (
            <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              Not enough balance to cover amount + fee.
            </div>
          )}
        </div>

        {/* CTA */}
        <div className="px-6 pb-6">
          <button
            type="button"
            disabled={disabled}
            onClick={submit}
            className="w-full rounded-2xl bg-[rgb(182,255,62)] hover:bg-[rgb(182,255,62)]/90 text-black font-bold py-4 text-base disabled:opacity-50 disabled:cursor-not-allowed transition shadow-[0_8px_30px_rgba(182,255,62,0.35)]"
          >
            {sending ? "Sending…" : "Send Money"}
          </button>
        </div>
      </div>

      {/* Status blocks */}
      {(lastSig || inviteSig) && (
        <div className="rounded-2xl border border-green-500/30 bg-green-500/10 p-4">
          <div className="flex items-start gap-4">
            <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse flex-shrink-0 mt-1" />
            <div className="flex-1 space-y-2">
              <div className="text-base font-semibold text-green-400">
                {recipientState === "nonuser"
                  ? "Invite sent"
                  : "Transfer submitted"}
              </div>
              <div className="text-sm text-white/60 break-all font-mono">
                Transaction: {lastSig || inviteSig}
              </div>
              <a
                href={explorerHref(lastSig || inviteSig || "")}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm text-[rgb(182,255,62)] hover:text-[rgb(182,255,62)]/80 transition-colors"
              >
                <span>View on Blockchain Explorer</span>
                <svg
                  className="w-4 h-4"
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

      {(sendErr || (recipientState === "error" && resolveErr)) && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
          <div className="flex items-start gap-4">
            <div className="w-3 h-3 rounded-full bg-red-400 flex-shrink-0 mt-1" />
            <div className="text-sm text-red-400 leading-relaxed">
              {sendErr || resolveErr}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}