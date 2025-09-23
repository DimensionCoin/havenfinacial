"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Image from "next/image";
import { X, RefreshCw } from "lucide-react";
import {
  type TokenMeta,
  tokensForCluster,
  getMintFor,
  type TokenCategory,
} from "@/lib/tokens";
import { useUser } from "@/providers/UserProvider";
import { usePrivy } from "@privy-io/react-auth";
import { useServerSponsoredJupSwap } from "@/hooks/useServerSponsoredJupSwap.ts";

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

const MAINNET = "mainnet"; // ❗ force mainnet everywhere

// Price + Quote APIs (Jupiter Lite)
const JUP_PRICE_BASE =
  process.env.NEXT_PUBLIC_JUP_PRICE_BASE || "https://lite-api.jup.ag/price/v3";
const JUP_QUOTE_BASE =
  process.env.NEXT_PUBLIC_JUP_QUOTE_BASE ||
  "https://lite-api.jup.ag/swap/v1/quote";

// USDC settings
const USDC_MAINNET =
  process.env.NEXT_PUBLIC_USDC_MAINNET_MINT ||
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
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
  className = "",
}: Props) {
  const { user } = useUser();
  const { getAccessToken, ready: privyReady, authenticated } = usePrivy();
  const displayCurrency = (user?.displayCurrency || "USD").toUpperCase();

  const depositOwnerBase58 = useMemo(() => {
    const u = user as unknown;
    if (u && typeof u === "object") {
      const rec = u as Record<string, unknown>;
      const dep = rec.depositWallet as Record<string, unknown> | undefined;
      const w = rec.wallet as Record<string, unknown> | undefined;
      const a1 = typeof dep?.address === "string" ? (dep.address as string) : undefined;
      const a2 = typeof w?.address === "string" ? (w.address as string) : undefined;
      return a1 || a2 || "";
    }
    return "";
  }, [user]);

  // ❗ Force mainnet token list
  const all = useMemo(() => tokensForCluster(MAINNET), []);

  const filtered = useMemo(
    () =>
      categories?.length
        ? all.filter((t) => t.category && categories.includes(t.category))
        : all,
    [all, categories]
  );

  const categoryOrder: TokenCategory[] = categories?.length
    ? categories
    : DEFAULT_CATEGORY_ORDER;

  const grouped = useMemo(() => {
    const map = new Map<TokenCategory, TokenMeta[]>();
    for (const cat of categoryOrder) map.set(cat, []);
    for (const t of filtered) {
      if (!t.category || !map.has(t.category)) continue;
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
        const id = getMintFor(t, MAINNET);
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
    <div
      className={`rounded-2xl border border-white/20 bg-black/40 backdrop-blur-[40px] shadow-2xl ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-[rgb(182,255,62)]/20 to-transparent border border-[rgb(182,255,62)]/30 flex items-center justify-center backdrop-blur-sm">
            <span className="text-[rgb(182,255,62)] font-bold text-sm">
              INV
            </span>
          </div>
          <div>
            <div className="text-white font-semibold text-lg leading-tight">
              Invest
            </div>
            <div className="text-sm text-white/60 leading-tight">
              Buy top tokens with one tap. Gas sponsored.
            </div>
          </div>
        </div>

        {/* Refresh button */}
        <button
          type="button"
          onClick={() => void fetchPrices(priceIds)}
          disabled={pricesLoading || !priceIds.length}
          className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-xl border border-white/20 hover:bg-white/10 text-white/80 disabled:opacity-50 transition-all duration-200 backdrop-blur-sm"
        >
          <RefreshCw
            className={`h-4 w-4 ${pricesLoading ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      {/* Body */}
      <div className="p-6">
        {grouped.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-white/60 mb-2">No tokens available</div>
            <div className="text-sm text-white/40">
              Add mints to{" "}
              <code className="bg-white/10 px-2 py-1 rounded">
                mints.mainnet
              </code>{" "}
              in{" "}
              <code className="bg-white/10 px-2 py-1 rounded">
                /lib/tokens.ts
              </code>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {grouped.map(([cat, tokens]) => (
              <section key={cat}>
                <h4 className="mb-4 text-sm font-semibold tracking-wider text-white/70 uppercase flex items-center gap-2">
                  <div className="h-1 w-8 bg-gradient-to-r from-[rgb(182,255,62)] to-transparent rounded-full"></div>
                  {cat}
                </h4>

                {/* Grid */}
                <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {tokens.map((t) => {
                    const mainnetMint = getMintFor(t, MAINNET);
                    const p = mainnetMint ? prices[mainnetMint] : undefined;
                    const usd = p?.usdPrice;
                    const local =
                      typeof usd === "number" ? usd * fxRate : undefined;
                    const change = p?.priceChange24h;
                    const changeStr = fmtChange(change);
                    const changeColor =
                      typeof change === "number"
                        ? change > 0
                          ? "text-[rgb(182,255,62)]"
                          : change < 0
                          ? "text-red-400"
                          : "text-white/40"
                        : "text-white/30";

                    const disabled =
                      !mainnetMint ||
                      !depositOwnerBase58 ||
                      !privyReady ||
                      !authenticated;

                    return (
                      <li
                        key={`${t.symbol}-${mainnetMint ?? "nomint"}`}
                        className="group rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all duration-300 p-4 backdrop-blur-sm"
                      >
                        <div className="flex items-start gap-4">
                          <div className="relative">
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
                              className="h-12 w-12 rounded-2xl border border-white/20 object-contain bg-white/5 backdrop-blur-sm"
                            />
                            {pricesLoading && (
                              <div className="absolute -top-1 -right-1 h-3 w-3 bg-[rgb(182,255,62)] rounded-full animate-pulse"></div>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-white font-semibold truncate text-lg">
                                {t.name}
                              </span>
                              <span className="text-sm text-white/50 font-medium">
                                {t.symbol}
                              </span>
                            </div>

                            <div className="flex items-center gap-3 mb-3">
                              <span className="text-white/90 font-semibold text-lg">
                                {fmtMoney(local)}
                              </span>
                              {changeStr && (
                                <span
                                  className={`text-sm font-medium ${changeColor} flex items-center gap-1`}
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

                            <button
                              type="button"
                              onClick={() => openBuy(t)}
                              disabled={disabled}
                              className="w-full text-sm px-4 py-2.5 rounded-xl bg-[rgb(182,255,62)] text-black font-semibold hover:bg-[rgb(182,255,62)]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl group-hover:scale-[1.02]"
                            >
                              Buy {t.symbol}
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {pricesError && (
              <div className="text-center p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                <div className="text-red-400 font-medium">
                  Failed to fetch prices
                </div>
                <div className="text-red-400/70 text-sm mt-1">
                  {pricesError}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

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
          onConfirm={(amountFiat) => {
            onStartBuy?.({ token: selected, amountFiat });
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

  const outputMint = getMintFor(token, MAINNET) || ""; // ❗ mainnet mint only
  const [outDecimals, setOutDecimals] = useState<number | null>(null);
  const [quote, setQuote] = useState<JupQuote>(null);
  const [qLoading, setQLoading] = useState(false);
  const [qError, setQError] = useState<string | null>(null);

  // one-time (per token) decimals fetch for UI
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
    try {
      const accessToken = await getAccessToken().catch(() => null);
      await swap({
        fromOwnerBase58: depositOwnerBase58,
        outputMint,
        amountDisplay, // local currency the user entered
        fxRate, // local → USD conversion
        accessToken,
      });
      onConfirm(amountDisplay);
      onClose();
    } catch {
      /* error is rendered below */
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
  ]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg rounded-2xl border border-white/20 bg-black/40 backdrop-blur-[40px] p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
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
              className="h-10 w-10 rounded-xl border border-white/20 object-contain bg-white/5"
            />
            <div>
              <h4 className="text-white font-semibold text-lg">
                Buy {token.name}
              </h4>
              <div className="text-white/60 text-sm">{token.symbol}</div>
            </div>
          </div>
          <button
            aria-label="Close"
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-white/10 text-white/60 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Spend ({displayCurrency})
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="w-full rounded-xl border border-white/20 bg-white/5 backdrop-blur-sm px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/50 focus:border-[rgb(182,255,62)] transition-all"
              placeholder="0.00"
              inputMode="decimal"
            />

            <div className="text-sm text-white/50 mt-2">
              Processing fee:{" "}
              <span className="text-white/80 font-medium">
                {new Intl.NumberFormat(undefined, {
                  style: "currency",
                  currency: displayCurrency,
                  maximumFractionDigits: 2,
                }).format(feeInDisplay)}
              </span>{" "}
              (deducted before purchase)
            </div>
          </div>

          {/* Quote panel */}
          <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4">
            {!spendValid ? (
              <div className="text-center py-4">
                <div className="text-red-400 font-medium">Invalid amount</div>
                <div className="text-red-400/70 text-sm">
                  Enter an amount greater than the fee
                </div>
              </div>
            ) : qLoading ? (
              <div className="text-center py-4">
                <div className="text-white/70">Getting live price...</div>
                <div className="mt-2 h-1 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-[rgb(182,255,62)] rounded-full animate-pulse w-1/2"></div>
                </div>
              </div>
            ) : qError ? (
              <div className="text-center py-4">
                <div className="text-red-400 font-medium">
                  Price fetch failed
                </div>
                <div className="text-red-400/70 text-sm">{qError}</div>
              </div>
            ) : quote && outAmountUi != null ? (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-white/60">You&#39;ll receive:</span>
                  <span className="text-white font-semibold text-lg">
                    {fmtToken(outAmountUi)} {token.symbol}
                  </span>
                </div>
                {quote.priceImpactPct && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-white/50">Price impact:</span>
                    <span className="text-white/70">
                      {(Number(quote.priceImpactPct) * 100).toFixed(2)}%
                    </span>
                  </div>
                )}
                <div className="h-px bg-white/10"></div>
                <div className="text-xs text-white/40 text-center">
                  Live quote • Updates automatically
                </div>
              </div>
            ) : (
              <div className="text-center py-4 text-white/50">
                Enter an amount to see a live price
              </div>
            )}
          </div>

          {/* Purchase state */}
          {swapError && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4">
              <div className="text-red-400 font-medium">Purchase failed</div>
              <div className="text-red-400/70 text-sm mt-1">{swapError}</div>
            </div>
          )}
          {signature && (
            <div className="rounded-xl bg-[rgb(182,255,62)]/10 border border-[rgb(182,255,62)]/20 p-4">
              <div className="text-[rgb(182,255,62)] font-medium">
                Purchase submitted successfully!
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 text-sm rounded-xl border border-white/20 text-white/80 hover:bg-white/10 transition-all duration-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSwap}
            onClick={onBuy}
            className="px-6 py-2.5 text-sm rounded-xl bg-[rgb(182,255,62)] text-black font-semibold hover:bg-[rgb(182,255,62)]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl"
          >
            {swapping ? "Processing..." : `Buy ${token.symbol}`}
          </button>
        </div>
      </div>
    </div>
  );
}
