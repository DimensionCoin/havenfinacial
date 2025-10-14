"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
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

function formatAmount(amount: number) {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(2)}M`;
  }
  if (amount >= 1000) {
    return `${(amount / 1000).toFixed(2)}K`;
  }
  return amount.toFixed(4);
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

export default function TopHoldings() {
  const { user } = useUser();
  const { ready, authenticated, getAccessToken } = usePrivy();

  const owner58 = user?.depositWallet?.address || null;
  const currency = useMemo(() => {
    const c = (user?.displayCurrency || "USD").toUpperCase();
    return c === "USDC" ? "USD" : c;
  }, [user?.displayCurrency]);

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
  const [fxRate, setFxRate] = useState(1);
  const [positions, setPositions] = useState<
    Array<{ token: TokenMeta; valueUsd: number; amount: number }>
  >([]);

  const refreshHoldings = useCallback(async () => {
    if (!owner58) {
      setPositions([]);
      setHasLoaded(true);
      return;
    }

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
        tokenAmount?: { amount?: string; decimals?: number };
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
        return { token, valueUsd, amount };
      });

      const filtered = rows.filter((r) => r.valueUsd >= 0.01);
      setPositions(filtered);
    } catch {
      setPositions([]);
    } finally {
      setHasLoaded(true);
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

  const topThree = positions.slice(0, 3);
  const hasHoldings = topThree.length > 0;
  const isLoading = !hasLoaded;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider">
          Top Holdings
        </h3>
        {hasHoldings && (
          <Link
            href="/invest"
            className="flex items-center gap-1 text-xs font-medium text-[rgb(182,255,62)] hover:text-[rgb(182,255,62)]/80 transition-colors"
          >
            See all
            <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </div>

      {/* Holdings List */}
      <div className="space-y-3">
        {isLoading ? (
          // Loading skeleton
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-3 rounded-2xl bg-black/80 border border-white/10 animate-pulse"
            >
              <div className="w-10 h-10 rounded-full bg-white/10" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-20 bg-white/10 rounded" />
                <div className="h-3 w-16 bg-white/5 rounded" />
              </div>
              <div className="text-right space-y-2">
                <div className="h-4 w-16 bg-white/10 rounded ml-auto" />
                <div className="h-3 w-12 bg-white/5 rounded ml-auto" />
              </div>
            </div>
          ))
        ) : hasHoldings ? (
          topThree.map((position) => (
            <div
              key={position.token.symbol}
              className="flex items-center gap-3 p-3 rounded-2xl bg-black/40 border border-white/10 hover:bg-white/10 hover:border-[rgb(182,255,62)]/20 transition-all duration-300 cursor-pointer group"
            >
              {/* Token Icon */}
              <div className="relative flex-shrink-0">
                <Image
                  src={
                    position.token.logo ||
                    "https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/default.png" ||
                    "/placeholder.svg"
                  }
                  alt={`${position.token.name} logo`}
                  width={40}
                  height={40}
                  className="rounded-full border border-white/20 bg-white/10 object-contain shadow-[0_0_12px_rgba(182,255,62,0.05)] group-hover:shadow-[0_0_16px_rgba(182,255,62,0.15)] transition-shadow"
                />
              </div>

              {/* Token Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">
                  {position.token.symbol}
                </p>
                <p className="text-xs text-white/50 truncate">
                  {formatAmount(position.amount)} {position.token.symbol}
                </p>
              </div>

              {/* Value */}
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold text-white">
                  {formatFiatNarrow(position.valueUsd * fxRate, currency)}
                </p>
                <p className="text-xs text-white/40">
                  {currency.toLowerCase()}
                </p>
              </div>
            </div>
          ))
        ) : (
          // Empty state
          <div className="flex flex-col items-center justify-center py-8 px-4 rounded-2xl bg-white/5 border border-white/10">
            <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center mb-3">
              <svg
                className="w-6 h-6 text-white/40"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
            </div>
            <p className="text-sm text-white/60 text-center mb-1">
              No holdings yet
            </p>
            <p className="text-xs text-white/40 text-center">
              Start investing to see your portfolio
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
