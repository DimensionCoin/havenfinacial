"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { toast } from "react-hot-toast";

type SentPending = {
  id: string;
  recipientEmail: string;
  amountUnits: number; // USDC in 6dp
  currency?: string; // "USDC"
  createdAt?: string; // ISO
  tokenExpiresAt?: string;
  escrowSignature?: string | null;
};

const DECIMALS = 6;

function fmtUsdcUnits(units?: number) {
  const ui = typeof units === "number" ? units / 10 ** DECIMALS : 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(ui);
  } catch {
    return `$${ui.toFixed(2)}`;
  }
}

export default function CancelTransfer({
  className,
  onChanged,
}: {
  className?: string;
  onChanged?: () => void;
}) {
  const { getAccessToken } = usePrivy();

  const [items, setItems] = useState<SentPending[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [busyAll, setBusyAll] = useState(false);
  const [busyOne, setBusyOne] = useState<string | null>(null);

  /** Build headers that never contain undefined values. */
  const buildAuthHeaders = useCallback(async (): Promise<HeadersInit> => {
    try {
      const token = await getAccessToken().catch(() => null);
      return token ? ({ Authorization: `Bearer ${token}` } as HeadersInit) : {};
    } catch {
      return {};
    }
  }, [getAccessToken]);

  /** Hit /api/user/me with Privy bearer to (re)set __session cookie. */
  const refreshSession = useCallback(async () => {
    const headers = await buildAuthHeaders();
    const res = await fetch("/api/user/me", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json", ...headers },
    });
    return res.ok;
  }, [buildAuthHeaders]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    let triedRefresh = false;
    const run = async () => {
      const headers = await buildAuthHeaders();
      const r = await fetch("/api/transfer/sent/list", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers,
      });
      if (r.status === 401 && !triedRefresh) {
        triedRefresh = true;
        const ok = await refreshSession();
        if (ok) return run(); // retry once after session refresh
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok || !Array.isArray(j.items)) {
        const message =
          j?.error ||
          (r.status === 401
            ? "Unauthorized. Please sign in."
            : `Failed to load transfers (${r.status})`);
        throw new Error(message);
      }
      setItems(j.items as SentPending[]);
    };

    try {
      await run();
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : "Failed to load transfers");
    } finally {
      setLoading(false);
    }
  }, [buildAuthHeaders, refreshSession]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalUnits = useMemo(
    () =>
      Array.isArray(items)
        ? items.reduce((a, c) => a + (c.amountUnits || 0), 0)
        : 0,
    [items]
  );

  const hasItems = Array.isArray(items) && items.length > 0;

  const cancelAll = useCallback(async () => {
    if (!hasItems) return;
    const toastId = toast.loading("Canceling transfers…");
    setBusyAll(true);
    try {
      const claimIds = items!.map((i) => i.id);
      const headers: HeadersInit = {
        ...(await buildAuthHeaders()),
        "Content-Type": "application/json",
      };
      const r = await fetch("/api/transfer/cancel", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ claimIds }),
      });
      if (r.status === 401) {
        const ok = await refreshSession();
        if (ok) {
          const r2 = await fetch("/api/transfer/cancel", {
            method: "POST",
            credentials: "include",
            headers,
            body: JSON.stringify({ claimIds }),
          });
          const j2 = await r2.json().catch(() => ({}));
          if (!r2.ok || !j2?.ok)
            throw new Error(j2?.error || `HTTP ${r2.status}`);
        } else {
          throw new Error("Unauthorized. Please sign in.");
        }
      } else {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      }

      toast.success("Transfers canceled", { id: toastId });
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed", {
        id: toastId,
      });
    } finally {
      setBusyAll(false);
    }
  }, [hasItems, items, buildAuthHeaders, refreshSession, load, onChanged]);

  const cancelOne = useCallback(
    async (id: string) => {
      const toastId = toast.loading("Canceling transfer…");
      setBusyOne(id);
      try {
        const headers: HeadersInit = {
          ...(await buildAuthHeaders()),
          "Content-Type": "application/json",
        };
        const r = await fetch("/api/transfer/cancel", {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({ claimIds: [id] }),
        });
        if (r.status === 401) {
          const ok = await refreshSession();
          if (ok) {
            const r2 = await fetch("/api/transfer/cancel", {
              method: "POST",
              credentials: "include",
              headers,
              body: JSON.stringify({ claimIds: [id] }),
            });
            const j2 = await r2.json().catch(() => ({}));
            if (!r2.ok || !j2?.ok)
              throw new Error(j2?.error || `HTTP ${r2.status}`);
          } else {
            throw new Error("Unauthorized. Please sign in.");
          }
        } else {
          const j = await r.json().catch(() => ({}));
          if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        }

        toast.success("Transfer canceled", { id: toastId });
        await load();
        onChanged?.();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Cancel failed", {
          id: toastId,
        });
      } finally {
        setBusyOne(null);
      }
    },
    [buildAuthHeaders, refreshSession, load, onChanged]
  );

  if (loading) {
    return (
      <section
        className={`rounded-2xl border border-white/10 bg-white/[0.03] p-5 ${
          className ?? ""
        }`}
      >
        <div className="h-5 w-44 bg-white/10 rounded mb-4 animate-pulse" />
        <div className="h-24 w-full bg-white/5 rounded animate-pulse" />
      </section>
    );
  }

  if (error) {
    return (
      <section
        className={`rounded-2xl border border-red-500/30 bg-red-900/20 p-5 text-red-300 ${
          className ?? ""
        }`}
      >
        <div className="font-medium mb-2">
          Couldn’t load your pending transfers
        </div>
        <div className="text-sm">{error}</div>
        <button
          onClick={() => load()}
          className="mt-3 rounded-md border border-white/20 px-3 py-1 text-sm hover:bg-white/10"
        >
          Retry
        </button>
      </section>
    );
  }

  if (!hasItems) return null;

  return (
    <section
      className={`rounded-2xl border border-white/10 bg-white/[0.03] ${
        className ?? ""
      }`}
    >
      <div className="p-5 md:p-6 flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-start md:items-center gap-3">
            <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-yellow-400/20 text-yellow-300">
              ⏳
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">
                Pending transfers you sent
              </h3>
              <p className="text-sm text-white/60">
                Total escrowed:{" "}
                <span className="font-medium text-white">
                  {fmtUsdcUnits(totalUnits)} USDC
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={cancelAll}
              disabled={busyAll || !!busyOne}
              className="rounded-2xl bg-red-500/90 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
            >
              {busyAll ? "Canceling…" : "Cancel all"}
            </button>
          </div>
        </div>

        <ul className="divide-y divide-white/10 rounded-xl border border-white/10 bg-white/[0.02]">
          {items!.map((t) => {
            const date = t.createdAt ? new Date(t.createdAt) : undefined;
            const dateStr =
              date &&
              date.toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });

            return (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white/60">To</span>
                    <span className="truncate text-sm font-medium text-white">
                      {t.recipientEmail || "Unknown"}
                    </span>
                  </div>
                  <div className="text-xs text-white/50">
                    Sent {dateStr ?? "—"}
                    {t.tokenExpiresAt
                      ? ` • Expires ${new Date(
                          t.tokenExpiresAt
                        ).toLocaleDateString()}`
                      : ""}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-sm font-semibold text-white">
                      {fmtUsdcUnits(t.amountUnits)} USDC
                    </div>
                  </div>
                  <button
                    onClick={() => cancelOne(t.id)}
                    disabled={busyAll || busyOne === t.id}
                    className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {busyOne === t.id ? "Canceling…" : "Cancel"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="text-[11px] text-white/60">
          Canceling returns funds from escrow back to your wallet. All actions
          settle on Solana.
        </p>
      </div>
    </section>
  );
}
