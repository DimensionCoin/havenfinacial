// components/wallet/WalletHoldings.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { RefreshCw, ChevronDown } from "lucide-react";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { useUser } from "@/providers/UserProvider";
import { usePrivy } from "@privy-io/react-auth";

/* ------------------------------ config/env ------------------------------- */

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC!;
const SOL_MINT = "So11111111111111111111111111111111111111112";
const LAMPORTS_PER_SOL = 1_000_000_000;

// Jupiter Token API (metadata)
const JUP_TOKENS_STRICT =
  process.env.NEXT_PUBLIC_JUP_TOKENS_STRICT || "https://token.jup.ag/strict";
const JUP_TOKENS_FALLBACK =
  process.env.NEXT_PUBLIC_JUP_TOKENS_FALLBACK ||
  "https://tokens.jup.ag/tokens?tags=verified";

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

type TokenMeta = {
  address: string; // mint
  symbol: string;
  name: string;
  logoURI?: string | null;
  decimals: number;
};

type PriceResp = Record<
  string,
  { usdPrice: number; decimals: number; priceChange24h?: number }
>;

type Holding = {
  mint: string;
  amountUi: number;
};

type ViewRow = {
  mint: string;
  symbol: string;
  name: string;
  logo?: string | null;
  amount: number;
  priceUsd: number; // store USD price
  valueUsd: number; // store USD value
};

/* ------------------------------ helpers ---------------------------------- */

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

// In case a USDC mint slips through the env set, also exclude by metadata.
function shouldHideByMeta(meta?: TokenMeta | null) {
  if (!meta) return false;
  const sym = (meta.symbol || "").trim().toUpperCase();
  const nm = (meta.name || "").trim().toUpperCase();
  return sym === "USDC" || nm === "USD COIN" || nm.includes("USDC");
}

/* --------------------------- metadata fetchers ---------------------------- */

async function fetchJupStrict(
  ids: string[]
): Promise<Record<string, TokenMeta>> {
  if (!ids.length) return {};
  const url = `${JUP_TOKENS_STRICT}?ids=${ids.join(",")}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`strict ${r.status}`);
  const j = await r.json();
  const map: Record<string, TokenMeta> = {};
  if (Array.isArray(j)) {
    for (const t of j) {
      if (!t?.address) continue;
      map[t.address] = {
        address: t.address,
        symbol: t.symbol ?? "",
        name: t.name ?? "",
        logoURI: t.logoURI ?? null,
        decimals: Number(t.decimals ?? 0),
      };
    }
  } else if (j && typeof j === "object") {
    for (const [mint, t] of Object.entries(j as Record<string, unknown>)) {
      map[mint] = {
        address: mint,
        symbol:
          typeof (t as Record<string, unknown>).symbol === "string"
            ? ((t as Record<string, unknown>).symbol as string)
            : "",
        name:
          typeof (t as Record<string, unknown>).name === "string"
            ? ((t as Record<string, unknown>).name as string)
            : "",
        logoURI:
          typeof (t as Record<string, unknown>).logoURI === "string"
            ? ((t as Record<string, unknown>).logoURI as string)
            : null,
        decimals: Number(
          (t as Record<string, unknown>).decimals as number | string | undefined
        ) || 0,
      };
    }
  }
  return map;
}

async function fetchJupTokensFallback(
  ids: string[]
): Promise<Record<string, TokenMeta>> {
  const r = await fetch(JUP_TOKENS_FALLBACK, { cache: "no-store" });
  if (!r.ok) throw new Error(`tokens ${r.status}`);
  const arrUnknown = (await r.json()) as unknown;
  const arr = Array.isArray(arrUnknown) ? (arrUnknown as unknown[]) : [];
  const idx = new Map<string, TokenMeta>();
  for (const t of arr) {
    const rec = (t ?? {}) as Record<string, unknown>;
    const addr = (rec.address as string | undefined) ?? (rec.mint as string | undefined);
    if (!addr) continue;
    if (!ids.includes(addr)) continue;
    idx.set(addr, {
      address: addr,
      symbol: (rec.symbol as string) ?? "",
      name: (rec.name as string) ?? "",
      logoURI: (rec.logoURI as string) ?? null,
      decimals: Number((rec.decimals as number | string | undefined) ?? 0),
    });
  }
  return Object.fromEntries(idx.entries());
}

async function fetchTokenMeta(
  ids: string[]
): Promise<Record<string, TokenMeta>> {
  if (!ids.length) return {};
  try {
    const strict = await fetchJupStrict(ids);
    const missing = ids.filter((m) => !strict[m]);
    if (!missing.length) return strict;
    const fb = await fetchJupTokensFallback(missing);
    return { ...strict, ...fb };
  } catch {
    try {
      return await fetchJupTokensFallback(ids);
    } catch {
      return {};
    }
  }
}

/* ------------------------------ price fetcher ----------------------------- */

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
  const owner58 = user?.depositWallet?.address || null; // ✅ deposit wallet owner

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ViewRow[]>([]); // USD-only rows
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [fxRate, setFxRate] = useState<number>(1); // USD -> display currency
  const [collapsed, setCollapsed] = useState(false); // ▼ collapsible (default expanded)

  // fetch USD→display FX (authorized so it actually returns CAD etc.)
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

      // 1) Native SOL
      const lamports = await conn.getBalance(owner, "confirmed");
      const solAmount = lamports / LAMPORTS_PER_SOL;
      const holdings: Holding[] = [];
      if (solAmount > 0) holdings.push({ mint: SOL_MINT, amountUi: solAmount });

      // 2) SPL balances
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
          const info = (it.account.data.parsed as { info?: ParsedTokenInfo } | undefined)?.info;
          const mint: string | undefined = info?.mint;
          const amountUi: number | undefined = Number(info?.tokenAmount?.uiAmount ?? 0);
          if (!mint) continue;
          if (!amountUi || amountUi <= 0) continue;
          if (EXCLUDED_MINTS.has(mint)) continue; // hide USDC
          holdings.push({ mint, amountUi });
        }
      };
      addTokenAccounts(tokStd);
      addTokenAccounts(tok22);

      // Consolidate
      const byMint = new Map<string, number>();
      for (const h of holdings)
        byMint.set(h.mint, (byMint.get(h.mint) || 0) + h.amountUi);
      const mints = Array.from(byMint.keys());

      // 3) Metadata
      const metaMap = await fetchTokenMeta(mints);

      // SOL meta fallback
      if (!metaMap[SOL_MINT]) {
        metaMap[SOL_MINT] = {
          address: SOL_MINT,
          symbol: "SOL",
          name: "Solana",
          logoURI:
            "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
          decimals: 9,
        };
      }

      // 4) Prices (USD)
      const pricedMints = mints.filter(
        (m) =>
          !!metaMap[m] &&
          !EXCLUDED_MINTS.has(m) &&
          !shouldHideByMeta(metaMap[m])
      );
      const prices = await fetchUsdPrices(pricedMints);

      // 5) Build rows in USD (hide < $0.01)
      const rowsUsd: ViewRow[] = [];
      for (const mint of pricedMints) {
        const amount = byMint.get(mint) || 0;
        const meta = metaMap[mint];
        if (!meta || shouldHideByMeta(meta)) continue;
        const p = prices[mint];
        if (!p) continue;

        const priceUsd = Number(p.usdPrice || 0);
        const valueUsd = amount * priceUsd;
        if (valueUsd < 0.01) continue;

        rowsUsd.push({
          mint,
          symbol: meta.symbol || "—",
          name: meta.name || "Unknown",
          logo: meta.logoURI ?? null,
          amount,
          priceUsd,
          valueUsd,
        });
      }

      rowsUsd.sort((a, b) => b.valueUsd - a.valueUsd);

      setRows(rowsUsd); // USD-only data in state
      setUpdatedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [owner58]);

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
                  key={r.mint}
                  className="rounded-xl border border-white/10 bg-zinc-900/70 backdrop-blur p-3 flex items-center gap-3"
                >
                  <Image
                    src={
                      r.logo ||
                      "https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/default.png"
                    }
                    alt={`${r.name} logo`}
                    width={36}
                    height={36}
                    className="h-9 w-9 rounded-full border border-white/10 object-contain bg-zinc-800"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-white font-medium truncate">
                          {r.name}{" "}
                          <span className="text-xs text-zinc-400">
                            ({r.symbol})
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
