"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  X,
  Search,
  TrendingUp,
  TrendingDown,
  Activity,
  DollarSign,
  Sparkles,
} from "lucide-react";
import {
  type TokenMeta,
  tokensForCluster,
  getMintFor,
  type TokenCategory,
} from "@/lib/tokens";
import { useUser } from "@/providers/UserProvider";
import { usePrivy } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { useServerSponsoredJupSwap } from "@/hooks/useServerSponsoredJupSwap";
import { toast } from "react-hot-toast";
import { useBalances } from "@/providers/BalanceProvider";

/* ------------------------------- config ---------------------------------- */

type Props = {
  onStartBuy?: (args: { token: TokenMeta; amountFiat: number }) => void;
  categories?: TokenCategory[];
  pollMs?: number;
  className?: string;
};

const DEFAULT_CATEGORY_ORDER: TokenCategory[] = [
  "Top 3",
  "DeFi",
  "Meme",
  "Stocks",
];
const MAINNET = "mainnet";

// Jupiter Lite endpoints for price/quote PREVIEW (server builds the real swap)
const JUP_PRICE_BASE =
  process.env.NEXT_PUBLIC_JUP_PRICE_BASE || "https://lite-api.jup.ag/price/v3";
const JUP_QUOTE_BASE =
  process.env.NEXT_PUBLIC_JUP_QUOTE_BASE ||
  "https://lite-api.jup.ag/swap/v1/quote";

// Base mint for preview math only; server enforces everything
const USDC_MAINNET =
  process.env.NEXT_PUBLIC_USDC_MAINNET_MINT ||
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;

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

/* ------------------------------- page ---------------------------------- */

export default function TokenCatalog({
  onStartBuy,
  categories,
  pollMs = 45_000,
  className = "",
}: Props) {
  const { user } = useUser();
  const { getAccessToken, ready: privyReady, authenticated } = usePrivy();
  const { wallets } = useSolanaWallets();
  const { deposit } = useBalances(); // from BalanceProvider

  const displayCurrency = (user?.displayCurrency || "USD").toUpperCase();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<
    TokenCategory | "All"
  >("All");

  // prefer app deposit wallet -> user's primary wallet -> first Privy Solana wallet
  const depositOwnerBase58 = useMemo(() => {
    const depositAddress = user?.depositWallet?.address;
    const fallbackPrivyAddress = wallets[0]?.address;
    return depositAddress || fallbackPrivyAddress || "";
  }, [user?.depositWallet?.address, wallets]);

  // force mainnet token list
  const all = useMemo(() => tokensForCluster(MAINNET), []);

  const filtered = useMemo(() => {
    let tokens = categories?.length
      ? all.filter((t) => t.category && categories.includes(t.category))
      : all;

    if (selectedCategory !== "All") {
      tokens = tokens.filter((t) => t.category === selectedCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      tokens = tokens.filter(
        (t) =>
          t.name.toLowerCase().includes(q) || t.symbol.toLowerCase().includes(q)
      );
    }

    return tokens;
  }, [all, categories, selectedCategory, searchQuery]);

  const categoryOrder: TokenCategory[] = categories?.length
    ? categories
    : DEFAULT_CATEGORY_ORDER;
  const displayTokens = useMemo(() => filtered, [filtered]);

  /* ------------------------------ live prices ------------------------------ */

  const priceIds = useMemo(() => {
    const s = new Set<string>();
    for (const t of displayTokens) {
      const id = getMintFor(t, MAINNET);
      if (id) s.add(id);
    }
    return Array.from(s);
  }, [displayTokens]);

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
    if (!pollMs || pollMs <= 0 || !priceIds.length) return;
    const id = setInterval(() => void fetchPrices(priceIds), pollMs);
    return () => clearInterval(id);
  }, [priceIds, pollMs, fetchPrices]);

  /* ------------------------------ FX: base → display ----------------------- */

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
      return `${displayCurrency} ${Number(v).toFixed(2)}`;
    }
  };

  const fmtChange = (p?: number) => {
    if (typeof p !== "number" || !Number.isFinite(p)) return null;
    const sign = p === 0 ? "" : p > 0 ? "+" : "";
    return `${sign}${p.toFixed(2)}%`;
  };

  const marketStats = useMemo(() => {
    let totalGainers = 0;
    let totalLosers = 0;
    let avgChange = 0;
    let count = 0;

    displayTokens.forEach((t) => {
      const mainnetMint = getMintFor(t, MAINNET);
      const p = mainnetMint ? prices[mainnetMint] : undefined;
      const change = p?.priceChange24h;
      if (typeof change === "number" && Number.isFinite(change)) {
        if (change > 0) totalGainers++;
        if (change < 0) totalLosers++;
        avgChange += change;
        count++;
      }
    });

    return {
      totalTokens: displayTokens.length,
      gainers: totalGainers,
      losers: totalLosers,
      avgChange: count > 0 ? avgChange / count : 0,
    };
  }, [displayTokens, prices]);

  /* -------------------------------- render -------------------------------- */

  return (
    <div
      className={`min-h-screen bg-gradient-to-b from-black via-black to-[rgb(182,255,62)]/5 ${
        className || ""
      }`}
    >
      <div className="border-b border-white/10 bg-black/60 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-6 lg:py-8">
          {/* Market Overview Stats */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
            <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent p-4 backdrop-blur-sm transition-all hover:border-[rgb(182,255,62)]/30 hover:shadow-lg hover:shadow-[rgb(182,255,62)]/10">
              <div className="absolute inset-0 bg-gradient-to-br from-[rgb(182,255,62)]/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <div className="relative">
                <div className="mb-2 flex items-center gap-2">
                  <div className="rounded-lg bg-[rgb(182,255,62)]/10 p-2">
                    <Activity className="h-4 w-4 text-[rgb(182,255,62)]" />
                  </div>
                  <span className="text-xs font-medium text-white/60">
                    Markets
                  </span>
                </div>
                <div className="text-2xl font-bold text-white">
                  {marketStats.totalTokens}
                </div>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent p-4 backdrop-blur-sm transition-all hover:border-green-500/30 hover:shadow-lg hover:shadow-green-500/10">
              <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <div className="relative">
                <div className="mb-2 flex items-center gap-2">
                  <div className="rounded-lg bg-green-500/10 p-2">
                    <TrendingUp className="h-4 w-4 text-green-400" />
                  </div>
                  <span className="text-xs font-medium text-white/60">
                    Gainers
                  </span>
                </div>
                <div className="text-2xl font-bold text-green-400">
                  {marketStats.gainers}
                </div>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent p-4 backdrop-blur-sm transition-all hover:border-red-500/30 hover:shadow-lg hover:shadow-red-500/10">
              <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <div className="relative">
                <div className="mb-2 flex items-center gap-2">
                  <div className="rounded-lg bg-red-500/10 p-2">
                    <TrendingDown className="h-4 w-4 text-red-400" />
                  </div>
                  <span className="text-xs font-medium text-white/60">
                    Losers
                  </span>
                </div>
                <div className="text-2xl font-bold text-red-400">
                  {marketStats.losers}
                </div>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent p-4 backdrop-blur-sm transition-all hover:border-[rgb(182,255,62)]/30 hover:shadow-lg hover:shadow-[rgb(182,255,62)]/10">
              <div className="absolute inset-0 bg-gradient-to-br from-[rgb(182,255,62)]/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <div className="relative">
                <div className="mb-2 flex items-center gap-2">
                  <div className="rounded-lg bg-[rgb(182,255,62)]/10 p-2">
                    <Activity className="h-4 w-4 text-[rgb(182,255,62)]" />
                  </div>
                  <span className="text-xs font-medium text-white/60">
                    Avg 24h
                  </span>
                </div>
                <div
                  className={`text-2xl font-bold ${
                    marketStats.avgChange >= 0
                      ? "text-green-400"
                      : "text-red-400"
                  }`}
                >
                  {fmtChange(marketStats.avgChange)}
                </div>
              </div>
            </div>
          </div>

          {/* Search and Filters */}
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-6">
            {/* Search */}
            <div className="relative flex-1">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-[rgb(182,255,62)]/10 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <div className="group relative">
                <Search className="absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-white/40 transition-colors group-focus-within:text-[rgb(182,255,62)]" />
                <input
                  type="text"
                  placeholder="Search tokens by name or symbol..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 py-3.5 pl-12 pr-4 text-white placeholder-white/40 backdrop-blur-xl transition-all focus:border-[rgb(182,255,62)]/50 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/20"
                />
              </div>
            </div>

            {/* Categories */}
            <div className="flex flex-wrap gap-2 lg:gap-3">
              <button
                onClick={() => setSelectedCategory("All")}
                className={`group relative overflow-hidden rounded-full px-5 py-2.5 text-sm font-bold transition-all ${
                  selectedCategory === "All"
                    ? "bg-[rgb(182,255,62)] text-black shadow-lg shadow-[rgb(182,255,62)]/30"
                    : "border border-white/20 bg-white/5 text-white/70 hover:border-[rgb(182,255,62)]/50 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span className="relative z-10">All Markets</span>
                {selectedCategory === "All" && (
                  <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                )}
              </button>
              {categoryOrder.map((c) => (
                <button
                  key={c}
                  onClick={() => setSelectedCategory(c)}
                  className={`group relative overflow-hidden rounded-full px-5 py-2.5 text-sm font-bold transition-all whitespace-nowrap ${
                    selectedCategory === c
                      ? "bg-[rgb(182,255,62)] text-black shadow-lg shadow-[rgb(182,255,62)]/30"
                      : "border border-white/20 bg-white/5 text-white/70 hover:border-[rgb(182,255,62)]/50 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <span className="relative z-10">{c}</span>
                  {selectedCategory === c && (
                    <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {pricesLoading && (
            <div className="mt-4 flex items-center gap-2 text-sm text-[rgb(182,255,62)]">
              <div className="h-2 w-2 animate-pulse rounded-full bg-[rgb(182,255,62)]" />
              <span className="font-medium">Updating live prices...</span>
            </div>
          )}
        </div>
      </div>

      <main className="container mx-auto px-4 py-8">
        {!displayTokens.length ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="mb-4 rounded-full bg-white/5 p-6">
              <Search className="h-12 w-12 text-white/40" />
            </div>
            <h3 className="mb-2 text-xl font-bold text-white">
              No tokens found
            </h3>
            <p className="text-white/60">
              Try adjusting your search or filters
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {displayTokens.map((t) => {
              const mainnetMint = getMintFor(t, MAINNET);
              const p = mainnetMint ? prices[mainnetMint] : undefined;
              const usd = p?.usdPrice;
              const local = typeof usd === "number" ? usd * fxRate : undefined;
              const change = p?.priceChange24h;
              const changeStr = fmtChange(change);
              const isPositive = typeof change === "number" && change > 0;
              const isNegative = typeof change === "number" && change < 0;
              const changeColor = isPositive
                ? "text-green-400"
                : isNegative
                ? "text-red-400"
                : "text-white/60";

              const disabled =
                !mainnetMint ||
                !depositOwnerBase58 ||
                !privyReady ||
                !authenticated;

              return (
                <Link
                  key={`${t.symbol}-${mainnetMint ?? "nomint"}`}
                  href={`/invest/${t.symbol.toLowerCase()}`}
                  className="group relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/5 via-white/[0.02] to-transparent p-5 backdrop-blur-xl transition-all duration-300 hover:border-[rgb(182,255,62)]/40 hover:shadow-2xl hover:shadow-[rgb(182,255,62)]/10 hover:-translate-y-1"
                  aria-label={`Open ${t.name} chart`}
                >
                  {/* Animated gradient overlay on hover */}
                  <div className="absolute inset-0 bg-gradient-to-br from-[rgb(182,255,62)]/5 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                  {/* Shimmer effect */}
                  <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />

                  <div className="relative">
                    {/* Header with logo and category */}
                    <div className="mb-4 flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="absolute inset-0 rounded-2xl bg-[rgb(182,255,62)]/20 blur-xl opacity-0 transition-opacity group-hover:opacity-100" />
                          <Image
                            src={
                              t.logo ||
                              "https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/default.png" ||
                              "/placeholder.svg"
                            }
                            alt={`${t.name} logo`}
                            width={48}
                            height={48}
                            className="relative h-12 w-12 rounded-2xl border border-white/20 bg-white/5 object-contain p-1.5 transition-transform group-hover:scale-110"
                          />
                          {pricesLoading && (
                            <div className="absolute -right-1 -top-1 h-3 w-3 animate-pulse rounded-full bg-[rgb(182,255,62)] ring-2 ring-black" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-bold text-white group-hover:text-[rgb(182,255,62)] transition-colors">
                            {t.name}
                          </h3>
                          <p className="text-xs font-medium text-white/50">
                            {t.symbol}
                          </p>
                        </div>
                      </div>
                      {t.category && (
                        <span className="rounded-lg bg-[rgb(182,255,62)]/10 px-2.5 py-1 text-xs font-bold text-[rgb(182,255,62)] border border-[rgb(182,255,62)]/20">
                          {t.category}
                        </span>
                      )}
                    </div>

                    {/* Price section */}
                    <div className="mb-4 space-y-2">
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-white">
                          {fmtMoney(local)}
                        </span>
                      </div>
                      {changeStr && (
                        <div
                          className={`flex items-center gap-1.5 text-sm font-bold ${changeColor}`}
                        >
                          {isPositive && <TrendingUp className="h-4 w-4" />}
                          {isNegative && <TrendingDown className="h-4 w-4" />}
                          <span>{changeStr}</span>
                          <span className="text-xs font-normal text-white/40">
                            24h
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Divider */}
                    <div className="mb-4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                    {/* Action button */}
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openBuy(t);
                      }}
                      disabled={disabled}
                      className="group/btn relative w-full overflow-hidden rounded-xl border border-[rgb(182,255,62)]/30 bg-[rgb(182,255,62)]/10 py-3 font-bold text-[rgb(182,255,62)] transition-all hover:border-[rgb(182,255,62)]/60 hover:bg-[rgb(182,255,62)]/20 hover:shadow-lg hover:shadow-[rgb(182,255,62)]/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[rgb(182,255,62)]/10"
                      aria-label={`Buy ${t.symbol}`}
                    >
                      <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-500 group-hover/btn:translate-x-full" />
                      <span className="relative z-10 flex items-center justify-center gap-2">
                        <DollarSign className="h-4 w-4" />
                        Buy {t.symbol}
                      </span>
                    </button>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {pricesError && (
          <div className="mt-8 overflow-hidden rounded-2xl border border-red-500/30 bg-gradient-to-br from-red-500/10 to-transparent p-6 backdrop-blur-xl">
            <div className="flex items-start gap-4">
              <div className="rounded-full bg-red-500/20 p-3">
                <Activity className="h-6 w-6 text-red-400" />
              </div>
              <div className="flex-1">
                <h3 className="mb-2 text-lg font-bold text-red-300">
                  Price Feed Unavailable
                </h3>
                <p className="mb-3 text-sm text-red-200/80">{pricesError}</p>
                <button
                  onClick={() => fetchPrices(priceIds)}
                  className="rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-300 transition-colors hover:bg-red-500/20"
                >
                  Retry Connection
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Buy modal */}
      {modalOpen && selected && (
        <BuyModal
          token={selected}
          displayCurrency={displayCurrency}
          fxRate={fxRate}
          jupQuoteBase={JUP_QUOTE_BASE}
          jupPriceBase={JUP_PRICE_BASE}
          depositOwnerBase58={depositOwnerBase58}
          depositAmountUsd={deposit.amountUsd} // base balance from BalanceProvider
          getAccessToken={getAccessToken}
          onClose={closeModal}
          onConfirm={(amountFiat) =>
            onStartBuy?.({ token: selected, amountFiat })
          }
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
  depositOwnerBase58,
  depositAmountUsd,
  getAccessToken,
  onClose,
  onConfirm,
}: {
  token: TokenMeta;
  displayCurrency: string;
  fxRate: number; // base → display
  jupQuoteBase: string;
  jupPriceBase: string;
  depositOwnerBase58: string;
  depositAmountUsd: number; // base balance from BalanceProvider
  getAccessToken: () => Promise<string | null>;
  onClose: () => void;
  onConfirm: (amountFiat: number) => void;
}) {
  const {
    swap,
    loading: swapping,
    signature,
    error: swapError,
  } = useServerSponsoredJupSwap();

  const [amountStr, setAmountStr] = useState<string>("50");
  const amountDisplay = Number(amountStr);

  const outputMint = getMintFor(token, MAINNET) || ""; // mainnet mint only
  const [outDecimals, setOutDecimals] = useState<number | null>(null);
  const [quote, setQuote] = useState<JupQuote>(null);
  const [qLoading, setQLoading] = useState(false);
  const [qError, setQError] = useState<string | null>(null);

  // derived: deposit balance in user display currency
  const depositLocal = depositAmountUsd * (fxRate || 1);

  const shortAddress =
    depositOwnerBase58 && depositOwnerBase58.length > 8
      ? `${depositOwnerBase58.slice(0, 4)}…${depositOwnerBase58.slice(-4)}`
      : depositOwnerBase58 || "—";

  // ---- Fee model: same tiered logic as SellModal ----
  // Work in base currency (pegged to 1 unit of deposit balance ≈ 1 USD)
  const amountBaseGross =
    Number.isFinite(amountDisplay) && amountDisplay > 0
      ? displayCurrency === "USD"
        ? amountDisplay
        : amountDisplay / (fxRate || 1)
      : 0;

  // 1% for trades under 1000 base, 0.5% for >= 1000 (same as sell)
  const feeRate =
    amountBaseGross > 0 ? (amountBaseGross < 1000 ? 0.01 : 0.005) : 0;

  const feeBase = amountBaseGross * feeRate;
  const amountBaseNet = Math.max(0, amountBaseGross - feeBase);

  const feeInDisplay = feeBase * (displayCurrency === "USD" ? 1 : fxRate || 1);

  const netAfterFeeDisplay =
    amountBaseNet * (displayCurrency === "USD" ? 1 : fxRate || 1);

  const spendValid = amountBaseNet > 0;

  const feePct = feeRate * 100;

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

  const computeInAmountRaw = (): number => {
    if (!spendValid) return 0;
    if (!Number.isFinite(amountBaseNet) || amountBaseNet <= 0) return 0;
    // amountBaseNet is in base units (~1 = 1 deposit unit), map to USDC base units
    return Math.floor(amountBaseNet * 10 ** USDC_DECIMALS);
  };

  async function fetchJupQuoteRobust({
    jupQuoteBase,
    inputMint,
    outputMint,
    inAmount,
  }: {
    jupQuoteBase: string;
    inputMint: string;
    outputMint: string;
    inAmount: number; // raw (base units)
  }) {
    // Skip tiny values (< 1 cent) which usually fail to route
    if (!inAmount || inAmount < 10_000) {
      throw new Error("Amount too small for a route. Try a larger amount.");
    }

    // 1) Try lite-api GET first
    const p1 = new URLSearchParams({
      inputMint,
      outputMint,
      amount: String(inAmount),
      slippageBps: "50",
      swapMode: "ExactIn",
    });
    try {
      const res = await fetch(`${jupQuoteBase}?${p1.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        let message = `Lite quote ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error || body?.message) {
            message += `: ${body.error || body.message}`;
          }
        } catch {}
        throw new Error(message);
      }
      const j = await res.json();
      if (j && j.outAmount) return j;
      if (j?.data?.outAmount) return j.data;
      if (Array.isArray(j?.data) && j.data[0]?.outAmount) return j.data[0];
      throw new Error("Lite quote: empty response");
    } catch {
      // fall through to v6 POST
    }

    // 2) Fallback to v6 official quote API
    const resV6 = await fetch("https://quote-api.jup.ag/v6/quote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        inputMint,
        outputMint,
        amount: inAmount,
        slippageBps: 50,
        swapMode: "ExactIn",
        onlyDirectRoutes: false,
        asLegacyTransaction: false,
      }),
    });
    if (!resV6.ok) {
      let message = `Jupiter v6 quote ${resV6.status}`;
      try {
        const body = await resV6.json();
        if (body?.error || body?.message) {
          message += `: ${body.error || body.message}`;
        }
      } catch {}
      throw new Error(message);
    }
    const j6 = await resV6.json();
    if (j6 && j6.outAmount) return j6;
    throw new Error("Jupiter v6 quote: empty response");
  }

  // Quote base-token -> target token for the preview panel (debounced, robust)
  useEffect(() => {
    if (!outputMint) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        setQLoading(true);
        setQError(null);
        setQuote(null);

        const inAmount = computeInAmountRaw();
        if (!inAmount || inAmount <= 0) {
          setQLoading(false);
          return;
        }

        const q = await fetchJupQuoteRobust({
          jupQuoteBase,
          inputMint: USDC_MAINNET,
          outputMint,
          inAmount,
        });

        if (!cancelled) setQuote(q as JupQuote);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setQError(msg);
        }
      } finally {
        if (!cancelled) setQLoading(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountStr, displayCurrency, fxRate, outputMint, jupQuoteBase]);

  const outAmountUi =
    quote && outDecimals != null
      ? Number(quote.outAmount) / 10 ** (outDecimals || 6)
      : null;

  const fmtToken = (v?: number | null) =>
    v == null || !Number.isFinite(v)
      ? "—"
      : new Intl.NumberFormat(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: v < 1 ? 6 : 4,
        }).format(v);

  const canSwap =
    !!depositOwnerBase58 &&
    spendValid &&
    !!quote &&
    !qLoading &&
    !!outputMint &&
    !swapping;

  const onBuy = useCallback(async () => {
    if (!canSwap || !outputMint) return;

    const toastId = toast.loading(`Buying ${token.symbol}…`);

    try {
      const accessToken = await getAccessToken().catch(() => null);
      const res = await swap({
        fromOwnerBase58: depositOwnerBase58,
        outputMint,
        amountDisplay, // user-entered in display currency
        fxRate, // display → base
        accessToken,
      });

      const sigFromCall = res as string | null;
      const sig = sigFromCall || signature;
      const tail = sig ? ` • ${sig.slice(0, 6)}…${sig.slice(-6)}` : "";

      toast.success(`Purchase submitted${tail}`, { id: toastId });

      onConfirm(amountDisplay);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e || "Failed");
      toast.error(`Purchase failed: ${msg}`, { id: toastId });
    }
  }, [
    canSwap,
    outputMint,
    getAccessToken,
    swap,
    depositOwnerBase58,
    amountDisplay,
    fxRate,
    onConfirm,
    onClose,
    token.symbol,
    signature,
  ]);

  const formatDisplayMoney = (v: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: displayCurrency,
      maximumFractionDigits: 2,
    }).format(v);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
    >
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-2xl"
        onClick={onClose}
        aria-hidden
      />

      <div className="pointer-events-auto relative w-full max-w-md overflow-hidden rounded-3xl border border-white/20 bg-gradient-to-br from-black via-black to-[rgb(182,255,62)]/5 shadow-2xl shadow-black/50 backdrop-blur-3xl">
        {/* Animated gradient border effect */}
        <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-[rgb(182,255,62)]/20 via-transparent to-transparent opacity-50" />

        <div className="relative p-6">
          {/* Header */}
          <div className="mb-4 flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="absolute inset-0 rounded-2xl bg-[rgb(182,255,62)]/30 blur-xl" />
                <Image
                  src={
                    token.logo ||
                    "https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/default.png" ||
                    "/placeholder.svg"
                  }
                  alt={`${token.name} logo`}
                  width={56}
                  height={56}
                  className="relative h-14 w-14 rounded-2xl border border-white/20 bg-white/5 object-contain p-2"
                />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">
                  Buy {token.name}
                </h2>
                <p className="text-sm text-white/60">{token.symbol}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl p-2 text-white/60 transition-all hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Deposit wallet + balance */}
          <div className="mb-6 flex items-start justify-between gap-3 rounded-2xl border border-white/15 bg-white/5 p-3 text-xs text-white/70">
            <div>
              <div className="mb-1 text-[0.72rem] font-semibold uppercase tracking-wide text-white/50">
                Deposit wallet
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[0.76rem] text-white/80">
                  {shortAddress}
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="mb-1 text-[0.72rem] font-semibold uppercase tracking-wide text-white/50">
                Available to spend
              </div>
              <div className="text-xs font-semibold text-white">
                {formatDisplayMoney(depositLocal)}
              </div>
            </div>
          </div>

          {/* Amount Input */}
          <div className="mb-6">
            <label className="mb-3 flex items-center justify-between text-sm font-bold text-white">
              <span>You Pay</span>
              <span className="text-white/60">{displayCurrency}</span>
            </label>
            <div className="relative">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-[rgb(182,255,62)]/10 to-transparent opacity-0 transition-opacity focus-within:opacity-100" />
              <input
                type="number"
                min="0"
                step="0.01"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                className="relative w-full rounded-2xl border border-white/20 bg-white/5 px-5 py-4 text-2xl font-bold text-white placeholder-white/40 backdrop-blur-xl transition-all focus:border-[rgb(182,255,62)]/50 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/20"
                placeholder="0.00"
                inputMode="decimal"
              />
            </div>

            {/* Fee breakdown */}
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/70 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-medium text-white/80">
                  Haven fee (only if purchase succeeds)
                </span>
                <span className="font-semibold text-white">
                  {feeInDisplay > 0 ? formatDisplayMoney(feeInDisplay) : "—"}
                  {feePct > 0 ? ` · ${feePct.toFixed(2)}%` : ""}
                </span>
              </div>
              <div className="flex items-center justify-between text-[0.7rem]">
                <span>Net amount routed into {token.symbol}</span>
                <span className="font-mono text-white/80">
                  {netAfterFeeDisplay > 0
                    ? `${formatDisplayMoney(netAfterFeeDisplay)}`
                    : "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Quote Display */}
          <div className="mb-6 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl">
            {!spendValid ? (
              <div className="p-6 text-center">
                <div className="mb-2 inline-flex rounded-full bg-yellow-500/10 p-3">
                  <Sparkles className="h-6 w-6 text-yellow-400" />
                </div>
                <p className="text-sm font-medium text-yellow-200">
                  Enter an amount large enough to cover the Haven fee.
                </p>
              </div>
            ) : qLoading ? (
              <div className="p-6">
                <div className="mb-3 flex items-center justify-center gap-2 text-white/80">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-[rgb(182,255,62)]" />
                  <span className="text-sm font-medium">
                    Fetching best price...
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-[rgb(182,255,62)] to-[rgb(182,255,62)]/50" />
                </div>
              </div>
            ) : qError ? (
              <div className="p-6">
                <div className="mb-3 flex items-center gap-3">
                  <div className="rounded-full bg-yellow-500/10 p-2">
                    <Activity className="h-5 w-5 text-yellow-400" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-yellow-200">
                      Quote Unavailable
                    </h4>
                    <p className="text-xs text-yellow-200/70">{qError}</p>
                  </div>
                </div>
                <ul className="mb-4 ml-10 list-disc space-y-1 text-xs text-white/60">
                  <li>Try a larger amount</li>
                  <li>Check token liquidity</li>
                </ul>
                <button
                  onClick={() => setAmountStr((prev) => prev)}
                  className="w-full rounded-xl border border-yellow-400/30 bg-yellow-500/10 py-2.5 text-sm font-semibold text-yellow-200 transition-colors hover:bg-yellow-500/20"
                >
                  Retry Quote
                </button>
              </div>
            ) : quote && outAmountUi != null ? (
              <div className="p-6">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-sm font-medium text-white/60">
                    You Receive
                  </span>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-[rgb(182,255,62)]">
                      {fmtToken(outAmountUi)}
                    </div>
                    <div className="text-sm text-white/60">{token.symbol}</div>
                  </div>
                </div>
                {quote.priceImpactPct && (
                  <div className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3">
                    <span className="text-xs font-medium text-white/60">
                      Price Impact
                    </span>
                    <span className="text-xs font-bold text-white">
                      {(Number(quote.priceImpactPct) * 100).toFixed(3)}%
                    </span>
                  </div>
                )}
                <div className="mt-3 flex items-center justify-center gap-2 text-xs text-[rgb(182,255,62)]">
                  <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-[rgb(182,255,62)]" />
                  <span className="font-medium">Live quote</span>
                </div>
              </div>
            ) : (
              <div className="p-6 text-center text-sm text-white/60">
                Enter an amount to see a quote
              </div>
            )}
          </div>

          {/* Error Messages */}
          {swapError && (
            <div className="mb-6 overflow-hidden rounded-2xl border border-red-500/30 bg-gradient-to-br from-red-500/10 to-transparent p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-red-500/20 p-2">
                  <X className="h-5 w-5 text-red-400" />
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-red-300">
                    Transaction Failed
                  </h4>
                  <p className="mt-1 text-sm text-red-200/80">{swapError}</p>
                </div>
              </div>
            </div>
          )}

          {signature && (
            <div className="mb-6 overflow-hidden rounded-2xl border border-[rgb(182,255,62)]/30 bg-gradient-to-br from-[rgb(182,255,62)]/10 to-transparent p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-[rgb(182,255,62)]/20 p-2">
                  <Sparkles className="h-5 w-5 text-[rgb(182,255,62)]" />
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-[rgb(182,255,62)]">
                    Purchase Submitted!
                  </h4>
                  <p className="mt-1 text-xs text-white/60">
                    Transaction is processing...
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 rounded-xl border border-white/20 bg-white/5 py-3.5 font-bold text-white/80 transition-all hover:bg-white/10 hover:text-white"
            >
              Cancel
            </button>
            <button
              disabled={!canSwap}
              onClick={onBuy}
              className="group/buy relative flex-1 overflow-hidden rounded-xl border border-[rgb(182,255,62)]/40 bg-[rgb(182,255,62)] py-3.5 font-bold text-black shadow-lg shadow-[rgb(182,255,62)]/30 transition-all hover:shadow-xl hover:shadow-[rgb(182,255,62)]/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-500 group-hover/buy:translate-x-full" />
              <span className="relative z-10 flex items-center justify-center gap-2">
                {swapping ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />
                    Processing...
                  </>
                ) : (
                  <>
                    <DollarSign className="h-5 w-5" />
                    Buy {token.symbol}
                  </>
                )}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
