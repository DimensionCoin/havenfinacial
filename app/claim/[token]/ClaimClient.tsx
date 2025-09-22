// app/claim/[token]/ClaimClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import FullScreenLoader from "@/components/shared/FullScreenLoader";

type PendingClaim = {
  id: string;
  createdAt: string;
  amountUi: number;
  note: string | null;
  senderEmail: string;
  escrowSignature: string | null;
  currency: string; // "USDC"
};

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
          {
            credentials: "include",
            cache: "no-store",
          }
        );
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        if (!cancelled) {
          setClaims(j.claims || []);
          setTotal(Number(j.totalAmountUi || 0));
        }
      } catch (e) {
        if (!cancelled)
          setListErr(
            e instanceof Error ? e.message : "Failed to load transfers"
          );
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
    setSubmitting(true);
    setMsg(null);
    try {
      // Pass a Privy access token if available (helps your API accept bearer)
      let access: string | null = null;
      try {
        access = (await getAccessToken()) || null;
      } catch {}

      const res = await fetch("/api/email-claims/claim", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(access ? { Authorization: `Bearer ${access}` } : {}),
        },
        body: JSON.stringify({ token }),
      });

      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);

      setMsg(
        `Claimed ${j.claimedCount || 0} transfer${
          (j.claimedCount || 0) === 1 ? "" : "s"
        }. Redirecting…`
      );
      setTimeout(() => {
        window.location.assign(j.redirect || "/onboarding");
      }, 800);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Claim failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready) return <FullScreenLoader message="Preparing secure claim…" />;

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
                {claims.map((c) => (
                  <div key={c.id} className="p-3 text-sm flex flex-col gap-1">
                    <div className="flex justify-between">
                      <div className="text-white font-medium">
                        {new Intl.NumberFormat(undefined, {
                          style: "currency",
                          currency: "USD",
                          maximumFractionDigits: 2,
                        }).format(c.amountUi)}
                      </div>
                      <div className="text-xs text-zinc-400">
                        {new Date(c.createdAt).toLocaleString()}
                      </div>
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
                ))}
              </div>

              <div className="flex justify-between text-sm pt-2">
                <span className="text-zinc-400">
                  Total ({claims.length}{" "}
                  {claims.length === 1 ? "transfer" : "transfers"}):
                </span>
                <span className="text-[rgb(182,255,62)] font-semibold">
                  {totalFmt} USD
                </span>
              </div>
            </div>
          </>
        )}

        {!authenticated ? (
          <>
            <p className="text-sm text-zinc-300 text-center">
              To claim, sign in with the email that received the invite.
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
                ? `Claim all (${totalFmt}) USD`
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
