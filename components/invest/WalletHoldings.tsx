// app/(wherever)/WalletHoldings.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { RefreshCw, X } from "lucide-react";
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
  { usdPrice: number; decimals?: number; priceChange24h?: number }
>;

type ViewRow = {
  token: TokenMeta;
  amount: number;            // for math/display
  amountFullStr: string;     // exact UI units for "Max" (no trimming)
  decimals: number;          // mint decimals
  rawStr: string;            // raw base units as string
  priceUsd: number;
  valueUsd: number;
};

/* -------------------------------- utils ---------------------------------- */

const chunk = <T,>(arr: T[], size: number) => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

function fmtMoneyWithoutCurrency(v: number) {
  try {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: v < 1 ? 4 : 2,
    }).format(v);
  } catch {
    return v.toFixed(2);
  }
}

/** raw (bigint) → exact UI string with `decimals` (no trimming) */
function uiStringFromRaw(raw: bigint, decimals: number): string {
  const s = raw.toString();
  if (decimals <= 0) return s;
  const split = s.length - decimals;
  if (split <= 0) return `0.${"0".repeat(-split)}${s}`;
  return `${s.slice(0, split)}.${s.slice(split)}`;
}

/** UI string → raw bigint for precise compare (no ES2020 bigint literals used) */
function rawFromUiString(value: string, decimals: number): bigint {
  const TEN = BigInt(10);
  const ZERO = BigInt(0);
  if (!value || !/^\d*(?:\.\d*)?$/.test(value)) return ZERO;
  const [whole = "", frac = ""] = value.split(".");
  const fracPadded = (frac || "").padEnd(decimals, "0").slice(0, decimals);
  const wholeBI = whole ? BigInt(whole) : ZERO;
  const fracBI = fracPadded ? BigInt(fracPadded) : ZERO;
  const scale = TEN ** BigInt(decimals);
  return wholeBI * scale + fracBI;
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

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ViewRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [fxRate, setFxRate] = useState<number>(1);

  const [sellOpen, setSellOpen] = useState(false);
  const [sellRow, setSellRow] = useState<ViewRow | null>(null);

  const openSell = useCallback((row: ViewRow) => {
    setSellRow(row);
    setSellOpen(true);
  }, []);

  const closeSell = () => {
    setSellOpen(false);
    setSellRow(null);
  };

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
        tokenAmount?: {
          amount?: string;
          decimals?: number;
          uiAmountString?: string;
          uiAmount?: number;
        };
      };

      const ZERO = BigInt(0);
      const TEN = BigInt(10);

      const accTotals = new Map<string, { raw: bigint; decimals: number }>();

      const addTokenAccounts = (accs: typeof tokStd) => {
        for (const it of accs.value) {
          const info = (
            it.account.data.parsed as { info?: ParsedTokenInfo } | undefined
          )?.info;
          const mint = info?.mint;
          if (!mint) continue;
          if (!byClusterMint.has(mint)) continue;
          if (EXCLUDED_MINTS.has(mint)) continue;

          const amtStr = info?.tokenAmount?.amount ?? "0";
          const decimals = Number(info?.tokenAmount?.decimals ?? 0);
          let raw: bigint;
          try {
            raw = BigInt(amtStr);
          } catch {
            raw = ZERO;
          }
          if (raw <= ZERO) continue;

          const prev = accTotals.get(mint);
          if (!prev) {
            accTotals.set(mint, { raw, decimals });
          } else if (prev.decimals === decimals) {
            accTotals.set(mint, { raw: prev.raw + raw, decimals });
          } else {
            const d = Math.max(prev.decimals, decimals);
            const scalePrev =
              prev.decimals === d ? BigInt(1) : TEN ** BigInt(d - prev.decimals);
            const scaleNew =
              decimals === d ? BigInt(1) : TEN ** BigInt(d - decimals);
            accTotals.set(mint, {
              raw: prev.raw * scalePrev + raw * scaleNew,
              decimals: d,
            });
          }
        }
      };

      addTokenAccounts(tokStd);
      addTokenAccounts(tok22);

      const held: Array<{
        token: TokenMeta;
        mint: string;
        raw: bigint;
        decimals: number;
      }> = [];
      for (const [mint, { raw, decimals }] of accTotals.entries()) {
        if (raw <= ZERO) continue;
        const token = byClusterMint.get(mint);
        if (token) held.push({ token, mint, raw, decimals });
      }

      if (held.length === 0) {
        setRows([]);
        setUpdatedAt(Date.now());
        setLoading(false);
        return;
      }

      const priceIds = held
        .map(({ token }) => mainnetMintFor(token))
        .filter((m): m is string => !!m);
      const prices = await fetchUsdPrices(Array.from(new Set(priceIds)));

      const rowsUsd: ViewRow[] = [];
      for (const { token, raw, decimals } of held) {
        const amountFullStr = uiStringFromRaw(raw, decimals);
        const amount = Number.parseFloat(
          decimals > 0 ? amountFullStr : raw.toString()
        );

        const mainnetMint = mainnetMintFor(token);
        const p = mainnetMint ? prices[mainnetMint] : undefined;
        if (!p) continue;

        const priceUsd = Number(p.usdPrice || 0);
        const valueUsd = amount * priceUsd;
        if (valueUsd < 0.01) continue;

        rowsUsd.push({
          token,
          amount,
          amountFullStr,
          decimals,
          rawStr: raw.toString(),
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
  }, [owner58, byClusterMint, mainnetMintFor]);

  useEffect(() => {
    (async () => {
      await refreshFx();
      await refresh();
    })();
  }, [refreshFx, refresh]);

  const onRefreshClick = async () => {
    await refreshFx();
    await refresh();
  };

  const totalLocal = useMemo(
    () => rows.reduce((s, r) => s + r.valueUsd, 0) * fxRate,
    [rows, fxRate]
  );
  const lastUpdated =
    updatedAt == null ? "—" : new Date(updatedAt).toLocaleTimeString();

  return (
    <div className={`min-h-screen bg-black/10 vision-perspective ${className}`}>
      <header className="sticky top-0 z-10  backdrop-blur-[40px]  border-b border-white/10 ">
        <div className="container mx-auto px-2 py-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold text-white">Portfolio</h1>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={onRefreshClick}
              className="p-2 rounded-full bg-white/10 border border-white/20 hover:bg-white/20 transition-all duration-300 text-white/70 hover:text-white"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
            </button>
          </div>

          <div className="text-center py-">
            <div className="text-2xl font-bold text-white mb-1">
              {fmtMoneyWithoutCurrency(totalLocal)} {currency}
            </div>
            <div className="text-xs text-white/50">Updated {lastUpdated}</div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px- py-4">
        {!owner58 ? (
          <div className="text-center py-12">
            <div className="relative group mx-auto mb-6 w-16 h-16">
              <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/20 via-transparent to-[rgb(182,255,62)]/20 rounded-full blur-xl opacity-50 pointer-events-none" />
              <div className="relative w-16 h-16 rounded-full bg-white/5 backdrop-blur-sm border border-white/10 flex items-center justify-center">
                <div className="w-8 h-8 rounded-full bg-white/10" />
              </div>
            </div>
            <div className="text-white mb-2 text-lg font-bold">
              Wallet Not Ready
            </div>
            <div className="text-white/60 text-sm max-w-md mx-auto">
              Your investment account isn&apos;t ready yet. Please finish
              onboarding to view your portfolio.
            </div>
          </div>
        ) : error ? (
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-red-500/20 via-transparent to-red-500/20 rounded-2xl blur-xl opacity-50 pointer-events-none" />
            <div className="relative text-center p-6 rounded-2xl bg-red-500/10 border border-red-500/30 backdrop-blur-sm">
              <div className="text-red-400 font-semibold text-lg">
                Connection Error
              </div>
              <div className="text-red-400/70 text-sm mt-2">
                Couldn&apos;t load your investments. Please check your
                connection and try again.
              </div>
            </div>
          </div>
        ) : rows.length === 0 && !loading ? (
          <div className="text-center py-12">
            <div className="relative group mx-auto mb-6 w-16 h-16">
              <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/20 via-transparent to-[rgb(182,255,62)]/20 rounded-full blur-xl opacity-50 pointer-events-none" />
              <div className="relative w-16 h-16 rounded-full bg-white/5 backdrop-blur-sm border border-white/10 flex items-center justify-center">
                <div className="w-8 h-8 rounded-full bg-white/10" />
              </div>
            </div>
            <div className="text-white mb-2 text-lg font-bold">
              No Assets Found
            </div>
            <div className="text-white/60 text-sm max-w-md mx-auto mb-4">
              No assets above $0.01 found in your wallet. Start investing to see
              your portfolio here.
            </div>
            <button
              type="button"
              onClick={onRefreshClick}
              className="group relative overflow-hidden rounded-2xl bg-[rgb(182,255,62)] text-black px-6 py-3 font-bold text-sm hover:bg-[rgb(182,255,62)]/90 transition-all duration-300 shadow-[0_8px_32px_rgba(182,255,62,0.3)] hover:shadow-[0_12px_48px_rgba(182,255,62,0.4)] transform hover:scale-[1.02] active:scale-[0.98]"
            >
              <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
              <div className="relative flex items-center justify-center gap-2">
                <RefreshCw
                  className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                />
                <span>Refresh Portfolio</span>
              </div>
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => {
              const cluster = getCluster();
              const clusterMint = getMintFor(row.token, cluster);
              const valueLocal = row.valueUsd * fxRate;

              return (
                <div
                  key={`${row.token.symbol}-${clusterMint ?? "nomint"}`}
                  className="relative group"
                >
                  {/* Subtle hover effect */}
                  <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/5 via-transparent to-[rgb(182,255,62)]/5 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-500 pointer-events-none" />

                  <div className="relative p-4 rounded-2xl border border-white/10 bg-black/20 backdrop-blur-[20px] backdrop-saturate-[150%] hover:bg-black/30 hover:border-white/20 transition-all duration-300">
                    <div className="flex items-center justify-between">
                      {/* Left side - Token info */}
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="relative flex-shrink-0">
                          <Image
                            src={
                              row.token.logo ||
                              "https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/default.png" ||
                              "/placeholder.svg"
                            }
                            alt={`${row.token.name} logo`}
                            width={40}
                            height={40}
                            className="h-10 w-10 rounded-full border border-white/20 object-contain bg-white/5"
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-white font-semibold text-base truncate">
                              {row.token.name}
                            </span>
                          </div>
                          <div className="text-white/60 text-sm">
                            {row.amount.toLocaleString(undefined, {
                              maximumFractionDigits:
                                row.amount < 1
                                  ? Math.min(row.decimals, 8)
                                  : Math.min(row.decimals, 4),
                            })}{" "}
                            {row.token.symbol}
                          </div>
                        </div>
                      </div>

                      {/* Right side - Values and sell button */}
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-white font-semibold text-base">
                            ${fmtMoneyWithoutCurrency(valueLocal)}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => openSell(row)}
                          className="group/btn relative overflow-hidden vision-button flex items-center justify-center gap-2 px-4 sm:px-6 py-2.5 sm:py-3 w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed rounded-lg bg-white/10 border border-white/20 hover:bg-[rgb(182,255,62)]/20 hover:border-[rgb(182,255,62)]/40 hover:text-[rgb(182,255,62)] transition-all duration-300 backdrop-blur-sm transform hover:scale-105 active:scale-95 hover:shadow-[0_8px_32px_rgba(182,255,62,0.2)] font-bold text-[rgb(182,255,62)] text-sm sm:text-base"
                        >
                          Sell
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/5 via-transparent to-[rgb(182,255,62)]/5 rounded-2xl blur-xl opacity-50 pointer-events-none" />
                <div className="relative p-4 rounded-2xl border border-white/10 bg-black/20 backdrop-blur-[20px] backdrop-saturate-[150%]">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-white/10 animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-white/10 rounded animate-pulse" />
                      <div className="h-3 bg-white/5 rounded animate-pulse w-2/3" />
                    </div>
                    <div className="w-16 h-4 bg-white/10 rounded animate-pulse" />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Sell Modal */}
      {sellOpen && sellRow && owner58 && (
        <div
          className="fixed inset-0 z-[9999] vision-perspective"
          aria-modal="true"
          role="dialog"
        >
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-2xl backdrop-saturate-150"
            onClick={closeSell}
            aria-hidden
          />
          <div className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute inset-0 bg-[radial-gradient(40%_30%_at_10%_85%,rgba(182,255,62,0.15),transparent),radial-gradient(35%_25%_at_90%_10%,rgba(182,255,62,0.12),transparent)]" />
          </div>
          <div className="pointer-events-auto w-full max-w-lg vision-window vision-depth rounded-3xl border border-white/20 bg-black/40 backdrop-blur-[40px] backdrop-saturate-[200%] shadow-[0_32px_64px_rgba(0,0,0,0.4)] p-6 fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
            {/* Subtle inner glow */}
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/5 via-transparent to-transparent pointer-events-none" />

            <SellModal
              onClose={closeSell}
              owner58={owner58}
              row={sellRow}
              getAccessToken={getAccessToken}
              maxAmountStr={sellRow.amountFullStr}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Sell Modal ------------------------------ */

function SellModal({
  onClose,
  owner58,
  row,
  getAccessToken,
  maxAmountStr,
}: {
  onClose: () => void;
  owner58: string;
  row: ViewRow;
  getAccessToken: () => Promise<string | null>;
  maxAmountStr: string;
}) {
  const { sell, loading, signature, error } = useServerSponsoredJupSell();
  const [amountStr, setAmountStr] = useState<string>("");

  const inputRef = useRef<HTMLInputElement | null>(null);

  const cluster = getCluster();
  const inputMint = getMintFor(row.token, cluster);
  const decimals = row.decimals;

  // Fill with exact max and force the DOM input to reflect immediately
  const onMax = () => {
    setAmountStr(maxAmountStr);
    if (inputRef.current) inputRef.current.value = maxAmountStr;
  };

  // convert to raw for precise comparison
  const inputRaw = useMemo(
    () => rawFromUiString(amountStr, decimals),
    [amountStr, decimals]
  );
  const maxRaw = useMemo(() => {
    try {
      return BigInt(row.rawStr);
    } catch {
      return BigInt(0);
    }
  }, [row.rawStr]);

  const canSell =
    !!inputMint && inputRaw > BigInt(0) && inputRaw <= maxRaw && !loading;

  const onConfirm = useCallback(async () => {
    if (!canSell) return;
    const toastId = toast.loading(`Selling ${row.token.symbol}…`);
    try {
      const bearer = await getAccessToken().catch(() => null);
      const res = await sell({
        fromOwnerBase58: owner58,
        inputMint,
        amountUi: Number(amountStr),
        inputDecimals: decimals,
        accessToken: bearer,
        slippageBps: 50,
      });
      const sigFromCall = res as string | null;
      const sig = sigFromCall || signature;
      const short =
        sig && typeof sig === "string"
          ? ` • ${sig.slice(0, 6)}…${sig.slice(-6)}`
          : "";
      toast.success(`Sell submitted${short}`, { id: toastId });
      onClose();
      setTimeout(() => {
        if (typeof window !== "undefined") window.location.reload();
      }, 250);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sell failed";
      toast.error(msg, { id: toastId });
    }
  }, [
    canSell,
    owner58,
    inputMint,
    amountStr,
    decimals,
    getAccessToken,
    sell,
    onClose,
    row.token.symbol,
    signature,
  ]);

  // Allow only valid decimals while typing (programmatic Max bypasses this)
  const onChangeStrict = (v: string) => {
    if (v === "" || /^\d*(?:\.\d*)?$/.test(v)) setAmountStr(v);
  };

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Image
            src={
              row.token.logo ||
              "https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/default.png" ||
              "/placeholder.svg"
            }
            alt={`${row.token.name} logo`}
            width={48}
            height={48}
            className="h-12 w-12 rounded-2xl border border-white/20 object-contain bg-white/5 backdrop-blur-sm"
          />
          <div>
            <h4 className="text-white font-bold text-xl tracking-tight">
              Sell {row.token.name}
            </h4>
            <div className="text-white/60 text-sm font-medium">
              {row.token.symbol}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="vision-button rounded-2xl p-3 hover:bg-white/10 transition-all duration-300 text-white/70 hover:text-white"
          aria-label="Close"
          type="button"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="relative space-y-6">
        <div className="text-white/60 text-sm mb-3">
          Balance:{" "}
          {row.amount.toLocaleString(undefined, {
            maximumFractionDigits:
              row.amount < 1
                ? Math.min(row.decimals, 8)
                : Math.min(row.decimals, 4),
          })}{" "}
          {row.token.symbol}
        </div>

        <div>
          <label className="block text-sm font-bold text-white mb-3">
            Amount to sell ({row.token.symbol})
          </label>
          <div className="relative group">
            {/* Decorative glow — must not block clicks */}
            <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/20 via-transparent to-[rgb(182,255,62)]/20 rounded-2xl blur-xl opacity-0 group-focus-within:opacity-100 transition-all duration-700 pointer-events-none" />
            <div className="flex gap-2 relative z-10">
              <input
                ref={inputRef}
                type="text"
                inputMode="decimal"
                value={amountStr}
                onChange={(e) => onChangeStrict(e.target.value)}
                placeholder="0.0"
                className="relative flex-1 px-4 py-4 bg-white/5 backdrop-blur-sm border border-white/20 rounded-2xl text-white text-lg font-semibold placeholder-white/50 focus:outline-none focus:border-[rgb(182,255,62)]/50 focus:bg-white/10 transition-all duration-300"
              />
              <button
                type="button"
                onClick={onMax}
                aria-label="Fill max amount"
                className="px-4 py-2 rounded-2xl border border-white/20 text-white/90 hover:bg-white/10 font-semibold focus:outline-none focus:ring-2 focus:ring-[rgb(182,255,62)] focus:ring-offset-0"
              >
                Max
              </button>
            </div>
            <div className="mt-2 text-xs text-white/40 relative z-10">
              Max: {maxAmountStr} {row.token.symbol}
            </div>
          </div>
        </div>

        <div className="text-xs text-white/50 font-medium">
          You&apos;ll receive USDC. A $0.25 USDC fee is charged only if the swap
          succeeds.
        </div>

        {error && (
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-red-500/20 via-transparent to-red-500/20 rounded-2xl blur-xl opacity-50 pointer-events-none" />
            <div className="relative rounded-2xl bg-red-500/10 border border-red-500/30 backdrop-blur-sm p-4">
              <div className="text-red-400 font-semibold">Sell failed</div>
              <div className="text-red-400/70 text-sm mt-1">{error}</div>
            </div>
          </div>
        )}

        {signature && (
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/20 via-transparent to-[rgb(182,255,62)]/20 rounded-2xl blur-xl opacity-50 pointer-events-none" />
            <div className="relative rounded-2xl bg-[rgb(182,255,62)]/10 border border-[rgb(182,255,62)]/30 backdrop-blur-sm p-4">
              <div className="text-[rgb(182,255,62)] font-semibold">
                Sell submitted successfully!
              </div>
              <div className="text-[rgb(182,255,62)]/70 text-sm mt-1">
                Tx: {signature.slice(0, 8)}…{signature.slice(-8)}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="relative flex items-center justify-end gap-4 mt-8 pt-6 border-t border-white/10">
        <button
          type="button"
          onClick={onClose}
          className="vision-button px-6 py-3 text-white/80 hover:text-white rounded-2xl bg-white/5 border border-white/20 hover:bg-white/10 hover:border-white/30 transition-all duration-300 backdrop-blur-sm font-semibold"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSell}
          onClick={onConfirm}
          className="group/btn relative overflow-hidden vision-button px-6 py-3 disabled:opacity-50 disabled:cursor-not-allowed rounded-2xl bg-red-500/20 border border-red-500/40 hover:bg-red-500/30 hover:border-red-500/60 hover:shadow-[0_8px_32px_rgba(239,68,68,0.3)] transition-all duration-300 backdrop-blur-sm font-bold text-red-400"
        >
          <div className="absolute inset-0 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/15 to-transparent pointer-events-none" />
          <span className="relative z-10">
            {loading ? "Selling..." : `Sell ${row.token.symbol}`}
          </span>
        </button>
      </div>
    </div>
  );
}
