// components/activity/ActivityLite.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useUser } from "@/providers/UserProvider";
import { findTokenByMint } from "@/lib/tokens";

type Item = {
  signature: string;
  blockTime: number | null;
  direction: "in" | "out";
  amountUi: number; // USDC
  counterparty?: string | null;
  feeLamports?: number | null;
  kind?: "transfer" | "swap" | "email";
  swapBoughtMint?: string;
  swapBoughtAmountUi?: number;
  counterpartyLabel?: string | null;
};

type ApiResp = { ok: true; items: Item[]; nextBefore: string | null };

function fmtDateTime(sec: number | null) {
  if (!sec) return { d: "—", t: "—" };
  const d = new Date(sec * 1000);
  return {
    d: d.toLocaleDateString(undefined, { month: "short", day: "2-digit" }),
    t: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
  };
}

function formatFiat(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

function TokenBoughtChip({
  mint,
  amountUi,
}: {
  mint?: string;
  amountUi?: number;
}) {
  if (!mint || !amountUi || amountUi <= 0) return null;
  const meta = findTokenByMint(mint);
  const symbol = meta?.symbol ?? "TOKEN";
  const dec = Math.max(0, Math.min(6, meta?.decimals ?? 6));
  return (
    <span className="inline-flex items-center gap-2 px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/10 text-[11px] text-white/75">
      {amountUi.toFixed(Math.min(4, dec))} {symbol}
    </span>
  );
}

export default function ActivityLite() {
  const router = useRouter();
  const { user } = useUser();
  const { ready, authenticated, getAccessToken } = usePrivy();

  const targetCurrency = useMemo(() => {
    const c = (user?.displayCurrency || "USD").toUpperCase();
    return c === "USDC" ? "USD" : c;
  }, [user?.displayCurrency]);

  const [rate, setRate] = useState<number>(1);
  const [fxLoading, setFxLoading] = useState(false);

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // render debug
  useEffect(() => {
    console.debug("[ActivityLite][render] items.len =", items.length);
  });

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    if (!ready || !authenticated) return {};
    try {
      const token = await getAccessToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }, [ready, authenticated, getAccessToken]);

  useEffect(() => {
    console.debug("[ActivityLite] auth state", { ready, authenticated });
  }, [ready, authenticated]);

  const loadFx = useCallback(async () => {
    if (targetCurrency === "USD") {
      setRate(1);
      return;
    }
    setFxLoading(true);
    try {
      const headers = await authHeaders();
      const url = `/api/fx?currency=${encodeURIComponent(
        targetCurrency
      )}&amount=1`;
      console.debug("[ActivityLite][FX] fetching", url);
      const r = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        headers,
      });
      const j = await r.json().catch(() => null);
      const fx = r.ok && j?.rate ? Number(j.rate) : 1;
      console.debug("[ActivityLite][FX] status", r.status, "rate", fx);
      setRate(isFinite(fx) && fx > 0 ? fx : 1);
    } catch (e) {
      console.warn("[ActivityLite][FX] error", e);
      setRate(1);
    } finally {
      setFxLoading(false);
    }
  }, [targetCurrency, authHeaders]);

  /**
   * Robust: fetch until we have N items (or we run out).
   * - batchSize controls how many we ask per call (keep it modest)
   * - stops when we reach N or nextBefore is null
   */
  const loadFirstN = useCallback(
    async (nWanted = 5, batchSize = 10) => {
      setLoading(true);
      setErr(null);
      try {
        const headers = await authHeaders();
        const collected: Item[] = [];
        let cursor: string | null = null;
        let safety = 0;

        console.groupCollapsed("[ActivityLite][API] fetch first N");
        console.debug("nWanted", nWanted, "batchSize", batchSize);

        while (collected.length < nWanted && safety < 10) {
          const url = new URL("/api/activity", window.location.origin);
          url.searchParams.set("limit", String(batchSize));
          if (cursor) url.searchParams.set("before", cursor);

          console.debug("GET", url.toString());
          const r = await fetch(url.toString(), {
            credentials: "include",
            cache: "no-store",
            headers,
          });

          const raw = await r.text();
          console.debug("status", r.status, "rawLen", raw.length);

          if (!r.ok) {
            console.groupEnd();
            throw new Error(raw || `HTTP ${r.status}`);
          }

          let j: ApiResp | null = null;
          try {
            j = JSON.parse(raw) as ApiResp;
          } catch (e) {
            console.error("[ActivityLite][API] JSON parse error", e);
          }

          const batch = Array.isArray(j?.items) ? j!.items : [];
          console.debug(
            "batch items",
            batch.length,
            "nextBefore",
            j?.nextBefore
          );
          if (batch.length) {
            console.table(
              batch.map((i) => ({
                signature: i.signature,
                time: i.blockTime,
                dir: i.direction,
                usdc: i.amountUi,
                kind: i.kind,
              }))
            );
          }

          collected.push(...batch);
          cursor = j?.nextBefore ?? null;

          if (!cursor || batch.length === 0) break;
          safety += 1;
        }

        const top = collected.slice(0, nWanted);
        console.debug(
          "collected",
          collected.length,
          "returning top",
          top.length
        );
        console.groupEnd();

        setItems(top);
      } catch (e) {
        console.error("[ActivityLite][API] loadFirstN error:", e);
        setErr(e instanceof Error ? e.message : "Failed to load activity");
      } finally {
        setLoading(false);
      }
    },
    [authHeaders]
  );

  useEffect(() => {
    if (!ready) return;
    void loadFx();
    void loadFirstN(5, 10); // <= ensure we end up with 5
  }, [ready, loadFx, loadFirstN]);

  useEffect(() => {
    console.debug("[ActivityLite][effect] items updated:", items.length, items);
  }, [items]);

  const fmtAmt = useCallback(
    (usdcUi: number, sign: "+" | "-") => {
      const n = usdcUi * rate;
      return `${sign}${formatFiat(n, targetCurrency)}`;
    },
    [rate, targetCurrency]
  );

  const labelFor = useCallback(
    (it: Item): { title: string; subtitle?: string } => {
      const cp = (it.counterpartyLabel || "").trim();

      if (it.kind === "email") {
        return {
          title:
            it.direction === "in"
              ? "Email transfer (received)"
              : "Email transfer (sent)",
          subtitle: "Haven Escrow",
        };
      }
      if (it.kind === "swap" && it.swapBoughtMint && it.swapBoughtAmountUi) {
        const sym = findTokenByMint(it.swapBoughtMint)?.symbol ?? "TOKEN";
        return { title: `Asset purchase — ${sym}`, subtitle: cp || "Swap" };
      }
      if (it.direction === "in")
        return { title: "Transfer from", subtitle: cp || "External" };
      return { title: "Transfer to", subtitle: cp || "External" };
    },
    []
  );

  const goAll = useCallback(() => router.push("/activity"), [router]);

  return (
    <div className="relative group w-full">
      {/* Glow ring */}
      <div className="absolute -inset-1 bg-gradient-to-r from-[rgba(182,255,62,0.2)] via-transparent to-[rgba(182,255,62,0.2)] rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-700" />

      {/* Let the card grow to show all 5 */}
      <div className="relative vision-window p-5 sm:p-6 rounded-3xl border border-white/20 bg-black/40 backdrop-blur-[40px] backdrop-saturate-[200%] overflow-visible min-h-[360px]">
        {/* Header */}
        <div className="mb-5 sm:mb-6 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-[rgb(182,255,62)] shadow-[0_0_20px_rgba(182,255,62,0.6)]" />
            <h3 className="text-lg sm:text-xl font-bold tracking-tight">
              Recent Activity
            </h3>
          </div>

          <Link
            href="/activity"
            className="text-xs sm:text-sm font-medium rounded-xl px-3 py-2 bg-white/5 border border-white/10 text-[rgb(182,255,62)] hover:bg-white/10 hover:border-[rgb(182,255,62)]/30 transition-all"
          >
            View all
          </Link>
        </div>

        {/* FX note */}
        <div className="text-[11px] sm:text-xs text-white/50 mb-2 min-h-[14px]">
          {fxLoading && targetCurrency !== "USD" ? "Updating FX…" : ""}
        </div>

        {/* Body */}
        {!authenticated && !loading ? (
          <div className="text-sm text-white/70">Sign in to view activity.</div>
        ) : err ? (
          <div className="text-sm text-red-400 break-words">
            Failed to load activity.
          </div>
        ) : items.length === 0 && !loading ? (
          <div className="text-sm text-white/60">No activity yet.</div>
        ) : (
          <ul className="divide-y divide-white/10">
            {loading && items.length === 0 ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : null}

            {items.map((it) => {
              const sign: "+" | "-" = it.direction === "in" ? "+" : "-";
              const { d, t } = fmtDateTime(it.blockTime);
              const { title, subtitle } = labelFor(it);
              const color =
                it.direction === "in"
                  ? "text-[rgb(182,255,62)]"
                  : "text-red-400";
              return (
                <li key={it.signature} className="px-1 py-3">
                  <button
                    type="button"
                    onClick={goAll}
                    className="w-full text-left flex items-start justify-between gap-3 hover:bg-white/[0.04] rounded-xl px-2 py-2 transition-colors"
                    aria-label="Open activity"
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-white/90 truncate">
                        {title}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {it.kind === "swap" ? (
                          <TokenBoughtChip
                            mint={it.swapBoughtMint}
                            amountUi={it.swapBoughtAmountUi}
                          />
                        ) : null}
                        {subtitle ? (
                          <span className="text-[11px] text-white/55">
                            {subtitle}
                          </span>
                        ) : null}
                        <span className="text-[11px] text-white/45">
                          • {d} {t}
                        </span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`text-sm font-semibold ${color}`}>
                        {fmtAmt(it.amountUi, sign)}
                      </div>
                      <div className="text-[11px] text-white/50">
                        {it.amountUi.toFixed(2)} USDC
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* Footer CTA */}
        <div className="pt-4 mt-4 border-t border-white/10 flex justify-end">
          <Link
            href="/activity"
            className="text-xs sm:text-sm rounded-lg px-3 py-2 text-white/80 hover:text-white hover:bg-white/10 border border-white/10 transition-all"
          >
            See full activity →
          </Link>
        </div>
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <li className="px-1 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="h-3 w-40 bg-white/10 rounded mb-2" />
          <div className="h-3 w-24 bg-white/10 rounded" />
        </div>
        <div className="w-24 h-4 bg-white/10 rounded" />
      </div>
    </li>
  );
}
