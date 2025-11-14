"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBalances } from "@/providers/BalanceProvider";
import { useUser } from "@/providers/UserProvider";
import { usePrivy } from "@privy-io/react-auth";
import { POSITION_META, type PositionMeta } from "@/idl/positionMeta";

/* ---------------------------- helper / types ---------------------------- */

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
    return (Number.isFinite(n) ? n : 0).toFixed(2);
  }
}

// Avoid empty-object type `{}` by using `Record<string, never>`
type ApiSide = {
  long?: Record<string, never>;
  short?: Record<string, never>;
  none?: Record<string, never>;
};

type RawApiPosition = {
  publicKey: string;
  symbol: "SOL" | "ETH" | "BTC";
  side: "long" | "short";
  account: {
    owner: string;
    custody: string;
    collateralCustody: string;
    price: string; // u64 1e6
    collateralUsd: string; // u64 1e6
    sizeUsd: string; // u64 1e6
    side: ApiSide;
  };
};

const FX_TTL_MS = 5 * 60 * 1000;
const fxCache = new Map<string, { rate: number; ts: number }>();
const ONE_E6 = 1_000_000;

/* -------------------------------------------------------------------------- */
/*                                   Hero                                     */
/* -------------------------------------------------------------------------- */

export default function Hero() {
  const { user, loading: userLoading } = useUser();
  const { totals, loading: balancesLoading } = useBalances();
  const { ready, getAccessToken } = usePrivy();

  /* ------------------------ display currency / FX ------------------------ */

  const currency = useMemo(() => {
    const c = (user?.displayCurrency || "USD").toUpperCase();
    return c === "USDC" ? "USD" : c;
  }, [user?.displayCurrency]);

  const baseWalletUsd = useMemo(() => {
    const v = Number(totals.totalUsd ?? 0);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  }, [totals.totalUsd]);

  const [fxRate, setFxRate] = useState(1);
  const [fxLoading, setFxLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchFxRate = useCallback(
    async (target: string) => {
      if (target === "USD") {
        setFxRate(1);
        return;
      }

      const now = Date.now();
      const cached = fxCache.get(target);
      if (cached && now - cached.ts < FX_TTL_MS) {
        setFxRate(cached.rate);
        return;
      }

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setFxLoading(true);
      try {
        let bearer: string | null = null;
        if (ready) {
          try {
            bearer = (await getAccessToken()) || null;
          } catch {
            bearer = null;
          }
        }

        const url = new URL("/api/fx", window.location.origin);
        url.searchParams.set("currency", target);
        url.searchParams.set("amount", "1");

        const request = async (useBearer: boolean) => {
          const r = await fetch(url.toString(), {
            method: "GET",
            credentials: "include",
            cache: "no-store",
            headers:
              useBearer && bearer ? { authorization: `Bearer ${bearer}` } : {},
            signal: ac.signal,
          });
          const raw = await r.text();
          const data = raw ? JSON.parse(raw) : null;
          if (!r.ok) throw new Error(data?.error || raw || `HTTP ${r.status}`);
          const rate = Number(data?.rate);
          return Number.isFinite(rate) && rate > 0 ? rate : 1;
        };

        let final = 1;
        try {
          final = await request(true);
        } catch {
          final = await request(false);
        }

        setFxRate(final);
        fxCache.set(target, { rate: final, ts: now });
      } catch {
        setFxRate(1);
      } finally {
        setFxLoading(false);
      }
    },
    [ready, getAccessToken]
  );

  useEffect(() => {
    if (userLoading) return;
    void fetchFxRate(currency);
    return () => abortRef.current?.abort();
  }, [currency, userLoading, fetchFxRate]);

  /* ----------------------- booster equity (margin + PnL) ---------------------- */

  const [boostEquityUsd, setBoostEquityUsd] = useState(0);
  const [boostLoading, setBoostLoading] = useState(false);

  useEffect(() => {
    const ownerBase58 = user?.depositWallet?.address;
    if (!ownerBase58) {
      setBoostEquityUsd(0);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setBoostLoading(true);
      try {
        // 1) Fetch all booster positions for this wallet
        const res = await fetch("/api/booster/positions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownerBase58 }),
        });

        if (!res.ok) {
          console.error("[Hero] booster positions error", await res.text());
          if (!cancelled) setBoostEquityUsd(0);
          return;
        }

        const data = (await res.json()) as { positions: RawApiPosition[] };
        const positions = data.positions || [];

        if (positions.length === 0) {
          if (!cancelled) setBoostEquityUsd(0);
          return;
        }

        // 2) Map custody -> priceId and build list of Pyth ids
        const ids = new Set<string>();
        const positionMeta = positions.map((p) => {
          const custodyKey = p.account.custody;
          const meta: PositionMeta | undefined =
            POSITION_META[custodyKey as keyof typeof POSITION_META];
          if (!meta?.priceId) {
            return { p, meta: undefined, cleanId: null as string | null };
          }

          const cleanId = (meta.priceId as string).replace(/^0x/, "");
          ids.add(cleanId);
          return { p, meta, cleanId };
        });

        if (ids.size === 0) {
          if (!cancelled) setBoostEquityUsd(0);
          return;
        }

        // 3) Fetch latest prices from Pyth Hermes
        const qs = Array.from(ids)
          .map((id) => `ids[]=${id}`)
          .join("&");

        const priceRes = await fetch(
          `https://hermes.pyth.network/v2/updates/price/latest?${qs}`
        );
        const priceBody = (await priceRes.json()) as {
          parsed: Array<{
            id: string;
            price: { price: string; expo: number };
          }>;
        };

        const markMap: Record<string, number> = {};
        priceBody.parsed.forEach((u) => {
          const val = Number.parseInt(u.price.price, 10);
          const scale = 10 ** Math.abs(u.price.expo);
          markMap[u.id] = val / scale;
        });

        // 4) Compute equity per position = margin + P&L, then sum
        let totalEquity = 0;

        for (const { p, cleanId } of positionMeta) {
          if (!cleanId) continue;

          const entry = Number(p.account.price) / ONE_E6; // USD per token at entry
          const collateral = Number(p.account.collateralUsd) / ONE_E6; // margin
          const sizeUsd = Number(p.account.sizeUsd) / ONE_E6; // notional
          if (!Number.isFinite(entry) || entry <= 0) continue;

          const mark = markMap[cleanId] ?? entry;
          const isLong = !!p.account.side.long;

          const pnl = isLong
            ? sizeUsd * ((mark - entry) / entry)
            : sizeUsd * ((entry - mark) / entry);

          const equity = collateral + pnl; // margin + P&L
          if (Number.isFinite(equity)) {
            totalEquity += equity;
          }
        }

        if (!cancelled) setBoostEquityUsd(totalEquity);
      } catch (err) {
        console.error("[Hero] failed to compute boost equity", err);
        if (!cancelled) setBoostEquityUsd(0);
      } finally {
        if (!cancelled) setBoostLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [user?.depositWallet?.address]);

  /* ---------------------------- combined totals ---------------------------- */

  // Wallet base + booster equity (all in USD)
  const combinedUsd = useMemo(
    () => baseWalletUsd + boostEquityUsd,
    [baseWalletUsd, boostEquityUsd]
  );

  const looksAlreadyDisplay = false;

  const totalFiat = useMemo(() => {
    const usd = Number(combinedUsd) || 0;
    const rate = Number(fxRate) || 1;
    return looksAlreadyDisplay ? usd : usd * rate;
  }, [combinedUsd, fxRate, looksAlreadyDisplay]);

  const showSkeleton =
    userLoading || balancesLoading || fxLoading || boostLoading;

  /* --------------------------------- UI ---------------------------------- */

  return (
    <header className="mb-8 mt-4">
      <div className="space-y-4">
        <div className="group relative vision-perspective">
          <div className="absolute -inset-1 bg-gradient-to-r from-[rgb(182,255,62)]/20 via-transparent to-[rgb(182,255,62)]/20 rounded-3xl blur-xl opacity-0 group-hover:opacity-100 transition-all duration-700" />
          <div className="relative bg-black/40 backdrop-blur-[40px] backdrop-saturate-[200%] border border-white/20 rounded-3xl p-4 px-5 shadow-[0_32px_64px_rgba(0,0,0,0.4),0_16px_32px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(0,0,0,0.2)] hover:shadow-[0_40px_80px_rgba(0,0,0,0.5),0_20px_40px_rgba(0,0,0,0.3),inset_0_2px_0_rgba(255,255,255,0.12)] transition-all duration-500">
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-transparent rounded-3xl pointer-events-none" />
            <div className="relative flex items-end justify-between">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wider text-white/50 font-medium">
                  Total Balance
                </p>
                {showSkeleton ? (
                  <div className="h-10 w-48 rounded-lg bg-white/10 animate-pulse" />
                ) : (
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl sm:text-5xl font-bold text-white">
                      {formatFiatNarrow(totalFiat, currency)}
                    </span>
                    <span className="text-lg text-white/40 font-medium">
                      {currency}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
