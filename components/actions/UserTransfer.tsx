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

  /* ------------------------------- form state ----------------------------- */

  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
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

  /* ---------------------------- derived amounts --------------------------- */

  const feeLocal = rate ? FEE_USDC * rate : null; // fee charged ON TOP
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
    sendingToSelf;

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
      const accessToken = (await getAccessToken().catch(() => null)) ?? null;

      if (recipientState === "user" && resolvedPk) {
        // ✅ Haven user → on-chain transfer (fee charged on top by backend)
        const sig = await send({
          fromOwnerBase58: fromPk.toBase58(),
          toOwnerBase58: resolvedPk.toBase58(),
          amountUi,
          accessToken,
          // backendUrl: "/api/transfer" (default)
        });
        if (sig) onSuccess?.(sig);
      } else if (recipientState === "nonuser") {
        // ✅ Non-Haven user → send to ESCROW, then record+email
        // 1) On-chain: user signs transfer to ESCROW + fee to TREASURY
        const chainSig = await send({
          fromOwnerBase58: fromPk.toBase58(),
          toOwnerBase58: ESCROW_OWNER, // escrow receives the full amount
          amountUi, // recipient should receive this much
          accessToken,
          // backendUrl: "/api/transfer" (default)
        });

        // 2) Tell the server to verify deltas & email the claim link
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
            note: note || undefined,
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

  /* ------------------------------ UI helpers ------------------------------ */

  const helper = (() => {
    if (resolving || recipientState === "checking")
      return "Looking up recipient…";
    if (recipientState === "user")
      return "Haven user found — funds arrive instantly.";
    if (recipientState === "nonuser")
      return "Not on Haven — we’ll email them a secure claim link after you pay.";
    if (recipientState === "error")
      return resolveErr || "Lookup failed. Try again.";
    return "";
  })();

  /* --------------------------------- render ------------------------------- */

  return (
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900/80 backdrop-blur-xl p-6 space-y-6 shadow-2xl">
      <h3 className="text-xl font-semibold text-white">Send money</h3>

      {!fromPk && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-200">
          Your deposit wallet isn’t ready yet. Please finish onboarding.
        </div>
      )}

      {/* Recipient email */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-300">
          Recipient email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@email.com"
          className={`w-full rounded-xl border px-4 py-3 bg-zinc-800/50 text-white placeholder-zinc-500 focus:outline-none transition-all ${
            recipientState === "error"
              ? "border-red-500/60 focus:ring-2 focus:ring-red-500/40"
              : "border-zinc-700 focus:ring-2 focus:ring-[rgb(182,255,62)]/50 focus:border-[rgb(182,255,62)]"
          }`}
        />
        <div className="text-xs text-zinc-400 h-4">{helper}</div>
      </div>

      {/* Optional note */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-300">
          Note (optional)
        </label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Dinner payback 🍝"
          maxLength={120}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/50 focus:border-[rgb(182,255,62)] transition-all"
        />
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
          {sendingToSelf && (
            <div className="text-xs text-red-400">
              You can’t send to your own account.
            </div>
          )}

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
        {sending
          ? "Sending…"
          : `Send ${fmt(youPayLocal)} • They get ${fmt(theyReceiveLocal)}`}
      </button>

      {/* Status blocks */}
      {(lastSig || inviteSig) && (
        <div className="bg-green-900/20 border border-green-700/30 rounded-lg p-3 mt-2">
          <div className="text-sm text-green-400 font-medium mb-1">
            {recipientState === "nonuser"
              ? "Invite sent"
              : "Transfer submitted"}
          </div>
          <div className="text-xs text-zinc-400 break-all">
            Transaction: {lastSig || inviteSig}
          </div>
          <a
            href={explorerHref(lastSig || inviteSig || "")}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-[rgb(182,255,62)] hover:underline mt-1 inline-block"
          >
            View on Blockchain Explorer →
          </a>
        </div>
      )}

      {(sendErr || (recipientState === "error" && resolveErr)) && (
        <div className="bg-red-900/20 border border-red-700/30 rounded-lg p-3 mt-2">
          <div className="text-sm text-red-400">{sendErr || resolveErr}</div>
        </div>
      )}
    </div>
  );
}
