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
          // 👇 NEW: ask backend to notify the recipient user
          notify: {
            toOwnerBase58: resolvedPk.toBase58(),
            amountUi, // lets server template a nice message
            // message: note ? `“${note}”` : undefined, // optional override; omit to use server fallback
          },
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

  /* --------------------------------- render ------------------------------- */

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6 vision-perspective">
      {/* Header */}
      <div className="text-center space-y-2">
        <h3 className="text-2xl sm:text-3xl font-bold bg-gradient-to-br from-white via-white to-white/80 bg-clip-text text-transparent tracking-tight">
          Send Money
        </h3>
        <p className="text-sm text-white/60">
          Send funds instantly to other Haven users or via email
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

            {/* Recipient email */}
            <div className="space-y-3">
              <label className="block text-sm font-semibold text-white/90">
                Recipient Email
              </label>

              {/* NEW: Contacts trigger — opens modal and autofills email on pick */}
              <div className="flex justify-end">
                <Contacts
                  buttonLabel="Pick from Contacts"
                  onPick={(c) => setEmail(c.email)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/20 px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/10"
                />
              </div>

              <div className="relative">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@email.com"
                  className={`w-full rounded-2xl border px-4 py-4 sm:px-6 sm:py-4 bg-white/5 backdrop-blur-sm text-white placeholder-white/40 focus:outline-none transition-all duration-300 text-base ${
                    recipientState === "error"
                      ? "border-red-500/60 focus:ring-2 focus:ring-red-500/40 focus:border-red-500"
                      : "border-white/20 focus:ring-2 focus:ring-[rgb(182,255,62)]/50 focus:border-[rgb(182,255,62)] hover:border-white/30"
                  }`}
                />
                {(resolving || recipientState === "checking") && (
                  <div className="absolute right-4 top-1/2 -translate-y-1/2">
                    <div className="w-5 h-5 border-2 border-[rgb(182,255,62)]/30 border-t-[rgb(182,255,62)] rounded-full animate-spin" />
                  </div>
                )}
              </div>

              {/* Status indicator */}
              <div className="min-h-[1.5rem] flex items-center gap-2">
                {recipientState === "user" && (
                  <div className="flex items-center gap-2 text-sm text-[rgb(182,255,62)]">
                    <div className="w-2 h-2 rounded-full bg-[rgb(182,255,62)] animate-pulse" />
                    <span>Haven user found — funds arrive instantly</span>
                  </div>
                )}
                {recipientState === "nonuser" && (
                  <div className="flex items-center gap-2 text-sm text-blue-400">
                    <div className="w-2 h-2 rounded-full bg-blue-400" />
                    <span>
                      Not on Haven — we&#39;ll email them a secure claim link
                    </span>
                  </div>
                )}
                {recipientState === "error" && (
                  <div className="flex items-center gap-2 text-sm text-red-400">
                    <div className="w-2 h-2 rounded-full bg-red-400" />
                    <span>{resolveErr || "Lookup failed. Try again."}</span>
                  </div>
                )}
                {(resolving || recipientState === "checking") && (
                  <div className="flex items-center gap-2 text-sm text-white/60">
                    <div className="w-2 h-2 rounded-full bg-white/60 animate-pulse" />
                    <span>Looking up recipient…</span>
                  </div>
                )}
              </div>
            </div>

            {/* Optional note */}
            <div className="space-y-3">
              <label className="block text-sm font-semibold text-white/90">
                Note{" "}
                <span className="text-white/50 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Dinner payback 🍝"
                maxLength={120}
                className="w-full rounded-2xl border border-white/20 bg-white/5 backdrop-blur-sm px-4 py-4 sm:px-6 sm:py-4 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/50 focus:border-[rgb(182,255,62)] hover:border-white/30 transition-all duration-300 text-base"
              />
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
                className="w-full rounded-2xl border border-white/20 bg-white/5 backdrop-blur-sm px-4 py-4 sm:px-6 sm:py-4 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/50 focus:border-[rgb(182,255,62)] hover:border-white/30 transition-all duration-300 text-base  sm:text-3xl font-bold"
                placeholder="0.00"
                inputMode="decimal"
              />

              {/* Fee breakdown */}
              <div className="vision-window rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-4 sm:p-6 space-y-3">
                {sendingToSelf && (
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/30">
                    <div className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
                    <span className="text-sm text-red-400">
                      You can&#39;t send to your own account.
                    </span>
                  </div>
                )}

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
                {sending && (
                  <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                )}
                <span>
                  {sending
                    ? "Sending…"
                    : `Send ${fmt(youPayLocal)} • They get ${fmt(
                        theyReceiveLocal
                      )}`}
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Status blocks */}
      {(lastSig || inviteSig) && (
        <div className="vision-window rounded-2xl border border-green-500/30 bg-green-500/10 backdrop-blur-sm p-4 sm:p-6">
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

      {(sendErr || (recipientState === "error" && resolveErr)) && (
        <div className="vision-window rounded-2xl border border-red-500/30 bg-red-500/10 backdrop-blur-sm p-4 sm:p-6">
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
