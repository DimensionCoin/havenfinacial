// components/activity/ActivityList.tsx
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
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

  // from API enrichment
  kind?: "transfer" | "swap" | "email";
  swapBoughtMint?: string;
  swapBoughtAmountUi?: number;
  counterpartyLabel?: string | null;
};

type ApiResp = { ok: true; items: Item[]; nextBefore: string | null };

const EXPLORER_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "mainnet";
const isMainnet =
  EXPLORER_CLUSTER === "mainnet" || EXPLORER_CLUSTER === "mainnet-beta";

const explorerTx = (sig: string) =>
  isMainnet
    ? `https://explorer.solana.com/tx/${sig}`
    : `https://explorer.solana.com/tx/${sig}?cluster=${EXPLORER_CLUSTER}`;

function TokenBoughtPill({
  mint,
  amountUi,
}: {
  mint?: string;
  amountUi?: number;
}) {
  if (!mint || !amountUi || amountUi <= 0) return null;
  const meta = findTokenByMint(mint);
  const symbol = meta?.symbol ?? "TOKEN";
  const logo = meta?.logo ?? "/logos/generic-token.png";
  const dec = Math.max(0, Math.min(6, meta?.decimals ?? 6));
  return (
    <span className="inline-flex items-center gap-2 px-2 py-1 rounded-md bg-white/[0.06] border border-white/10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo} alt={symbol} className="h-4 w-4 rounded-sm" />
      <span className="text-xs text-white/80">
        {amountUi.toFixed(Math.min(4, dec))}
      </span>
      <span className="text-xs text-white/60">{symbol}</span>
    </span>
  );
}

export default function ActivityList() {
  const { user } = useUser();
  const { ready, authenticated, getAccessToken } = usePrivy();

  const targetCurrency = useMemo(() => {
    const c = (user?.displayCurrency || "USD").toUpperCase();
    return c === "USDC" ? "USD" : c;
  }, [user?.displayCurrency]);

  const [rate, setRate] = useState<number>(1);
  const [loadingFx, setLoadingFx] = useState(false);

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    if (!ready || !authenticated) return {};
    try {
      const token = await getAccessToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }, [ready, authenticated, getAccessToken]);

  const loadFx = useCallback(async () => {
    if (targetCurrency === "USD") {
      setRate(1);
      return;
    }
    setLoadingFx(true);
    try {
      const headers = await authHeaders();
      const r = await fetch(
        `/api/fx?currency=${encodeURIComponent(targetCurrency)}&amount=1`,
        { credentials: "include", cache: "no-store", headers }
      );
      const j = await r.json().catch(() => null);
      const fx = r.ok && j?.rate ? Number(j.rate) : 1;
      setRate(isFinite(fx) && fx > 0 ? fx : 1);
    } catch {
      setRate(1);
    } finally {
      setLoadingFx(false);
    }
  }, [targetCurrency, authHeaders]);

  const load = useCallback(
    async (cursor?: string | null) => {
      setLoading(true);
      setErr(null);
      try {
        const headers = await authHeaders();
        const url = new URL("/api/activity", window.location.origin);
        if (cursor) url.searchParams.set("before", cursor);
        url.searchParams.set("limit", "30");

        const r = await fetch(url.toString(), {
          credentials: "include",
          cache: "no-store",
          headers,
        });
        if (!r.ok) {
          const text = await r.text().catch(() => "");
          throw new Error(text || `HTTP ${r.status}`);
        }
        const j = (await r.json()) as ApiResp;
        setItems((prev) => (cursor ? [...prev, ...j.items] : j.items));
        setNextBefore(j.nextBefore);
      } catch (e) {
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
    void load(null);
  }, [ready, loadFx, load]);

  const fmtAmt = useCallback(
    (usdcUi: number, sign: "+" | "-") => {
      const local = usdcUi * rate;
      try {
        return `${sign}${new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: targetCurrency,
          maximumFractionDigits: 2,
        }).format(local)}`;
      } catch {
        return `${sign}${targetCurrency} ${local.toFixed(2)}`;
      }
    },
    [rate, targetCurrency]
  );

  const fmtDate = (sec: number | null) =>
    sec
      ? new Date(sec * 1000).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "2-digit",
        })
      : "—";

  const fmtTime = (sec: number | null) =>
    sec
      ? new Date(sec * 1000).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

  const labelFor = useCallback(
    (it: Item): { title: string; subtitle?: string } => {
      const cp = (it.counterpartyLabel || "").trim();

      if (it.kind === "email") {
        return {
          title:
            it.direction === "in"
              ? "Haven email transfer (received)"
              : "Haven email transfer (sent)",
          subtitle: "Haven Escrow",
        };
      }

      if (it.kind === "swap" && it.swapBoughtMint && it.swapBoughtAmountUi) {
        const meta = findTokenByMint(it.swapBoughtMint);
        const sym = meta?.symbol ?? "TOKEN";
        return { title: `Asset purchase — ${sym}`, subtitle: cp || "Swap" };
      }

      if (it.direction === "in") {
        return { title: "Transfer from", subtitle: cp || "External" };
      }
      return { title: "Transfer to", subtitle: cp || "External" };
    },
    []
  );

  // Group by day for statement sections
  const groups = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of items) {
      const d = fmtDate(it.blockTime);
      const list = map.get(d) || [];
      list.push(it);
      map.set(d, list);
    }
    return Array.from(map.entries());
  }, [items]);

  // Simple mobile skeleton rows
  const SkeletonRow = () => (
    <li className="px-4 py-3 flex items-center justify-between">
      <div className="flex-1 min-w-0">
        <div className="h-3 w-40 bg-white/10 rounded mb-2" />
        <div className="h-3 w-24 bg-white/10 rounded" />
      </div>
      <div className="w-24 h-4 bg-white/10 rounded" />
    </li>
  );

  return (
    <div className="w-full max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base sm:text-xl font-semibold text-white">
          Activity
        </h2>
        <button
          onClick={() => load(null)}
          className="text-xs px-3 py-2 rounded-md border border-white/10 text-white/80 hover:bg-white/10 active:scale-[0.98]"
          disabled={loading}
          aria-label="Refresh activity"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {!authenticated ? (
        <div className="text-sm text-white/70">Sign in to view activity.</div>
      ) : err ? (
        <div className="text-sm text-red-400 break-words">
          Failed to load activity.
        </div>
      ) : items.length === 0 && !loading ? (
        <div className="text-sm text-white/60">No activity yet.</div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
          {/* Top bar */}
          <div className="px-4 py-2 text-[11px] sm:text-xs text-white/60 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
            <span>Bank statement view</span>
            <span>
              {loadingFx && targetCurrency !== "USD"
                ? "Updating FX…"
                : `FX: 1 USD ≈ ${rate.toFixed(4)} ${targetCurrency}`}
            </span>
          </div>

          {/* MOBILE view (default): stacked, tap-friendly */}
          <div className="sm:hidden divide-y divide-white/10">
            {loading && items.length === 0 ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : null}

            {groups.map(([date, rows]) => (
              <section key={date} className="py-1">
                <div className="px-4 py-2 text-[11px] font-medium text-white/70 bg-white/[0.02] sticky top-0">
                  {date}
                </div>
                <ul className="divide-y divide-white/5">
                  {rows.map((it) => {
                    const sign: "+" | "-" = it.direction === "in" ? "+" : "-";
                    const { title, subtitle } = labelFor(it);

                    return (
                      <li key={it.signature} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          {/* Left: title + subtitle + tag */}
                          <div className="min-w-0">
                            <div className="text-[15px] text-white/90 truncate">
                              {title}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              {it.kind === "swap" ? (
                                <TokenBoughtPill
                                  mint={it.swapBoughtMint}
                                  amountUi={it.swapBoughtAmountUi}
                                />
                              ) : null}
                              {subtitle ? (
                                <span className="text-xs text-white/50">
                                  {subtitle}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1 text-[11px] text-white/45">
                              {fmtTime(it.blockTime)}
                            </div>
                            <div className="mt-2">
                              <a
                                href={explorerTx(it.signature)}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] text-white/40 hover:text-white/70 underline underline-offset-2"
                              >
                                View on explorer →
                              </a>
                            </div>
                          </div>

                          {/* Right: amount */}
                          <div className="text-right flex-shrink-0">
                            <div
                              className={`text-sm font-semibold ${
                                it.direction === "in"
                                  ? "text-[rgb(182,255,62)]"
                                  : "text-red-400"
                              }`}
                            >
                              {fmtAmt(it.amountUi, sign)}
                            </div>
                            <div className="text-[11px] text-white/50">
                              {it.amountUi.toFixed(2)} USDC
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          {/* DESKTOP view (sm+): grid/table */}
          <div className="hidden sm:block">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white/5 text-white/70">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">When</th>
                    <th className="text-left px-4 py-2 font-medium">
                      Description
                    </th>
                    <th className="text-right px-4 py-2 font-medium">Amount</th>
                    <th className="text-right px-4 py-2 font-medium">Tx</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {groups.map(([date]) => (
                    <tr key={date} className="bg-white/[0.02]">
                      <td
                        colSpan={4}
                        className="px-4 py-2 text-xs font-medium text-white/70"
                      >
                        {date}
                      </td>
                    </tr>
                  )).length === 0 && loading ? (
                    <>
                      <tr>
                        <td colSpan={4}>
                          <SkeletonRow />
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={4}>
                          <SkeletonRow />
                        </td>
                      </tr>
                    </>
                  ) : null}

                  {groups.flatMap(([, rows]) =>
                    rows.map((it) => {
                      const sign: "+" | "-" = it.direction === "in" ? "+" : "-";
                      const { title, subtitle } = labelFor(it);
                      return (
                        <tr
                          key={it.signature}
                          className="text-white/90 hover:bg-white/[0.04]"
                        >
                          <td className="px-4 py-3 text-white/70">
                            <div>{fmtDate(it.blockTime)}</div>
                            <div className="text-[11px] text-white/45">
                              {fmtTime(it.blockTime)}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-sm">{title}</div>
                            <div className="mt-1 flex items-center gap-2">
                              {it.kind === "swap" ? (
                                <TokenBoughtPill
                                  mint={it.swapBoughtMint}
                                  amountUi={it.swapBoughtAmountUi}
                                />
                              ) : null}
                              {subtitle ? (
                                <span className="text-xs text-white/50">
                                  {subtitle}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div
                              className={`text-sm font-semibold ${
                                it.direction === "in"
                                  ? "text-[rgb(182,255,62)]"
                                  : "text-red-400"
                              }`}
                            >
                              {fmtAmt(it.amountUi, sign)}
                            </div>
                            <div className="text-[11px] text-white/50">
                              {it.amountUi.toFixed(2)} USDC
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <a
                              href={explorerTx(it.signature)}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[rgb(182,255,62)] hover:underline"
                            >
                              View →
                            </a>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pager */}
          <div className="p-3 flex items-center justify-end">
            <button
              onClick={() => nextBefore && load(nextBefore)}
              disabled={!nextBefore || loading}
              className="w-full sm:w-auto text-xs px-3 py-2 rounded-md border border-white/10 text-white/80 disabled:opacity-50 hover:bg-white/10 active:scale-[0.98]"
            >
              {loading ? "Loading…" : nextBefore ? "Load more" : "End of list"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
