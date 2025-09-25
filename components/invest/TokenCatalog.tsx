"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Image from "next/image";
import { X } from "lucide-react";
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
    <div className={`vision-window ${className}`}>
      

      <div className="p-4">
        {!grouped.length ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
              <div className="w-8 h-8 rounded-full bg-white/10" />
            </div>
            <div className="text-white/70 mb-2 text-base font-medium">
              No tokens available
            </div>
            <div className="text-sm text-white/50 max-w-md mx-auto">
              Add mints to{" "}
              <code className="bg-white/10 px-2 py-1 rounded font-mono text-xs">
                mints.mainnet
              </code>{" "}
              in{" "}
              <code className="bg-white/10 px-2 py-1 rounded font-mono text-xs">
                /lib/tokens.ts
              </code>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map(([cat, tokens]) => (
              <section key={cat}>
                <div className="mb-4 flex items-center gap-3">
                  <div className="h-1 w-6 bg-gradient-to-r from-[rgb(182,255,62)] to-transparent rounded-full" />
                  <h4 className="text-sm font-bold tracking-wide text-white uppercase">
                    {cat}
                  </h4>
                  <div className="flex-1 h-px bg-gradient-to-r from-white/20 to-transparent" />
                </div>

                <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
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
                        className="vision-card group p-4 transition-all duration-300 hover:scale-[1.02]"
                      >
                        <div className="flex items-start gap-3">
                          <div className="relative">
                            <Image
                              src={
                                t.logo ||
                                "https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/default.png" ||
                                "/placeholder.svg" ||
                                "/placeholder.svg"
                              }
                              alt={`${t.name} logo`}
                              width={40}
                              height={40}
                              className="h-10 w-10 rounded-full border border-white/20 object-contain bg-white/5 backdrop-blur-sm"
                            />
                            {pricesLoading && (
                              <div className="absolute -top-1 -right-1 h-3 w-3 bg-[rgb(182,255,62)] rounded-full animate-pulse" />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-white font-semibold truncate text-sm">
                                {t.name}
                              </span>
                              <span className="text-xs text-white/50 font-medium px-1.5 py-0.5 bg-white/10 rounded">
                                {t.symbol}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-white font-bold text-base">
                                {fmtMoney(local)}
                              </span>
                              {changeStr && (
                                <span
                                  className={`text-xs font-medium ${changeColor} flex items-center gap-1`}
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
                              className="vision-accent w-full text-xs px-3 py-2 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 group-hover:scale-[1.02]"
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
              <div className="text-center p-4 rounded-xl bg-red-500/10 border border-red-500/20 backdrop-blur-sm">
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
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        onClick={onClose}
      />
      <div className="vision-modal relative w-full max-w-lg rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Image
              src={
                token.logo ||
                "https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/default.png" ||
                "/placeholder.svg" ||
                "/placeholder.svg"
              }
              alt={`${token.name} logo`}
              width={40}
              height={40}
              className="h-10 w-10 rounded-xl border border-white/20 object-contain bg-white/5"
            />
            <div>
              <h4 className="text-white font-bold text-lg">Buy {token.name}</h4>
              <div className="text-white/60 text-sm">{token.symbol}</div>
            </div>
          </div>
          <button
            aria-label="Close"
            onClick={onClose}
            className="vision-button p-2 rounded-xl text-white/60 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-white/90 mb-2">
              Spend ({displayCurrency})
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="vision-input w-full rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none transition-all"
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
          <div className="vision-card rounded-xl p-4">
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
                  <div className="h-full bg-[rgb(182,255,62)] rounded-full animate-pulse w-1/2" />
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
                <div className="h-px bg-white/10" />
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
            className="vision-button px-6 py-2.5 text-sm rounded-xl text-white/80 hover:text-white transition-all duration-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSwap}
            onClick={onBuy}
            className="vision-accent px-6 py-2.5 text-sm rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {swapping ? "Processing..." : `Buy ${token.symbol}`}
          </button>
        </div>
      </div>
    </div>
  );
}
