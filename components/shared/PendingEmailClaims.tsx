"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { toast } from "react-hot-toast";

type PendingClaim = {
  id: string;
  createdAt: string;
  amountUi: number;
  note: string | null;
  senderEmail: string;
  escrowSignature: string | null;
  currency: string; // "USDC"
};

type ListOk = {
  ok: true;
  claims: PendingClaim[];
  totalCount: number;
  totalAmountUi: number;
};
type ListErr = { ok?: false; error?: string; code?: string; traceId?: string };

type ClaimOk = {
  ok: true;
  claimedCount: number;
  signatures: string[];
  redirect?: string;
  traceId?: string;
};
type ClaimErr = {
  ok?: false;
  code?: string;
  error?: string;
  hint?: string;
  traceId?: string;
  partial?: { claimedCount: number; signatures: string[] };
};

export default function PendingEmailClaims({
  className = "",
  showCard = true,
}: {
  className?: string;
  showCard?: boolean;
}) {
  const { ready, authenticated, getAccessToken } = usePrivy();

  const [loaded, setLoaded] = useState(false);
  const [items, setItems] = useState<PendingClaim[]>([]);
  const [claiming, setClaiming] = useState(false);

  const totalFmt = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(items.reduce((a, c) => a + (c.amountUi || 0), 0)),
    [items]
  );

  const load = useCallback(async () => {
    if (!authenticated) return;
    setLoaded(false);
    try {
      const headers: HeadersInit = {};
      try {
        const token = await getAccessToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      } catch {
        /* ignore */
      }
      const r = await fetch("/api/email-claims/pending?me=1", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers,
      });
      const j = (await r.json().catch(() => ({}))) as ListOk | ListErr;
      if (!r.ok || (j as ListErr)?.ok === false) {
        // Silent fail (render nothing) but log for debugging
        console.error("pending email-claims load error:", j);
        setItems([]);
      } else {
        setItems((j as ListOk).claims || []);
      }
    } catch (e) {
      console.error("pending email-claims load error:", e);
      setItems([]);
    } finally {
      setLoaded(true);
    }
  }, [authenticated, getAccessToken]);

  useEffect(() => {
    if (!ready || !authenticated) return;
    void load();
  }, [ready, authenticated, load]);

  const claimAll = useCallback(async () => {
    if (!items.length) return;
    const toastId = toast.loading("Claiming transfers…");
    setClaiming(true);
    try {
      const headers: HeadersInit = { "Content-Type": "application/json" };
      try {
        const token = await getAccessToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      } catch {
        /* ignore */
      }

      const r = await fetch("/api/email-claims/claim", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ all: true }),
      });
      const j = (await r.json().catch(() => ({}))) as ClaimOk | ClaimErr;

      if (!r.ok || (j as ClaimErr)?.ok === false) {
        const code = (j as ClaimErr)?.code ?? `HTTP_${r.status}`;
        const base = (j as ClaimErr)?.error || "Claim failed.";
        const hint = (j as ClaimErr)?.hint ? ` ${(j as ClaimErr).hint}` : "";
        const trace = (j as ClaimErr)?.traceId
          ? ` (Ref: ${(j as ClaimErr).traceId})`
          : "";

        if (
          code === "UNAUTHORIZED" ||
          code === "ESCROW_FUNDS_INSUFFICIENT" ||
          code === "RPC_BLOCKHASH_EXPIRED" ||
          code === "PRIVY_RATE_LIMITED"
        ) {
          toast.error(`${base}${hint}${trace}`, { id: toastId });
        } else {
          toast.error(`${base}${hint}${trace}`, { id: toastId });
        }
        return;
      }

      const claimed = (j as ClaimOk).claimedCount || 0;
      const redirect = (j as ClaimOk).redirect || "/dashboard";
      toast.success(
        `Claimed ${claimed} transfer${claimed === 1 ? "" : "s"}. Redirecting…`,
        { id: toastId }
      );
      setTimeout(() => window.location.assign(redirect), 800);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Claim failed. Please try again.",
        { id: toastId }
      );
    } finally {
      setClaiming(false);
      void load();
    }
  }, [items.length, getAccessToken, load]);

  // ── Visibility rules ────────────────────────────────────────────────────
  // Show absolutely nothing if:
  // - not ready
  // - not authenticated
  // - loaded and there are NO pending items
  if (!ready || !authenticated) return null;
  if (loaded && items.length === 0) return null;

  // If we got here and not loaded yet, stay invisible to avoid flashes.
  if (!loaded) return null;

  // Surface (only rendered if there ARE pending items)
  const Body = (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-white/80">
          You have{" "}
          <span className="font-semibold text-white">{items.length}</span>{" "}
          pending transfer{items.length === 1 ? "" : "s"} totaling{" "}
          <span className="font-semibold text-white">{totalFmt}</span>.
        </div>
        <button
          onClick={claimAll}
          disabled={claiming}
          className="rounded-lg bg-[rgb(182,255,62)] text-black px-3 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {claiming ? "Claiming…" : "Claim all"}
        </button>
      </div>

      <ul className="divide-y divide-white/10 rounded-md border border-white/10 bg-white/[0.02]">
        {items.map((c) => (
          <li key={c.id} className="px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-white/90 truncate">
                  From <span className="font-medium">{c.senderEmail}</span>
                </div>
                <div className="text-xs text-white/50">
                  {new Date(c.createdAt).toLocaleString()}
                </div>
                {c.note && (
                  <div className="text-xs text-white/70 italic mt-0.5">
                    “{c.note}”
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="text-white font-semibold">
                  {new Intl.NumberFormat(undefined, {
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 2,
                  }).format(c.amountUi)}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );

  if (!showCard) return <div className={className}>{Body}</div>;

  return (
    <section
      className={`rounded-2xl border border-white/10 bg-white/[0.03] p-4 ${className}`}
    >
      <h3 className="text-base font-semibold text-white mb-3">
        Unclaimed transfers
      </h3>
      {Body}
    </section>
  );
}
