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
import { TrendingUp, TrendingDown, Info, AlertCircle } from "lucide-react";
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

const FIXED_LEVERAGE = 1.5;

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

/* ======================= Helpers ======================= */

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

function toNum(v: string) {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/* ======================= Main Page ======================= */

type PositionSummary = {
  id: string;
  symbol: string;
  boostedNotionalUsd: number;
  pnlUsd: number;
  liquidationUsd: number | null;
};

export default function TradeBoosterPage() {
  const [selectedCoin, setSelectedCoin] = useState<Coin>("BTC");
  const [side, setSide] = useState<"long" | "short">("long");
  const [depositAmount, setDepositAmount] = useState<string>("");
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

  const fx = fxRate || 1;
  const formatLocal = (n: number) => formatMoney(n, currency);
  const availableLocal = depositUsd * fx;

  // selected coin meta + price feed
  const selectedCoinData = useMemo(
    () => COINS.find((c) => c.symbol === selectedCoin)!,
    [selectedCoin]
  );
  const priceFeedId = PYTH_FEEDS[selectedCoin];

  // live price via Pyth (USD)
  const { price: pythPriceUsd } = usePythPrice(priceFeedId, 10_000);

  /* ----------------------------- Booster Math ----------------------------- */

  const depositLocal = toNum(depositAmount);

  const depositUsdFromInput = fx > 0 ? depositLocal / fx : depositLocal || 0;

  const boostedUsd = depositUsdFromInput * FIXED_LEVERAGE;
  const boostedLocal = boostedUsd * fx;

  const qtyAtCurrentPrice =
    pythPriceUsd && pythPriceUsd > 0 ? boostedUsd / pythPriceUsd : 0;

  const marginUsd = depositUsdFromInput;
  const liquidationUsd =
    pythPriceUsd && pythPriceUsd > 0 && qtyAtCurrentPrice > 0
      ? side === "long"
        ? pythPriceUsd - marginUsd / qtyAtCurrentPrice
        : pythPriceUsd + marginUsd / qtyAtCurrentPrice
      : 0;

  const liquidationLocal = liquidationUsd * fx;

  const canTrade =
    depositUsdFromInput > 0 &&
    pythPriceUsd &&
    pythPriceUsd > 0 &&
    disclaimerAccepted &&
    depositUsdFromInput <= depositUsd;

  const handleTrade = () => {
    console.log({
      coin: selectedCoin,
      side,
      depositLocal,
      depositUsd: depositUsdFromInput,
      boostedUsd,
      boostedLocal,
      currentPriceUsd: pythPriceUsd,
      positionSize: qtyAtCurrentPrice,
      liquidationUsd,
      liquidationLocal,
      leverage: FIXED_LEVERAGE,
    });
  };

  const handleDisclaimerScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 16) {
      setHasScrolledDisclaimer(true);
    }
  };

  const depositExceedsBalance =
    depositUsdFromInput > depositUsd && depositLocal > 0;

  /* ---------------------- Portfolio stats (placeholder) ------------------- */

  const positions: PositionSummary[] = [];

  const totalBoostedUsd = positions.reduce(
    (sum, p) => sum + (p.boostedNotionalUsd || 0),
    0
  );
  const totalPnlUsd = positions.reduce((sum, p) => sum + (p.pnlUsd || 0), 0);

  const liquidationLevelsLocal = positions
    .filter((p) => p.liquidationUsd != null)
    .map((p) => ({
      id: p.id,
      symbol: p.symbol,
      local: (p.liquidationUsd as number) * fx,
    }));

  const totalBoostedLocal = totalBoostedUsd * fx;
  const totalPnlLocal = totalPnlUsd * fx;

  const pnlColor =
    totalPnlLocal > 0
      ? "text-emerald-400"
      : totalPnlLocal < 0
      ? "text-red-400"
      : "text-white/60";

  return (
    <>
      {/* Under construction blocker overlay */}
      <Blocker
        pageNameOverride="Trade Booster"
        descriptionOverride="You are seeing a prototype version of Trade Booster. Some functionality may be missing or not working yet."
      />

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

          {/* Portfolio stats bar */}
          <div className="mb-5 sm:mb-6">
            <div className="relative rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl px-3 py-3 sm:px-4 sm:py-4">
              <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 via-transparent to-transparent" />

              <div className="relative space-y-3 sm:space-y-4 text-xs sm:text-sm">
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <div className="text-white/50 mb-1">
                      Total boosted portfolio
                    </div>
                    <div className="text-white font-semibold text-sm sm:text-base">
                      {formatLocal(totalBoostedLocal || 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-white/50 mb-1">Portfolio P&amp;L</div>
                    <div
                      className={`font-semibold text-sm sm:text-base ${pnlColor}`}
                    >
                      {formatLocal(totalPnlLocal || 0)}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-white/50 mb-1 text-xs sm:text-sm">
                    Liquidation levels
                  </div>
                  {liquidationLevelsLocal.length === 0 ? (
                    <div className="text-white/50 text-[0.7rem] sm:text-xs">
                      No liquidation levels yet.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 sm:gap-2">
                      {liquidationLevelsLocal.map((lvl) => (
                        <span
                          key={lvl.id}
                          className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[0.65rem] sm:text-xs text-white/80"
                        >
                          <span className="text-white/60 uppercase text-[0.6rem]">
                            {lvl.symbol}
                          </span>
                          <span className="font-semibold">
                            {formatLocal(lvl.local)}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {showDisclaimer && !disclaimerAccepted && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-xl flex items-center justify-center z-50 p-4">
              <div className="relative group w-full max-w-3xl max-h-[90vh]">
                <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/25 via-transparent to-[rgb(182,255,62)]/25 rounded-3xl blur-xl opacity-60" />

                <div className="relative rounded-3xl border border-white/20 bg-black/70 backdrop-blur-[40px] backdrop-saturate-[200%] shadow-[0_32px_64px_rgba(0,0,0,0.5)] px-6 py-6 md:px-8 md:py-8 flex flex-col h-full max-h-[90vh]">
                  <div className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-br from-white/5 via-transparent to-transparent" />

                  {/* Header */}
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

                  {/* Scrollable content container */}
                  <div
                    ref={scrollRef}
                    onScroll={handleDisclaimerScroll}
                    className="relative flex-1 overflow-y-auto pr-2 -mr-2 space-y-5 rounded-2xl border border-white/10 bg-black/40 px-4 py-4 md:px-5 md:py-5"
                  >
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-black/80 to-transparent" />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/90 via-black/70 to-transparent" />

                    <div className="space-y-5 text-white/80 text-sm md:text-base relative">
                      {/* Fixed leverage explanation */}
                      <div className="p-4 rounded-2xl border border-[rgb(182,255,62)]/20 bg-[rgb(182,255,62)]/5">
                        <p className="font-semibold text-[rgb(182,255,62)] mb-2">
                          💰 Fixed 1.5× Leverage Boost
                        </p>
                        <p>
                          When you deposit funds, we automatically provide{" "}
                          <strong>1.5× exposure</strong> to your chosen crypto.
                          For example, if you deposit the equivalent of 100 in
                          your currency, you will hold 150 worth of that coin.
                          Your deposit acts as{" "}
                          <strong>margin (collateral)</strong>.
                        </p>
                      </div>

                      {/* Long trades */}
                      <div className="p-4 rounded-2xl border border-green-500/20 bg-green-500/5">
                        <p className="font-semibold text-green-400 mb-3">
                          📈 LONG Trades (Bet on Price Going Up)
                        </p>
                        <p className="mb-3">
                          Select Long if you believe the price will{" "}
                          <strong>increase</strong>. We use your boosted
                          exposure to buy the coin at the current price.
                        </p>
                        <ul className="list-disc list-inside space-y-2 text-white/70 text-xs md:text-sm ml-2">
                          <li>
                            <strong>How you profit:</strong> Price goes up and
                            your boosted crypto position becomes worth more than
                            your entry.
                          </li>
                          <li>
                            <strong>How you lose:</strong> Price goes down and
                            unrealized losses eat into your margin (your
                            deposit).
                          </li>
                          <li>
                            <strong>Liquidation:</strong> If price drops to your
                            liquidation level, your position is closed and your
                            deposit can be lost.
                          </li>
                        </ul>
                      </div>

                      {/* Short trades */}
                      <div className="p-4 rounded-2xl border border-red-500/20 bg-red-500/5">
                        <p className="font-semibold text-red-400 mb-3">
                          📉 SHORT Trades (Bet on Price Going Down)
                        </p>
                        <p className="mb-3">
                          Select Short if you believe the price will{" "}
                          <strong>decrease</strong>. We short-sell the coin
                          using your boosted exposure.
                        </p>
                        <ul className="list-disc list-inside space-y-2 text-white/70 text-xs md:text-sm ml-2">
                          <li>
                            <strong>How you profit:</strong> Price goes down and
                            you close the position at a lower price and keep the
                            difference.
                          </li>
                          <li>
                            <strong>How you lose:</strong> Price goes up and
                            your losses increase as the price moves higher.
                          </li>
                          <li>
                            <strong>Liquidation:</strong> If price rises to your
                            liquidation level, your position is closed and your
                            deposit can be lost.
                          </li>
                        </ul>
                      </div>

                      {/* Liquidation details */}
                      <div className="p-4 rounded-2xl border border-blue-500/20 bg-blue-500/5">
                        <p className="font-semibold text-blue-400 mb-2">
                          ⚠️ Understanding Liquidation
                        </p>
                        <p className="mb-2">
                          Your deposit works as <strong>margin</strong>.
                          Liquidation happens when your losses approach the size
                          of your deposit. At that point, your position is
                          forcibly closed to prevent further loss.
                        </p>
                        <p>
                          The liquidation level depends on your entry price,
                          direction (long or short), and the amount of leverage.
                          Once liquidated, your <strong>entire deposit</strong>{" "}
                          may be used to cover losses and is no longer available
                          to you.
                        </p>
                      </div>

                      {/* Why 1.5x */}
                      <div className="p-4 rounded-2xl border border-yellow-500/20 bg-yellow-500/5">
                        <p className="font-semibold text-yellow-400 mb-2">
                          🎯 Why 1.5× Is Milder Than High Leverage
                        </p>
                        <p className="mb-2">
                          Traditional leveraged trading platforms can offer 10×,
                          20×, or even higher leverage. At those levels, small
                          price moves can quickly trigger liquidation.
                        </p>
                        <p>
                          With fixed 1.5× leverage, price has to move further
                          before liquidation, making risk more manageable than
                          very high leverage products. However, you can still
                          lose 100 percent of your deposit.
                        </p>
                      </div>

                      {/* General risk warning */}
                      <div className="p-4 rounded-2xl border border-red-500/30 bg-red-500/10">
                        <p className="font-semibold text-red-400 mb-2">
                          🚨 General Risk Warning
                        </p>
                        <ul className="list-disc list-inside space-y-2 text-white/80 text-xs md:text-sm ml-2">
                          <li>
                            Crypto markets are volatile and can move quickly in
                            either direction.
                          </li>
                          <li>
                            Leveraged trading amplifies both gains and losses.
                          </li>
                          <li>You can lose your entire deposit.</li>
                          <li>
                            Past performance does not guarantee future returns.
                          </li>
                          <li>
                            Only trade with funds you can afford to lose
                            completely.
                          </li>
                        </ul>
                      </div>

                      {/* Final acknowledgment text at bottom */}
                      <div className="p-4 rounded-2xl border border-white/15 bg-white/5">
                        <p className="text-xs md:text-sm text-white/80">
                          By continuing, you confirm that you understand how
                          Trade Booster works, that leveraged trading carries
                          significant risk, and that you alone are responsible
                          for any losses.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Footer actions */}
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

          {/* Main content: mobile-first stacked, then side-by-side on large */}
          <div className="flex flex-col lg:grid lg:grid-cols-3 lg:gap-6">
            {/* Left side: coin selector + chart */}
            <div className="lg:col-span-2 space-y-4 lg:space-y-5">
              {/* Coin selector */}
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

              {/* Chart */}
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/10 via-transparent to-[rgb(182,255,62)]/10 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-500 pointer-events-none" />
                <div className="relative rounded-3xl border border-white/10 bg-black/20 backdrop-blur-[20px] backdrop-saturate-[150%] overflow-hidden">
                  <TradingViewChart
                    symbol={selectedCoinData.tradingViewSymbol}
                    height={340}
                  />
                </div>
              </div>
            </div>

            {/* Right column: trade form */}
            <div className="mt-4 lg:mt-0 lg:col-span-1">
              <div className="relative group lg:sticky lg:top-4">
                <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/10 via-transparent to-[rgb(182,255,62)]/10 rounded-3xl blur-xl opacity-50 pointer-events-none" />
                <div className="relative rounded-3xl border border-white/10 bg-black/20 backdrop-blur-[20px] backdrop-saturate-[150%] p-4 sm:p-6 space-y-4 sm:space-y-5">
                  <div>
                    <h2 className="text-white font-bold text-lg sm:text-xl mb-4 text-balance">
                      Boost Your Crypto
                    </h2>

                    {/* Balance */}
                    <div className="p-3 sm:p-4 rounded-2xl bg-white/5 border border-white/10 mb-4 sm:mb-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-white/60 text-[0.65rem] sm:text-xs mb-1 font-medium">
                            Available Balance
                          </div>
                          {depositErr ? (
                            <div className="text-xs text-red-300">
                              {depositErr}
                            </div>
                          ) : depositLoading ? (
                            <div className="h-6 w-28 sm:w-32 rounded-md bg-white/10 animate-pulse" />
                          ) : (
                            <div className="text-white font-bold text-lg sm:text-xl">
                              {formatLocal(availableLocal)}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => deposit?.refresh?.()}
                          className="px-3 py-1.5 text-[0.65rem] sm:text-xs rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white/70 hover:text-white transition-all duration-300 disabled:opacity-50 font-semibold whitespace-nowrap"
                          disabled={depositLoading}
                          aria-label="Refresh balance"
                        >
                          {depositLoading ? "…" : "Refresh"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Direction */}
                  <div>
                    <label className="block text-white/80 text-[0.65rem] sm:text-xs font-semibold mb-2 sm:mb-3 uppercase tracking-wider">
                      Direction
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setSide("long")}
                        className={[
                          "flex-1 py-2.5 sm:py-3 rounded-xl transition-all duration-300 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 sm:gap-2",
                          side === "long"
                            ? "bg-[rgb(182,255,62)]/15 border border-[rgb(182,255,62)]/30 text-[rgb(182,255,62)] shadow-[0_6px_18px_rgba(182,255,62,0.2)]"
                            : "bg-white/5 border border-white/10 text-white/70 hover:bg-white/10",
                        ].join(" ")}
                        aria-pressed={side === "long"}
                      >
                        <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        Long
                      </button>
                      <button
                        onClick={() => setSide("short")}
                        className={[
                          "flex-1 py-2.5 sm:py-3 rounded-xl transition-all duration-300 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 sm:gap-2",
                          side === "short"
                            ? "bg-red-500/15 border border-red-500/30 text-red-400 shadow-[0_6px_18px_rgba(239,68,68,0.2)]"
                            : "bg-white/5 border border-white/10 text-white/70 hover:bg-white/10",
                        ].join(" ")}
                        aria-pressed={side === "short"}
                      >
                        <TrendingDown className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        Short
                      </button>
                    </div>
                  </div>

                  {/* Deposit Amount */}
                  <div>
                    <label className="block text-white/80 text-[0.65rem] sm:text-xs font-semibold mb-2 sm:mb-3 uppercase tracking-wider">
                      Amount to boost ({currency})
                    </label>
                    <div className="relative group/input">
                      <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/20 via-transparent to-[rgb(182,255,62)]/20 rounded-2xl blur-xl opacity-0 group-focus-within/input:opacity-100 transition-all duration-500 pointer-events-none" />
                      <input
                        type="text"
                        inputMode="decimal"
                        value={depositAmount}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === "" || /^\d*\.?\d*$/.test(val)) {
                            setDepositAmount(val);
                          }
                        }}
                        placeholder="0.00"
                        className="relative w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-white/5 backdrop-blur-sm border border-white/20 rounded-2xl text-sm sm:text-lg text-white font-semibold placeholder-white/50 focus:outline-none focus:border-[rgb(182,255,62)]/50 focus:bg-white/10 transition-all duration-300"
                        aria-label="Deposit amount to boost"
                      />
                    </div>

                    {/* Quick-fill */}
                    <div className="flex gap-1.5 sm:gap-2 mt-2 sm:mt-3">
                      {[25, 50, 75, 100].map((pct) => (
                        <button
                          key={pct}
                          disabled={depositLoading || depositUsd <= 0}
                          onClick={() => {
                            const amountLocal = (availableLocal * pct) / 100;
                            setDepositAmount(amountLocal.toFixed(2));
                          }}
                          className="flex-1 py-1.5 sm:py-2 rounded-lg bg-white/5 border border-white/10 text-white/70 text-[0.65rem] sm:text-xs font-semibold hover:bg-white/10 hover:border-white/20 transition-all disabled:opacity-50"
                          aria-label={`Set ${pct}% of balance`}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>

                    {/* Validation */}
                    {depositExceedsBalance && (
                      <div className="mt-2 sm:mt-3 p-2.5 sm:p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-[0.65rem] sm:text-xs text-red-300">
                        Amount exceeds available balance
                      </div>
                    )}
                  </div>

                  <div className="p-3 sm:p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2.5 sm:space-y-3">
                    <div className="flex justify-between text-[0.7rem] sm:text-sm">
                      <span className="text-white/60">
                        Margin (Your Deposit)
                      </span>
                      <span className="text-white font-semibold">
                        {formatLocal(depositLocal || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between text-[0.7rem] sm:text-sm">
                      <span className="text-white/60">
                        Trading Power (1.5×)
                      </span>
                      <span className="text-[rgb(182,255,62)] font-semibold">
                        {formatLocal(boostedLocal || 0)}
                      </span>
                    </div>
                    <div className="border-t border-white/10 pt-2 sm:pt-3">
                      <div className="flex justify-between text-[0.7rem] sm:text-sm">
                        <span className="text-white/60">
                          Estimated Liquidation Price
                        </span>
                        <span
                          className={
                            side === "long" ? "text-red-400" : "text-blue-400"
                          }
                        >
                          {formatLocal(liquidationLocal || 0)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Action button */}
                  <button
                    onClick={handleTrade}
                    disabled={!canTrade}
                    className={[
                      "group/btn relative overflow-hidden w-full py-3 sm:py-4 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 backdrop-blur-sm font-bold text-base sm:text-lg flex items-center justify-center gap-2",
                      side === "long"
                        ? "bg-[rgb(182,255,62)]/20 border border-[rgb(182,255,62)]/40 hover:bg-[rgb(182,255,62)]/30 hover:border-[rgb(182,255,62)]/60 hover:shadow-[0_8px_32px_rgba(182,255,62,0.3)] text-[rgb(182,255,62)]"
                        : "bg-red-500/20 border border-red-500/40 hover:bg-red-500/30 hover:border-red-500/60 hover:shadow-[0_8px_32px_rgba(239,68,68,0.3)] text-red-400",
                    ].join(" ")}
                    aria-disabled={!canTrade}
                  >
                    <div className="absolute inset-0 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/15 to-transparent pointer-events-none" />
                    <div className="relative flex items-center justify-center gap-2">
                      {side === "long" ? (
                        <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5" />
                      ) : (
                        <TrendingDown className="w-4 h-4 sm:w-5 sm:h-5" />
                      )}
                      <span>
                        {side === "long" ? "Boost Long" : "Boost Short"}
                      </span>
                    </div>
                  </button>

                  {!disclaimerAccepted && (
                    <div className="p-2.5 sm:p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/30 flex gap-2">
                      <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                      <p className="text-[0.65rem] sm:text-xs text-yellow-500/90 font-medium">
                        Please accept the Trade Booster terms before placing a
                        leveraged trade.
                      </p>
                    </div>
                  )}

                  <div className="p-2.5 sm:p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 flex gap-2">
                    <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                    <p className="text-[0.65rem] sm:text-xs text-blue-500/90">
                      💡 Trade Booster increases the amount of crypto you hold
                      by 1.5×, but it also increases risk. Only boost what you
                      can afford to lose.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
