"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, RefreshCw } from "lucide-react";
import {
  findTokenBySymbol,
  getMintFor,
  type TokenMeta,
} from "@/lib/tokens";
import TradingViewAdvanced from "@/components/invest/TradingViewAdvanced";

import { useUser } from "@/providers/UserProvider";
import { usePrivy } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { useServerSponsoredJupSwap } from "@/hooks/useServerSponsoredJupSwap";
import { useServerSponsoredJupSell } from "@/hooks/useServerSponsoredJupSell";

import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { toast } from "react-hot-toast";

/* -------------------------------- config -------------------------------- */

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC!;
const MAINNET = "mainnet";

const JUP_PRICE_BASE =
  process.env.NEXT_PUBLIC_JUP_PRICE_BASE || "https://lite-api.jup.ag/price/v3";
const JUP_QUOTE_BASE =
  process.env.NEXT_PUBLIC_JUP_QUOTE_BASE ||
  "https://lite-api.jup.ag/swap/v1/quote";

const USDC_MAINNET =
  process.env.NEXT_PUBLIC_USDC_MAINNET_MINT ||
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;
const FLAT_FEE_USD = 0.25;

/* -------------------------------- utils --------------------------------- */

function fmtMoney(v?: number | null, currency = "USD") {
  if (v == null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: v < 1 ? 6 : 2,
  }).format(v);
}
function fmtPct(p?: number | null) {
  if (typeof p !== "number" || !Number.isFinite(p)) return "—";
  const sign = p === 0 ? "" : p > 0 ? "+" : "";
  return `${sign}${p.toFixed(2)}%`;
}
const uiStringFromRaw = (raw: bigint, decimals: number) => {
  const s = raw.toString();
  if (decimals <= 0) return s;
  const split = s.length - decimals;
  if (split <= 0) return `0.${"0".repeat(-split)}${s}`;
  return `${s.slice(0, split)}.${s.slice(split)}`;
};
const rawFromUiString = (v: string, decimals: number): bigint => {
  const TEN = BigInt(10);
  const [whole = "0", frac = ""] = (v || "0").split(".");
  const fracPadded = frac.padEnd(decimals, "0").slice(0, decimals);
  return (
    BigInt(whole || "0") * TEN ** BigInt(decimals) + BigInt(fracPadded || "0")
  );
};

/* -------------------------------- types --------------------------------- */

type PriceResp = Record<
  string,
  { usdPrice: number; priceChange24h?: number; decimals?: number }
>;
type JupPriceResponse = Record<
  string,
  { usdPrice: number; decimals: number; priceChange24h?: number }
>;
type JupQuote = {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  priceImpactPct: string;
} | null;

/* -------------------------------- page ---------------------------------- */

type TokenChartPageProps = {
  params: Promise<{ symbol: string }>;
};

export default function TokenChartPage({ params }: TokenChartPageProps) {
  const resolvedParams = use(params);
  const symbolParam = (resolvedParams?.symbol || "").toUpperCase();
  const token = useMemo(() => findTokenBySymbol(symbolParam), [symbolParam]);

  if (!token) {
    return (
      <div className="min-h-screen grid place-items-center bg-black/20 p-6">
        <div className="text-center text-white">
          <div className="text-2xl font-bold mb-2">Token not found</div>
          <Link
            href="/invest"
            className="text-[rgb(182,255,62)] underline underline-offset-4"
          >
            Back to Invest
          </Link>
        </div>
      </div>
    );
  }

  return <TradeLayout token={token} />;
}

/* ------------------------------- layout --------------------------------- */

function TradeLayout({ token }: { token: TokenMeta }) {
  const { user } = useUser();
  const displayCurrency = (user?.displayCurrency || "USD").toUpperCase();

  const { ready: privyReady, authenticated, getAccessToken } = usePrivy();
  const { wallets } = useSolanaWallets();

  // choose a wallet addr to show balance/allow trade
  const owner58 = useMemo(() => {
    const depositAddress = user?.depositWallet?.address;
    const fallbackWallet = wallets[0]?.address;
    return depositAddress || fallbackWallet || "";
  }, [user?.depositWallet?.address, wallets]);

  const mainnetMint = getMintFor(token, MAINNET) || "";
  const tokenTv = token.tv; // from /lib/tokens.ts

  /* ------------------------------ live price ----------------------------- */

  const [price, setPrice] = useState<number | null>(null);
  const [change24h, setChange24h] = useState<number | null>(null);
  const [decimals, setDecimals] = useState<number>(token.decimals ?? 6);

  const fetchPrice = useCallback(async () => {
    if (!mainnetMint) return;
    try {
      const res = await fetch(`${JUP_PRICE_BASE}?ids=${mainnetMint}`, {
        cache: "no-store",
      });
      const j = (await res.json()) as PriceResp;
      const it = j?.[mainnetMint];
      if (it) {
        setPrice(Number(it.usdPrice));
        if (typeof it.priceChange24h === "number")
          setChange24h(Number(it.priceChange24h));
        if (typeof it.decimals === "number") setDecimals(Number(it.decimals));
      }
    } catch {
      /* noop */
    }
  }, [mainnetMint]);

  useEffect(() => {
    fetchPrice();
    const id = setInterval(fetchPrice, 45_000);
    return () => clearInterval(id);
  }, [fetchPrice]);

  /* ------------------------------ balance -------------------------------- */

  const [balanceRaw, setBalanceRaw] = useState<bigint>(BigInt(0));
  const [balanceUi, setBalanceUi] = useState<string>("0");
  const [loadingBal, setLoadingBal] = useState(false);

  const refreshBalance = useCallback(async () => {
    if (!owner58 || !mainnetMint) return;
    setLoadingBal(true);
    try {
      const conn = new Connection(RPC, "confirmed");
      const owner = new PublicKey(owner58);

      const [a, b] = await Promise.all([
        conn.getParsedTokenAccountsByOwner(owner, {
          programId: TOKEN_PROGRAM_ID,
        }),
        conn.getParsedTokenAccountsByOwner(owner, {
          programId: TOKEN_2022_PROGRAM_ID,
        }),
      ]);

      const ZERO = BigInt(0);
      const entries = [...a.value, ...b.value];
      let raw = ZERO;
      let dec = decimals;

      type ParsedTokenInfo = {
        mint?: string;
        tokenAmount?: {
          amount?: string;
          decimals?: number;
        };
      };

      for (const it of entries) {
        const parsed = it.account.data;
        const rawInfo =
          parsed && typeof parsed === "object" && "parsed" in parsed
            ? (parsed.parsed as { info?: ParsedTokenInfo })
            : null;
        const info = rawInfo?.info;
        if (info?.mint !== mainnetMint) continue;
        const amtStr = info.tokenAmount?.amount ?? "0";
        const nextDecimals = info.tokenAmount?.decimals;
        if (typeof nextDecimals === "number") {
          dec = nextDecimals;
        }
        try {
          raw += BigInt(amtStr);
        } catch {}
      }

      setBalanceRaw(raw);
      setBalanceUi(uiStringFromRaw(raw, dec));
    } catch {
      setBalanceRaw(BigInt(0));
      setBalanceUi("0");
    } finally {
      setLoadingBal(false);
    }
  }, [owner58, mainnetMint, decimals]);

  useEffect(() => {
    refreshBalance();
  }, [refreshBalance]);

  /* ------------------------------ buy/sell ------------------------------- */

  const {
    swap,
    loading: swapping,
    signature: buySig,
    error: buyErr,
  } = useServerSponsoredJupSwap();
  const {
    sell,
    loading: selling,
    signature: sellSig,
    error: sellErr,
  } = useServerSponsoredJupSell();

  const [spendStr, setSpendStr] = useState("50"); // in display currency
  const [sellStr, setSellStr] = useState("");

  const spendValid =
    Number.isFinite(Number(spendStr)) &&
    Number(spendStr) >
      (displayCurrency === "USD" ? FLAT_FEE_USD : FLAT_FEE_USD); // fx handled server-side

  const canBuy =
    !!owner58 &&
    !!mainnetMint &&
    privyReady &&
    authenticated &&
    !swapping &&
    spendValid;

  const canSell = useMemo(() => {
    if (!owner58 || !mainnetMint || !privyReady || !authenticated || selling)
      return false;
    const raw = rawFromUiString(sellStr || "0", decimals);
    return raw > BigInt(0) && raw <= balanceRaw;
  }, [
    owner58,
    mainnetMint,
    privyReady,
    authenticated,
    selling,
    sellStr,
    decimals,
    balanceRaw,
  ]);

  const onBuy = useCallback(async () => {
    if (!canBuy) return;
    const toastId = toast.loading(`Buying ${token.symbol}…`);
    try {
      const accessToken = await getAccessToken().catch(() => null);
      await swap({
        fromOwnerBase58: owner58,
        outputMint: mainnetMint,
        amountDisplay: Number(spendStr),
        fxRate: 1, // server handles conversion from display if needed
        accessToken,
      });
      toast.success("Purchase submitted", { id: toastId });
      setTimeout(() => refreshBalance(), 1000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Buy failed", {
        id: toastId,
      });
    }
  }, [
    canBuy,
    token.symbol,
    getAccessToken,
    swap,
    owner58,
    mainnetMint,
    spendStr,
    refreshBalance,
  ]);

  const onSell = useCallback(async () => {
    if (!canSell) return;
    const toastId = toast.loading(`Selling ${token.symbol}…`);
    try {
      const accessToken = await getAccessToken().catch(() => null);
      await sell({
        fromOwnerBase58: owner58,
        inputMint: mainnetMint,
        amountUi: Number(sellStr || "0"),
        inputDecimals: decimals,
        accessToken,
        slippageBps: 50,
      });
      toast.success("Sell submitted", { id: toastId });
      setSellStr("");
      setTimeout(() => refreshBalance(), 1000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sell failed", {
        id: toastId,
      });
    }
  }, [
    canSell,
    token.symbol,
    getAccessToken,
    sell,
    owner58,
    mainnetMint,
    sellStr,
    decimals,
    refreshBalance,
  ]);

  /* -------------------------------- fx ----------------------------------- */

  const [fxRate, setFxRate] = useState(1);
  useEffect(() => {
    (async () => {
      if (displayCurrency === "USD") return setFxRate(1);
      try {
        const bearer =
          privyReady && authenticated
            ? await getAccessToken().catch(() => null)
            : null;
        const r = await fetch(
          `/api/fx?currency=${encodeURIComponent(displayCurrency)}&amount=1`,
          {
            cache: "no-store",
            credentials: "include",
            headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
          }
        );
        if (!r.ok) throw new Error();
        const j = await r.json();
        setFxRate(Number(j?.rate || 1));
      } catch {
        setFxRate(1);
      }
    })();
  }, [displayCurrency, privyReady, authenticated, getAccessToken]);

  const priceLocal =
    typeof price === "number"
      ? price * (displayCurrency === "USD" ? 1 : fxRate)
      : null;

  /* ------------------ live quote preview for Buy form -------------------- */

  const [outDecimals, setOutDecimals] = useState<number | null>(
    token.decimals ?? 6
  );
  const [quote, setQuote] = useState<JupQuote>(null);
  const [qLoading, setQLoading] = useState(false);
  const [qError, setQError] = useState<string | null>(null);

  // fetch token decimals from Jupiter price API (reliable)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${JUP_PRICE_BASE}?ids=${mainnetMint}`, {
          cache: "no-store",
        });
        const j = (await res.json()) as JupPriceResponse;
        const d = j?.[mainnetMint]?.decimals;
        if (typeof d === "number") setOutDecimals(d);
      } catch {
        /* ignore */
      }
    })();
  }, [mainnetMint]);

  const computeInAmountRaw = (): number => {
    if (!spendValid) return 0;
    const spendDisplay = Number(spendStr);
    // convert to USD if needed and subtract flat fee
    const grossUsd =
      displayCurrency === "USD" ? spendDisplay : spendDisplay / fxRate;
    const netUsd = Math.max(0, grossUsd - FLAT_FEE_USD);
    return Math.floor(netUsd * 10 ** USDC_DECIMALS);
  };

  useEffect(() => {
    if (!mainnetMint) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        setQLoading(true);
        setQuote(null);
        setQError(null);
        const inAmount = computeInAmountRaw();
        if (!inAmount) {
          setQLoading(false);
          return;
        }
        const url =
          `${JUP_QUOTE_BASE}?inputMint=${USDC_MAINNET}&outputMint=${mainnetMint}&amount=${inAmount}` +
          `&slippageBps=50&restrictIntermediateTokens=true&dynamicSlippage=true`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`quote ${res.status}`);
        const j = (await res.json()) as JupQuote;
        if (!cancelled) setQuote(j);
      } catch (e) {
        if (!cancelled)
          setQError(e instanceof Error ? e.message : "Failed to fetch quote");
      } finally {
        if (!cancelled) setQLoading(false);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spendStr, displayCurrency, fxRate, mainnetMint]);

  const outAmountUi =
    quote && outDecimals != null
      ? Number(quote.outAmount) / 10 ** (outDecimals || 6)
      : null;

  /* -------------------------------- UI ----------------------------------- */

  return (
    <div className="min-h-screen bg-gradient-to-b from-black/70 to-black/30">
      {/* Top bar (mobile-first) */}
      <header className="sticky top-0 z-10 bg-black/50 border-b border-white/10 backdrop-blur-2xl">
        <div className="mx-auto w-full max-w-7xl px-3 sm:px-4 py-2.5 sm:py-3">
          <div className="flex items-center gap-3 sm:gap-4">
            <Link
              href="/invest"
              className="p-2 rounded-xl bg-white/10 border border-white/20 text-white/80 hover:text-white hover:bg-white/15"
              aria-label="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>

            <Image
              src={token.logo}
              alt={token.name}
              width={28}
              height={28}
              className="rounded-full border border-white/20 bg-white/5 object-contain"
            />
            <div className="flex items-baseline gap-2 min-w-0">
              <h1 className="text-white font-bold text-sm sm:text-base truncate">
                {token.name}
              </h1>
              <span className="text-white/60 text-xs sm:text-sm">
                {token.symbol}
              </span>
              {token.category && (
                <span className="hidden sm:inline text-[rgb(182,255,62)]/90 text-[10px] sm:text-xs px-2 py-0.5 rounded-lg bg-[rgb(182,255,62)]/10 border border-[rgb(182,255,62)]/30">
                  {token.category}
                </span>
              )}
            </div>

            <div className="ml-auto flex items-center gap-3 sm:gap-4">
              <div className="text-right leading-tight">
                <div className="text-white font-bold text-sm sm:text-lg">
                  {fmtMoney(priceLocal ?? undefined, displayCurrency)}
                </div>
                <div
                  className={`text-[10px] sm:text-xs font-semibold ${
                    (change24h ?? 0) > 0
                      ? "text-[rgb(182,255,62)]"
                      : (change24h ?? 0) < 0
                      ? "text-red-400"
                      : "text-white/60"
                  }`}
                >
                  {fmtPct(change24h)}
                </div>
              </div>
              <button
                onClick={() => {
                  fetchPrice();
                  refreshBalance();
                }}
                className="p-2 rounded-xl bg-white/10 border border-white/20 text-white/70 hover:text-white hover:bg-white/15"
                aria-label="Refresh"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6 grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Chart */}
        <section className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-1 sm:p-2">
            <TradingViewAdvanced tv={tokenTv} height={520} />
          </div>

          {/* Token info (simple + mobile friendly) */}
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-white font-semibold mb-1">
              About {token.name}
            </div>
            <p className="text-white/60 text-sm leading-6">
              A short description, risks, and links can live here. Keep it
              concise for mobile; expand on desktop if needed.
            </p>
          </div>
        </section>

        {/* Trade panel */}
        <aside className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-white/70 text-sm">Balance</div>
              <button
                onClick={refreshBalance}
                className="text-white/60 hover:text-white text-xs px-2 py-1 rounded-md bg-white/5 border border-white/10"
              >
                Refresh
              </button>
            </div>
            <div className="text-white font-bold text-lg sm:text-xl">
              {loadingBal ? "…" : `${balanceUi} ${token.symbol}`}
            </div>
            {price && (
              <div className="text-white/50 text-xs mt-1">
                ≈{" "}
                {fmtMoney(
                  Number(balanceUi) *
                    price *
                    (displayCurrency === "USD" ? 1 : fxRate),
                  displayCurrency
                )}
              </div>
            )}
          </div>

          {/* Buy */}
          <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-white font-semibold">Buy {token.symbol}</div>
              <div className="text-white/60 text-xs">
                Fee:{" "}
                {fmtMoney(
                  FLAT_FEE_USD * (displayCurrency === "USD" ? 1 : fxRate),
                  displayCurrency
                )}
              </div>
            </div>

            <div className="space-y-3">
              <label className="block text-xs text-white/60">
                Spend ({displayCurrency})
              </label>
              <div className="relative group">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={spendStr}
                  onChange={(e) => setSpendStr(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-white/50 focus:outline-none focus:border-[rgb(182,255,62)]/50"
                  placeholder={`Amount in ${displayCurrency}`}
                />
                <div className="mt-1 text-xs text-white/50">
                  You’re buying with{" "}
                  <span className="text-white font-semibold">
                    {fmtMoney(Number(spendStr) || 0, displayCurrency)}
                  </span>
                   . Fee is deducted before the swap.
                </div>
              </div>

              {/* Live preview */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                {qLoading ? (
                  <div className="text-white/70 text-sm">
                    Getting live price…
                  </div>
                ) : qError ? (
                  <div className="text-red-400/80 text-xs">{qError}</div>
                ) : outAmountUi != null ? (
                  <div className="flex items-center justify-between">
                    <span className="text-white/70 text-sm">
                      You’ll receive ~
                    </span>
                    <span className="text-white font-bold">
                      {new Intl.NumberFormat(undefined, {
                        maximumFractionDigits: outAmountUi < 1 ? 6 : 4,
                      }).format(outAmountUi)}{" "}
                      {token.symbol}
                    </span>
                  </div>
                ) : (
                  <div className="text-white/60 text-sm">
                    Enter an amount to see a live quote.
                  </div>
                )}
                {quote?.priceImpactPct && (
                  <div className="mt-1 text-[10px] text-white/50">
                    Price impact:{" "}
                    {(Number(quote.priceImpactPct) * 100).toFixed(2)}%
                  </div>
                )}
              </div>

              {buyErr && (
                <div className="text-red-400/80 text-xs border border-red-500/30 rounded-lg p-2 bg-red-500/10">
                  {String(buyErr)}
                </div>
              )}
              {buySig && (
                <div className="text-[rgb(182,255,62)]/80 text-xs border border-[rgb(182,255,62)]/30 rounded-lg p-2 bg-[rgb(182,255,62)]/10">
                  Buy submitted!
                </div>
              )}

              <button
                onClick={onBuy}
                disabled={!canBuy}
                className="w-full group relative overflow-hidden rounded-xl bg-[rgb(182,255,62)]/20 border border-[rgb(182,255,62)]/40 text-[rgb(182,255,62)] font-bold py-3 disabled:opacity-50"
              >
                <span className="absolute inset-0 -translate-x-full group-hover:translate-x-0 transition-transform duration-700 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                <span className="relative z-10">
                  {swapping ? "Processing…" : `Buy ${token.symbol}`}
                </span>
              </button>
            </div>
          </div>

          {/* Sell */}
          <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4">
            <div className="text-white font-semibold mb-3">
              Sell {token.symbol}
            </div>
            <div className="space-y-3">
              <div className="text-white/60 text-xs">
                Balance: {loadingBal ? "…" : `${balanceUi} ${token.symbol}`}
              </div>
              <input
                type="text"
                inputMode="decimal"
                value={sellStr}
                onChange={(e) => setSellStr(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/20 text-white placeholder-white/50 focus:outline-none focus:border-red-400/50"
                placeholder={`0.0 ${token.symbol}`}
              />
              {sellErr && (
                <div className="text-red-400/80 text-xs border border-red-500/30 rounded-lg p-2 bg-red-500/10">
                  {String(sellErr)}
                </div>
              )}
              {sellSig && (
                <div className="text-[rgb(182,255,62)]/80 text-xs border border-[rgb(182,255,62)]/30 rounded-lg p-2 bg-[rgb(182,255,62)]/10">
                  Sell submitted!
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSellStr(balanceUi)}
                  className="px-3 py-2 rounded-lg text-white/80 bg-white/5 border border-white/15 text-xs"
                >
                  Max
                </button>
                <button
                  onClick={onSell}
                  disabled={!canSell}
                  className="flex-1 group relative overflow-hidden rounded-xl bg-red-500/20 border border-red-500/40 text-red-400 font-bold py-3 disabled:opacity-50"
                >
                  <span className="absolute inset-0 -translate-x-full group-hover:translate-x-0 transition-transform duration-700 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                  <span className="relative z-10">
                    {selling ? "Processing…" : `Sell ${token.symbol}`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
