// components/activity/ActivityList.tsx
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useUser } from "@/providers/UserProvider";
import { findTokenByMint } from "@/lib/tokens"; // client-safe: logos + symbols

type Item = {
  signature: string;
  blockTime: number | null; // seconds
  direction: "in" | "out"; // USDC direction
  amountUi: number; // USDC
  counterparty?: string | null;
  feeLamports?: number | null;

  // from the API enrichment
  kind?: "transfer" | "swap" | "email";
  swapBoughtMint?: string;
  swapBoughtAmountUi?: number;
  counterpartyLabel?: string | null;
};

type ApiResp = { ok: true; items: Item[]; nextBefore: string | null };

const EXPLORER_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "mainnet";

function explorerTx(sig: string) {
  // For mainnet: no cluster param; others include cluster
  return EXPLORER_CLUSTER === "mainnet" || EXPLORER_CLUSTER === "mainnet-beta"
    ? `https://explorer.solana.com/tx/${sig}`
    : `https://explorer.solana.com/tx/${sig}?cluster=${EXPLORER_CLUSTER}`;
}

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

  const [rate, setRate] = useState<number>(1); // USD -> targetCurrency
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
        const msg = e instanceof Error ? e.message : String(e);
        setErr(msg);
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

  // Row labels driven by API-provided kind + counterpartyLabel
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

  // Group by date for statement sections
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

  return (
    <div className="w-full max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Activity</h2>
        <button
          onClick={() => load(null)}
          className="text-xs px-3 py-1.5 rounded-md border border-white/10 text-white/80 hover:bg-white/10"
          disabled={loading}
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
          <div className="px-4 py-2 text-xs text-white/60 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
            <span>Bank statement view</span>
            <span>
              {loadingFx && targetCurrency !== "USD"
                ? "Updating FX…"
                : `FX: 1 USD ≈ ${rate.toFixed(4)} ${targetCurrency}`}
            </span>
          </div>

          <div className="divide-y divide-white/10">
            {groups.map(([date, rows]) => (
              <section key={date} className="py-1">
                <div className="px-4 py-2 text-xs font-medium text-white/70 bg-white/[0.02]">
                  {date}
                </div>
                <ul className="divide-y divide-white/5">
                  {rows.map((it) => {
                    const sign: "+" | "-" = it.direction === "in" ? "+" : "-";
                    const { title, subtitle } = labelFor(it);

                    return (
                      <li
                        key={it.signature}
                        className="px-4 py-3 grid grid-cols-12 gap-2 items-center hover:bg-white/[0.04] transition-colors"
                      >
                        {/* Time */}
                        <div className="col-span-2 md:col-span-2">
                          <div className="text-xs text-white/60">
                            {fmtTime(it.blockTime)}
                          </div>
                        </div>

                        {/* Description */}
                        <div className="col-span-6 md:col-span-6 min-w-0">
                          <div className="text-sm text-white/90 truncate">
                            {title}
                          </div>
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
                        </div>

                        {/* Amount (USDC + local) */}
                        <div className="col-span-4 md:col-span-4 text-right">
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

                        {/* Explorer link */}
                        <div className="col-span-12 mt-1 text-right text-[11px]">
                          <a
                            href={explorerTx(it.signature)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-white/40 hover:text-white/70 hover:underline"
                          >
                            View on explorer →
                          </a>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          {/* Pager */}
          <div className="p-3 flex items-center justify-end">
            <button
              onClick={() => nextBefore && load(nextBefore)}
              disabled={!nextBefore || loading}
              className="text-xs px-3 py-1.5 rounded-md border border-white/10 text-white/80 disabled:opacity-50 hover:bg-white/10"
            >
              {loading ? "Loading…" : nextBefore ? "Load more" : "End of list"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
