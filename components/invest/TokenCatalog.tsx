"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Image from "next/image";
import { X, Search } from "lucide-react";
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
const MAINNET = "mainnet"; // hard-force mainnet UI everywhere

// Jupiter Lite endpoints for price/quote PREVIEW (server builds the real swap)
const JUP_PRICE_BASE =
  process.env.NEXT_PUBLIC_JUP_PRICE_BASE || "https://lite-api.jup.ag/price/v3";
const JUP_QUOTE_BASE =
  process.env.NEXT_PUBLIC_JUP_QUOTE_BASE ||
  "https://lite-api.jup.ag/swap/v1/quote";

// USDC mainnet (for preview math only; server enforces everything)
const USDC_MAINNET =
  process.env.NEXT_PUBLIC_USDC_MAINNET_MINT ||
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;

// Flat service fee (USD) — UI only; server also collects this in the tx
const FLAT_FEE_USD = 0.25;

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

  const displayCurrency = (user?.displayCurrency || "USD").toUpperCase();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<
    TokenCategory | "All"
  >("All");

  // prefer app's deposit wallet -> user's primary wallet -> first Privy Solana wallet
  const depositOwnerBase58 = useMemo(() => {
    const u = user as unknown;
    let dep: string | undefined;
    let w: string | undefined;
    if (u && typeof u === "object") {
      const rec = u as Record<string, unknown>;
      const depObj = rec["depositWallet"] as
        | Record<string, unknown>
        | undefined;
      const wObj = rec["wallet"] as Record<string, unknown> | undefined;
      const depAddr = depObj?.["address"];
      const wAddr = wObj?.["address"];
      dep = typeof depAddr === "string" ? depAddr : undefined;
      w = typeof wAddr === "string" ? wAddr : undefined;
    }
    const privyFirst = wallets[0]?.address;
    return dep || w || privyFirst || "";
  }, [user, wallets]);

  // force mainnet token list
  const all = useMemo(() => tokensForCluster(MAINNET), []);

  const filtered = useMemo(() => {
    let tokens = categories?.length
      ? all.filter((t) => t.category && categories.includes(t.category))
      : all;

    // Apply category filter
    if (selectedCategory !== "All") {
      tokens = tokens.filter((t) => t.category === selectedCategory);
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      tokens = tokens.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          t.symbol.toLowerCase().includes(query)
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

  /* -------------------------------- render -------------------------------- */

  return (
    <div className={`min-h-screen bg-black/10 vision-perspective ${className}`}>
      <header className="sticky top-0 z-10 bg-black/10 backdrop-blur-[40px] backdrop-saturate-[200%] border-b border-white/10">
        <div className="container mx-auto px-4 py-4 sm:py-6">
          <div className="max-w-md mx-auto mb-4 sm:mb-6">
            <div className="relative group">
              {/* Background glow effect */}
              <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/20 via-transparent to-[rgb(182,255,62)]/20 rounded-2xl blur-xl opacity-0 group-focus-within:opacity-100 transition-all duration-700" />

              <div className="relative vision-glass rounded-2xl border border-white/20 bg-black/40 backdrop-blur-[40px] backdrop-saturate-[200%]">
                <Search className="absolute left-3 sm:left-4 top-1/2 transform -translate-y-1/2 text-white/60 w-4 h-4 sm:w-5 sm:h-5" />
                <input
                  type="text"
                  placeholder="Search tokens..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 sm:pl-12 pr-3 sm:pr-4 py-3 sm:py-4 bg-transparent text-white placeholder-white/50 text-sm sm:text-base font-medium focus:outline-none focus:ring-0"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-center">
            <div className="flex flex-wrap gap-1.5 sm:gap-2 p-1.5 sm:p-2 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 max-w-full overflow-x-auto">
              <button
                onClick={() => setSelectedCategory("All")}
                className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-semibold transition-all duration-300 whitespace-nowrap ${
                  selectedCategory === "All"
                    ? "bg-[rgb(182,255,62)]/20 text-[rgb(182,255,62)] border border-[rgb(182,255,62)]/30 shadow-[0_0_20px_rgba(182,255,62,0.3)]"
                    : "text-white/70 hover:bg-white/10 hover:text-white border border-transparent"
                }`}
              >
                All
              </button>
              {categoryOrder.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-semibold transition-all duration-300 whitespace-nowrap ${
                    selectedCategory === category
                      ? "bg-[rgb(182,255,62)]/20 text-[rgb(182,255,62)] border border-[rgb(182,255,62)]/30 shadow-[0_0_20px_rgba(182,255,62,0.3)]"
                      : "text-white/70 hover:bg-white/10 hover:text-white border border-transparent"
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-4 sm:py-6">
        {!displayTokens.length ? (
          <div className="text-center py-12">
            <div className="relative group mx-auto mb-6 w-16 h-16 sm:w-20 sm:h-20">
              <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/20 via-transparent to-[rgb(182,255,62)]/20 rounded-full blur-xl opacity-50" />
              <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/5 backdrop-blur-sm border border-white/10 flex items-center justify-center">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-white/10" />
              </div>
            </div>
            <div className="text-white mb-2 text-lg sm:text-xl font-bold">
              {searchQuery ? "No tokens found" : "No tokens available"}
            </div>
            <div className="text-white/60 text-sm max-w-md mx-auto">
              {searchQuery
                ? `No tokens match "${searchQuery}"`
                : "Add mints to mints.mainnet in /lib/tokens.ts"}
            </div>
          </div>
        ) : (
          <div className="space-y-3 sm:space-y-4">
            {displayTokens.map((t) => {
              const mainnetMint = getMintFor(t, MAINNET);
              const p = mainnetMint ? prices[mainnetMint] : undefined;
              const usd = p?.usdPrice;
              const local = typeof usd === "number" ? usd * fxRate : undefined;
              const change = p?.priceChange24h;
              const changeStr = fmtChange(change);
              const changeColor =
                typeof change === "number"
                  ? change > 0
                    ? "text-[rgb(182,255,62)]"
                    : change < 0
                    ? "text-red-400"
                    : "text-white/60"
                  : "text-white/60";

              const disabled =
                !mainnetMint ||
                !depositOwnerBase58 ||
                !privyReady ||
                !authenticated;

              return (
                <div
                  key={`${t.symbol}-${mainnetMint ?? "nomint"}`}
                  className="relative group"
                >
                  {/* Background glow effect */}
                  <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/10 via-transparent to-[rgb(182,255,62)]/10 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-700" />

                  <div className="relative vision-window p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-white/20 bg-black/40 backdrop-blur-[40px] backdrop-saturate-[200%] shadow-[0_16px_32px_rgba(0,0,0,0.3)] hover:shadow-[0_20px_40px_rgba(0,0,0,0.4)] transition-all duration-500 transform-gpu hover:scale-[1.02]">
                    {/* Subtle inner glow */}
                    <div className="absolute inset-0 rounded-2xl sm:rounded-3xl bg-gradient-to-br from-white/5 via-transparent to-transparent pointer-events-none" />

                    <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                        <div className="relative flex-shrink-0">
                          <Image
                            src={
                              t.logo ||
                              "https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/default.png" ||
                              "/placeholder.svg" ||
                              "/placeholder.svg" ||
                              "/placeholder.svg" ||
                              "/placeholder.svg"
                            }
                            alt={`${t.name} logo`}
                            width={48}
                            height={48}
                            className="h-10 w-10 sm:h-14 sm:w-14 rounded-xl sm:rounded-2xl border border-white/20 object-contain bg-white/5 backdrop-blur-sm"
                          />
                          {pricesLoading && (
                            <div className="absolute -top-0.5 -right-0.5 sm:-top-1 sm:-right-1 h-3 w-3 sm:h-4 sm:w-4 bg-[rgb(182,255,62)] rounded-full animate-pulse shadow-[0_0_20px_rgba(182,255,62,0.6)]" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-2">
                            <span className="text-white font-bold text-base sm:text-lg tracking-tight truncate">
                              {t.name}
                            </span>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-white/70 font-semibold px-2 sm:px-3 py-1 bg-white/10 backdrop-blur-sm rounded-lg border border-white/10">
                                {t.symbol}
                              </span>
                              {t.category && (
                                <span className="text-xs text-[rgb(182,255,62)] font-medium px-2 py-1 bg-[rgb(182,255,62)]/10 rounded-lg">
                                  {t.category}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-3 sm:gap-4">
                            <span className="text-white font-black text-xl sm:text-2xl bg-gradient-to-br from-white via-white to-white/80 bg-clip-text">
                              {fmtMoney(local)}
                            </span>
                            {changeStr && (
                              <span
                                className={`text-xs sm:text-sm font-semibold ${changeColor} flex items-center gap-1`}
                              >
                                {typeof change === "number" &&
                                  change > 0 &&
                                  "↗"}
                                {typeof change === "number" &&
                                  change < 0 &&
                                  "↘"}
                                {changeStr}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => openBuy(t)}
                        disabled={disabled}
                        className="group/btn relative overflow-hidden vision-button flex items-center justify-center gap-2 px-4 sm:px-6 py-2.5 sm:py-3 w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed rounded-xl sm:rounded-2xl bg-white/10 border border-white/20 hover:bg-[rgb(182,255,62)]/20 hover:border-[rgb(182,255,62)]/40 hover:text-[rgb(182,255,62)] transition-all duration-300 backdrop-blur-sm transform hover:scale-105 active:scale-95 hover:shadow-[0_8px_32px_rgba(182,255,62,0.2)] font-bold text-[rgb(182,255,62)] text-sm sm:text-base"
                      >
                        {/* Enhanced shimmer effect on hover */}
                        <div className="absolute inset-0 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/15 to-transparent" />

                        <span className="relative z-10">Buy {t.symbol}</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {pricesError && (
          <div className="relative group mt-6">
            <div className="absolute -inset-1 bg-gradient-to-r from-red-500/20 via-transparent to-red-500/20 rounded-2xl blur-xl opacity-50" />
            <div className="relative text-center p-4 sm:p-6 rounded-2xl bg-red-500/10 border border-red-500/30 backdrop-blur-sm">
              <div className="text-red-400 font-semibold text-base sm:text-lg">
                Failed to fetch prices
              </div>
              <div className="text-red-400/70 text-sm mt-2">{pricesError}</div>
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
  getAccessToken,
  onClose,
  onConfirm,
}: {
  token: TokenMeta;
  displayCurrency: string;
  fxRate: number; // USD→display
  jupQuoteBase: string;
  jupPriceBase: string;
  depositOwnerBase58: string;
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
  const spendValid =
    Number.isFinite(amountDisplay) &&
    amountDisplay > FLAT_FEE_USD * (displayCurrency === "USD" ? 1 : fxRate);

  const outputMint = getMintFor(token, MAINNET) || ""; // mainnet mint only
  const [outDecimals, setOutDecimals] = useState<number | null>(null);
  const [quote, setQuote] = useState<JupQuote>(null);
  const [qLoading, setQLoading] = useState(false);
  const [qError, setQError] = useState<string | null>(null);

  // token decimals (for readable outAmount)
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

  // net USDC-in after the fixed fee
  const computeInAmountRaw = (): number => {
    if (!spendValid) return 0;
    const amountUsdGross =
      displayCurrency === "USD" ? amountDisplay : amountDisplay / fxRate;
    const amountUsdNet = Math.max(0, amountUsdGross - FLAT_FEE_USD);
    return Math.floor(amountUsdNet * 10 ** USDC_DECIMALS);
  };

  // Quote USDC -> token for the preview panel
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

        const url =
          `${jupQuoteBase}?inputMint=${USDC_MAINNET}&outputMint=${outputMint}&amount=${inAmount}` +
          `&slippageBps=50&restrictIntermediateTokens=true&dynamicSlippage=true`;
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
      ? Number(quote.outAmount) / 10 ** (outDecimals || 6)
      : null;

  const feeInDisplay =
    displayCurrency === "USD" ? FLAT_FEE_USD : FLAT_FEE_USD * fxRate;

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
        fxRate, // display → USD
        accessToken,
      });

      // Try to surface a short tx id in the toast
      const sigFromCall = res as string | null;
      const sig = sigFromCall || signature;
      const tail = sig ? ` • ${sig.slice(0, 6)}…${sig.slice(-6)}` : "";

      toast.success(`Purchase submitted${tail}`, { id: toastId });

      onConfirm(amountDisplay);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e || "Failed");
      toast.error(`Purchase failed: ${msg}`, { id: toastId });
      // swapError panel still shows below for context
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

  return (
    <div
      className="fixed inset-0 z-[9999] vision-perspective flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
    >
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-2xl backdrop-saturate-150"
        onClick={onClose}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(40%_30%_at_10%_85%,rgba(182,255,62,0.15),transparent),radial-gradient(35%_25%_at_90%_10%,rgba(182,255,62,0.12),transparent)]" />
      </div>
      <div className="pointer-events-auto w-full max-w-sm sm:max-w-lg vision-window vision-depth rounded-2xl sm:rounded-3xl border border-white/20 bg-black/40 backdrop-blur-[40px] backdrop-saturate-[200%] shadow-[0_32px_64px_rgba(0,0,0,0.4)] p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
        {/* Subtle inner glow */}
        <div className="absolute inset-0 rounded-2xl sm:rounded-3xl bg-gradient-to-br from-white/5 via-transparent to-transparent pointer-events-none" />

        <div className="relative flex items-center justify-between mb-4 sm:mb-6">
          <div className="flex items-center gap-2 sm:gap-3">
            <Image
              src={
                token.logo ||
                "https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/default.png" ||
                "/placeholder.svg" ||
                "/placeholder.svg" ||
                "/placeholder.svg" ||
                "/placeholder.svg"
              }
              alt={`${token.name} logo`}
              width={40}
              height={40}
              className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl sm:rounded-2xl border border-white/20 object-contain bg-white/5 backdrop-blur-sm"
            />
            <div>
              <h4 className="text-white font-bold text-lg sm:text-xl tracking-tight">
                Buy {token.name}
              </h4>
              <div className="text-white/60 text-xs sm:text-sm font-medium">
                {token.symbol}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="vision-button rounded-xl sm:rounded-2xl p-2 sm:p-3 hover:bg-white/10 transition-all duration-300 text-white/70 hover:text-white"
            aria-label="Close"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>

        <div className="relative space-y-4 sm:space-y-6">
          <div>
            <label className="block text-sm font-bold text-white mb-2 sm:mb-3">
              Spend ({displayCurrency})
            </label>
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/20 via-transparent to-[rgb(182,255,62)]/20 rounded-2xl blur-xl opacity-0 group-focus-within:opacity-100 transition-all duration-700" />
              <input
                type="number"
                min="0"
                step="0.01"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                className="relative w-full px-3 sm:px-4 py-3 sm:py-4 bg-white/5 backdrop-blur-sm border border-white/20 rounded-xl sm:rounded-2xl text-white text-base sm:text-lg font-semibold placeholder-white/50 focus:outline-none focus:border-[rgb(182,255,62)]/50 focus:bg-white/10 transition-all duration-300"
                placeholder="0.00"
                inputMode="decimal"
              />
            </div>

            <div className="text-xs sm:text-sm text-white/60 mt-2 sm:mt-3 font-medium">
              Processing fee:{" "}
              <span className="text-white font-semibold">
                {new Intl.NumberFormat(undefined, {
                  style: "currency",
                  currency: displayCurrency,
                  maximumFractionDigits: 2,
                }).format(feeInDisplay)}
              </span>{" "}
              (deducted before purchase)
            </div>
          </div>

          <div className="vision-glass rounded-xl sm:rounded-2xl p-4 sm:p-6 bg-white/5 backdrop-blur-sm border border-white/10">
            {!spendValid ? (
              <div className="text-center py-4 sm:py-6">
                <div className="text-red-400 font-semibold text-base sm:text-lg">
                  Invalid amount
                </div>
                <div className="text-red-400/70 text-xs sm:text-sm mt-1">
                  Enter an amount greater than the fee
                </div>
              </div>
            ) : qLoading ? (
              <div className="text-center py-4 sm:py-6">
                <div className="text-white/70 font-medium text-sm sm:text-base">
                  Getting live price...
                </div>
                <div className="mt-3 h-2 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-[rgb(182,255,62)] rounded-full animate-pulse w-1/2" />
                </div>
              </div>
            ) : qError ? (
              <div className="text-center py-4 sm:py-6">
                <div className="text-red-400 font-semibold text-sm sm:text-base">
                  Price fetch failed
                </div>
                <div className="text-red-400/70 text-xs sm:text-sm mt-1">
                  {qError}
                </div>
              </div>
            ) : quote && outAmountUi != null ? (
              <div className="space-y-3 sm:space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-white/70 font-medium text-sm sm:text-base">
                    You&apos;ll receive:
                  </span>
                  <span className="text-white font-bold text-lg sm:text-xl bg-gradient-to-br from-white via-white to-white/80 bg-clip-text">
                    {fmtToken(outAmountUi)} {token.symbol}
                  </span>
                </div>
                {quote.priceImpactPct && (
                  <div className="flex justify-between items-center text-xs sm:text-sm">
                    <span className="text-white/60">Price impact:</span>
                    <span className="text-white/70 font-medium">
                      {(Number(quote.priceImpactPct) * 100).toFixed(2)}%
                    </span>
                  </div>
                )}
                <div className="h-px bg-white/20" />
                <div className="text-xs text-white/50 text-center font-medium">
                  Live quote • Updates automatically
                </div>
              </div>
            ) : (
              <div className="text-center py-4 sm:py-6 text-white/60 font-medium text-sm sm:text-base">
                Enter an amount to see a live price
              </div>
            )}
          </div>

          {swapError && (
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-red-500/20 via-transparent to-red-500/20 rounded-2xl blur-xl opacity-50" />
              <div className="relative rounded-xl sm:rounded-2xl bg-red-500/10 border border-red-500/30 backdrop-blur-sm p-3 sm:p-4">
                <div className="text-red-400 font-semibold text-sm sm:text-base">
                  Purchase failed
                </div>
                <div className="text-red-400/70 text-xs sm:text-sm mt-1">
                  {swapError}
                </div>
              </div>
            </div>
          )}
          {signature && (
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/20 via-transparent to-[rgb(182,255,62)]/20 rounded-2xl blur-xl opacity-50" />
              <div className="relative rounded-xl sm:rounded-2xl bg-[rgb(182,255,62)]/10 border border-[rgb(182,255,62)]/30 backdrop-blur-sm p-3 sm:p-4">
                <div className="text-[rgb(182,255,62)] font-semibold text-sm sm:text-base">
                  Purchase submitted successfully!
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="relative flex flex-col sm:flex-row items-center justify-end gap-3 sm:gap-4 mt-6 sm:mt-8 pt-4 sm:pt-6 border-t border-white/10">
          <button
            onClick={onClose}
            className="vision-button w-full sm:w-auto px-4 sm:px-6 py-2.5 sm:py-3 text-white/80 hover:text-white rounded-xl sm:rounded-2xl bg-white/5 border border-white/20 hover:bg-white/10 hover:border-white/30 transition-all duration-300 backdrop-blur-sm font-semibold text-sm sm:text-base"
          >
            Cancel
          </button>
          <button
            disabled={!canSwap}
            onClick={onBuy}
            className="group/btn relative overflow-hidden vision-button w-full sm:w-auto px-4 sm:px-6 py-2.5 sm:py-3 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl sm:rounded-2xl bg-[rgb(182,255,62)]/20 border border-[rgb(182,255,62)]/40 hover:bg-[rgb(182,255,62)]/30 hover:border-[rgb(182,255,62)]/60 hover:shadow-[0_8px_32px_rgba(182,255,62,0.3)] transition-all duration-300 backdrop-blur-sm font-bold text-[rgb(182,255,62)] text-sm sm:text-base"
          >
            {/* Enhanced shimmer effect on hover */}
            <div className="absolute inset-0 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/15 to-transparent" />

            <span className="relative z-10">
              {swapping ? "Processing..." : `Buy ${token.symbol}`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
