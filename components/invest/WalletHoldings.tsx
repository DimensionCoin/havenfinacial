// components/wallet/WalletHoldings.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
      className={`rounded-2xl border border-white/10 bg-zinc-900/70 backdrop-blur-xl shadow-2xl ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="min-w-0">
          <div className="text-white font-semibold leading-tight">
            Investments
          </div>
          <div className="text-[11px] text-zinc-400 leading-tight">
            Total value:{" "}
            <span className="text-white/90 font-medium">
              {fmtMoney(totalLocal, currency)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-[10px] text-zinc-500">
            Updated {lastUpdated}
          </span>
          <button
            type="button"
            disabled={loading}
            onClick={onRefreshClick}
            className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/10 text-white/80 disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((c) => !c)}
            className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/10 text-white/80"
            title={collapsed ? "Expand" : "Collapse"}
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-200 ${
                collapsed ? "" : "rotate-180"
              }`}
            />
            {collapsed ? "Show" : "Hide"}
          </button>
        </div>
      </div>

      {/* Body (collapsible) */}
      {!collapsed && (
        <div className="p-4">
          {!owner58 ? (
            <div className="text-sm text-zinc-400">
              Your investment account isn’t ready yet. Please finish onboarding.
            </div>
          ) : error ? (
            <div className="text-sm text-red-400">
              Couldn’t load your investments. Please try again.
            </div>
          ) : rows.length === 0 && !loading ? (
            <div className="text-sm text-zinc-400">No assets above $0.01.</div>
          ) : (
            <ul className={`grid ${grid} gap-3`}>
              {rows.map((r) => (
                <li
                  key={`${r.token.symbol}-${getMintFor(r.token, cluster)}`}
                  className="rounded-xl border border-white/10 bg-zinc-900/70 backdrop-blur p-3 flex items-center gap-3"
                >
                  <Image
                    src={r.token.logo || "/logos/default.png"}
                    alt={`${r.token.name} logo`}
                    width={36}
                    height={36}
                    className="h-9 w-9 rounded-full border border-white/10 object-contain bg-zinc-800"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-white font-medium truncate">
                          {r.token.name}{" "}
                          <span className="text-xs text-zinc-400">
                            ({r.token.symbol})
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          Qty{" "}
                          {r.amount.toLocaleString(undefined, {
                            maximumFractionDigits: r.amount < 1 ? 6 : 4,
                          })}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-white/90 font-semibold">
                          {fmtMoney(r.valueUsd * fxRate, currency)}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {fmtMoney(r.priceUsd * fxRate, currency)}
                          <span className="opacity-70"> • each</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
              {loading && (
                <li className="rounded-xl border border-white/10 bg-zinc-900/70 backdrop-blur p-3 text-sm text-white/60">
                  Updating…
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
