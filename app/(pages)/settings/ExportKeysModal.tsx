// app/settings/ExportKeysModal.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { useUser } from "@/providers/UserProvider";

export default function ExportKeysModal({ onClose }: { onClose: () => void }) {
  const { user: appUser } = useUser();
  const { ready, authenticated, login, user: privyUser } = usePrivy();
  const { exportWallet } = useSolanaWallets();

  const choices = useMemo(() => {
    const out: Array<{ label: string; address: string }> = [];
    const dep = appUser?.depositWallet?.address;
    if (dep) out.push({ label: "Deposit Account", address: dep });
    return out;
  }, [appUser]);

  const [address, setAddress] = useState<string>("");
  const [authBusy, setAuthBusy] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (choices.length > 0) setAddress(choices[0].address);
  }, [choices]);

  const addressExistsInPrivy = useMemo(() => {
    if (!address) return false;
    const raw = (privyUser as unknown as Record<string, unknown>)?.linkedAccounts as unknown;
    const accounts = Array.isArray(raw) ? (raw as unknown[]) : [];
    if (!accounts.length) return false;
    return accounts.some((acc) => {
      if (!acc || typeof acc !== "object") return false;
      const a = acc as Record<string, unknown>;
      return (
        a.type === "wallet" &&
        a.walletClientType === "privy" &&
        a.chainType === "solana" &&
        typeof a.address === "string" &&
        a.address.toLowerCase() === address.toLowerCase()
      );
    });
  }, [privyUser, address]);

  const ensureAuth = async () => {
    if (!ready) throw new Error("Authentication not ready yet.");
    if (!authenticated) {
      setAuthBusy(true);
      try {
        await login();
      } finally {
        setAuthBusy(false);
      }
    }
  };

  const startCooldown = (ms = 600) => {
    setCooldown(true);
    setTimeout(() => setCooldown(false), ms);
  };

  const onExport = async () => {
    setError(null);
    setLastSuccess(null);

    try {
      if (!address) {
        setError(
          "Please select an account to export recovery information for."
        );
        return;
      }

      await ensureAuth();

      if (!addressExistsInPrivy) {
        console.warn("Selected address not visible in Privy session yet.");
      }

      const p = exportWallet({ address });
      startCooldown();
      await p;
      setLastSuccess(address);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const lower = msg.toLowerCase();
      if (
        lower.includes("cancel") ||
        lower.includes("dismiss") ||
        lower.includes("closed")
      ) {
        return;
      }
      setError(msg);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] grid place-items-center">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-md">
        {/* Background gradient effects */}
        <div className="absolute -top-10 -left-10 w-20 h-20 bg-[rgb(182,255,62)] opacity-[0.08] rounded-full blur-2xl" />
        <div className="absolute -bottom-10 -right-10 w-16 h-16 bg-[rgb(182,255,62)] opacity-[0.06] rounded-full blur-xl" />

        <div className="relative backdrop-blur-sm bg-white/[0.02] border border-white/10 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-[rgb(182,255,62)]/20 rounded-xl flex items-center justify-center">
              <span className="text-[rgb(182,255,62)] text-lg">🔐</span>
            </div>
            <div>
              <h3 className="text-xl font-semibold text-foreground">
                Export Recovery Information
              </h3>
              <p className="text-sm text-muted-foreground">
                Secure account backup
              </p>
            </div>
          </div>

          <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl mb-6">
            <p className="text-sm text-blue-200">
              This opens a secure export process for your account recovery
              information. Haven never sees this sensitive data - it&rsquo;s handled
              entirely by our security partner.
            </p>
          </div>

          {choices.length === 0 ? (
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl mb-4">
              <p className="text-sm text-amber-200">
                No recovery information available for this account type.
              </p>
            </div>
          ) : (
            <>
              <label className="block mb-4">
                <span className="mb-2 block text-sm font-medium text-foreground/90">
                  Select Account
                </span>
                <select
                  className="w-full rounded-xl bg-white/[0.02] border border-white/10 px-4 py-3 text-foreground outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/50 focus:border-[rgb(182,255,62)]/50 transition-all"
                  value={address}
                  onChange={(e) => {
                    setAddress(e.target.value);
                    setError(null);
                    setLastSuccess(null);
                  }}
                  disabled={authBusy}
                >
                  {choices.map((c) => (
                    <option
                      key={c.address}
                      value={c.address}
                      className="bg-zinc-900"
                    >
                      {c.label} — {shorten(c.address)}
                    </option>
                  ))}
                </select>
              </label>

              {!addressExistsInPrivy && address && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl mb-4">
                  <p className="text-xs text-amber-200">
                    This account may not be visible in your current session yet.
                    You can still try exporting.
                  </p>
                </div>
              )}
            </>
          )}

          {error && (
            <div
              className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl mb-4"
              role="alert"
            >
              <p className="text-sm text-red-200">{error}</p>
            </div>
          )}

          {lastSuccess && (
            <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl mb-4">
              <p className="text-sm text-green-200">
                Recovery information exported successfully for{" "}
                {shorten(lastSuccess)}. You can export another account if
                needed.
              </p>
            </div>
          )}

          <div className="flex gap-3 mb-4">
            <button
              onClick={onExport}
              disabled={
                authBusy || cooldown || choices.length === 0 || !address
              }
              className="flex-1 rounded-xl bg-[rgb(182,255,62)] text-black font-medium px-6 py-3 hover:bg-[rgb(182,255,62)]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {authBusy
                ? "Authenticating…"
                : lastSuccess
                ? "Export Another"
                : "Export Recovery Info"}
            </button>
            <button
              onClick={onClose}
              className="rounded-xl border border-white/20 text-foreground px-6 py-3 hover:bg-white/10 transition-all duration-200"
            >
              {lastSuccess ? "Done" : "Cancel"}
            </button>
          </div>

          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
            <p className="text-xs text-red-200">
              <strong>Critical Security Notice:</strong> Anyone with access to
              your recovery information can control your account and funds.
              Store this information offline in a secure location and never
              share it with anyone. Haven cannot recover lost recovery
              information.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function shorten(a: string, n = 4) {
  if (!a) return "";
  return `${a.slice(0, n)}…${a.slice(-n)}`;
}
