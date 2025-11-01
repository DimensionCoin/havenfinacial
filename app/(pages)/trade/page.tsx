"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { TrendingUp, TrendingDown, Info } from "lucide-react";
import { useBalances } from "@/providers/BalanceProvider";
import { useUser } from "@/providers/UserProvider";
import Blocker from "@/components/shared/Blocker";

/* ======================= Pyth Hermes SSE hook ======================= */

type HermesParsedPrice = {
  price: { price: string; expo: number; conf?: string; publish_time?: number };
  ema_price?: {
    price: string;
    expo: number;
    conf?: string;
    publish_time?: number;
  };
  id: string;
  metadata?: {
    slot?: number;
    prev_publish_time?: number;
    proof_available_time?: number;
  };
};

type HermesMessage = {
  binary?: { data: string[]; encoding: "hex" | "base64" };
  parsed?: HermesParsedPrice[];
};

type UsePythPriceResult = {
  price: number | null; // USD
  lastUpdate: number | null; // epoch ms
  loading: boolean;
  error: string | null;
};

/**
 * Streams Pyth price updates via Hermes SSE and publishes:
 * - Immediately on the first message after (re)subscribe
 * - Then every `tickMs` (default 10s) thereafter
 * Auto-reconnects with backoff.
 *
 * NOTE: Not exported — page files can only export specific Next.js fields.
 */
function usePythPrice(
  priceId: string | null | undefined,
  tickMs = 10_000
): UsePythPriceResult {
  const [price, setPrice] = useState<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const latestRef = useRef<{ price: number | null; ts: number | null }>({
    price: null,
    ts: null,
  });
  const esRef = useRef<EventSource | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<{ tries: number }>({ tries: 0 });
  const immediateOnceRef = useRef<boolean>(true);

  const url = useMemo(() => {
    if (!priceId) return null;
    const u = new URL("https://hermes.pyth.network/v2/updates/price/stream");
    u.searchParams.append("parsed", "true");
    u.searchParams.append("ignore_invalid_price_ids", "true");
    u.searchParams.append("ids[]", priceId);
    return u.toString();
  }, [priceId]);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      setPrice(null);
      setLastUpdate(null);
      setError(null);
      return;
    }

    let cancelled = false;
    immediateOnceRef.current = true;

    function openStream(u: string) {
      if (cancelled) return;
      setLoading(true);
      setError(null);

      esRef.current?.close();
      esRef.current = null;

      const es = new EventSource(u);
      esRef.current = es;

      es.onopen = () => {
        reconnectRef.current.tries = 0;
        if (!cancelled) setLoading(false);
      };

      es.onerror = () => {
        if (cancelled) return;
        es.close();
        esRef.current = null;
        setLoading(true);
        const tries = ++reconnectRef.current.tries;
        const delay = Math.min(30_000, 1_000 * Math.pow(2, tries));
        setTimeout(() => {
          if (!cancelled) openStream(u);
        }, delay);
      };

      es.onmessage = (ev) => {
        if (cancelled) return;
        try {
          const msg: HermesMessage = JSON.parse(ev.data);
          const p = msg?.parsed?.[0]?.price;
          if (!p) return;

          const raw = Number(p.price);
          const expo = Number(p.expo);
          if (!Number.isFinite(raw) || !Number.isFinite(expo)) return;

          const px = raw * Math.pow(10, expo); // USD price
          const now = Date.now();
          latestRef.current = { price: px, ts: now };

          if (immediateOnceRef.current) {
            setPrice(px);
            setLastUpdate(now);
            setError(null);
            setLoading(false);
            immediateOnceRef.current = false;
          }
        } catch {
          // ignore malformed ticks
        }
      };
    }

    openStream(url);

    // throttled publish
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    intervalRef.current = setInterval(() => {
      const { price: px, ts } = latestRef.current;
      if (px !== null && ts !== null) {
        setPrice(px);
        setLastUpdate(ts);
        setError(null);
      }
    }, tickMs);

    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [url, tickMs]);

  return { price, lastUpdate, loading, error };
}

/* ======================= App constants ======================= */

type Coin = "BTC" | "SOL" | "ETH";

type CoinData = {
  symbol: Coin;
  name: string;
  logo: string;
  tradingViewSymbol: string;
};

const MAX_LEVERAGE = 20;

const COINS: CoinData[] = [
  {
    symbol: "BTC",
    name: "Bitcoin",
    logo: "/logos/btc.png",
    tradingViewSymbol: "PYTH:BTCUSD",
  },
  {
    symbol: "SOL",
    name: "Solana",
    logo: "/logos/sol.png",
    tradingViewSymbol: "PYTH:SOLUSD",
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    logo: "/logos/eth.png",
    tradingViewSymbol: "PYTH:ETHUSD",
  },
];

/** Hardcoded Pyth mainnet price feed IDs (USD) */
const PYTH_FEEDS: Record<Coin, string> = {
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SOL: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
};

/* ======================= FX helpers (USD <-> Local) ======================= */

function formatMoney(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/** Get USD->target conversion rate & converted amount for a given USD amount. */
function useFx(amountUsd: number) {
  const { user } = useUser();
  const target = (user?.displayCurrency || "USD").toUpperCase();

  const [converted, setConverted] = useState<number | null>(null);
  const [rate, setRate] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!isFinite(amountUsd)) return;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/fx?amount=${encodeURIComponent(amountUsd)}`,
          {
            method: "GET",
            cache: "no-store",
            credentials: "include",
            headers: { accept: "application/json" },
          }
        );
        const j = await res.json().catch(() => null);
        if (!cancelled && res.ok && j) {
          setRate(Number(j.rate) || 1);
          setConverted(Number(j.converted) || amountUsd);
        }
      } catch {
        if (!cancelled) {
          setRate(1);
          setConverted(amountUsd);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [amountUsd, target]);

  return {
    target,
    converted: converted ?? amountUsd * rate,
    rate, // USD -> target
    loading,
  };
}

/* ======================= TradingView Chart ======================= */

/** Minimal types to avoid `any` */
type TVWidget = { remove?: () => void };
type TVLib = { widget: new (opts: unknown) => TVWidget };

declare global {
  interface Window {
    TradingView?: TVLib;
    __tvScriptLoadingPromise?: Promise<void>;
  }
}

function loadTradingViewScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.TradingView) return Promise.resolve();
  if (!window.__tvScriptLoadingPromise) {
    window.__tvScriptLoadingPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://s3.tradingview.com/tv.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = (e) => reject(e);
      document.head.appendChild(script);
    });
  }
  return window.__tvScriptLoadingPromise;
}

function TradingViewChart({
  symbol,
  height = 420,
}: {
  symbol: string;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<string>(`tv_${Math.random().toString(36).slice(2)}`);
  const widgetRef = useRef<TVWidget | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function mountWidget() {
      setIsLoading(true);
      try {
        await loadTradingViewScript();
        if (cancelled) return;
        const el = containerRef.current;
        if (!el || !window.TradingView) return;

        el.id = idRef.current;
        const w = new (window.TradingView as TVLib).widget({
          autosize: true,
          symbol,
          interval: "15",
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1",
          locale: "en",
          hide_top_toolbar: true, // compact
          hide_legend: true, // compact
          container_id: idRef.current,
          backgroundColor: "rgba(0,0,0,0.2)",
          gridColor: "rgba(255,255,255,0.06)",
        });
        widgetRef.current = w;
        if (!cancelled)
          setTimeout(() => !cancelled && setIsLoading(false), 150);
      } catch {
        if (!cancelled) setIsLoading(false);
      }
    }
    void mountWidget();
    return () => {
      cancelled = true;
      try {
        widgetRef.current?.remove?.();
      } catch {}
      widgetRef.current = null;
    };
  }, [symbol]);

  return (
    <div className="relative w-full" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-white/50">Loading chart...</div>
        </div>
      )}
    </div>
  );
}

/* ======================= Utilities ======================= */

function formatQty(symbol: Coin, qty: number) {
  if (!Number.isFinite(qty)) return "0";
  const digits = symbol === "BTC" ? 5 : 6;
  return qty.toFixed(digits);
}
function toNum(v: string) {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/* ======================= Page ======================= */

export default function TradePage() {
  const [selectedCoin, setSelectedCoin] = useState<Coin>("BTC");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [side, setSide] = useState<"long" | "short">("long");
  const [leverage, _setLeverage] = useState<number>(10);
  const [baseQty, setBaseQty] = useState<string>(""); // base asset amount

  // Quote currency UI: USD or user's local currency
  const { user } = useUser();
  const userLocal = (user?.displayCurrency || "USD").toUpperCase();
  const [quote, setQuote] = useState<"USD" | "LOCAL">(
    userLocal === "USD" ? "USD" : "LOCAL"
  );

  // Limit price INPUT is in the SELECTED quote currency (USD or Local)
  const [limitPriceInput, setLimitPriceInput] = useState<string>("");

  const { deposit } = useBalances();
  const depositUsd = Number(deposit?.amountUsd ?? 0);
  const depositLoading = Boolean(deposit?.loading);
  const depositErr = deposit?.error || null;

  // FX for balance & quote conversions
  const {
    rate: usdToLocal,
    target: localCode,
    converted: depositLocal,
    loading: fxLoading,
  } = useFx(depositUsd);

  // clamp leverage to 1..MAX_LEVERAGE
  const setLeverage = (n: number) =>
    _setLeverage(Math.max(1, Math.min(MAX_LEVERAGE, n)));

  // selected coin meta + price feed
  const selectedCoinData = useMemo(
    () => COINS.find((c) => c.symbol === selectedCoin)!,
    [selectedCoin]
  );
  const priceFeedId = PYTH_FEEDS[selectedCoin];

  // live price via Pyth (USD)
  const {
    price: pythPriceUsd,
    lastUpdate,
    loading: pythLoading,
    error: pythErr,
  } = usePythPrice(priceFeedId, 10_000);

  // Convert price for display or limit input
  const priceDisplay =
    quote === "LOCAL" ? (pythPriceUsd ?? 0) * usdToLocal : pythPriceUsd ?? 0;

  // Parse limit input -> USD
  const limitInputNum = toNum(limitPriceInput);
  const limitUsd =
    orderType === "limit" && limitInputNum > 0
      ? quote === "LOCAL"
        ? limitInputNum / Math.max(usdToLocal, 1e-12)
        : limitInputNum
      : 0;

  // Effective USD price for calculations
  const effectivePriceUsd =
    orderType === "limit" && limitUsd > 0 ? limitUsd : pythPriceUsd ?? 0;

  /* ----------------------------- Perp math (USD) ----------------------------- */
  const qtyNum = toNum(baseQty); // base units
  const notionalUsd = qtyNum * (effectivePriceUsd || 0);
  const marginRequiredUsd = notionalUsd / Math.max(1, leverage);

  // Localized display helper
  const fmtQuote = (nUsd: number) =>
    quote === "LOCAL"
      ? formatMoney(nUsd * usdToLocal, localCode)
      : formatMoney(nUsd, "USD");

  const canTrade =
    qtyNum > 0 &&
    effectivePriceUsd > 0 &&
    marginRequiredUsd <= depositUsd &&
    leverage >= 1 &&
    leverage <= MAX_LEVERAGE;

  const handleTrade = () => {
    console.log({
      coin: selectedCoin,
      orderType,
      side,
      leverage,
      baseQty: qtyNum,
      priceUsedUsd: effectivePriceUsd,
      marginRequiredUsd,
      notionalUsd,
      lastUpdate,
      quoteSelected: quote === "LOCAL" ? localCode : "USD",
      fxRateUsdToLocal: usdToLocal,
    });
  };

  return (
    <div className="min-h-screen bg-black vision-perspective">
      <Blocker/>
      {/* subtle glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(40%_30%_at_50%_50%,rgba(182,255,62,0.08),transparent)]" />
      </div>

      <div className="relative container mx-auto px-4 py-4 md:py-6 max-w-[1800px]">
        {/* Asset switcher */}
        <div className="relative group mb-3">
          <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/10 via-transparent to-[rgb(182,255,62)]/10 rounded-3xl blur-xl opacity-50 pointer-events-none" />
          <div className="relative vision-window vision-depth rounded-3xl border border-white/10 bg-black/40 backdrop-blur-[40px] backdrop-saturate-[150%] p-3 md:p-4">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div className="flex flex-wrap items-stretch gap-2 md:gap-3">
                {COINS.map((coin) => {
                  const isSelected = selectedCoin === coin.symbol;
                  return (
                    <button
                      key={coin.symbol}
                      onClick={() => setSelectedCoin(coin.symbol)}
                      className={[
                        "flex items-center gap-2 md:gap-3 px-3 py-2 md:px-5 md:py-3 rounded-2xl transition-all duration-300 vision-button",
                        "min-w-[96px] md:min-w-[120px]",
                        isSelected
                          ? "border-[rgb(182,255,62)]/30 bg-[rgb(182,255,62)]/15 text-[rgb(182,255,62)] shadow-lg"
                          : "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white hover:border-white/20",
                      ].join(" ")}
                      aria-pressed={isSelected}
                    >
                      <Image
                        src={coin.logo || "/placeholder.svg"}
                        alt={coin.name}
                        width={22}
                        height={22}
                        className="rounded-full md:hidden"
                      />
                      <Image
                        src={coin.logo || "/placeholder.svg"}
                        alt={coin.name}
                        width={28}
                        height={28}
                        className="rounded-full hidden md:block"
                      />
                      <div className="text-left">
                        <div className="font-bold text-xs md:text-sm leading-tight">
                          {coin.symbol}
                        </div>
                        <div className="text-[10px] md:text-xs opacity-70 leading-tight">
                          {coin.name}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Quote currency toggle */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/60">Quote</span>
                <div className="bg-white/5 border border-white/10 rounded-xl p-1 flex">
                  <button
                    onClick={() => setQuote("USD")}
                    className={[
                      "px-3 py-1 text-xs rounded-lg",
                      quote === "USD"
                        ? "bg-white/10 text-white"
                        : "text-white/70 hover:bg-white/10",
                    ].join(" ")}
                    aria-pressed={quote === "USD"}
                  >
                    USD
                  </button>
                  <button
                    onClick={() => setQuote("LOCAL")}
                    className={[
                      "px-3 py-1 text-xs rounded-lg",
                      quote === "LOCAL"
                        ? "bg-white/10 text-white"
                        : "text-white/70 hover:bg-white/10",
                    ].join(" ")}
                    aria-pressed={quote === "LOCAL"}
                  >
                    {localCode}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chart + positions */}
          <div className="lg:col-span-2 space-y-4">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/10 via-transparent to-[rgb(182,255,62)]/10 rounded-3xl blur-xl opacity-50 pointer-events-none" />
              <div className="relative vision-window vision-depth rounded-3xl border border-white/10 bg-black/40 overflow-hidden">
                <TradingViewChart
                  symbol={selectedCoinData.tradingViewSymbol}
                  height={460}
                />
              </div>
            </div>

            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/10 via-transparent to-[rgb(182,255,62)]/10 rounded-3xl blur-xl opacity-50 pointer-events-none" />
              <div className="relative vision-window vision-depth rounded-3xl border border-white/10 bg-black/40 p-5">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <h3 className="text-white font-bold">Open Positions</h3>
                  <div className="text-xs text-white/60">
                    {pythLoading
                      ? "Updating price…"
                      : lastUpdate
                      ? `As of ${new Date(lastUpdate).toLocaleTimeString()}`
                      : ""}
                  </div>
                </div>
                <div className="text-center py-8 text-white/50">
                  No open positions
                </div>
              </div>
            </div>
          </div>

          {/* Order ticket */}
          <div className="lg:col-span-1">
            <div className="relative group sticky top-4">
              <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/10 via-transparent to-[rgb(182,255,62)]/10 rounded-3xl blur-xl opacity-50 pointer-events-none" />
              <div className="relative vision-window vision-depth rounded-3xl border border-white/10 bg-black/40 p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-white font-bold text-lg">Order</h2>
                  {/* Live last price */}
                  <div className="text-right">
                    <div className="text-xs text-white/60">Last Price</div>
                    <div className="text-white font-semibold">
                      {pythErr
                        ? "—"
                        : pythLoading && (pythPriceUsd ?? 0) === 0
                        ? "…"
                        : quote === "LOCAL"
                        ? formatMoney(priceDisplay, localCode)
                        : formatMoney(priceDisplay, "USD")}
                    </div>
                  </div>
                </div>

                {/* Balance */}
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-white/60 text-xs mb-1">
                        Available Margin
                      </div>
                      {depositErr ? (
                        <div className="text-xs text-red-300">{depositErr}</div>
                      ) : depositLoading || fxLoading ? (
                        <div className="h-6 w-36 rounded-md bg-white/10 animate-pulse" />
                      ) : (
                        <>
                          <div className="text-white font-bold text-xl">
                            {quote === "LOCAL"
                              ? formatMoney(depositLocal, localCode)
                              : formatMoney(depositUsd, "USD")}
                          </div>
                          <div className="text-[11px] text-white/50 mt-0.5">
                            ≈ {formatMoney(depositUsd, "USD")}
                          </div>
                        </>
                      )}
                    </div>
                    <button
                      onClick={() => deposit?.refresh?.()}
                      className="vision-button px-3 py-2 text-xs rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-[rgb(182,255,62)]/30 transition-all"
                      disabled={depositLoading}
                      aria-label="Refresh balance"
                    >
                      {depositLoading ? "…" : "Refresh"}
                    </button>
                  </div>
                </div>

                {/* Order type */}
                <div>
                  <label className="block text-white/80 text-xs font-semibold mb-2">
                    Order Type
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setOrderType("market")}
                      className={[
                        "flex-1 py-2.5 rounded-xl transition-all duration-300 vision-button text-sm font-semibold",
                        orderType === "market"
                          ? "bg-[rgb(182,255,62)]/15 border border-[rgb(182,255,62)]/30 text-[rgb(182,255,62)]"
                          : "bg-white/5 border border-white/10 text-white/70 hover:bg-white/10",
                      ].join(" ")}
                      aria-pressed={orderType === "market"}
                    >
                      Market
                    </button>
                    <button
                      onClick={() => setOrderType("limit")}
                      className={[
                        "flex-1 py-2.5 rounded-xl transition-all duration-300 vision-button text-sm font-semibold",
                        orderType === "limit"
                          ? "bg-[rgb(182,255,62)]/15 border border-[rgb(182,255,62)]/30 text-[rgb(182,255,62)]"
                          : "bg-white/5 border border-white/10 text-white/70 hover:bg-white/10",
                      ].join(" ")}
                      aria-pressed={orderType === "limit"}
                    >
                      Limit
                    </button>
                  </div>
                </div>

                {/* Limit price in selected quote (USD/Local) */}
                {orderType === "limit" && (
                  <div>
                    <label className="block text-white/80 text-xs font-semibold mb-2">
                      Limit Price ({quote === "LOCAL" ? localCode : "USD"})
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={limitPriceInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "" || /^\d*\.?\d*$/.test(val)) {
                          setLimitPriceInput(val);
                        }
                      }}
                      placeholder="0.00"
                      className="w-full px-4 py-3 bg-white/5 backdrop-blur-sm border border-white/20 rounded-xl text-white text-lg font-semibold placeholder-white/50 focus:outline-none focus:border-[rgb(182,255,62)]/50 focus:bg-white/10 transition-all duration-300"
                      aria-label={`Limit Price in ${
                        quote === "LOCAL" ? localCode : "USD"
                      }`}
                    />
                    {/* helper line to show the other currency */}
                    {limitPriceInput && (
                      <div className="mt-1 text-[11px] text-white/50">
                        ≈{" "}
                        {quote === "LOCAL"
                          ? formatMoney(
                              limitInputNum / Math.max(usdToLocal, 1e-12),
                              "USD"
                            )
                          : formatMoney(limitInputNum * usdToLocal, localCode)}
                      </div>
                    )}
                  </div>
                )}

                {/* Leverage */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-white/80 text-xs font-semibold">
                      Leverage (max {MAX_LEVERAGE}×)
                    </label>
                    <span className="text-[rgb(182,255,62)] font-bold">
                      {leverage}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={MAX_LEVERAGE}
                    value={leverage}
                    onChange={(e) => setLeverage(Number(e.target.value))}
                    className="w-full h-2 rounded-full appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, rgb(182,255,62) 0%, rgb(182,255,62) ${
                        (leverage / MAX_LEVERAGE) * 100
                      }%, rgba(255,255,255,0.1) ${
                        (leverage / MAX_LEVERAGE) * 100
                      }%, rgba(255,255,255,0.1) 100%)`,
                    }}
                    aria-valuemin={1}
                    aria-valuemax={MAX_LEVERAGE}
                    aria-valuenow={leverage}
                  />
                  <div className="flex justify-between text-[10px] text-white/50 mt-1">
                    <span>1x</span>
                    <span>10x</span>
                    <span>15x</span>
                    <span>20x</span>
                  </div>
                </div>

                {/* Base size */}
                <div>
                  <label className="block text-white/80 text-xs font-semibold mb-2">
                    Amount ({selectedCoin}) — Base Size
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={baseQty}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "" || /^\d*\.?\d*$/.test(val))
                        setBaseQty(val);
                    }}
                    placeholder="0.0000"
                    className="w-full px-4 py-3 bg-white/5 backdrop-blur-sm border border-white/20 rounded-xl text-white text-lg font-semibold placeholder-white/50 focus:outline-none focus:border-[rgb(182,255,62)]/50 focus:bg-white/10 transition-all duration-300"
                    aria-label={`Base size in ${selectedCoin}`}
                  />

                  {/* Quick-fill based on max notional at 20x */}
                  <div className="flex gap-2 mt-3">
                    {[25, 50, 75, 100].map((pct) => {
                      const targetQty =
                        effectivePriceUsd > 0
                          ? (depositUsd * MAX_LEVERAGE * (pct / 100)) /
                            effectivePriceUsd
                          : 0;
                      return (
                        <button
                          key={pct}
                          disabled={
                            depositLoading ||
                            pythLoading ||
                            effectivePriceUsd <= 0 ||
                            depositUsd <= 0
                          }
                          onClick={() =>
                            setBaseQty(formatQty(selectedCoin, targetQty))
                          }
                          className="flex-1 py-2 rounded-lg bg-white/5 border border-white/10 text-white/70 text-xs font-semibold hover:bg-white/10 hover:border-white/20 transition-all duration-300 disabled:opacity-50"
                          aria-label={`Set ${pct}% of max size`}
                        >
                          {pct}%
                        </button>
                      );
                    })}
                  </div>

                  {/* Margin guard */}
                  {marginRequiredUsd > depositUsd && qtyNum > 0 && (
                    <div className="mt-2 text-xs text-red-300">
                      Margin required ({fmtQuote(marginRequiredUsd)}) exceeds
                      your available balance ({fmtQuote(depositUsd)}).
                    </div>
                  )}
                </div>

                {/* Summary */}
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-white/60">Position Size</span>
                    <span className="text-white font-semibold">
                      {fmtQuote(notionalUsd)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-white/60">Margin Required</span>
                    <span className="text-white font-semibold">
                      {fmtQuote(marginRequiredUsd)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-white/60">Liquidation Price</span>
                    <span className="text-white font-semibold">—</span>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setSide("long");
                      handleTrade();
                    }}
                    disabled={!canTrade}
                    className="group/btn relative overflow-hidden flex-1 py-3.5 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed bg-[rgb(182,255,62)]/20 border border-[rgb(182,255,62)]/40 hover:bg-[rgb(182,255,62)]/30 hover:border-[rgb(182,255,62)]/60 hover:shadow-[0_8px_32px_rgba(182,255,62,0.3)] transition-all duration-300 backdrop-blur-sm font-bold text-[rgb(182,255,62)]"
                    aria-disabled={!canTrade}
                  >
                    <div className="absolute inset-0 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/15 to-transparent pointer-events-none" />
                    <div className="relative flex items-center justify-center gap-2">
                      <TrendingUp className="w-5 h-5" />
                      <span>Long</span>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      setSide("short");
                      handleTrade();
                    }}
                    disabled={!canTrade}
                    className="group/btn relative overflow-hidden flex-1 py-3.5 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed bg-red-500/20 border border-red-500/40 hover:bg-red-500/30 hover:border-red-500/60 hover:shadow-[0_8px_32px_rgba(239,68,68,0.3)] transition-all duration-300 backdrop-blur-sm font-bold text-red-400"
                    aria-disabled={!canTrade}
                  >
                    <div className="absolute inset-0 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/15 to-transparent pointer-events-none" />
                    <div className="relative flex items-center justify-center gap-2">
                      <TrendingDown className="w-5 h-5" />
                      <span>Short</span>
                    </div>
                  </button>
                </div>

                <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/30 flex gap-2">
                  <Info className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-yellow-500/90">
                    Trading perpetuals with leverage (max 20×) involves
                    significant risk. Only trade with funds you can afford to
                    lose.
                  </p>
                </div>
              </div>
            </div>
          </div>
          {/* /Order ticket */}
        </div>
      </div>
    </div>
  );
}
