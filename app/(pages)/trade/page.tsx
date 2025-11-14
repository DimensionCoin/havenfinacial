"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from "react";
import Image from "next/image";
import TradingViewChart from "@/components/invest/TradingViewAdvanced";
import { AlertCircle } from "lucide-react";
import { useBalances } from "@/providers/BalanceProvider";
import { useUser } from "@/providers/UserProvider";
import Positions from "@/components/booster/Positions";
import Trade from "@/components/booster/Trade";

/* ======================= Pyth Hermes SSE hook ======================= */

type HermesParsedPrice = {
  price: { price: string; expo: number; conf?: string; publish_time?: number };
  ema_price?: {
    price: string;
    expo: number;
    conf?: string; // confidence interval
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
  price: number | null;
  lastUpdate: number | null;
  loading: boolean;
  error: string | null;
};

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

          const px = raw * Math.pow(10, expo);
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

/* ======================= Constants ======================= */

type Coin = "BTC" | "SOL" | "ETH";

type CoinData = {
  symbol: Coin;
  name: string;
  logo: string;
  tradingViewSymbol: string;
};

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

const PYTH_FEEDS: Record<Coin, string> = {
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SOL: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
};

const DISCLAIMER_STORAGE_KEY = "haven.tradeBooster.disclaimer.v1";
const DISCLAIMER_TTL_MS = 30 * 24 * 60 * 60 * 1000; // ~30 days

/* ======================= Main Page ======================= */

export default function TradeBoosterPage() {
  const [selectedCoin, setSelectedCoin] = useState<Coin>("BTC");
  const [side, setSide] = useState<"long" | "short">("long");

  const [showDisclaimer, setShowDisclaimer] = useState(true);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [hasScrolledDisclaimer, setHasScrolledDisclaimer] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { user } = useUser();
  const { deposit } = useBalances();

  const currency = (user?.displayCurrency || "USD").toUpperCase();
  const depositUsd = Number(deposit?.amountUsd ?? 0);
  const depositLoading = Boolean(deposit?.loading);
  const depositErr = deposit?.error || null;

  const [fxRate, setFxRate] = useState<number>(1);

  // 🔁 shared state between Trade & Positions (still needed)
  const [positionsRefreshKey, setPositionsRefreshKey] = useState(0);

  const handlePositionMutated = useCallback(() => {
    // Delay the refresh a bit so the new position is definitely
    // committed on-chain and visible to /api/booster/positions
    setTimeout(() => {
      setPositionsRefreshKey((k) => k + 1);
    }, 5000); // 5 seconds
  }, []);

  const refreshFx = useCallback(async () => {
    if (currency === "USD") {
      setFxRate(1);
      return;
    }
    try {
      const r = await fetch(
        `/api/fx?currency=${encodeURIComponent(currency)}&amount=1`,
        {
          credentials: "include",
          cache: "no-store",
        }
      );
      if (!r.ok) throw new Error("fx");
      const j = await r.json();
      setFxRate(Number(j?.rate || 1));
    } catch {
      setFxRate(1);
    }
  }, [currency]);

  useEffect(() => {
    void refreshFx();
  }, [refreshFx]);

  // Only show disclaimer once per month (per browser)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DISCLAIMER_STORAGE_KEY);
      if (!raw) {
        // Never accepted → show it
        setShowDisclaimer(true);
        setDisclaimerAccepted(false);
        return;
      }

      const parsed = JSON.parse(raw) as { acceptedAt?: number };
      const acceptedAt =
        typeof parsed?.acceptedAt === "number" ? parsed.acceptedAt : 0;
      const now = Date.now();

      if (acceptedAt && now - acceptedAt < DISCLAIMER_TTL_MS) {
        // Still within 30 days
        setDisclaimerAccepted(true);
        setShowDisclaimer(false);
      } else {
        // Expired or invalid
        setDisclaimerAccepted(false);
        setShowDisclaimer(true);
      }
    } catch {
      // On any error, be safe and show it
      setShowDisclaimer(true);
      setDisclaimerAccepted(false);
    }
  }, []);

  const fx = fxRate || 1;

  const selectedCoinData = useMemo(
    () => COINS.find((c) => c.symbol === selectedCoin)!,
    [selectedCoin]
  );
  const priceFeedId = PYTH_FEEDS[selectedCoin];

  const { price: pythPriceUsd } = usePythPrice(priceFeedId, 10_000);

  const handleDisclaimerScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 16) {
      setHasScrolledDisclaimer(true);
    }
  };

  return (
    <>
      <div className="min-h-screen bg-black/10 vision-perspective">
        <div className="fixed inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-[radial-gradient(40%_30%_at_50%_50%,rgba(182,255,62,0.06),transparent)]" />
        </div>

        <div className="relative container mx-auto px-3 sm:px-4 py-4 md:py-6 max-w-[1800px]">
          <div className="mb-4 sm:mb-6">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-1 sm:mb-2 text-balance">
              Trade Booster
            </h1>
            <p className="text-white/60 text-sm sm:text-base max-w-xl">
              We boost your deposits by 1.5× to increase the amount of crypto
              you hold, always shown in your currency.
            </p>
          </div>

          <div className="mb-5 sm:mb-6">
            {/* Positions just gets refreshKey now */}
            <Positions
              // you'll add this prop to Positions: refreshKey?: number
              refreshKey={positionsRefreshKey}
            />
          </div>

          {showDisclaimer && !disclaimerAccepted && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-xl flex items-center justify-center z-50 p-4">
              <div className="relative group w-full max-w-3xl max-h-[90vh]">
                <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/25 via-transparent to-[rgb(182,255,62)]/25 rounded-3xl blur-xl opacity-60" />
                <div className="relative rounded-3xl border border-white/20 bg-black/70 backdrop-blur-[40px] backdrop-saturate-[200%] shadow-[0_32px_64px_rgba(0,0,0,0.5)] px-6 py-6 md:px-8 md:py-8 flex flex-col h-full max-h-[90vh]">
                  <div className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-br from-white/5 via-transparent to-transparent" />

                  <div className="relative flex items-start gap-3 mb-4 md:mb-6">
                    <div className="mt-1">
                      <AlertCircle className="w-6 h-6 text-[rgb(182,255,62)] flex-shrink-0" />
                    </div>
                    <div>
                      <h2 className="text-2xl md:text-3xl font-bold text-white mb-2">
                        Trade Booster – Important Information
                      </h2>
                      <p className="text-white/70 text-sm md:text-base">
                        Trade Booster increases your crypto exposure with fixed{" "}
                        <strong>1.5× leverage</strong> on your deposits. Before
                        you continue, please review how it works and the risks
                        involved.
                      </p>
                    </div>
                  </div>

                  <div
                    ref={scrollRef}
                    onScroll={handleDisclaimerScroll}
                    className="relative flex-1 overflow-y-auto pr-2 -mr-2 space-y-5 rounded-2xl border border-white/10 bg-black/40 px-4 py-4 md:px-5 md:py-5"
                  >
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-black/80 to-transparent" />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/90 via-black/70 to-transparent" />

                    <div className="space-y-5 text-white/80 text-sm md:text-base relative">
                      {/* ... disclaimer content unchanged ... */}
                    </div>
                  </div>

                  <div className="relative pt-4 mt-4 border-t border-white/10 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="text-xs text-white/50 md:max-w-xs">
                      {hasScrolledDisclaimer ? (
                        <span>
                          Ready when you are. You can now accept below.
                        </span>
                      ) : (
                        <span>
                          Scroll to the bottom of the information above to
                          enable the accept button.
                        </span>
                      )}
                    </div>

                    <div className="flex gap-3 mt-2 md:mt-0">
                      <button
                        onClick={() => setShowDisclaimer(false)}
                        className="flex-1 py-3 rounded-xl bg-white/5 border border-white/25 hover:bg-white/10 text-white font-semibold transition-all duration-300 backdrop-blur-sm"
                      >
                        Decline
                      </button>
                      <button
                        onClick={() => {
                          if (!hasScrolledDisclaimer) return;
                          setDisclaimerAccepted(true);
                          setShowDisclaimer(false);
                          try {
                            if (typeof window !== "undefined") {
                              window.localStorage.setItem(
                                DISCLAIMER_STORAGE_KEY,
                                JSON.stringify({ acceptedAt: Date.now() })
                              );
                            }
                          } catch {
                            // ignore localStorage failure
                          }
                        }}
                        disabled={!hasScrolledDisclaimer}
                        className="flex-1 py-3 rounded-xl bg-[rgb(182,255,62)]/20 border border-[rgb(182,255,62)]/40 hover:bg-[rgb(182,255,62)]/30 text-[rgb(182,255,62)] font-semibold transition-all duration-300 backdrop-blur-sm hover:shadow-[0_8px_32px_rgba(182,255,62,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        I Understand &amp; Accept
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Main content */}
          <div className="flex flex-col lg:grid lg:grid-cols-3 lg:gap-6">
            {/* Left side: selector + chart */}
            <div className="lg:col-span-2 space-y-4 lg:space-y-5">
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/10 via-transparent to-[rgb(182,255,62)]/10 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-500 pointer-events-none" />
                <div className="relative rounded-3xl border border-white/10 bg-black/20 backdrop-blur-[20px] backdrop-saturate-[150%] px-3 py-3 sm:px-4 sm:py-4">
                  <h3 className="text-white/80 text-[0.65rem] sm:text-xs font-semibold mb-3 uppercase tracking-wider text-center">
                    Select Coin
                  </h3>
                  <div className="flex gap-2 overflow-x-auto no-scrollbar py-1 justify-center md:justify-start">
                    {COINS.map((coin) => {
                      const isSelected = selectedCoin === coin.symbol;
                      return (
                        <button
                          key={coin.symbol}
                          onClick={() => setSelectedCoin(coin.symbol)}
                          className={[
                            "flex-shrink-0 flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-2.5 rounded-2xl transition-all duration-300 min-w-[110px] sm:min-w-[130px]",
                            isSelected
                              ? "border border-[rgb(182,255,62)]/40 bg-[rgb(182,255,62)]/15 text-[rgb(182,255,62)] shadow-[0_6px_18px_rgba(182,255,62,0.2)]"
                              : "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white hover:border-white/20",
                          ].join(" ")}
                          aria-pressed={isSelected}
                        >
                          <Image
                            src={coin.logo || "/placeholder.svg"}
                            alt={coin.name}
                            width={20}
                            height={20}
                            className="rounded-full h-5 w-5 sm:h-6 sm:w-6"
                          />
                          <div className="text-left">
                            <div className="font-bold text-xs sm:text-sm">
                              {coin.symbol}
                            </div>
                            <div className="text-[0.6rem] sm:text-[0.7rem] opacity-70">
                              {coin.name}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/10 via-transparent to-[rgb(182,255,62)]/10 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-500 pointer-events-none" />
                <div className="relative rounded-3xl border border-white/10 bg-black/20 backdrop-blur-[20px] backdrop-saturate-[150%] overflow-hidden">
                  <TradingViewChart
                    symbol={selectedCoinData.tradingViewSymbol}
                    height={430}
                  />
                </div>
                <p className="text-[0.65rem] text-white/40 text-right">
                  Chart shown in USD
                </p>
              </div>
            </div>

            {/* Right side: booster trade component */}
            <div className="mt-4 lg:mt-0 lg:col-span-1">
              <div className="relative group lg:sticky lg:top-4">
                <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/10 via-transparent to-[rgb(182,255,62)]/10 rounded-3xl blur-xl opacity-50 pointer-events-none" />
                <div className="relative rounded-3xl border border-white/10 bg-black/20 backdrop-blur-[20px] backdrop-saturate-[150%] p-4 sm:p-6">
                  <Trade
                    selectedCoin={selectedCoin}
                    side={side}
                    setSide={setSide}
                    currency={currency}
                    depositUsd={depositUsd}
                    depositLoading={depositLoading}
                    depositErr={depositErr}
                    onRefreshDeposit={deposit?.refresh ?? (() => {})}
                    fxRate={fx}
                    priceUsd={pythPriceUsd}
                    disclaimerAccepted={disclaimerAccepted}
                    onPositionChange={handlePositionMutated}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
