// InvestAccountCard.tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useUser } from "@/providers/UserProvider";
import { usePrivy } from "@privy-io/react-auth";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  getCluster,
  tokensForCluster,
  getMintFor,
  type TokenMeta,
} from "@/lib/tokens";

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC!;
const JUP_PRICE_BASE =
  process.env.NEXT_PUBLIC_JUP_PRICE_BASE || "https://lite-api.jup.ag/price/v3";

const USDC_MINTS_ENV = [
  process.env.NEXT_PUBLIC_USDC_MINT,
  process.env.NEXT_PUBLIC_USDC_MAINNET_MINT,
  process.env.NEXT_PUBLIC_USDC_DEVNET_MINT,
  process.env.NEXT_PUBLIC_USDC_2022_MINT,
].filter(Boolean) as string[];
const DEFAULT_USDC_MINTS = ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"];
const EXCLUDED_MINTS = new Set([...DEFAULT_USDC_MINTS, ...USDC_MINTS_ENV]);

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function formatFiatNarrow(n: number, currency: string) {
  try {
    const nf = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 2,
    });
    const parts = nf.formatToParts(n);
    const sym = parts.find((p) => p.type === "currency")?.value ?? "";
    const number = parts
      .filter((p) => p.type !== "currency")
      .map((p) => p.value)
      .join("");
    return `${sym}${number}`;
  } catch {
    return n.toFixed(2);
  }
}

async function fetchUsdPrices(ids: string[]) {
  if (!ids.length) return {};
  const out: Record<string, { usdPrice: number }> = {};
  const chunks = chunk(ids, 50);
  for (const c of chunks) {
    const res = await fetch(`${JUP_PRICE_BASE}?ids=${c.join(",")}`, {
      cache: "no-store",
    });
    if (!res.ok) continue;
    const j = await res.json();
    Object.assign(out, j);
  }
  return out;
}

function InvestAccountCard() {
  const { user } = useUser();
  const { ready, authenticated, getAccessToken } = usePrivy();

  const owner58 = user?.depositWallet?.address || null;
  const currency = (user?.displayCurrency || "USD").toUpperCase();
  const cluster = getCluster();

  const supportedTokens = useMemo(() => tokensForCluster(cluster), [cluster]);
  const byClusterMint = useMemo(() => {
    const map = new Map<string, TokenMeta>();
    for (const t of supportedTokens) {
      const mint = getMintFor(t, cluster);
      if (mint) map.set(mint, t);
    }
    return map;
  }, [supportedTokens, cluster]);

  const mainnetMintFor = useCallback(
    (t: TokenMeta) => getMintFor(t, "mainnet"),
    []
  );

  const [conn] = useState(() => new Connection(RPC, "confirmed"));

  const [hasLoaded, setHasLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [totalUsd, setTotalUsd] = useState(0);
  const [fxRate, setFxRate] = useState(1);
  const [positions, setPositions] = useState<
    Array<{ token: TokenMeta; valueUsd: number }>
  >([]);

  const refreshHoldings = useCallback(async () => {
    if (!owner58) {
      setPositions([]);
      setTotalUsd(0);
      setHasLoaded(true);
      return;
    }

    setRefreshing(true);
    try {
      const owner = new PublicKey(owner58);
      const [std, v22] = await Promise.all([
        conn.getParsedTokenAccountsByOwner(owner, {
          programId: TOKEN_PROGRAM_ID,
        }),
        conn.getParsedTokenAccountsByOwner(owner, {
          programId: TOKEN_2022_PROGRAM_ID,
        }),
      ]);

      const ZERO = BigInt(0);
      const accTotals = new Map<string, { raw: bigint; decimals: number }>();

      type ParsedTokenInfo = {
        mint?: string;
        tokenAmount?: {
          amount?: string;
          decimals?: number;
        };
      };

      const add = (accs: typeof std) => {
        for (const { account } of accs.value) {
          const parsedInfo = (
            account.data as { parsed?: { info?: ParsedTokenInfo } }
          )?.parsed?.info;
          if (!parsedInfo) continue;

          const mint = parsedInfo.mint;
          if (!mint || EXCLUDED_MINTS.has(mint) || !byClusterMint.has(mint))
            continue;
          const amtStr = parsedInfo.tokenAmount?.amount ?? "0";
          const decimals = Number(parsedInfo.tokenAmount?.decimals ?? 0);
          let raw: bigint;
          try {
            raw = BigInt(amtStr);
          } catch {
            raw = ZERO;
          }
          if (raw <= ZERO) continue;

          const prev = accTotals.get(mint);
          if (!prev) accTotals.set(mint, { raw, decimals });
          else accTotals.set(mint, { raw: prev.raw + raw, decimals });
        }
      };

      add(std);
      add(v22);

      const held = Array.from(accTotals.entries()).map(
        ([mint, { raw, decimals }]) => {
          const token = byClusterMint.get(mint)!;
          return { token, raw, decimals };
        }
      );

      const mints = held
        .map(({ token }) => mainnetMintFor(token))
        .filter((m): m is string => !!m);
      const prices = await fetchUsdPrices([...new Set(mints)]);

      const rows = held.map(({ token, raw, decimals }) => {
        const amount = Number(raw) / 10 ** decimals;
        const price = prices[mainnetMintFor(token)!]?.usdPrice ?? 0;
        const valueUsd = amount * price;
        return { token, valueUsd };
      });

      const filtered = rows.filter((r) => r.valueUsd >= 0.01);
      setPositions(filtered);
      setTotalUsd(filtered.reduce((s, r) => s + r.valueUsd, 0));
    } catch {
      setPositions([]);
      setTotalUsd(0);
    } finally {
      setHasLoaded(true);
      setRefreshing(false);
    }
  }, [conn, owner58, byClusterMint, mainnetMintFor]);

  useEffect(() => {
    void refreshHoldings();
  }, [refreshHoldings]);

  useEffect(() => {
    if (currency === "USD") return setFxRate(1);
    (async () => {
      try {
        const bearer = ready && authenticated ? await getAccessToken() : null;
        const r = await fetch(`/api/fx?currency=${currency}&amount=1`, {
          headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
          cache: "no-store",
        });
        const j = await r.json();
        setFxRate(Number(j?.rate || 1));
      } catch {
        setFxRate(1);
      }
    })();
  }, [currency, ready, authenticated, getAccessToken]);

  const fiatTotal = useMemo(() => totalUsd * fxRate, [totalUsd, fxRate]);

  const manualRefresh = useCallback(
    (e?: React.MouseEvent<HTMLButtonElement>) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      return refreshHoldings();
    },
    [refreshHoldings]
  );

  const showEmpty = hasLoaded && positions.length === 0;
  const hasAssets = !showEmpty;

  return (
    <Link
      href="/invest"
      className="block space-y-6 vision-perspective focus:outline-none"
      aria-label="Open Invest page"
    >
      <div className="relative group">
        {/* Background glow */}
        <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/20 via-transparent to-[rgb(182,255,62)]/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-700" />

        {/* Card */}
        <div className="relative vision-window p-4 sm:p-6 lg:p-8 rounded-3xl border border-white/20 bg-black/40 backdrop-blur-[40px] backdrop-saturate-[200%] shadow-[0_32px_64px_rgba(0,0,0,0.4),0_16px_32px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(0,0,0,0.2)] hover:shadow-[0_40px_80px_rgba(0,0,0,0.5),0_20px_40px_rgba(0,0,0,0.3),inset_0_2px_0_rgba(255,255,255,0.12)] transition-all duration-500 transform-gpu cursor-pointer">
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/5 via-transparent to-transparent pointer-events-none" />

          {/* Header */}
          <div className="flex items-center justify-between gap-2 mb-6 sm:mb-8">
            <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
              <div className="relative flex-shrink-0">
                <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-[rgb(182,255,62)] shadow-[0_0_20px_rgba(182,255,62,0.6)] animate-pulse" />
                <div className="absolute inset-0 w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-[rgb(182,255,62)] animate-ping opacity-20" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg sm:text-xl lg:text-2xl font-bold text-white tracking-tight truncate">
                  Invest Account
                </h3>
                <p className="text-xs sm:text-sm text-white/60 mt-1">
                  {hasAssets ? "Portfolio Value" : "Get started"}
                </p>
              </div>
            </div>

            {/* Refresh (prevents navigation) */}
            <button
              onClick={manualRefresh}
              disabled={refreshing || !owner58}
              className="vision-button px-3 py-2 sm:px-6 sm:py-3 text-xs sm:text-sm text-[rgb(182,255,62)] disabled:opacity-60 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-[rgb(182,255,62)]/30 transition-all duration-300 backdrop-blur-sm flex-shrink-0"
              aria-busy={refreshing}
              aria-label="Refresh balances"
              title="Refresh balances"
              type="button"
            >
              {refreshing ? (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 sm:w-4 sm:h-4 border-2 border-[rgb(182,255,62)]/30 border-t-[rgb(182,255,62)] rounded-full animate-spin" />
                  <span className="hidden sm:inline">Refreshing…</span>
                  <span className="sm:hidden">…</span>
                </div>
              ) : (
                "Refresh"
              )}
            </button>
          </div>

          {/* Content: use a 2-col grid at ALL sizes to keep symmetry */}
          {hasAssets ? (
            <div className="grid grid-cols-2 items-end gap-4">
              {/* Balance (left) */}
              <div className="min-w-0">
                <div className="flex items-baseline gap-3 min-h-[2.75rem] sm:min-h-[3.25rem]">
                  {refreshing ? (
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-24 sm:h-12 sm:w-36 bg-white/10 rounded-xl animate-pulse" />
                      <div className="h-4 w-8 sm:h-6 sm:w-12 bg-white/5 rounded-lg animate-pulse" />
                    </div>
                  ) : (
                    <>
                      <span className="text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-black bg-gradient-to-br from-white via-white to-white/80 bg-clip-text text-transparent tracking-tight leading-none">
                        {formatFiatNarrow(fiatTotal, currency)}
                      </span>
                      <span className="text-sm sm:text-base lg:text-lg text-white/50 font-medium self-end pb-1 lg:pb-2">
                        {currency.toLowerCase()}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Logos + count (right) */}
              <div className="justify-self-end text-right">
                <div className="flex justify-end space-x-2 mb-1 min-h-8">
                  {refreshing
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <div
                          key={i}
                          className="w-8 h-8 rounded-full border border-white/10 bg-white/5 animate-pulse"
                        />
                      ))
                    : positions
                        .slice(0, 3)
                        .map((p) => (
                          <Image
                            key={p.token.symbol}
                            src={
                              p.token.logo ||
                              "https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/default.png"
                            }
                            alt={`${p.token.name} logo`}
                            width={32}
                            height={32}
                            className="rounded-full border border-white/20 bg-white/10 object-contain shadow-[0_0_12px_rgba(182,255,62,0.05)]"
                          />
                        ))}
                </div>
                <p className="text-xs text-white/60">
                  {hasLoaded ? (
                    <>
                      {positions.length} position
                      {positions.length > 1 ? "s" : ""}
                    </>
                  ) : (
                    "Loading…"
                  )}
                </p>
              </div>
            </div>
          ) : (
            // Empty state: keep grid symmetry too
            <div className="grid grid-cols-2 items-center gap-3">
              <div className="text-white/70 text-sm">
                You don&apos;t have any assets yet.
              </div>
              <div className="justify-self-end">
                <div
                  className="group relative overflow-hidden vision-button inline-flex items-center justify-center gap-2 px-4 py-2 rounded-2xl bg-[rgb(182,255,62)] text-black font-semibold hover:bg-[rgb(182,255,62)]/90 transition-all duration-300 shadow-[0_8px_32px_rgba(182,255,62,0.3)]"
                  role="button"
                  aria-label="Buy assets"
                >
                  <span>Buy some assets</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

export default InvestAccountCard;
