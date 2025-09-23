// components/wallet/WalletHoldings.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { RefreshCw, ChevronDown } from "lucide-react";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { useUser } from "@/providers/UserProvider";
import { usePrivy } from "@privy-io/react-auth";

// Pull everything from your catalog (logos are local /public paths)
import {
  getCluster,
  tokensForCluster,
  getMintFor,
  WSOL_MINT,
  type TokenMeta,
} from "@/lib/tokens";

/* ------------------------------ config/env ------------------------------- */

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC!;
const LAMPORTS_PER_SOL = 1_000_000_000;

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
  token: TokenMeta; // from catalog (gives us local logo/name/symbol)
  amount: number;
  priceUsd: number; // price per unit in USD
  valueUsd: number; // amount * priceUsd
};

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
  const owner58 = user?.depositWallet?.address || null; // ✅ deposit wallet
  const cluster = getCluster();

  // Supported tokens for this cluster (from catalog)
  const supportedTokens = useMemo(() => tokensForCluster(cluster), [cluster]);

  // Index by current-cluster mint for quick lookups
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
  const [rows, setRows] = useState<ViewRow[]>([]); // USD-only rows
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [fxRate, setFxRate] = useState<number>(1); // USD -> display currency
  const [collapsed, setCollapsed] = useState(false); // ▼ collapsible

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

      // 1) Native SOL balance (always map to WSOL mint in catalog indexing)
      const lamports = await conn.getBalance(owner, "confirmed");
      const solAmount = lamports / LAMPORTS_PER_SOL;

      const holdings: Holding[] = [];
      if (solAmount > 0 && byClusterMint.has(WSOL_MINT)) {
        holdings.push({ mint: WSOL_MINT, amountUi: solAmount });
      }

      // 2) SPL balances, but only keep those whose mint is in our catalog
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
          if (!byClusterMint.has(mint)) continue; // ❗ only tokens we support
          if (EXCLUDED_MINTS.has(mint)) continue; // hide USDC etc.
          holdings.push({ mint, amountUi });
        }
      };
      addTokenAccounts(tokStd);
      addTokenAccounts(tok22);

      // 3) Consolidate quantities per (supported) mint
      const byMint = new Map<string, number>();
      for (const h of holdings) {
        byMint.set(h.mint, (byMint.get(h.mint) || 0) + h.amountUi);
      }

      // 4) Build list of supported tokens the user actually holds (>0)
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

      // 5) Fetch USD prices using **mainnet** mints of the held tokens
      const priceIds = heldTokens
        .map((t) => mainnetMintFor(t))
        .filter((m): m is string => !!m);
      const prices = await fetchUsdPrices(Array.from(new Set(priceIds)));

      // 6) Build rows in USD (hide < $0.01)
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

        rowsUsd.push({
          token: t,
          amount,
          priceUsd,
          valueUsd,
        });
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

  // Load FX first, then balances; re-run if currency changes
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

  // Compute totals/prices in display currency at render-time
  const totalLocal = useMemo(
    () => rows.reduce((s, r) => s + r.valueUsd, 0) * fxRate,
    [rows, fxRate]
  );

  const lastUpdated =
    updatedAt == null ? "—" : new Date(updatedAt).toLocaleTimeString();

  const grid =
    rows.length === 1 ? "grid-cols-1" : "sm:grid-cols-2 lg:grid-cols-3";

  return (
    <div
      className={`relative rounded-3xl border border-white/20 bg-black/40 backdrop-blur-[40px] backdrop-saturate-[200%] shadow-[0_32px_64px_rgba(0,0,0,0.4),0_16px_32px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(0,0,0,0.2)] overflow-hidden ${className}`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-black/20 pointer-events-none" />

      {/* Header */}
      <div className="relative flex items-center justify-between px-6 py-4 border-b border-white/10 bg-gradient-to-r from-white/5 to-transparent">
        <div className="min-w-0">
          <div className="text-white font-bold text-lg leading-tight tracking-tight">
            Portfolio
          </div>
          <div className="text-sm text-white/60 leading-tight mt-1">
            Total value:{" "}
            <span className="text-white font-semibold">
              {fmtMoney(totalLocal, currency)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-xs text-white/60 bg-white/5 px-3 py-1.5 rounded-full border border-white/10">
            Updated {lastUpdated}
          </span>
          <button
            type="button"
            disabled={loading}
            onClick={onRefreshClick}
            className="inline-flex items-center gap-2 text-sm px-4 py-2.5 rounded-xl border border-white/20 bg-white/5 hover:bg-white/10 text-white backdrop-blur-sm disabled:opacity-50 transition-all duration-200 shadow-lg hover:shadow-xl"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((c) => !c)}
            className="inline-flex items-center gap-2 text-sm px-4 py-2.5 rounded-xl border border-white/20 bg-white/5 hover:bg-white/10 text-white backdrop-blur-sm transition-all duration-200 shadow-lg hover:shadow-xl"
            title={collapsed ? "Expand" : "Collapse"}
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-300 ${
                collapsed ? "" : "rotate-180"
              }`}
            />
            <span className="hidden sm:inline">
              {collapsed ? "Show" : "Hide"}
            </span>
          </button>
        </div>
      </div>

      {/* Body (collapsible) */}
      {!collapsed && (
        <div className="relative p-6">
          {!owner58 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                <div className="w-8 h-8 rounded-full bg-white/10" />
              </div>
              <div className="text-white font-medium mb-2">
                Wallet Not Ready
              </div>
              <div className="text-sm text-white/60 max-w-sm mx-auto">
                Your investment account isn&#39;t ready yet. Please finish
                onboarding to view your portfolio.
              </div>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <div className="w-8 h-8 rounded-full bg-red-500/20" />
              </div>
              <div className="text-red-300 font-medium mb-2">
                Connection Error
              </div>
              <div className="text-sm text-red-400/80 max-w-sm mx-auto">
                Couldn&#39;t load your investments. Please check your connection and
                try again.
              </div>
            </div>
          ) : rows.length === 0 && !loading ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                <div className="w-8 h-8 rounded-full bg-white/10" />
              </div>
              <div className="text-white font-medium mb-2">No Assets Found</div>
              <div className="text-sm text-white/60 max-w-sm mx-auto mb-4">
                No assets above $0.01 found in your wallet. Start investing to
                see your portfolio here.
              </div>
              <button
                type="button"
                onClick={onRefreshClick}
                className="group relative overflow-hidden rounded-2xl bg-[rgb(182,255,62)] text-black px-6 py-3 font-bold text-sm hover:bg-[rgb(182,255,62)]/90 transition-all duration-300 shadow-[0_8px_32px_rgba(182,255,62,0.3)] hover:shadow-[0_12px_48px_rgba(182,255,62,0.4)] transform hover:scale-[1.02] active:scale-[0.98]"
              >
                {/* Button shimmer effect */}
                <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                <div className="relative flex items-center justify-center gap-2">
                  <RefreshCw
                    className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                  />
                  <span>Refresh Portfolio</span>
                </div>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className={`grid ${grid} gap-4`}>
                {rows.map((r) => (
                  <div
                    key={`${r.token.symbol}-${getMintFor(r.token, cluster)}`}
                    className="group relative rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-4 hover:border-white/20 hover:bg-white/10 transition-all duration-300 shadow-lg hover:shadow-xl"
                  >
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <Image
                          src={r.token.logo || "/logos/default.png"}
                          alt={`${r.token.name} logo`}
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
                              {r.token.name}
                            </div>
                            <div className="text-sm text-white/60 leading-tight">
                              {r.token.symbol} •{" "}
                              {r.amount.toLocaleString(undefined, {
                                maximumFractionDigits: r.amount < 1 ? 6 : 4,
                              })}
                            </div>
                          </div>

                          <div className="text-right flex-shrink-0">
                            <div className="text-white font-bold text-lg leading-tight">
                              {fmtMoney(r.valueUsd * fxRate, currency)}
                            </div>
                            <div className="text-sm text-white/60 leading-tight">
                              {fmtMoney(r.priceUsd * fxRate, currency)} each
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 h-1 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-[rgb(182,255,62)] to-[rgb(182,255,62)]/80 rounded-full transition-all duration-1000"
                            style={{
                              width: `${Math.min(
                                (r.valueUsd /
                                  Math.max(
                                    ...rows.map((row) => row.valueUsd)
                                  )) *
                                  100,
                                100
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-4">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-full bg-white/10 animate-pulse" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-white/10 rounded animate-pulse" />
                        <div className="h-3 bg-white/5 rounded animate-pulse w-2/3" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
