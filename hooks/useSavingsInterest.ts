// hooks/useSavingsInterest.ts
import { useBalances } from "@/providers/BalanceProvider";
import { useUser } from "@/providers/UserProvider";
import { useCallback, useMemo, useState } from "react";

export function useSavingsInterest() {
  const { savings } = useBalances();
  const {
    savingsBaselineUi,
    loading: userLoading,
    refresh: refreshUser,
  } = useUser();

  // Current value of the savings account (USD/USDC-pegged) from the BalanceProvider
  const currentUsd = Number(savings.amountUsd ?? 0) || 0;

  // Baseline principal tracked in Mongo (added on deposits, reduced on withdrawals)
  const baselineUsd = Number(savingsBaselineUi ?? 0) || 0;

  // Compute interest; clamp tiny negatives to 0 to handle rounding + “withdrew interest” cases
  const interestUsd = useMemo(() => {
    const raw = currentUsd - baselineUsd;
    // treat tiny float noise as zero
    if (Math.abs(raw) < 0.000001) return 0;
    return raw > 0 ? raw : 0;
  }, [currentUsd, baselineUsd]);

  // Optional: percent return since baseline
  const interestPct = useMemo(() => {
    if (baselineUsd <= 0) return 0;
    return (interestUsd / baselineUsd) * 100;
  }, [interestUsd, baselineUsd]);

  // Aggregate loading + refresh
  const [err, setErr] = useState<string | null>(null);
  const loading = savings.loading || userLoading;

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      await Promise.all([savings.refresh(), refreshUser()]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [savings, refreshUser]);

  return {
    currentUsd,
    baselineUsd,
    interestUsd,
    interestPct, // <- handy for UI, safe to ignore if not used
    loading,
    error: err || savings.error || null,
    refresh,
  };
}
