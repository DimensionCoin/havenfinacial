// app/claim/[token]/ClaimClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { toast } from "react-hot-toast";
import FullScreenLoader from "@/components/shared/FullScreenLoader";

type PendingClaim = {
  id: string;
  createdAt: string;
  amountUi: number; // shown only after auth
  note: string | null;
  senderEmail: string;
  escrowSignature: string | null;
  currency: string; // "USDC"
};

type ClaimApiOk = {
  ok: true;
  claimedCount: number;
  signatures: string[];
  redirect?: string;
  traceId?: string;
};

type ClaimApiErr = {
  ok?: false;
  code?: string; // e.g. EMAIL_MISMATCH, TOKEN_EXPIRED, UNAUTHORIZED…
  error?: string; // user-readable summary
  hint?: string; // optional action
  traceId?: string; // for support correlation
  partial?: { claimedCount: number; signatures: string[] };
};

type ClaimApi = ClaimApiOk | ClaimApiErr;

function isClaimOk(value: unknown): value is ClaimApiOk {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.ok !== true) return false;
  return Array.isArray(record.signatures) && record.signatures.every((s) => typeof s === "string");
}

export default function ClaimClient({ token }: { token: string }) {
  const { ready, authenticated, login, getAccessToken } = usePrivy();

  const [loadingList, setLoadingList] = useState(true);
  const [listErr, setListErr] = useState<string | null>(null);
  const [claims, setClaims] = useState<PendingClaim[]>([]);
  const [total, setTotal] = useState<number>(0);

  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingList(true);
      setListErr(null);
      try {
        const r = await fetch(
          `/api/email-claims/pending?token=${encodeURIComponent(token)}`,
          { credentials: "include", cache: "no-store" }
        );
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok) {
          const m = j?.error || `Failed to load transfers (HTTP ${r.status})`;
          throw new Error(m);
        }
        if (!cancelled) {
          setClaims(Array.isArray(j.claims) ? j.claims : []);
          setTotal(Number(j.totalAmountUi || 0));
        }
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Failed to load transfers";
        if (!cancelled) {
          setListErr(message);
          toast.error(message);
        }
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const totalFmt = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(total),
    [total]
  );

  const claim = async () => {
    const loadingId = toast.loading("Claiming your funds…");
    setSubmitting(true);
    setMsg(null);

    try {
      // Include a Privy access token if available (your API accepts bearer)
      let access: string | null = null;
      try {
        access = (await getAccessToken()) || null;
      } catch {
        /* ignore */
      }

      const res = await fetch("/api/email-claims/claim", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(access ? { Authorization: `Bearer ${access}` } : {}),
        },
        body: JSON.stringify({ token }),
      });

      const data = (await res.json().catch(() => ({}))) as ClaimApi;

      // Branch 1: HTTP error → treat as ClaimApiErr
      if (!res.ok) {
        const err = data as ClaimApiErr;
        const code = err.code ?? `HTTP_${res.status}`;
        const base = err.error || "Claim failed.";
        const hint = err.hint ? ` ${err.hint}` : "";
        const trace = err.traceId ? ` (Ref: ${err.traceId})` : "";

        // Friendly buckets by code
        if (
          code === "UNAUTHORIZED" ||
          code === "EMAIL_MISMATCH" ||
          code === "TOKEN_EXPIRED" ||
          code === "TOKEN_INVALID" ||
          code === "ESCROW_FUNDS_INSUFFICIENT"
        ) {
          toast.error(`${base}${hint}${trace}`, { id: loadingId });
        } else if (
          code === "RPC_BLOCKHASH_EXPIRED" ||
          code === "PRIVY_RATE_LIMITED"
        ) {
          toast.error(`${base} Please try again.${trace}`, { id: loadingId });
        } else {
          toast.error(`${base}${hint}${trace}`, { id: loadingId });
        }

        setSubmitting(false);
        return;
      }

      // Branch 2: HTTP OK but payload is not ok → treat as logical error
      if (!isClaimOk(data)) {
        const err = data as ClaimApiErr;
        const base = err.error || "Claim failed.";
        const hint = err.hint ? ` ${err.hint}` : "";
        const trace = err.traceId ? ` (Ref: ${err.traceId})` : "";
        toast.error(`${base}${hint}${trace}`, { id: loadingId });
        setSubmitting(false);
        return;
      }

      // Branch 3: success
      const claimedCount = Number(data.claimedCount || 0);
      const redirect = data.redirect || "/onboarding";

      toast.success(
        `Claimed ${claimedCount} transfer${
          claimedCount === 1 ? "" : "s"
        }. Redirecting…`,
        { id: loadingId }
      );
      setMsg(
        `Claimed ${claimedCount} transfer${
          claimedCount === 1 ? "" : "s"
        }. Redirecting…`
      );
      setTimeout(() => {
        window.location.assign(redirect);
      }, 800);
    } catch (e) {
      toast.dismiss(loadingId);
      toast.error(
        e instanceof Error ? e.message : "Claim failed. Please try again."
      );
      setMsg(e instanceof Error ? e.message : "Claim failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready) return <FullScreenLoader message="Preparing secure claim…" />;

  // Hide amounts until the user is signed in
  const showAmounts = authenticated;

  return (
    <div className="min-h-[70vh] grid place-items-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900/80 backdrop-blur-xl p-6 space-y-6">
        <h1 className="text-2xl font-semibold text-white text-center">
          Claim your funds
        </h1>

        {loadingList ? (
          <div className="text-sm text-zinc-300 text-center">
            Loading transfers…
          </div>
        ) : listErr ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-200 p-3 text-sm">
            {listErr}
          </div>
        ) : claims.length === 0 ? (
          <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 text-zinc-300 p-3 text-sm text-center">
            No pending transfers to claim for this link.
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <div className="text-sm text-zinc-400">Pending transfers:</div>
              <div className="divide-y divide-white/10 rounded-lg border border-white/10">
                {claims.map((c) => {
                  const created = new Date(c.createdAt).toLocaleString();
                  return (
                    <div key={c.id} className="p-3 text-sm flex flex-col gap-1">
                      <div className="flex justify-between">
                        <div className="text-white font-medium">
                          {showAmounts ? (
                            new Intl.NumberFormat(undefined, {
                              style: "currency",
                              currency: "USD",
                              maximumFractionDigits: 2,
                            }).format(c.amountUi)
                          ) : (
                            <span className="text-zinc-400">
                              Sign in to view
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-400">{created}</div>
                      </div>
                      <div className="text-xs text-zinc-400">
                        From:{" "}
                        <span className="text-zinc-300">{c.senderEmail}</span>
                      </div>
                      {c.note && (
                        <div className="text-xs text-zinc-300 italic">
                          “{c.note}”
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-between text-sm pt-2">
                <span className="text-zinc-400">
                  Total ({claims.length}{" "}
                  {claims.length === 1 ? "transfer" : "transfers"}):
                </span>
                <span className="text-[rgb(182,255,62)] font-semibold">
                  {showAmounts ? totalFmt + " USD" : "—"}
                </span>
              </div>
            </div>
          </>
        )}

        {!authenticated ? (
          <>
            <p className="text-sm text-zinc-300 text-center">
              To claim, sign in with the email that received the invite. We’ll
              show amounts after you’re signed in.
            </p>
            <button
              onClick={() => login()}
              className="w-full rounded-xl bg-[rgb(182,255,62)] text-black py-3 font-semibold text-lg"
            >
              Sign in to continue
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-zinc-300 text-center">
              We’ll verify your email matches the invite and move funds from
              escrow to your Haven wallet.
            </p>
            <button
              disabled={submitting || claims.length === 0}
              onClick={claim}
              className="w-full rounded-xl bg-[rgb(182,255,62)] text-black py-3 font-semibold text-lg disabled:opacity-50"
            >
              {submitting
                ? "Claiming…"
                : claims.length > 0
                ? showAmounts
                  ? `Claim all (${totalFmt}) USD`
                  : "Claim all"
                : "Nothing to claim"}
            </button>
          </>
        )}

        {msg && (
          <div
            className={`rounded-lg p-3 text-sm ${
              /fail|error|unauthor|expired/i.test(msg)
                ? "border border-red-500/30 bg-red-500/10 text-red-200"
                : "border border-green-500/30 bg-green-500/10 text-green-200"
            }`}
          >
            {msg}
          </div>
        )}
      </div>
    </div>
  );
}
