"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
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
const MAINNET = "mainnet";

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
    <div className={`min-h-screen ${className || ""}`}>
      {/* Compact sticky header */}
      <header className="sticky top-0 z-20 border-b border-white/10 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
            {/* Search */}
            <div className="relative flex-1">
              <div className="absolute inset-0 rounded-2xl bg-white/5" />
              <div className="relative rounded-2xl border border-white/15 bg-black/40">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search by name or symbol"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-transparent text-white placeholder-white/50 text-sm focus:outline-none"
                />
              </div>
            </div>

            {/* Categories */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 md:pb-0">
              <button
                onClick={() => setSelectedCategory("All")}
                className={`px-3 py-2 rounded-full text-xs font-semibold transition ${
                  selectedCategory === "All"
                    ? "bg-[rgb(182,255,62)]/20 text-[rgb(182,255,62)] border border-[rgb(182,255,62)]/30"
                    : "text-white/70 hover:text-white hover:bg-white/10"
                }`}
              >
                All
              </button>
              {categoryOrder.map((c) => (
                <button
                  key={c}
                  onClick={() => setSelectedCategory(c)}
                  className={`px-3 py-2 rounded-full text-xs font-semibold transition whitespace-nowrap ${
                    selectedCategory === c
                      ? "bg-[rgb(182,255,62)]/20 text-[rgb(182,255,62)] border border-[rgb(182,255,62)]/30"
                      : "text-white/70 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* List */}
      <main className="container mx-auto px-4 py-6">
        {!displayTokens.length ? (
          <div className="text-center py-20 text-white/70">
            No tokens found.
          </div>
        ) : (
          <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                <Link
                  key={`${t.symbol}-${mainnetMint ?? "nomint"}`}
                  href={`/invest/${t.symbol.toLowerCase()}`}
                  className="group block rounded-2xl border border-white/10 backdrop-blur-xl p-4 transition hover:border-white/20 hover:bg-black/40"
                  aria-label={`Open ${t.name} chart`}
                >
                  <div className="flex items-start gap-3">
                    {/* Logo */}
                    <div className="relative">
                      <Image
                        src={
                          t.logo ||
                          "https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/default.png" ||
                          "/placeholder.svg"
                        }
                        alt={`${t.name} logo`}
                        width={40}
                        height={40}
                        className="h-10 w-10 rounded-xl border border-white/15 bg-white/5 object-contain"
                      />
                      {pricesLoading && (
                        <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-[rgb(182,255,62)] animate-pulse" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-white font-semibold">
                          {t.name}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-md bg-white/10 text-white/70 border border-white/10">
                          {t.symbol}
                        </span>
                        {t.category && (
                          <span className="text-xs px-2 py-0.5 rounded-md bg-[rgb(182,255,62)]/10 text-[rgb(182,255,62)] border border-[rgb(182,255,62)]/20">
                            {t.category}
                          </span>
                        )}
                      </div>

                      <div className="mt-2 flex items-end justify-between gap-2">
                        <div className="flex items-baseline gap-2">
                          <span className="text-white text-lg font-bold">
                            {fmtMoney(local)}
                          </span>
                          {changeStr && (
                            <span
                              className={`text-xs font-semibold ${changeColor}`}
                            >
                              {typeof change === "number" && change > 0 && "↗ "}
                              {typeof change === "number" && change < 0 && "↘ "}
                              {changeStr}
                            </span>
                          )}
                        </div>

                        {/* Buy button (stops link navigation) */}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openBuy(t);
                          }}
                          disabled={disabled}
                          className="relative overflow-hidden rounded-xl px-3 py-2 text-xs font-bold border transition
                                     bg-white/10 border-white/20 text-[rgb(182,255,62)]
                                     hover:bg-[rgb(182,255,62)]/20 hover:border-[rgb(182,255,62)]/40
                                     disabled:opacity-50 disabled:cursor-not-allowed"
                          aria-label={`Buy ${t.symbol}`}
                        >
                          <span className="absolute inset-0 -translate-x-full group-hover:translate-x-0 transition-transform duration-700 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                          <span className="relative z-10">Buy</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {pricesError && (
          <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
            <div className="font-semibold">We couldn’t load live prices.</div>
            <div className="text-sm opacity-90 mt-1">{pricesError}</div>
            <div className="text-xs opacity-70 mt-2">
              Tip: check your connection or try again in a few seconds.
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

  // net USDC-in after the fixed fee (raw base units)
  const computeInAmountRaw = (): number => {
    if (!spendValid) return 0;
    const amountUsdGross =
      displayCurrency === "USD" ? amountDisplay : amountDisplay / fxRate;
    const amountUsdNet = Math.max(0, amountUsdGross - FLAT_FEE_USD);
    return Math.floor(amountUsdNet * 10 ** USDC_DECIMALS);
  };

  // --- robust quote helper (lite GET -> v6 POST fallback) ---
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
    // Skip tiny values (< 1 USDC cent) which usually fail to route
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
        // extract message if present
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

  // Quote USDC -> token for the preview panel (debounced, robust)
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

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-2xl"
        onClick={onClose}
        aria-hidden
      />
      <div className="pointer-events-auto w-full max-w-sm sm:max-w-lg rounded-2xl border border-white/20 bg-black/40 backdrop-blur-[40px] p-5 shadow-[0_32px_64px_rgba(0,0,0,0.4)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              src={
                token.logo ||
                "https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/default.png" ||
                "/placeholder.svg"
              }
              alt={`${token.name} logo`}
              width={44}
              height={44}
              className="h-11 w-11 rounded-xl border border-white/20 bg-white/5 object-contain"
            />
            <div>
              <div className="text-white font-bold text-lg">
                Buy {token.name}
              </div>
              <div className="text-white/60 text-xs">{token.symbol}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-white/70 hover:text-white hover:bg-white/10"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-5 space-y-5">
          <div>
            <label className="block text-sm font-bold text-white mb-2">
              Spend ({displayCurrency})
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-white placeholder-white/50 focus:outline-none focus:border-[rgb(182,255,62)]/50"
              placeholder="0.00"
              inputMode="decimal"
            />
            <div className="mt-2 text-xs text-white/60">
              Processing fee:{" "}
              <span className="text-white font-semibold">
                {new Intl.NumberFormat(undefined, {
                  style: "currency",
                  currency: displayCurrency,
                  maximumFractionDigits: 2,
                }).format(feeInDisplay)}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            {!spendValid ? (
              <div className="text-center text-red-300 text-sm">
                Enter an amount greater than the fee.
              </div>
            ) : qLoading ? (
              <div className="text-center text-white/80 text-sm">
                Getting a live price…
                <div className="mt-3 h-2 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full rounded-full animate-pulse w-1/2 bg-white/60" />
                </div>
              </div>
            ) : qError ? (
              <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-yellow-100 text-sm">
                <div className="font-semibold">We couldn’t fetch a quote.</div>
                <div className="opacity-90 mt-1">{qError}</div>
                <ul className="list-disc ml-5 mt-2 text-xs opacity-80 space-y-1">
                  <li>Try a larger amount (very small trades can’t route).</li>
                  <li>
                    If this is a new or illiquid token, routes may be limited.
                  </li>
                </ul>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setAmountStr((prev) => prev)} // retrigger debounce
                    className="px-3 py-1.5 rounded-md border border-white/20 bg-white/10 text-white/90 hover:bg-white/15 text-xs"
                  >
                    Try again
                  </button>
                </div>
              </div>
            ) : quote && outAmountUi != null ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-white/70 text-sm">You’ll receive</span>
                  <span className="text-white font-bold text-lg">
                    {fmtToken(outAmountUi)} {token.symbol}
                  </span>
                </div>
                {quote.priceImpactPct && (
                  <div className="flex items-center justify-between text-xs text-white/60">
                    <span>Price impact</span>
                    <span className="text-white/80">
                      {(Number(quote.priceImpactPct) * 100).toFixed(2)}%
                    </span>
                  </div>
                )}
                <div className="text-center text-xs text-white/50 pt-1">
                  Live quote
                </div>
              </div>
            ) : (
              <div className="text-center text-white/60 text-sm">
                Enter an amount to see a live quote.
              </div>
            )}
          </div>

          {swapError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm">
              <div className="font-semibold">Purchase failed.</div>
              <div className="opacity-90 mt-1">{swapError}</div>
            </div>
          )}
          {signature && (
            <div className="rounded-xl border border-[rgb(182,255,62)]/30 bg-[rgb(182,255,62)]/10 p-3 text-[rgb(182,255,62)] text-sm">
              Purchase submitted!
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-end">
            <button
              onClick={onClose}
              className="w-full sm:w-auto rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-white/80 hover:text-white hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              disabled={!canSwap}
              onClick={onBuy}
              className="w-full sm:w-auto relative overflow-hidden rounded-xl px-5 py-3 font-bold text-[rgb(182,255,62)]
                         border border-[rgb(182,255,62)]/40 bg-[rgb(182,255,62)]/20
                         hover:bg-[rgb(182,255,62)]/30 hover:border-[rgb(182,255,62)]/60
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {swapping ? "Processing…" : `Buy ${token.symbol}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
