// providers/UserProvider.tsx
"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import FullScreenLoader from "@/components/shared/FullScreenLoader";

type EmbeddedWallet = {
  walletId?: string;
  address?: string;
  chainType: "solana";
  /** ✅ Native SOL balance in SOL units (from /api/user/me) */
  solBalanceUi?: number | null;
} | null;

type PublicUser = {
  id: string;
  privyId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  countryISO: string | null;
  displayCurrency: string;
  status: "pending" | "active" | "blocked" | "closed";
  kycStatus: "none" | "pending" | "approved" | "rejected";
  riskLevel: "low" | "medium" | "high";
  features: { onramp: boolean; cards: boolean; lend: boolean };
  depositWallet: EmbeddedWallet;
  tokenAccounts?: { usdc2022?: { depositAta?: string | null } };
  marginfi?: {
    accountPk: string | null;
    usdcBankPk: string | null;
    lastApy: number | null;
    lastApyAt: string | null;
  };
  savingsConsent?: {
    enabled?: boolean;
    acceptedAt?: string | null;
    version?: string;
  };
  /** ✅ baseline principal in USD/USDC units */
  savingsBaselineUi?: number;
  /** ✅ Native SOL balance from API (root-level helper) */
  depositSolBalanceUi?: number;
  flags?: {
    hasDepositWallet: boolean;
    hasMarginfiAccount: boolean;
    canOfframpFromDeposit: boolean;
  };
  createdAt?: string | null;
  updatedAt?: string | null;
};

type Ctx = {
  user: PublicUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** ✅ Convenience getter so callers don’t null-check */
  savingsBaselineUi: number;
  /** ✅ Convenience getter for native SOL balance on deposit wallet */
  depositSolBalanceUi: number;
};

const UserContext = createContext<Ctx>({
  user: null,
  loading: true,
  refresh: async () => {},
  savingsBaselineUi: 0,
  depositSolBalanceUi: 0,
});

const PUBLIC_ROUTES = new Set<string>([
  "/",
  "/sign-in",
  "/sign-up",
  "/onboarding",
  "/kyc/pending",
  "/tos",
  "/policy",
]);

function isPublicPath(pathname: string) {
  if (PUBLIC_ROUTES.has(pathname)) return true;
  if (pathname === "/claim" || pathname.startsWith("/claim/")) return true;
  return false;
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { ready, authenticated, getAccessToken } = usePrivy();

  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => setMounted(true), []);

  const fetchMe = useCallback(async () => {
    setLoading(true);
    try {
      const bearer = authenticated ? await getAccessToken() : null;

      const res = await fetch("/api/user/me", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: {
          accept: "application/json",
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        },
      });

      if (res.status === 401) {
        setUser(null);
        if (!isPublicPath(pathname)) router.replace("/sign-in");
        return;
      }
      if (res.status === 404) {
        setUser(null);
        if (!isPublicPath(pathname)) router.replace("/sign-up");
        return;
      }
      if (!res.ok) {
        setUser(null);
        if (!isPublicPath(pathname)) router.replace("/sign-in");
        return;
      }

      const data = (await res.json()) as PublicUser;
      setUser(data);

      if (!isPublicPath(pathname)) {
        const ok = data.status === "active" && data.kycStatus === "approved";
        if (!ok && pathname !== "/onboarding" && pathname !== "/kyc/pending") {
          router.replace("/onboarding");
        }
      }
    } catch (e) {
      console.error("UserProvider fetch error:", e);
      setUser(null);
      if (!isPublicPath(pathname)) router.replace("/sign-in");
    } finally {
      setLoading(false);
    }
  }, [authenticated, getAccessToken, pathname, router]);

  const refresh = useCallback(async () => {
    await fetchMe();
  }, [fetchMe]);

  useEffect(() => {
    if (!mounted) return;
    if (!ready) return;
    fetchMe();
  }, [mounted, ready, authenticated, pathname, fetchMe]);

  const savingsBaselineUi = useMemo(
    () => Number(user?.savingsBaselineUi ?? 0) || 0,
    [user?.savingsBaselineUi]
  );

  const depositSolBalanceUi = useMemo(() => {
    // Prefer root-level field from API if present
    if (typeof user?.depositSolBalanceUi === "number") {
      return user.depositSolBalanceUi;
    }
    // Fallback to nested depositWallet.solBalanceUi
    const raw =
      user?.depositWallet && "solBalanceUi" in user.depositWallet
        ? user.depositWallet.solBalanceUi
        : null;
    return typeof raw === "number" ? raw : 0;
  }, [user?.depositSolBalanceUi, user?.depositWallet]);

  const value = useMemo(
    () => ({
      user,
      loading,
      refresh,
      savingsBaselineUi,
      depositSolBalanceUi,
    }),
    [user, loading, refresh, savingsBaselineUi, depositSolBalanceUi]
  );

  const isPublic = isPublicPath(pathname);
  const shouldBlock = !mounted || !ready || loading || (!isPublic && !user);

  const loaderMessage = !mounted
    ? "Starting…"
    : !ready
    ? "Starting session…"
    : loading
    ? "Loading your account…"
    : "Loading Haven…";

  return (
    <UserContext.Provider value={value}>
      {shouldBlock ? <FullScreenLoader message={loaderMessage} /> : children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
