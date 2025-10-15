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
    return (Number.isFinite(n) ? n : 0).toFixed(2);
  }
}

const FX_TTL_MS = 5 * 60 * 1000;
const fxCache = new Map<string, { rate: number; ts: number }>();

export default function Hero() {
  const { user, loading: userLoading } = useUser();
  const { totals, loading: balancesLoading } = useBalances();
  const { ready, getAccessToken } = usePrivy();

 

  // Normalize USDC -> USD for display/FX
  const currency = useMemo(() => {
    const c = (user?.displayCurrency || "USD").toUpperCase();
    return c === "USDC" ? "USD" : c;
  }, [user?.displayCurrency]);

  // Source of truth is USD from BalanceProvider
  const totalUsd = useMemo(() => {
    const v = Number(totals.totalUsd ?? 0);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  }, [totals.totalUsd]);

  const [fxRate, setFxRate] = useState(1);
  const [fxLoading, setFxLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchFxRate = useCallback(
    async (target: string) => {
      // Peg USD
      if (target === "USD") {
        setFxRate(1);
        return;
      }

      // Cache
      const now = Date.now();
      const cached = fxCache.get(target);
      if (cached && now - cached.ts < FX_TTL_MS) {
        setFxRate(cached.rate);
        return;
      }

      // Cancel any in-flight request
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setFxLoading(true);
      try {
        // Bearer is optional; we’ll retry without it if needed
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
            credentials: "include", // send haven_session
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
        // Graceful fallback
        setFxRate(1);
      } finally {
        // IMPORTANT: always clear, even if the fetch was aborted
        setFxLoading(false);
      }
    },
    [ready, getAccessToken]
  );

  // Fetch when currency changes (after user is known).
  // Abort in-flight on unmount or currency change.
  useEffect(() => {
    if (userLoading) return;
    void fetchFxRate(currency);
    return () => abortRef.current?.abort();
  }, [currency, userLoading, fetchFxRate]);

  // (Optional) set true if you ever find your totals already converted
  const looksAlreadyDisplay = false;

  const totalFiat = useMemo(() => {
    const usd = Number(totalUsd) || 0;
    const rate = Number(fxRate) || 1;
    return looksAlreadyDisplay ? usd : usd * rate;
  }, [totalUsd, fxRate, looksAlreadyDisplay]);

  const showSkeleton = userLoading || balancesLoading || fxLoading;

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
