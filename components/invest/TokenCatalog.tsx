// components/crypto/TokenCatalog.tsx
"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import Image from "next/image";
import { X, ChevronDown, RefreshCw } from "lucide-react";
import {
  TokenMeta,
  tokensForCluster,
  getCluster,
  getMintFor,
  TokenCategory,
} from "@/lib/tokens";
import { useUser } from "@/providers/UserProvider";
import { usePrivy } from "@privy-io/react-auth";

/* ------------------------------- config ---------------------------------- */

type Props = {
  /** Called when user confirms an amount to buy. */
  onStartBuy?: (args: { token: TokenMeta; amountFiat: number }) => void;
  /** If provided, only show these categories (in this order). */
  categories?: TokenCategory[];
  /** How often to refresh prices (ms). Set 0 to disable polling. */
  pollMs?: number;
  /** Start collapsed (can be toggled by the user). */
  defaultCollapsed?: boolean;
  className?: string;
};

const DEFAULT_CATEGORY_ORDER: TokenCategory[] = [
  "Top 3",
  "DeFi",
  "Meme",
  "Stocks",
];

// Price API
const JUP_PRICE_BASE =
  process.env.NEXT_PUBLIC_JUP_PRICE_BASE || "https://lite-api.jup.ag/price/v3";

// Quote API
const JUP_QUOTE_BASE =
  process.env.NEXT_PUBLIC_JUP_QUOTE_BASE ||
  "https://lite-api.jup.ag/swap/v1/quote";

// Mainnet USDC (input token for buys)
const USDC_MAINNET =
  process.env.NEXT_PUBLIC_USDC_MAINNET_MINT ||
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// USDC decimals
const USDC_DECIMALS = 6;

// Flat service fee (USD)
const FLAT_FEE_USD = 0.2;

/* -------------------------------- types ---------------------------------- */

type JupPriceItem = {
  usdPrice: number;
  decimals: number;
  priceChange24h?: number;
  blockId?: number;
};
type JupPriceResponse = Record<string, JupPriceItem>;

type JupQuote = {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: "ExactIn" | "ExactOut";
  slippageBps: number;
  platformFee: unknown | null;
  priceImpactPct: string;
  routePlan: unknown[];
  contextSlot: number;
  timeTaken: number;
} | null;

/* ------------------------------- component -------------------------------- */

export default function TokenCatalog({
  onStartBuy,
  categories,
  pollMs = 45_000,
  defaultCollapsed = false,
  className = "",
}: Props) {
  const { user } = useUser();
  const { getAccessToken, ready: privyReady, authenticated } = usePrivy();
  const displayCurrency = (user?.displayCurrency || "USD").toUpperCase();

  const cluster = getCluster();
  const all = useMemo(() => tokensForCluster(cluster), [cluster]);

  // Optionally filter by categories prop
  const filtered = useMemo(
    () =>
      categories?.length
        ? all.filter((t) => t.category && categories.includes(t.category))
        : all,
    [all, categories]
  );

  // Group by category; only include categories that actually have tokens
  const categoryOrder: TokenCategory[] = categories?.length
    ? categories
    : DEFAULT_CATEGORY_ORDER;

  const grouped = useMemo(() => {
    const map = new Map<TokenCategory, TokenMeta[]>();
    for (const cat of categoryOrder) map.set(cat, []);
    for (const t of filtered) {
      if (!t.category) continue;
      if (!map.has(t.category)) continue;
      map.get(t.category)!.push(t);
    }
    return categoryOrder
      .map((c) => [c, map.get(c)!] as const)
      .filter(([, arr]) => arr.length > 0);
  }, [filtered, categoryOrder]);

  /* ------------------------------ live prices ------------------------------ */

  const priceIds = useMemo(() => {
    const s = new Set<string>();
    for (const [, tokens] of grouped) {
      for (const t of tokens) {
        const id = getMintFor(t, "mainnet");
        if (id) s.add(id);
      }
    }
    return Array.from(s);
  }, [grouped]);

  const [prices, setPrices] = useState<JupPriceResponse>({});
  const [pricesLoading, setPricesLoading] = useState(false);
  const [pricesError, setPricesError] = useState<string | null>(null);

  const fetchPrices = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    setPricesLoading(true);
    setPricesError(null);
    try {
      const url = `${JUP_PRICE_BASE}?ids=${ids.join(",")}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Jupiter price error ${res.status}`);
      const j = (await res.json()) as JupPriceResponse;
      setPrices(j || {});
    } catch (e) {
      setPricesError(e instanceof Error ? e.message : String(e));
      setPrices({});
    } finally {
      setPricesLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPrices(priceIds);
  }, [priceIds, fetchPrices]);

  useEffect(() => {
    if (!pollMs || pollMs <= 0) return;
    if (!priceIds.length) return;
    const id = setInterval(() => void fetchPrices(priceIds), pollMs);
    return () => clearInterval(id);
  }, [priceIds, pollMs, fetchPrices]);

  /* ------------------------------ USD → display FX ------------------------- */

  const [fxRate, setFxRate] = useState<number>(1);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (displayCurrency === "USD") {
        setFxRate(1);
        return;
      }
      try {
        if (!privyReady || !authenticated) throw new Error("no auth");
        const token = await getAccessToken();
        const r = await fetch(
          `/api/fx?currency=${encodeURIComponent(displayCurrency)}&amount=1`,
          {
            credentials: "include",
            cache: "no-store",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }
        );
        if (!r.ok) throw new Error(`fx ${r.status}`);
        const j = await r.json();
        if (!cancelled) setFxRate(Number(j?.rate || 1));
      } catch {
        if (!cancelled) setFxRate(1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [displayCurrency, getAccessToken, privyReady, authenticated]);

  /* ------------------------------ collapse state --------------------------- */

  const STORAGE_KEY = "invest.tokens.collapsed";
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw == null) return defaultCollapsed;
      return raw === "1";
    } catch {
      return defaultCollapsed;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  /* ------------------------------ UI helpers ------------------------------ */

  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<TokenMeta | null>(null);

  const openBuy = (t: TokenMeta) => {
    setSelected(t);
    setModalOpen(true);
  };
  const closeModal = () => {
    setModalOpen(false);
    setSelected(null);
  };

  const fmtMoney = (v?: number | null) => {
    if (v == null || !Number.isFinite(v)) return "—";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: displayCurrency,
        maximumFractionDigits: v < 1 ? 6 : 2,
      }).format(v);
    } catch {
      return `${displayCurrency} ${v.toFixed(2)}`;
    }
  };

  const fmtChange = (p?: number) => {
    if (typeof p !== "number" || !Number.isFinite(p)) return null;
    const sign = p === 0 ? "" : p > 0 ? "+" : "";
    return `${sign}${p.toFixed(2)}%`;
  };

  /* -------------------------------- render -------------------------------- */

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-zinc-900/70 backdrop-blur-xl shadow-2xl ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[rgb(182,255,62)]/20 to-transparent border border-[rgb(182,255,62)]/30 flex items-center justify-center">
            <span className="text-[rgb(182,255,62)] font-bold text-xs">
              INV
            </span>
          </div>
          <div>
            <div className="text-white font-semibold leading-tight">Invest</div>
            <div className="text-[11px] text-zinc-400 leading-tight">
              Buy top tokens with one tap. Gas sponsored.
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchPrices(priceIds)}
            disabled={pricesLoading || !priceIds.length}
            className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/10 text-white/80 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${pricesLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg bg-[rgb(182,255,62)] text-black font-semibold hover:bg-[rgb(182,255,62)]/90"
            aria-expanded={!collapsed}
            aria-controls="invest-token-list"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${
                collapsed ? "-rotate-90" : ""
              }`}
            />
            {collapsed ? "Expand" : "Collapse"}
          </button>
        </div>
      </div>

      {/* Body */}
      <div
        id="invest-token-list"
        className={`transition-[max-height,opacity] duration-300 ease-out ${
          collapsed
            ? "max-h-0 opacity-0 overflow-hidden"
            : "max-h-[4000px] opacity-100"
        }`}
      >
        <div className="p-4">
          {grouped.length === 0 ? (
            <div className="text-sm text-zinc-400">
              No tokens are enabled for {cluster}. Add mints to{" "}
              <code>mints.{cluster}</code> in <code>/lib/tokens.ts</code>.
            </div>
          ) : (
            <div className="space-y-6">
              {grouped.map(([cat, tokens]) => (
                <section key={cat}>
                  <h4 className="mb-2 text-xs font-semibold tracking-wider text-zinc-400 uppercase">
                    {cat}
                  </h4>

                  {/* Grid */}
                  <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {tokens.map((t) => {
                      const mainnetMint = getMintFor(t, "mainnet");
                      const p = mainnetMint ? prices[mainnetMint] : undefined;
                      const usd = p?.usdPrice;
                      const local =
                        typeof usd === "number" ? usd * fxRate : undefined;
                      const change = p?.priceChange24h;
                      const changeStr = fmtChange(change);
                      const changeColor =
                        typeof change === "number"
                          ? change > 0
                            ? "text-emerald-400"
                            : change < 0
                            ? "text-red-400"
                            : "text-zinc-400"
                          : "text-zinc-500";

                      return (
                        <li
                          key={`${t.symbol}-${mainnetMint ?? "nomint"}`}
                          className="rounded-xl border border-white/10 bg-zinc-900/60 hover:bg-zinc-900/80 transition-colors p-3 flex items-center gap-3"
                        >
                          <Image
                            src={
                              t.logo ||
                              "https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/default.png"
                            }
                            alt={`${t.name} logo`}
                            width={36}
                            height={36}
                            className="h-9 w-9 rounded-full border border-white/10 object-contain bg-zinc-800"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-white font-medium truncate">
                                {t.name}
                              </span>
                              <span className="text-xs text-zinc-400">
                                ({t.symbol})
                              </span>
                            </div>
                            <div className="mt-0.5 text-[12px] text-zinc-400 flex items-center gap-2">
                              <span className="text-white/90 font-medium">
                                {fmtMoney(local)}
                              </span>
                              {changeStr && (
                                <span className={`text-[11px] ${changeColor}`}>
                                  {changeStr}
                                </span>
                              )}
                              {pricesLoading && (
                                <span className="text-[10px] text-zinc-500">
                                  • updating…
                                </span>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => openBuy(t)}
                            className="text-sm px-3 py-1.5 rounded-lg bg-[rgb(182,255,62)] text-black font-semibold hover:bg-[rgb(182,255,62)]/90 transition-colors"
                          >
                            Buy
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
              {pricesError && (
                <div className="text-xs text-red-400">
                  Failed to fetch prices: {pricesError}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Buy modal */}
      {modalOpen && selected && (
        <BuyModal
          token={selected}
          displayCurrency={displayCurrency}
          fxRate={fxRate}
          jupQuoteBase={JUP_QUOTE_BASE}
          jupPriceBase={JUP_PRICE_BASE}
          onClose={closeModal}
          onConfirm={(amountFiat) => {
            onStartBuy?.({ token: selected, amountFiat });
            closeModal();
          }}
        />
      )}
    </div>
  );
}

/* --------------------------- buy modal w/ quotes -------------------------- */

function BuyModal({
  token,
  displayCurrency,
  fxRate,
  jupQuoteBase,
  jupPriceBase,
  onClose,
  onConfirm,
}: {
  token: TokenMeta;
  displayCurrency: string;
  fxRate: number; // USD→display
  jupQuoteBase: string;
  jupPriceBase: string;
  onClose: () => void;
  onConfirm: (amountFiat: number) => void;
}) {
  const [amountStr, setAmountStr] = useState<string>("50");
  const amountDisplay = Number(amountStr);
  const spendValid =
    Number.isFinite(amountDisplay) &&
    amountDisplay > FLAT_FEE_USD * (displayCurrency === "USD" ? 1 : fxRate);

  const outputMint = getMintFor(token, "mainnet") || ""; // quote on mainnet mints
  const [outDecimals, setOutDecimals] = useState<number | null>(null);
  const [quote, setQuote] = useState<JupQuote>(null);
  const [qLoading, setQLoading] = useState(false);
  const [qError, setQError] = useState<string | null>(null);

  // one-time (per token) decimals fetch via Price API (to format outAmount)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!outputMint) return;
      try {
        const res = await fetch(`${jupPriceBase}?ids=${outputMint}`, {
          cache: "no-store",
        });
        const j = (await res.json()) as JupPriceResponse;
        if (!cancelled) setOutDecimals(j?.[outputMint]?.decimals ?? 6);
      } catch {
        if (!cancelled) setOutDecimals(6);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [outputMint, jupPriceBase]);

  // compute net-USDC input (after flat $0.20 fee)
  const computeInAmountRaw = (): number => {
    if (!spendValid) return 0;
    // display → USD
    const amountUsdGross =
      displayCurrency === "USD" ? amountDisplay : amountDisplay / fxRate;
    const amountUsdNet = Math.max(0, amountUsdGross - FLAT_FEE_USD);
    // USDC ~ USD; convert to raw
    return Math.floor(amountUsdNet * 10 ** USDC_DECIMALS);
  };

  // debounced auto-quote whenever amount changes
  useEffect(() => {
    if (!outputMint) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        setQLoading(true);
        setQError(null);
        setQuote(null);

        const inAmount = computeInAmountRaw();
        if (!inAmount || inAmount <= 0) {
          setQLoading(false);
          return;
        }

        const url = `${jupQuoteBase}?inputMint=${USDC_MAINNET}&outputMint=${outputMint}&amount=${inAmount}&slippageBps=50&restrictIntermediateTokens=true`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`quote ${res.status}`);
        const j = (await res.json()) as JupQuote;

        if (!cancelled) setQuote(j);
      } catch (e) {
        if (!cancelled) setQError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setQLoading(false);
      }
    }, 350);

    return () => {
      clearTimeout(t);
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountStr, displayCurrency, fxRate, outputMint, jupQuoteBase]);

  const outAmountUi =
    quote && outDecimals != null
      ? Number(quote.outAmount) / 10 ** outDecimals
      : null;

  const feeInDisplay =
    displayCurrency === "USD" ? FLAT_FEE_USD : FLAT_FEE_USD * fxRate;

  const fmtToken = (v?: number | null) => {
    if (v == null || !Number.isFinite(v)) return "—";
    const dp = v < 1 ? 6 : 4;
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: dp,
    }).format(v);
  };

  const canSwap = spendValid && !!quote && !qLoading;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-md mx-4 rounded-2xl border border-white/10 bg-zinc-900/95 p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h4 className="text-white font-semibold">Buy {token.name}</h4>
          <button
            aria-label="Close"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-zinc-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 flex items-start gap-3">
          <Image
            src={
              token.logo ||
              "https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/default.png"
            }
            alt={`${token.name} logo`}
            width={40}
            height={40}
            className="h-10 w-10 rounded-lg border border-white/10 object-contain bg-zinc-800"
          />
        </div>

        <div className="mt-5 space-y-2">
          <label className="text-sm text-zinc-300">
            Spend ({displayCurrency})
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-800/60 px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/50 focus:border-[rgb(182,255,62)]"
            placeholder="0.00"
            inputMode="decimal"
          />

          <div className="text-[11px] text-zinc-500">
            Flat fee:{" "}
            <span className="text-white/80">
              {new Intl.NumberFormat(undefined, {
                style: "currency",
                currency: displayCurrency,
                maximumFractionDigits: 2,
              }).format(feeInDisplay)}
            </span>{" "}
            (deducted from what’s swapped)
          </div>

          {/* Quote panel */}
          <div className="mt-3 rounded-lg border border-white/10 bg-zinc-800/40 p-3">
            {!spendValid ? (
              <div className="text-xs text-red-400">
                Enter an amount greater than the fee.
              </div>
            ) : qLoading ? (
              <div className="text-xs text-white/70">Fetching quote…</div>
            ) : qError ? (
              <div className="text-xs text-red-400">Quote failed: {qError}</div>
            ) : quote && outAmountUi != null ? (
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Estimated receive:</span>
                  <span className="text-white font-medium">
                    {fmtToken(outAmountUi)} {token.symbol}
                  </span>
                </div>
                {quote.priceImpactPct && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-500">Price impact:</span>
                    <span className="text-zinc-300">
                      {(Number(quote.priceImpactPct) * 100).toFixed(2)}%
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-white/60">
                Enter an amount to see a quote.
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm rounded-lg border border-white/10 text-white/80 hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSwap}
            onClick={() => onConfirm(amountDisplay)}
            className="px-3 py-2 text-sm rounded-lg bg-[rgb(182,255,62)] text-black font-semibold hover:bg-[rgb(182,255,62)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Swap
          </button>
        </div>
      </div>
    </div>
  );
}
