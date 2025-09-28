// providers/BalanceProvider.tsx
"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useUser } from "@/providers/UserProvider";
import { usePrivy } from "@privy-io/react-auth";

type BalanceSlice = {
  amountUsd: number; // always USD (USDC-pegged)
  loading: boolean;
  error?: string | null;
  refresh: () => Promise<void>;
};

type BalanceTotals = {
  totalUsd: number;
};

type BalanceContextValue = {
  deposit: BalanceSlice;
  invest: BalanceSlice;
  savings: BalanceSlice;
  totals: BalanceTotals;
  loading: boolean; // any slice loading
  refreshAll: () => Promise<void>;
};

const BalanceContext = createContext<BalanceContextValue | undefined>(
  undefined
);

export function BalanceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const { ready, authenticated, getAccessToken } = usePrivy();

  const owner58 = user?.depositWallet?.address || null;

  const [depositUsd, setDepositUsd] = useState(0);
  const [investUsd, setInvestUsd] = useState(0);
  const [savingsUsd, setSavingsUsd] = useState(0);

  const [loadingDeposit, setLoadingDeposit] = useState(false);
  const [loadingInvest, setLoadingInvest] = useState(false);
  const [loadingSavings, setLoadingSavings] = useState(false);

  const [errDeposit, setErrDeposit] = useState<string | null>(null);
  const [errInvest, setErrInvest] = useState<string | null>(null);
  const [errSavings, setErrSavings] = useState<string | null>(null);

  const bearerRef = useRef<string | null>(null);

  // Get a bearer once (when session is ready)
  const ensureBearer = useCallback(async () => {
    if (!(ready && authenticated)) return null;
    if (bearerRef.current) return bearerRef.current;
    try {
      const t = await getAccessToken();
      bearerRef.current = t ?? null;
      return bearerRef.current;
    } catch {
      return null;
    }
  }, [ready, authenticated, getAccessToken]);

  const fetchJSON = useCallback(
    async <TResponse = unknown>(path: string): Promise<TResponse> => {
      const token = await ensureBearer();
      const r = await fetch(path, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const j: unknown = await r.json().catch(() => null);
      if (!r.ok) {
        const errorMessage =
          (j && typeof j === "object" && j !== null && "error" in j
            ? String((j as { error?: unknown }).error)
            : null) ||
          (j && typeof j === "object" && j !== null && "message" in j
            ? String((j as { message?: unknown }).message)
            : null);
        throw new Error(errorMessage || `HTTP ${r.status}`);
      }
      return j as TResponse;
    },
    [ensureBearer]
  );

  // --------- individual refreshers ----------
  const refreshDeposit = useCallback(async () => {
    if (!ready || !authenticated) return;
    setLoadingDeposit(true);
    setErrDeposit(null);
    try {
      // /api/balance/deposit -> { amountUi: number }
      const j = await fetchJSON<{ amountUi?: unknown }>("/api/balance/deposit");
      const amt = Number(j?.amountUi ?? 0);
      setDepositUsd(Number.isFinite(amt) ? amt : 0);
    } catch (e) {
      setDepositUsd(0);
      setErrDeposit(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingDeposit(false);
    }
  }, [ready, authenticated, fetchJSON]);

  const refreshInvest = useCallback(async () => {
    if (!ready || !authenticated) return;
    setLoadingInvest(true);
    setErrInvest(null);
    try {
      // /api/balance/invest -> { totalUsd?: number, positions?: [...] }
      const j = await fetchJSON<{
        totalUsd?: unknown;
        positions?: Array<{ valueUsd?: unknown }>;
      }>("/api/balance/invest");
      let usd = Number(j?.totalUsd ?? 0);
      if (!Number.isFinite(usd) || usd <= 0) {
        // fallback: sum positions.valueUsd
        const positions = Array.isArray(j?.positions) ? j.positions : [];
        usd = positions.reduce((s, p) => s + (Number(p.valueUsd ?? 0) || 0), 0);
      }
      setInvestUsd(Number.isFinite(usd) ? usd : 0);
    } catch (e) {
      setInvestUsd(0);
      setErrInvest(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingInvest(false);
    }
  }, [ready, authenticated, fetchJSON]);

  const refreshSavings = useCallback(async () => {
    if (!ready || !authenticated || !owner58) return;
    setLoadingSavings(true);
    setErrSavings(null);
    try {
      // /api/savings/balance?owner58=... -> { amountUi: number }
      const j = await fetchJSON<{ amountUi?: unknown }>(
        `/api/savings/balance?owner58=${encodeURIComponent(owner58)}`
      );
      const amt = Number(j?.amountUi ?? 0);
      setSavingsUsd(Number.isFinite(amt) ? amt : 0);
    } catch (e) {
      setSavingsUsd(0);
      setErrSavings(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingSavings(false);
    }
  }, [ready, authenticated, owner58, fetchJSON]);

  // --------- initial & reactive fetch ----------
  useEffect(() => {
    if (!ready || !authenticated) return;
    // Don’t run until we know the address (savings depends on it)
    if (!owner58) {
      // Still fetch what we can (deposit, invest) if user exists but no wallet
      void refreshDeposit();
      void refreshInvest();
      return;
    }
    void refreshDeposit();
    void refreshInvest();
    void refreshSavings();
  }, [
    ready,
    authenticated,
    owner58,
    refreshDeposit,
    refreshInvest,
    refreshSavings,
  ]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshDeposit(), refreshInvest(), refreshSavings()]);
  }, [refreshDeposit, refreshInvest, refreshSavings]);

  // --------- context value ----------
  const totals: BalanceTotals = useMemo(
    () => ({ totalUsd: depositUsd + investUsd + savingsUsd }),
    [depositUsd, investUsd, savingsUsd]
  );

  const loading = loadingDeposit || loadingInvest || loadingSavings;

  const value: BalanceContextValue = useMemo(
    () => ({
      deposit: {
        amountUsd: depositUsd,
        loading: loadingDeposit,
        error: errDeposit,
        refresh: refreshDeposit,
      },
      invest: {
        amountUsd: investUsd,
        loading: loadingInvest,
        error: errInvest,
        refresh: refreshInvest,
      },
      savings: {
        amountUsd: savingsUsd,
        loading: loadingSavings,
        error: errSavings,
        refresh: refreshSavings,
      },
      totals,
      loading,
      refreshAll,
    }),
    [
      depositUsd,
      investUsd,
      savingsUsd,
      loadingDeposit,
      loadingInvest,
      loadingSavings,
      errDeposit,
      errInvest,
      errSavings,
      refreshDeposit,
      refreshInvest,
      refreshSavings,
      totals,
      loading,
      refreshAll,
    ]
  );

  return (
    <BalanceContext.Provider value={value}>{children}</BalanceContext.Provider>
  );
}

export function useBalances() {
  const ctx = useContext(BalanceContext);
  if (!ctx) throw new Error("useBalances must be used within BalanceProvider");
  return ctx;
}
