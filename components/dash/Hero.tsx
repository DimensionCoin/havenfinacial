"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBalances } from "@/providers/BalanceProvider";
import { useUser } from "@/providers/UserProvider";
import { usePrivy } from "@privy-io/react-auth";

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

const FX_TTL_MS = 5 * 60 * 1000;
const fxCache = new Map<string, { rate: number; ts: number }>();

export default function Hero() {
  const { user } = useUser();
  const { totals, loading } = useBalances();
  const { ready, authenticated, getAccessToken } = usePrivy();

  const displayName = useMemo(() => {
    const first = (user?.firstName || "").trim();
    return first || "there";
  }, [user?.firstName]);

  const currency = useMemo(() => {
    const c = (user?.displayCurrency || "USD").toUpperCase();
    return c === "USDC" ? "USD" : c;
  }, [user?.displayCurrency]);

  const totalUsd = totals.totalUsd;

  const [fxRate, setFxRate] = useState(1);
  const [fxLoading, setFxLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchFxRate = useCallback(
    async (target: string) => {
      if (target === "USD" || !ready || !authenticated) {
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
        const token = await getAccessToken().catch(() => null);
        const url = new URL("/api/fx", window.location.origin);
        url.searchParams.set("currency", target);
        url.searchParams.set("amount", "1");
        const r = await fetch(url.toString(), {
          credentials: "include",
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: ac.signal,
        });
        const j = await r.json().catch(() => null);
        const rate = r.ok && j?.rate ? Number(j.rate) : 1;
        const final = Number.isFinite(rate) && rate > 0 ? rate : 1;
        setFxRate(final);
        fxCache.set(target, { rate: final, ts: now });
      } catch (e: unknown) {
        if ((e as { name?: string } | null)?.name !== "AbortError") {
          setFxRate(1);
        }
      } finally {
        if (!ac.signal.aborted) setFxLoading(false);
      }
    },
    [ready, authenticated, getAccessToken]
  );

  const lastCurrencyRef = useRef<string | null>(null);
  useEffect(() => {
    if (currency !== lastCurrencyRef.current) {
      lastCurrencyRef.current = currency;
      void fetchFxRate(currency);
    }
  }, [currency, fetchFxRate]);

  const totalFiat = useMemo(() => totalUsd * fxRate, [totalUsd, fxRate]);
  const showBalance = ready && authenticated;

  return (
    <header className="mb-8 mt-4">
      <div className="space-y-2">
        {/* Greeting */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">
            Hello, {displayName}
          </h1>
        </div>

        {/* Balance Card */}
        <div className="bg-gradient-to-br from-black/85 to-black/25 border border-white/10 rounded-2xl p-3 px-4">
          <div className="flex items-end justify-between">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wider text-white/50 font-medium">
                Total Balance
              </p>
              {!showBalance || loading || fxLoading ? (
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
    </header>
  );
}
