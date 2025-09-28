// components/Hero.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBalances } from "@/providers/BalanceProvider";
import { useUser } from "@/providers/UserProvider";
import { usePrivy } from "@privy-io/react-auth";

/* ---------- utils ---------- */
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

const FX_TTL_MS = 5 * 60 * 1000; // 5 min cache
const fxCache = new Map<string, { rate: number; ts: number }>();

export default function Hero() {
  const { user } = useUser();
  const { totals, loading, refreshAll } = useBalances();
  const { ready, authenticated, getAccessToken } = usePrivy();

  const displayName =
    user?.firstName ||
    [user?.firstName].filter(Boolean).join(" ") ||
    null;

  // currency preference (USDC -> USD)
  const currency = useMemo(() => {
    const c = (user?.displayCurrency || "USD").toUpperCase();
    return c === "USDC" ? "USD" : c;
  }, [user?.displayCurrency]);

  const totalUsd = totals.totalUsd;

  // ---- FX (fetch once per currency; reuse cache) ----
  const [fxRate, setFxRate] = useState(1);
  const [fxLoading, setFxLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchFxRate = useCallback(
    async (target: string) => {
      if (target === "USD") {
        setFxRate(1);
        return;
      }
      if (!ready || !authenticated) {
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
        url.searchParams.set("amount", "1"); // cacheable per target currency

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
        if ((e as { name?: string | undefined } | null)?.name !== "AbortError") {
          setFxRate(1);
        }
      } finally {
        if (!ac.signal.aborted) setFxLoading(false);
      }
    },
    [ready, authenticated, getAccessToken]
  );

  // only react to currency changes
  const lastCurrencyRef = useRef<string | null>(null);
  useEffect(() => {
    if (currency !== lastCurrencyRef.current) {
      lastCurrencyRef.current = currency;
      void fetchFxRate(currency);
    }
  }, [currency, fetchFxRate]);

  const totalFiat = useMemo(() => totalUsd * fxRate, [totalUsd, fxRate]);

  const onRefresh = useCallback(() => {
    const maybe = refreshAll();
    if (maybe && typeof (maybe as Promise<void>).then === "function") {
      (maybe as Promise<void>).then(() => fetchFxRate(currency));
    } else {
      void fetchFxRate(currency);
    }
  }, [refreshAll, currency, fetchFxRate]);

  const showBalance = ready && authenticated;

  /* ---------- UI ---------- */
  return (
    <section
      className="
        relative mb-8 overflow-hidden rounded-3xl
        border border-white/10 bg-white/[0.03]
      "
      aria-label="Welcome"
    >
      {/* subtle backdrop / professional vibe */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute -inset-24 opacity-60 blur-3xl"
          style={{
            background:
              "radial-gradient(60% 60% at 20% 30%, rgba(182,255,62,0.08), transparent 60%), radial-gradient(50% 50% at 80% 20%, rgba(182,255,62,0.06), transparent 60%)",
          }}
        />
      </div>

      <div className="px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-12">
        {/* Top row: greeting + quick action */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight text-white">
              Welcome to <span className="text-[rgb(182,255,62)]">Haven</span>
              {displayName ? (
                <span className="text-white/70 font-medium">
                  , {displayName}
                </span>
              ) : null}
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-white/60">
              Your accounts at a glance
            </p>
          </div>

          <div className="flex-shrink-0">
            <button
              onClick={onRefresh}
              disabled={!showBalance || loading || fxLoading}
              className="
                text-xs sm:text-sm px-3 py-2 rounded-xl
                border border-white/10 text-white/80
                hover:bg-white/10 active:scale-[0.98]
                disabled:opacity-60
              "
              aria-label="Refresh balances"
            >
              {!showBalance
                ? "Sign in"
                : loading || fxLoading
                ? "Refreshing…"
                : "Refresh"}
            </button>
          </div>
        </div>

        {/* Big total balance block */}
        <div
          className="
            mt-5 sm:mt-6
            rounded-2xl border border-white/10 bg-black/30
            px-4 py-5 sm:px-6 sm:py-6
            shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]
          "
        >
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs sm:text-sm text-white/60">
                Total balance
              </div>

              <div className="flex items-baseline gap-2 sm:gap-3 mt-1 sm:mt-1.5">
                {/* skeleton */}
                {!showBalance || loading || fxLoading ? (
                  <>
                    <div className="h-9 sm:h-12 w-40 sm:w-56 bg-white/10 rounded-xl animate-pulse" />
                    <div className="h-4 sm:h-5 w-10 bg-white/5 rounded-lg animate-pulse" />
                  </>
                ) : (
                  <>
                    <span
                      className="
                        text-3xl sm:text-5xl lg:text-6xl font-extrabold
                        bg-gradient-to-b from-white to-white/80 bg-clip-text text-transparent
                        tracking-tight leading-none"
                    >
                      {formatFiatNarrow(totalFiat, currency)}
                    </span>
                    <span className="text-xs sm:text-sm text-white/50 font-medium self-end pb-1 sm:pb-1.5">
                      {currency.toLowerCase()}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Status pill */}
            <div
              className="
                hidden sm:flex items-center gap-2
                rounded-xl border border-white/10 bg-white/[0.04]
                px-3 py-2"
              aria-live="polite"
            >
              <span className="inline-block h-2 w-2 rounded-full bg-[rgb(182,255,62)] animate-pulse" />
              <span className="text-xs text-white/70">
                {loading || fxLoading ? "Updating…" : "Up to date"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
