// app/components/booster/Positions.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { RefreshCw, TrendingUp, TrendingDown, X } from "lucide-react";
import { toast } from "react-hot-toast";

import { useUser } from "@/providers/UserProvider";
import { POSITION_META, type PositionMeta } from "@/idl/positionMeta";
import { findTokenBySymbol } from "@/lib/tokens";
import { useServerSponsoredBoosterClose } from "@/hooks/useServerSponsoredBoosterClose";

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

type EmptyObj = Record<string, never>;

type ApiSide = {
  long?: EmptyObj;
  short?: EmptyObj;
  none?: EmptyObj;
};

type RawApiPosition = {
  publicKey: string;
  symbol: "SOL" | "ETH" | "BTC";
  side: "long" | "short";
  account: {
    owner: string;
    custody: string;
    collateralCustody: string;
    price: string;
    collateralUsd: string;
    sizeUsd: string;
    side: ApiSide;
  };
};

type DecodedPosition = {
  price: BN;
  collateralUsd: BN;
  sizeUsd: BN;
  side: ApiSide;
  custody: PublicKey;
};

interface PositionUI {
  acct: DecodedPosition;
  meta: PositionMeta & { cleanId: string };
}

interface BoosterPositionsProps {
  onStatsChange?: (stats: {
    totalNet: number;
    totalPnl: number;
    totalNotional: number;
    totalCollateral: number;
    totalSpotValue: number;
    positionCount: number;
  }) => void;
  refreshKey?: number;
}

interface PositionRow {
  meta: PositionMeta & { cleanId: string };
  entry: number; // USD
  mark: number; // USD
  collateral: number; // USD (margin currently in use, after open fees)
  sizeUsd: number; // USD notional at entry
  sizeTokens: number;
  spotValue: number; // USD notional at current mark
  pnl: number; // USD (price P&L, before close fees)
  net: number; // USD (equity = collateral + pnl)
  liq: number | null; // USD
  side: boolean; // true = long, false = short

  // Fee + transparency math
  grossDeposit: number; // Approx. what user originally put in before open fees
  havenOpenFee: number;
  jupOpenFee: number;
  totalOpenFees: number;

  havenCloseFee: number; // est. Haven close fee at current equity
  jupCloseFee: number; // est. Jupiter close fee at current notional
  totalCloseFees: number;

  takeHomeAfterFees: number; // equity now minus estimated close fees
  pnlAfterFees: number; // take-home after all fees minus grossDeposit
}

/* -------------------------- helpers / formatting -------------------------- */

const usdFromBN = (x: BN, decimals = 6) => x.toNumber() / 10 ** decimals;

const formatToken = (n: number) => {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1) return n.toFixed(4);
  return n.toFixed(6);
};

const estimateLiqPrice = (
  entry: number,
  collateral: number,
  sizeUsd: number,
  isLong: boolean
) => {
  if (sizeUsd <= 0 || entry <= 0) return null;
  const ratio = collateral / sizeUsd;
  return isLong ? entry * (1 - ratio) : entry * (1 + ratio);
};

const getTokenLogo = (symbol: string) => {
  const token = findTokenBySymbol(symbol);
  return token?.logo || "/placeholder.svg";
};

// Frontend minimum boost amount (user-facing, base in USD).
export const MIN_BOOSTER_MARGIN_USD = 15;

// How long to wait after a tx before we refetch positions (ms)
const REFRESH_AFTER_TX_MS = 1200;

// Fee constants (open + close)
const HAVEN_OPEN_FEE_RATE = 0.02; // 2%
const JUP_TRADE_FEE_RATE = 0.0007; // 0.07% (Jupiter)
const HAVEN_CLOSE_FEE_RATE = 0.005; // 0.5% close fee

/* ------------------------ FX helper using /api/fx ------------------------ */

function useDisplayCurrencyFx(
  user: { displayCurrency?: string | null } | null | undefined
) {
  const displayCurrency = (user?.displayCurrency || "USD").toUpperCase();
  const [fxRate, setFxRate] = useState(1); // USD -> display
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchFx = async () => {
      if (!displayCurrency || displayCurrency === "USD") {
        setFxRate(1);
        return;
      }

      setLoading(true);
      try {
        const res = await fetch(
          `/api/fx?currency=${encodeURIComponent(displayCurrency)}&amount=1`,
          { credentials: "include" }
        );
        if (!res.ok) throw new Error(`FX ${res.status}`);
        const data = (await res.json()) as { rate?: number };
        if (!cancelled) {
          const r = Number(data.rate);
          setFxRate(!Number.isFinite(r) || r <= 0 ? 1 : r);
        }
      } catch {
        if (!cancelled) {
          setFxRate(1);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchFx();
    return () => {
      cancelled = true;
    };
  }, [displayCurrency]);

  const formatLocal = useCallback(
    (usdAmount: number) => {
      const amt = (Number.isFinite(usdAmount) ? usdAmount : 0) * fxRate;
      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: displayCurrency,
          currencyDisplay: "narrowSymbol",
          maximumFractionDigits: 2,
        }).format(amt);
      } catch {
        return `${displayCurrency} ${amt.toFixed(2)}`;
      }
    },
    [fxRate, displayCurrency]
  );

  return { currency: displayCurrency, fxRate, formatLocal, fxLoading: loading };
}

/* -------------------------------------------------------------------------- */
/*                              Main Component                                */
/* -------------------------------------------------------------------------- */

export default function Positions({
  onStatsChange,
  refreshKey,
}: BoosterPositionsProps) {
  const { user } = useUser();
  const { formatLocal } = useDisplayCurrencyFx(user);

  const ownerPubkey = useMemo(() => {
    const addr = user?.depositWallet?.address;
    if (!addr) return null;
    try {
      return new PublicKey(addr);
    } catch (e) {
      console.error("[BoosterPositions] Invalid depositWallet.address:", e);
      return null;
    }
  }, [user?.depositWallet?.address]);

  const [positions, setPositions] = useState<PositionUI[]>([]);
  const [markPrices, setMarkPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const [sellOpen, setSellOpen] = useState(false);
  const [sellRow, setSellRow] = useState<PositionRow | null>(null);

  const openSell = useCallback((row: PositionRow) => {
    setSellRow(row);
    setSellOpen(true);
  }, []);

  const closeSell = () => {
    setSellOpen(false);
    setSellRow(null);
  };

  const fetchPositions = useCallback(async () => {
    if (!ownerPubkey) return;
    setLoading(true);
    try {
      const res = await fetch("/api/booster/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerBase58: ownerPubkey.toBase58() }),
      });

      if (!res.ok) {
        console.error("[BoosterPositions] API error", await res.text());
        setPositions([]);
        return;
      }

      const data = (await res.json()) as { positions: RawApiPosition[] };

      const decoded: PositionUI[] = data.positions.map((p) => {
        const acct: DecodedPosition = {
          price: new BN(p.account.price),
          collateralUsd: new BN(p.account.collateralUsd),
          sizeUsd: new BN(p.account.sizeUsd),
          side: p.account.side,
          custody: new PublicKey(p.account.custody),
        };

        const custodyKey = acct.custody.toBase58();
        const baseMeta = POSITION_META[custodyKey];
        if (!baseMeta) {
          throw new Error(
            "[BoosterPositions] Missing POSITION_META for custody " + custodyKey
          );
        }

        return {
          acct,
          meta: {
            ...baseMeta,
            cleanId: baseMeta.priceId.replace(/^0x/, ""),
          },
        };
      });

      setPositions(decoded);
    } catch (err) {
      console.error("[BoosterPositions] Failed to fetch positions:", err);
      setPositions([]);
    } finally {
      setLoading(false);
    }
  }, [ownerPubkey]);

  useEffect(() => {
    if (ownerPubkey) {
      void fetchPositions();
    }
  }, [ownerPubkey, fetchPositions]);

  useEffect(() => {
    if (!ownerPubkey) return;
    if (refreshKey === undefined) return;

    const id = setTimeout(() => {
      void fetchPositions();
    }, REFRESH_AFTER_TX_MS);

    return () => clearTimeout(id);
  }, [refreshKey, ownerPubkey, fetchPositions]);

  // Poll mark prices for open positions
  useEffect(() => {
    if (positions.length === 0) {
      setMarkPrices({});
      return;
    }

    let canceled = false;

    const fetchPrices = async () => {
      try {
        const ids = Array.from(new Set(positions.map((p) => p.meta.cleanId)));
        if (ids.length === 0) return;

        const qs = ids.map((id) => `ids[]=${id}`).join("&");
        const res = await fetch(
          `https://hermes.pyth.network/v2/updates/price/latest?${qs}`
        );
        const body = (await res.json()) as {
          parsed: Array<{
            id: string;
            price: { price: string; expo: number };
          }>;
        };

        const next: Record<string, number> = {};
        body.parsed.forEach((u) => {
          const val = Number.parseInt(u.price.price, 10);
          const scale = 10 ** Math.abs(u.price.expo);
          next[u.id] = val / scale;
        });

        if (!canceled) setMarkPrices(next);
      } catch (err) {
        console.error("[BoosterPositions] Failed to fetch prices:", err);
      }
    };

    fetchPrices();
    const iv = setInterval(fetchPrices, 5_000);
    return () => {
      canceled = true;
      clearInterval(iv);
    };
  }, [positions]);

  const rows = useMemo<PositionRow[]>(() => {
    return positions.map(({ acct, meta }) => {
      const entry = usdFromBN(acct.price, 6); // USD per token at entry
      const collateral = usdFromBN(acct.collateralUsd, 6); // USD margin in use (after open fees)
      const sizeUsd = usdFromBN(acct.sizeUsd, 6); // USD notional at entry
      const isLong = !!acct.side.long;

      const mark = markPrices[meta.cleanId] ?? entry; // USD per token (current)
      const sizeTokens = entry > 0 ? sizeUsd / entry : 0;
      const spotValue = mark * sizeTokens; // current notional at mark

      // Price-only P&L (ignoring close fees)
      const pnl = isLong
        ? sizeUsd * ((mark - entry) / entry)
        : sizeUsd * ((entry - mark) / entry);

      const net = collateral + pnl; // equity (can be < 0 in theory)
      const liq = estimateLiqPrice(entry, collateral, sizeUsd, isLong);

      // ----- Fee math -----
      // Assume collateral we see is AFTER Haven 2% + Jupiter 0.07% at open.
      const combinedOpenRate = HAVEN_OPEN_FEE_RATE + JUP_TRADE_FEE_RATE;
      const grossDeposit =
        collateral > 0 ? collateral / (1 - combinedOpenRate) : 0;

      const havenOpenFee = grossDeposit * HAVEN_OPEN_FEE_RATE;
      const jupOpenFee = grossDeposit * JUP_TRADE_FEE_RATE;
      const totalOpenFees = havenOpenFee + jupOpenFee;

      // Equity basis for close (never charge close % on negative equity)
      const equityForCloseFees = Math.max(net, 0);

      // Haven close fee: 0.5% of equity
      const havenCloseFee = equityForCloseFees * HAVEN_CLOSE_FEE_RATE;

      // Jupiter close fee: ~0.07% of current notional (spotValue)
      const jupCloseFee = spotValue * JUP_TRADE_FEE_RATE;

      const totalCloseFees = havenCloseFee + jupCloseFee;

      const takeHomeAfterFees = Math.max(
        equityForCloseFees - totalCloseFees,
        0
      );

      // P&L including ALL fees (open Haven + open Jup + est. close fees)
      const pnlAfterFees = takeHomeAfterFees - grossDeposit;

      return {
        meta,
        entry,
        mark,
        collateral,
        sizeUsd,
        sizeTokens,
        spotValue,
        pnl,
        net,
        liq,
        side: isLong,
        grossDeposit,
        havenOpenFee,
        jupOpenFee,
        totalOpenFees,
        havenCloseFee,
        jupCloseFee,
        totalCloseFees,
        takeHomeAfterFees,
        pnlAfterFees,
      };
    });
  }, [positions, markPrices]);

  const totals = useMemo(() => {
    const totalNet = rows.reduce((s, r) => s + r.net, 0);
    const totalPnl = rows.reduce((s, r) => s + r.pnl, 0);
    const totalNotional = rows.reduce((s, r) => s + r.sizeUsd, 0);
    const totalCollateral = rows.reduce((s, r) => s + r.collateral, 0);
    const totalSpotValue = rows.reduce((s, r) => s + r.spotValue, 0);
    const totalGrossDeposit = rows.reduce((s, r) => s + r.grossDeposit, 0);
    const totalTakeHomeAfterFees = rows.reduce(
      (s, r) => s + r.takeHomeAfterFees,
      0
    );
    const totalPnlAfterFees = totalTakeHomeAfterFees - totalGrossDeposit;
    const totalOpenFees = rows.reduce((s, r) => s + r.totalOpenFees, 0);
    const totalCloseFees = rows.reduce((s, r) => s + r.totalCloseFees, 0);

    return {
      totalNet,
      totalPnl,
      totalNotional,
      totalCollateral,
      totalSpotValue,
      positionCount: rows.length,
      totalGrossDeposit,
      totalTakeHomeAfterFees,
      totalPnlAfterFees,
      totalOpenFees,
      totalCloseFees,
    };
  }, [rows]);

  const tokenSummary = useMemo(() => {
    const map: Record<string, number> = {};

    for (const r of rows) {
      const sym = r.meta.symbol;
      map[sym] = (map[sym] || 0) + (r.sizeTokens || 0);
    }

    const parts = Object.entries(map)
      .filter(([, amt]) => amt > 0)
      .map(([sym, amt]) => `${formatToken(amt)} ${sym}`);

    return parts.join(" • ");
  }, [rows]);

  useEffect(() => {
    onStatsChange?.({
      totalNet: totals.totalNet,
      totalPnl: totals.totalPnl,
      totalNotional: totals.totalNotional,
      totalCollateral: totals.totalCollateral,
      totalSpotValue: totals.totalSpotValue,
      positionCount: totals.positionCount,
    });
  }, [totals, onStatsChange]);

  if (!user?.depositWallet?.address || !ownerPubkey) {
    return (
      <div className="relative rounded-2xl border border-white/10 bg-black/20 backdrop-blur-[20px] px-4 py-4">
        <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 via-transparent to-transparent" />
        <div className="relative">
          <div className="text-xs text-white/50 mb-1 uppercase tracking-wide">
            Boosted trades
          </div>
          <div className="text-sm text-white/70">
            Set up your deposit account to view boosted trades.
          </div>
        </div>
      </div>
    );
  }

  const {
    totalNet,
    totalSpotValue,
    totalCollateral,
    positionCount,
    totalPnlAfterFees,
  } = totals;

  const pnlColor =
    totalPnlAfterFees > 0
      ? "text-emerald-400"
      : totalPnlAfterFees < 0
      ? "text-red-400"
      : "text-white/60";

  return (
    <div className="space-y-4">
      {/* Summary card */}
      <div className="relative rounded-2xl border border-white/10 bg-black/20 backdrop-blur-[20px] px-4 py-4">
        <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 via-transparent to-transparent" />

        <div className="relative space-y-3">
          {/* Header row with title and refresh */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-white/50 mb-0.5 uppercase tracking-wide">
                Boosted trades
              </div>
              <div className="text-white/60 text-xs">
                {positionCount} open {positionCount !== 1 ? "trades" : "trade"}
              </div>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={fetchPositions}
              className="inline-flex items-center px-2 py-1 rounded-xl text-[10px] border border-white/15 text-white/70 hover:bg-white/10 hover:text-white transition-colors"
            >
              <RefreshCw
                className={`w-3 h-3 mr-1 ${
                  loading
                    ? "animate-spin text-[rgb(182,255,62)]"
                    : "text-white/60"
                }`}
              />
              Refresh
            </button>
          </div>

          {/* Stats grid (all local currency) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className="text-white/50 mb-0.5 text-2xs">Spot value</div>
              <div className="text-white font-semibold text-sm">
                {formatLocal(totalSpotValue || 0)}
              </div>
            </div>
            <div>
              <div className="text-white/50 mb-0.5 text-2xs">
                Boosted net (equity)
              </div>
              <div className="text-white font-semibold text-sm">
                {formatLocal(totalNet || 0)}
              </div>
            </div>
            <div>
              <div className="text-white/50 mb-0.5 text-2xs">
                Unrealized P&amp;L (icl fees)
              </div>
              <div
                className={`font-semibold text-sm flex items-center gap-1 ${pnlColor}`}
              >
                {totalPnlAfterFees >= 0 ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                <span>{formatLocal(totalPnlAfterFees || 0)}</span>
              </div>
            </div>
            <div>
              <div className="text-white/50 mb-0.5 text-2xs">Margin in use</div>
              <div className="text-white font-semibold text-sm">
                {formatLocal(totalCollateral || 0)}
              </div>
            </div>
          </div>

          {/* Optional summary of token exposure */}
          {tokenSummary && (
            <div className="text-2xs text-white/40">
              Exposure: {tokenSummary}
            </div>
          )}
        </div>
      </div>

      {/* Positions list */}
      <div className="space-y-2">
        {rows.length === 0 && !loading ? (
          <div className="text-center py-12 rounded-2xl border border-white/10 bg-black/20 backdrop-blur-[20px]">
            <div className="relative group mx-auto mb-6 w-16 h-16">
              <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/20 via-transparent to-[rgb(182,255,62)]/20 rounded-full blur-xl opacity-50 pointer-events-none" />
              <div className="relative w-16 h-16 rounded-full bg-white/5 backdrop-blur-sm border border-white/10 flex items-center justify-center">
                <div className="w-8 h-8 rounded-full bg-white/10" />
              </div>
            </div>
            <div className="text-white mb-2 text-lg font-bold">
              No Boosted Trades
            </div>
            <div className="text-white/60 text-sm max-w-md mx-auto">
              You don&apos;t have any open boosted positions yet.
            </div>
          </div>
        ) : (
          <>
            {rows.map((r, idx) => {
              const pnlAfterFeesLocal = r.pnlAfterFees;
              const pnlColorLocal =
                pnlAfterFeesLocal > 0
                  ? "text-emerald-400"
                  : pnlAfterFeesLocal < 0
                  ? "text-red-400"
                  : "text-white/50";

              return (
                <div key={`${r.meta.symbol}-${idx}`} className="relative group">
                  <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/5 via-transparent to-[rgb(182,255,62)]/5 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-500 pointer-events-none" />

                  <div className="relative p-4 rounded-2xl border border-white/10 bg-black/20 backdrop-blur-[20px] backdrop-saturate-[150%] hover:bg-black/30 hover:border-white/20 transition-all duration-300">
                    <div className="flex items-center justify-between gap-4">
                      {/* Left side - Token info */}
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="relative flex-shrink-0">
                          <Image
                            src={
                              getTokenLogo(r.meta.symbol) || "/placeholder.svg"
                            }
                            alt={`${r.meta.symbol} logo`}
                            width={40}
                            height={40}
                            className="h-10 w-10 rounded-full border border-white/20 object-contain bg-white/5"
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-white font-semibold text-base">
                              {r.meta.symbol}
                            </span>
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                                r.side
                                  ? "bg-emerald-500/20 text-emerald-300"
                                  : "bg-red-500/20 text-red-300"
                              }`}
                            >
                              {r.side ? "LONG" : "SHORT"}
                            </span>
                          </div>
                          <div className="text-white/60 text-xs sm:text-sm">
                            {formatToken(r.sizeTokens)} {r.meta.symbol}
                          </div>
                          <div className="text-white/40 text-[0.7rem] sm:text-xs">
                            Position value: {formatLocal(r.spotValue)}
                          </div>
                          <div className="text-white/40 text-2xs sm:text-xs mt-0.5 whitespace-nowrap">
                            Entry: {formatLocal(r.entry)} • Liq:{" "}
                            {r.liq ? formatLocal(r.liq) : "—"}
                          </div>
                        </div>
                      </div>

                      {/* Right side - Values and close button */}
                      <div className="flex items-center gap-3">
                        <div className="text-right text-xs">
                          <div className="text-white font-semibold text-sm">
                            {formatLocal(r.net)}
                          </div>
                          <div
                            className={`font-semibold ${pnlColorLocal} text-xs`}
                          >
                            {pnlAfterFeesLocal >= 0 ? "+" : ""}
                            {formatLocal(pnlAfterFeesLocal)} P&amp;L
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => openSell(r)}
                          className="group/btn relative overflow-hidden flex items-center justify-center
             px-3 py-1.5 sm:px-4 sm:py-2.5
             rounded-lg bg-white/10 border border-white/20
             hover:bg-[rgb(182,255,62)]/20 hover:border-[rgb(182,255,62)]/40 hover:text-[rgb(182,255,62)]
             transition-all duration-300 backdrop-blur-sm transform hover:scale-105 active:scale-95
             font-bold text-[rgb(182,255,62)]
             text-2xs sm:text-sm
             whitespace-nowrap"
                        >
                          <div className="absolute inset-0 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/15 to-transparent pointer-events-none" />
                          <span className="relative z-10">Close</span>
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
                <div className="relative p-4 rounded-2xl border border-white/10 bg-black/20 backdrop-blur-[150%]">
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
          </>
        )}
      </div>

      {sellOpen && sellRow && ownerPubkey && (
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
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/5 via-transparent to-transparent pointer-events-none" />

            <ClosePositionModal
              onClose={closeSell}
              onClosedSuccess={() => {
                closeSell();
                setTimeout(() => {
                  void fetchPositions();
                }, REFRESH_AFTER_TX_MS);
              }}
              position={sellRow}
              ownerPubkey={ownerPubkey}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Close Position Modal ------------------------------ */

function ClosePositionModal({
  onClose,
  onClosedSuccess,
  position,
  ownerPubkey,
}: {
  onClose: () => void;
  onClosedSuccess: () => void;
  position: PositionRow;
  ownerPubkey: PublicKey;
}) {
  const { user } = useUser();
  const { formatLocal } = useDisplayCurrencyFx(user);

  const {
    closeBoosterPosition,
    loading,
    error: boosterError,
    signature,
    reset,
  } = useServerSponsoredBoosterClose();

  // Position value and equity math
  const positionValue = position.spotValue; // current notional at mark
  const netUsd = position.net; // equity (can be < 0)
  const basisUsd = Math.max(netUsd, 0); // never charge % fee on negative equity

  // Aggregated fee + cash-out math
  const grossDeposit = position.grossDeposit;
  const totalOpenFeesUsd = position.totalOpenFees;
  const totalCloseFeesUsd = position.totalCloseFees;
  const takeHomeAfterFeesUsd = position.takeHomeAfterFees;
  const pnlAfterAllFeesUsd = position.pnlAfterFees;

  const handleClose = useCallback(async () => {
    reset();
    try {
      const ownerBase58 = ownerPubkey.toBase58();
      const symbol = position.meta.symbol as "SOL" | "ETH" | "BTC";
      const side = position.side ? "long" : "short";

      // Payout basis (equity) in USDC 1e6, for Haven fee math / backend
      const netCloseUsdUnits = Math.max(0, Math.floor(basisUsd * 1e6));

      const sig = await closeBoosterPosition({
        ownerBase58,
        symbol,
        side,
        priceSlippageBps: 500,
        entirePosition: true,
        netCloseUsdUnits,
      });

      toast.success("Position closed successfully.");
      if (sig) {
        console.log("[ClosePositionModal] close signature", sig);
      }
      onClosedSuccess();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to close position.";
      toast.error(msg);
      console.error("[ClosePositionModal] close error", err);
    }
  }, [
    reset,
    closeBoosterPosition,
    ownerPubkey,
    position.meta.symbol,
    position.side,
    basisUsd,
    onClosedSuccess,
  ]);

  const pnlColor =
    pnlAfterAllFeesUsd > 0
      ? "text-emerald-400"
      : pnlAfterAllFeesUsd < 0
      ? "text-red-400"
      : "text-white";

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Image
            src={getTokenLogo(position.meta.symbol) || "/placeholder.svg"}
            alt={`${position.meta.symbol} logo`}
            width={48}
            height={48}
            className="h-12 w-12 rounded-2xl border border-white/20 object-contain bg-white/5 backdrop-blur-sm"
          />
          <div>
            <h4 className="text-white font-bold text-xl tracking-tight">
              Close {position.meta.symbol}
            </h4>
            <div className="text-white/60 text-sm font-medium">
              {position.side ? "LONG" : "SHORT"} Position
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
        {/* Position details */}
        <div className="rounded-2xl border border-white/15 bg-white/5 backdrop-blur-sm px-4 py-3 text-xs text-white/70 space-y-1.5">
          <div className="flex justify-between">
            <span>Entry Price</span>
            <span className="text-white font-semibold">
              {formatLocal(position.entry)}
            </span>
          </div>

          <div className="flex justify-between">
            <span>Mark Price</span>
            <span className="text-white font-semibold">
              {formatLocal(position.mark)}
            </span>
          </div>

          <div className="flex justify-between">
            <span>Position Value</span>
            <span className="text-white font-semibold">
              {formatLocal(positionValue)}
            </span>
          </div>

          <div className="flex justify-between">
            <span>Position Size</span>
            <span className="text-white font-semibold">
              {formatToken(position.sizeTokens)} {position.meta.symbol}
            </span>
          </div>

          <div className="flex justify-between">
            <span>Collateral / Margin</span>
            <span className="text-white font-semibold">
              {formatLocal(position.collateral)}
            </span>
          </div>

          <div className="flex justify-between">
            <span>Liquidation Price</span>
            <span className="text-white font-semibold">
              {position.liq ? formatLocal(position.liq) : "—"}
            </span>
          </div>

          <div className="pt-1 border-t border-white/10 flex justify-between">
            <span>Unrealized P&amp;L (before fees)</span>
            <span
              className={`font-semibold ${
                position.pnl > 0
                  ? "text-emerald-400"
                  : position.pnl < 0
                  ? "text-red-400"
                  : "text-white"
              }`}
            >
              {position.pnl >= 0 ? "+" : ""}
              {formatLocal(position.pnl)}
            </span>
          </div>
        </div>

        {/* Simple fee + payout summary */}
        <div className="rounded-2xl border border-white/15 bg-white/5 backdrop-blur-sm px-4 py-3 text-xs text-white/70 space-y-1.5">
          <div className="flex justify-between">
            <span>You put in</span>
            <span className="text-white font-semibold">
              {formatLocal(grossDeposit)}
            </span>
          </div>

          <div className="flex justify-between">
            <span>Fees paid so far</span>
            <span className="text-white font-semibold">
              {formatLocal(totalOpenFeesUsd)}
            </span>
          </div>

          <div className="flex justify-between">
            <span>Estimated close fee</span>
            <span className="text-white font-semibold">
              {formatLocal(totalCloseFeesUsd)}
            </span>
          </div>

          <div className="pt-1 border-t border-white/10 flex justify-between">
            <span>Estimated payout after all fees</span>
            <span className="text-white font-semibold">
              {formatLocal(takeHomeAfterFeesUsd)}
            </span>
          </div>

          <div className="flex justify-between">
            <span>Take-home P&amp;L</span>
            <span className={`${pnlColor} font-semibold`}>
              {pnlAfterAllFeesUsd >= 0 ? "+" : ""}
              {formatLocal(pnlAfterAllFeesUsd)}
            </span>
          </div>

          <div className="text-[0.7rem] text-white/40 mt-1">
            Numbers are estimates based on current price and fee rates. Final
            payout may differ slightly depending on execution.
          </div>
        </div>

        <div className="text-xs text-white/50 font-medium">
          Closing this position will settle your{" "}
          {position.side ? "long" : "short"} trade at the current mark price and
          return your remaining collateral minus the close fee.
        </div>

        {boosterError && (
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-red-500/20 via-transparent to-red-500/20 rounded-2xl blur-xl opacity-50 pointer-events-none" />
            <div className="relative rounded-2xl bg-red-500/10 border border-red-500/30 backdrop-blur-sm p-4">
              <div className="text-red-400 font-semibold">Error</div>
              <div className="text-red-400/70 text-sm mt-1">{boosterError}</div>
            </div>
          </div>
        )}

        {signature && (
          <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 backdrop-blur-sm p-3 text-xs text-emerald-200 break-all">
            <div className="font-semibold mb-1">Close transaction sent</div>
            <div className="opacity-80">
              Signature: <span className="font-mono">{signature}</span>
            </div>
          </div>
        )}
      </div>

      <div className="relative flex items-center justify-end gap-4 mt-8 pt-6 border-t border-white/10">
        <button
          type="button"
          onClick={onClose}
          className="vision-button px-6 py-3 text-white/80 hover:text-white rounded-2xl bg-white/5 border border-white/20 hover:bg:white/10 hover:border-white/30 transition-all duration-300 backdrop-blur-sm font-semibold"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={handleClose}
          className="group/btn relative overflow-hidden vision-button px-6 py-3 disabled:opacity-50 disabled:cursor-not-allowed rounded-2xl bg-red-500/20 border border-red-500/40 hover:bg-red-500/30 hover:border-red-500/60 hover:shadow-[0_8px_32px_rgba(239,68,68,0.3)] transition-all duration-300 backdrop-blur-sm font-bold text-red-400"
        >
          <div className="absolute inset-0 -translate-x-full group-hover/btn:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/15 to-transparent pointer-events-none" />
          <span className="relative z-10">
            {loading ? "Closing..." : "Close Position"}
          </span>
        </button>
      </div>
    </div>
  );
}
