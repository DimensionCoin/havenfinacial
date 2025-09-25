// app/(wherever)/WalletHoldings.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { useUser } from "@/providers/UserProvider";
import { usePrivy } from "@privy-io/react-auth";
import { toast } from "react-hot-toast";

import {
  getCluster,
  tokensForCluster,
  getMintFor,
  type TokenMeta,
  type TokenCategory,
} from "@/lib/tokens";

import { useServerSponsoredJupSell } from "@/hooks/useServerSponsoredJupSell";

/* ------------------------------ config/env ------------------------------- */

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC!;

// Jupiter Price API V3
const JUP_PRICE_BASE =
  process.env.NEXT_PUBLIC_JUP_PRICE_BASE || "https://lite-api.jup.ag/price/v3";

// USDC exclusion (env + safe defaults)
const USDC_MINTS_ENV = [
  process.env.NEXT_PUBLIC_USDC_MINT,
  process.env.NEXT_PUBLIC_USDC_MAINNET_MINT,
  process.env.NEXT_PUBLIC_USDC_DEVNET_MINT,
  process.env.NEXT_PUBLIC_USDC_2022_MINT,
].filter(Boolean) as string[];

const DEFAULT_USDC_MINTS = [
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // mainnet USDC
];

const EXCLUDED_MINTS = new Set<string>([
  ...DEFAULT_USDC_MINTS,
  ...USDC_MINTS_ENV,
]);

/* -------------------------------- types ---------------------------------- */

type PriceResp = Record<
  string,
  { usdPrice: number; decimals: number; priceChange24h?: number }
>;

type Holding = {
  mint: string; // current cluster mint
  amountUi: number; // human units
};

type ViewRow = {
  token: TokenMeta; // from catalog
  amount: number;
  priceUsd: number; // price per unit in USD
  valueUsd: number; // amount * priceUsd
};

type CategoryState = Record<TokenCategory, boolean>;

/* -------------------------------- utils ---------------------------------- */

const chunk = <T,>(arr: T[], size: number) => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

function fmtMoney(v: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: v < 1 ? 4 : 2,
    }).format(v);
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}

function fmtMoneyWithoutCurrency(v: number) {
  try {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: v < 1 ? 4 : 2,
    }).format(v);
  } catch {
    return v.toFixed(2);
  }
}

async function fetchUsdPrices(ids: string[]): Promise<PriceResp> {
  if (!ids.length) return {};
  const chunks = chunk(ids, 50);
  const out: PriceResp = {};
  for (const c of chunks) {
    const url = `${JUP_PRICE_BASE}?ids=${c.join(",")}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) continue;
    const j = (await r.json()) as PriceResp;
    Object.assign(out, j);
  }
  return out;
}

/* ------------------------------ main component ---------------------------- */

export default function WalletHoldings({
  className = "",
}: {
  className?: string;
}) {
  const { user } = useUser();
  const { ready: privyReady, authenticated, getAccessToken } = usePrivy();

  const currency = (user?.displayCurrency || "USD").toUpperCase();
  const owner58 = user?.depositWallet?.address || null;
  const cluster = getCluster();

  // Supported tokens for this cluster (from catalog)
  const supportedTokens = useMemo(() => tokensForCluster(cluster), [cluster]);

  // Index by current-cluster mint for quick lookups (strictly from tokens.ts)
  const byClusterMint = useMemo(() => {
    const map = new Map<string, TokenMeta>();
    for (const t of supportedTokens) {
      const mint = getMintFor(t, cluster);
      if (mint) map.set(mint, t);
    }
    return map;
  }, [supportedTokens, cluster]);

  // Map to mainnet mints (for price API)
  const mainnetMintFor = useCallback(
    (t: TokenMeta) => getMintFor(t, "mainnet"),
    []
  );

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ViewRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [fxRate, setFxRate] = useState<number>(1);

  const [categoryStates, setCategoryStates] = useState<CategoryState>({
    "Top 3": true,
    DeFi: true,
    Meme: true,
    Stocks: true,
  });

  // SELL modal state
  const [sellOpen, setSellOpen] = useState(false);
  const [sellRow, setSellRow] = useState<ViewRow | null>(null);
  const [sellDecimals, setSellDecimals] = useState<number>(6);

  const openSell = useCallback(async (row: ViewRow) => {
    setSellRow(row);
    setSellOpen(true);
    // Try to fetch decimals via JUP price endpoint using mainnet mint
    try {
      const mainnetMint = getMintFor(row.token, "mainnet");
      if (mainnetMint) {
        const r = await fetch(`${JUP_PRICE_BASE}?ids=${mainnetMint}`, {
          cache: "no-store",
        });
        const j = (await r.json()) as PriceResp;
        const d = j?.[mainnetMint]?.decimals ?? 6;
        setSellDecimals(d);
      } else {
        setSellDecimals(6);
      }
    } catch {
      setSellDecimals(6);
    }
  }, []);

  const closeSell = () => {
    setSellOpen(false);
    setSellRow(null);
  };

  // Fetch USD→display FX (authorized)
  const refreshFx = useCallback(async () => {
    if (currency === "USD") {
      setFxRate(1);
      return;
    }
    try {
      const bearer =
        privyReady && authenticated
          ? await getAccessToken().catch(() => null)
          : null;
      const r = await fetch(
        `/api/fx?currency=${encodeURIComponent(currency)}&amount=1`,
        {
          credentials: "include",
          cache: "no-store",
          headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
        }
      );
      if (!r.ok) throw new Error(`fx ${r.status}`);
      const j = await r.json();
      setFxRate(Number(j?.rate || 1));
    } catch {
      setFxRate(1);
    }
  }, [currency, privyReady, authenticated, getAccessToken]);

  const refresh = useCallback(async () => {
    if (!owner58) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const conn = new Connection(RPC, "confirmed");
      const owner = new PublicKey(owner58);

      // SPL balances **only** (strictly tokens present in tokens.ts)
      const [tokStd, tok22] = await Promise.all([
        conn.getParsedTokenAccountsByOwner(owner, {
          programId: TOKEN_PROGRAM_ID,
        }),
        conn.getParsedTokenAccountsByOwner(owner, {
          programId: TOKEN_2022_PROGRAM_ID,
        }),
      ]);

      type ParsedTokenInfo = {
        mint?: string;
        tokenAmount?: { uiAmount?: number };
      };

      const holdings: Holding[] = [];
      const addTokenAccounts = (accs: typeof tokStd) => {
        for (const it of accs.value) {
          const info = (
            it.account.data.parsed as { info?: ParsedTokenInfo } | undefined
          )?.info;
          const mint: string | undefined = info?.mint;
          const amountUi: number | undefined = Number(
            info?.tokenAmount?.uiAmount ?? 0
          );
          if (!mint || !amountUi || amountUi <= 0) continue;
          // keep **only** mints defined in tokens.ts for this cluster
          if (!byClusterMint.has(mint)) continue;
          // exclude USDC mints from display (portfolio of investable tokens only)
          if (EXCLUDED_MINTS.has(mint)) continue;
          holdings.push({ mint, amountUi });
        }
      };
      addTokenAccounts(tokStd);
      addTokenAccounts(tok22);

      // Consolidate per mint
      const byMint = new Map<string, number>();
      for (const h of holdings) {
        byMint.set(h.mint, (byMint.get(h.mint) || 0) + h.amountUi);
      }

      // Tokens the user actually holds (>0), restricted to tokens.ts
      const heldTokens: TokenMeta[] = [];
      for (const [mint, amount] of byMint.entries()) {
        if (!amount || amount <= 0) continue;
        const token = byClusterMint.get(mint);
        if (token) heldTokens.push(token);
      }

      if (heldTokens.length === 0) {
        setRows([]);
        setUpdatedAt(Date.now());
        setLoading(false);
        return;
      }

      // USD prices using **mainnet** mints
      const priceIds = heldTokens
        .map((t) => mainnetMintFor(t))
        .filter((m): m is string => !!m);
      const prices = await fetchUsdPrices(Array.from(new Set(priceIds)));

      // Build rows in USD (hide < $0.01)
      const rowsUsd: ViewRow[] = [];
      for (const t of heldTokens) {
        const clusterMint = getMintFor(t, cluster)!;
        const amount = byMint.get(clusterMint) || 0;

        const mainnetMint = mainnetMintFor(t);
        const p = mainnetMint ? prices[mainnetMint] : undefined;
        if (!p) continue;

        const priceUsd = Number(p.usdPrice || 0);
        const valueUsd = amount * priceUsd;
        if (valueUsd < 0.01) continue;

        rowsUsd.push({ token: t, amount, priceUsd, valueUsd });
      }

      rowsUsd.sort((a, b) => b.valueUsd - a.valueUsd);

      setRows(rowsUsd);
      setUpdatedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [owner58, byClusterMint, mainnetMintFor, cluster]);

  // Load FX then balances
  useEffect(() => {
    (async () => {
      await refreshFx();
      await refresh();
    })();
  }, [refreshFx, refresh]);

  // Manual refresh
  const onRefreshClick = async () => {
    await refreshFx();
    await refresh();
  };

  const toggleCategory = (category: TokenCategory) => {
    setCategoryStates((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  const tokensByCategory = useMemo(() => {
    const grouped: Record<TokenCategory, ViewRow[]> = {
      "Top 3": [],
      DeFi: [],
      Meme: [],
      Stocks: [],
    };
    rows.forEach((row) => {
      const category = row.token.category || "Top 3";
      grouped[category].push(row);
    });
    return grouped;
  }, [rows]);

  const totalLocal = useMemo(
    () => rows.reduce((s, r) => s + r.valueUsd, 0) * fxRate,
    [rows, fxRate]
  );

  const lastUpdated =
    updatedAt == null ? "—" : new Date(updatedAt).toLocaleTimeString();

  return (
    <div
      className={`relative rounded-3xl border border-white/20 bg-black/40 backdrop-blur-[40px] backdrop-saturate-[200%] shadow-[0_32px_64px_rgba(0,0,0,0.4),0_16px_32px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(0,0,0,0.2)] overflow-hidden ${className}`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-black/20 pointer-events-none" />

      <button
        type="button"
        disabled={loading}
        onClick={onRefreshClick}
        className="absolute top-4 right-4 z-10 inline-flex items-center justify-center w-10 h-10 rounded-xl border border-white/20 bg-white/5 hover:bg-white/10 text-white backdrop-blur-sm disabled:opacity-50 transition-all duration-200 shadow-lg hover:shadow-xl"
        title="Refresh"
      >
        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      </button>

      <div className="relative px-6 py-8 border-b border-white/10 bg-gradient-to-r from-white/5 to-transparent">
        <div className="text-center mb-6">
          <div className="text-sm text-white/60 font-medium mb-1 tracking-wide uppercase">
            Total Portfolio Value
          </div>
          <div className="flex items-baseline justify-center gap-2 mb-1">
            <span className="text-4xl md:text-5xl font-bold text-white tracking-tight">
              {fmtMoneyWithoutCurrency(totalLocal)}
            </span>
            <span className="text-lg text-white/60 font-medium">
              {currency}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-center">
          <span className="text-xs text-white/60 bg-white/5 px-3 py-1.5 rounded-full border border-white/10">
            Updated {lastUpdated}
          </span>
        </div>
      </div>

      <div className="relative p-6">
        {!owner58 ? (
          <EmptyState
            title="Wallet Not Ready"
            message="Your investment account isn't ready yet. Please finish onboarding to view your portfolio."
          />
        ) : error ? (
          <ErrorState />
        ) : rows.length === 0 && !loading ? (
          <NoAssets onRefreshClick={onRefreshClick} loading={loading} />
        ) : (
          <div className="space-y-6">
            {(["Top 3", "DeFi", "Meme", "Stocks"] as TokenCategory[]).map(
              (category) => {
                const categoryTokens = tokensByCategory[category];
                if (categoryTokens.length === 0) return null;

                const categoryTotal =
                  categoryTokens.reduce(
                    (sum, token) => sum + token.valueUsd,
                    0
                  ) * fxRate;
                const isExpanded = categoryStates[category];

                return (
                  <div
                    key={category}
                    className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm overflow-hidden"
                  >
                    {/* Category Header */}
                    <button
                      onClick={() => toggleCategory(category)}
                      className="w-full px-6 py-4 flex items-center justify-between hover:bg-white/5 transition-colors duration-200"
                    >
                      <div className="flex items-center gap-4">
                        <div className="text-lg font-bold text-white">
                          {category}
                        </div>
                        <div className="text-sm text-white/60">
                          {categoryTokens.length} token
                          {categoryTokens.length !== 1 ? "s" : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-white font-semibold">
                            {fmtMoney(categoryTotal, currency)}
                          </div>
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="h-5 w-5 text-white/60" />
                        ) : (
                          <ChevronDown className="h-5 w-5 text-white/60" />
                        )}
                      </div>
                    </button>

                    {/* Category Tokens */}
                    {isExpanded && (
                      <div className="border-t border-white/10">
                        <div className="p-4 space-y-3">
                          {categoryTokens.map((row) => (
                            <div
                              key={`${row.token.symbol}-${getMintFor(
                                row.token,
                                cluster
                              )}`}
                              className="group relative rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4 hover:border-white/20 hover:bg-white/10 transition-all duration-300"
                            >
                              <div className="flex items-center gap-4">
                                <div className="relative">
                                  <Image
                                    src={row.token.logo || "/logos/default.png"}
                                    alt={`${row.token.name} logo`}
                                    width={48}
                                    height={48}
                                    className="h-12 w-12 rounded-full border-2 border-white/20 object-contain bg-white/5 shadow-lg"
                                  />
                                  <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[rgb(182,255,62)] border-2 border-black/40 shadow-sm" />
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="text-white font-semibold text-base leading-tight truncate">
                                        {row.token.name}
                                      </div>
                                      <div className="text-sm text-white/60 leading-tight">
                                        {row.token.symbol} •{" "}
                                        {row.amount.toLocaleString(undefined, {
                                          maximumFractionDigits:
                                            row.amount < 1 ? 6 : 4,
                                        })}
                                      </div>
                                    </div>

                                    <div className="text-right flex-shrink-0">
                                      <div className="text-white font-bold text-lg leading-tight">
                                        {fmtMoney(
                                          row.valueUsd * fxRate,
                                          currency
                                        )}
                                      </div>
                                      <div className="text-sm text-white/60 leading-tight">
                                        {fmtMoney(
                                          row.priceUsd * fxRate,
                                          currency
                                        )}{" "}
                                        each
                                      </div>
                                    </div>
                                  </div>

                                  <div className="mt-3 h-1 bg-white/10 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-gradient-to-r from-[rgb(182,255,62)] to-[rgb(182,255,62)]/80 rounded-full transition-all duration-1000"
                                      style={{
                                        width: `${Math.min(
                                          (row.valueUsd /
                                            Math.max(
                                              ...rows.map((r) => r.valueUsd)
                                            )) *
                                            100,
                                          100
                                        )}%`,
                                      }}
                                    />
                                  </div>

                                  {/* Sell button */}
                                  <div className="mt-3 flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => openSell(row)}
                                      className="text-sm px-3 py-2 rounded-xl border border-white/20 text-white/90 hover:bg-white/10 transition-colors"
                                      title="Sell to USDC"
                                    >
                                      Sell
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              }
            )}

            {loading && <SkeletonRow />}
          </div>
        )}
      </div>

      {/* Sell Modal */}
      {sellOpen && sellRow && owner58 && (
        <SellModal
          onClose={closeSell}
          owner58={owner58}
          row={sellRow}
          inputDecimals={sellDecimals}
          getAccessToken={getAccessToken}
        />
      )}
    </div>
  );
}

/* ------------------------------ small pieces ------------------------------ */

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="text-center py-12">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full bg-white/10" />
      </div>
      <div className="text-white font-medium mb-2">{title}</div>
      <div className="text-sm text-white/60 max-w-sm mx-auto">{message}</div>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="text-center py-12">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full bg-red-500/20" />
      </div>
      <div className="text-red-300 font-medium mb-2">Connection Error</div>
      <div className="text-sm text-red-400/80 max-w-sm mx-auto">
        Couldn&apos;t load your investments. Please check your connection and
        try again.
      </div>
    </div>
  );
}

function NoAssets({
  onRefreshClick,
  loading,
}: {
  onRefreshClick: () => void;
  loading: boolean;
}) {
  return (
    <div className="text-center py-12">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full bg-white/10" />
      </div>
      <div className="text-white font-medium mb-2">No Assets Found</div>
      <div className="text-sm text-white/60 max-w-sm mx-auto mb-4">
        No assets above $0.01 found in your wallet. Start investing to see your
        portfolio here.
      </div>
      <button
        type="button"
        onClick={onRefreshClick}
        className="group relative overflow-hidden rounded-2xl bg-[rgb(182,255,62)] text-black px-6 py-3 font-bold text-sm hover:bg-[rgb(182,255,62)]/90 transition-all duration-300 shadow-[0_8px_32px_rgba(182,255,62,0.3)] hover:shadow-[0_12px_48px_rgba(182,255,62,0.4)] transform hover:scale-[1.02] active:scale-[0.98]"
      >
        <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        <div className="relative flex items-center justify-center gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          <span>Refresh Portfolio</span>
        </div>
      </button>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-4">
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-full bg-white/10 animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-white/10 rounded animate-pulse" />
          <div className="h-3 bg-white/5 rounded animate-pulse w-2/3" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Sell Modal ------------------------------ */

function SellModal({
  onClose,
  owner58,
  row,
  inputDecimals,
  getAccessToken,
}: {
  onClose: () => void;
  owner58: string;
  row: ViewRow;
  inputDecimals: number;
  getAccessToken: () => Promise<string | null>;
}) {
  const { sell, loading, signature, error } = useServerSponsoredJupSell();
  const [amountStr, setAmountStr] = useState<string>("");

  const cluster = getCluster();
  const inputMint = getMintFor(row.token, cluster) || "";
  const maxAmount = row.amount;

  const onMax = () => setAmountStr(String(maxAmount));

  const canSell =
    !!inputMint &&
    Number.isFinite(Number(amountStr)) &&
    Number(amountStr) > 0 &&
    Number(amountStr) <= maxAmount &&
    !loading;

  const onConfirm = useCallback(async () => {
    if (!canSell) return;

    const toastId = toast.loading(`Selling ${row.token.symbol}…`);

    try {
      const bearer = await getAccessToken().catch(() => null);
      const res = await sell({
        fromOwnerBase58: owner58,
        inputMint,
        amountUi: Number(amountStr),
        inputDecimals,
        accessToken: bearer,
        slippageBps: 50,
      });

      // Prefer returned signature; fall back to hook state
      const sigFromCall = res as string | null;
      const sig = sigFromCall || signature;
      const short =
        sig && typeof sig === "string"
          ? ` • ${sig.slice(0, 6)}…${sig.slice(-6)}`
          : "";

      toast.success(`Sell submitted${short}`, { id: toastId });
      onClose();

      // small refresh to reflect new balances
      setTimeout(() => {
        if (typeof window !== "undefined") window.location.reload();
      }, 250);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sell failed";
      toast.error(msg, { id: toastId });
      // UI error banner still renders below via `error`
    }
  }, [
    canSell,
    owner58,
    inputMint,
    amountStr,
    inputDecimals,
    getAccessToken,
    sell,
    onClose,
    row.token.symbol,
    signature,
  ]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md rounded-2xl border border-white/20 bg-black/40 backdrop-blur-[40px] p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="text-white font-semibold text-lg">
            Sell {row.token.name}
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-white/15 text-white/70 hover:bg-white/10"
          >
            Close
          </button>
        </div>

        <div className="text-white/60 text-sm mb-3">
          Balance:{" "}
          {row.amount.toLocaleString(undefined, {
            maximumFractionDigits: row.amount < 1 ? 6 : 4,
          })}{" "}
          {row.token.symbol}
        </div>

        <label className="block text-sm font-medium text-white/80 mb-2">
          Amount to sell ({row.token.symbol})
        </label>
        <div className="flex gap-2 mb-2">
          <input
            type="number"
            min="0"
            step="any"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            className="flex-1 rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/50"
            placeholder="0.0"
            inputMode="decimal"
          />
          <button
            type="button"
            onClick={onMax}
            className="px-3 py-2 rounded-xl border border-white/20 text-white/80 hover:bg-white/10"
          >
            Max
          </button>
        </div>

        <div className="text-xs text-white/50 mb-4">
          You&apos;ll receive USDC. A $0.25 USDC fee is charged only if the swap
          succeeds.
        </div>

        {error && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400 mb-3">
            {error}
          </div>
        )}
        {signature && (
          <div className="rounded-xl bg-[rgb(182,255,62)]/10 border border-[rgb(182,255,62)]/20 p-3 text-sm text-[rgb(182,255,62)] mb-3">
            Submitted! Tx: {signature.slice(0, 8)}…{signature.slice(-8)}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-white/20 text-white/80 hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            disabled={!canSell}
            onClick={onConfirm}
            className="px-5 py-2 rounded-xl bg-[rgb(182,255,62)] text-black font-semibold hover:bg-[rgb(182,255,62)]/90 disabled:opacity-50"
          >
            {loading ? "Selling…" : `Sell ${row.token.symbol}`}
          </button>
        </div>
      </div>
    </div>
  );
}
