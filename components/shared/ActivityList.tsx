// components/activity/ActivityList.tsx
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useUser } from "@/providers/UserProvider";

type Item = {
  signature: string;
  blockTime: number | null; // seconds
  direction: "in" | "out";
  amountUi: number; // USDC
  counterparty?: string | null;
  feeLamports?: number | null;
};

type ApiResp = { ok: true; items: Item[]; nextBefore: string | null };

const EXPLORER_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "devnet";

function explorerTx(sig: string) {
  return EXPLORER_CLUSTER === "mainnet"
    ? `https://explorer.solana.com/tx/${sig}`
    : `https://explorer.solana.com/tx/${sig}?cluster=${EXPLORER_CLUSTER}`;
}

export default function ActivityList() {
  const { user } = useUser();
  const { ready, authenticated, getAccessToken } = usePrivy();

  const targetCurrency = useMemo(() => {
    const c = (user?.displayCurrency || "USD").toUpperCase();
    return c === "USDC" ? "USD" : c;
  }, [user?.displayCurrency]);

  const [rate, setRate] = useState<number>(1); // USD -> targetCurrency
  const [loadingFx, setLoadingFx] = useState(false);

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    if (!ready || !authenticated) return {};
    try {
      const token = await getAccessToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }, [ready, authenticated, getAccessToken]);

  const loadFx = useCallback(async () => {
    if (targetCurrency === "USD") {
      setRate(1);
      return;
    }
    setLoadingFx(true);
    try {
      const headers = await authHeaders();
      const r = await fetch(
        `/api/fx?currency=${encodeURIComponent(targetCurrency)}&amount=1`,
        { credentials: "include", cache: "no-store", headers }
      );
      const j = await r.json().catch(() => null);
      const fx = r.ok && j?.rate ? Number(j.rate) : 1;
      setRate(isFinite(fx) && fx > 0 ? fx : 1);
    } catch {
      setRate(1);
    } finally {
      setLoadingFx(false);
    }
  }, [targetCurrency, authHeaders]);

  const load = useCallback(
    async (cursor?: string | null) => {
      setLoading(true);
      setErr(null);
      try {
        const headers = await authHeaders();
        const url = new URL("/api/activity", window.location.origin);
        if (cursor) url.searchParams.set("before", cursor);
        url.searchParams.set("limit", "30");

        const r = await fetch(url.toString(), {
          credentials: "include",
          cache: "no-store",
          headers,
        });
        if (!r.ok) {
          const text = await r.text().catch(() => "");
          throw new Error(text || `HTTP ${r.status}`);
        }
        const j = (await r.json()) as ApiResp;
        setItems((prev) => (cursor ? [...prev, ...j.items] : j.items));
        setNextBefore(j.nextBefore);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setErr(msg);
      } finally {
        setLoading(false);
      }
    },
    [authHeaders]
  );

  useEffect(() => {
    if (!ready) return;
    void loadFx();
    void load(null);
  }, [ready, loadFx, load]);

  const fmtAmt = useCallback(
    (usdcUi: number) => {
      const local = usdcUi * rate;
      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: targetCurrency,
          maximumFractionDigits: 2,
        }).format(local);
      } catch {
        return `${targetCurrency} ${local.toFixed(2)}`;
      }
    },
    [rate, targetCurrency]
  );

  const fmtDate = (sec: number | null) =>
    sec
      ? new Date(sec * 1000).toLocaleString(undefined, {
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

  return (
    <div className="w-full max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Activity</h2>
        <button
          onClick={() => load(null)}
          className="text-xs px-3 py-1.5 rounded-md border border-white/10 text-white/80 hover:bg-white/10"
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {!authenticated ? (
        <div className="text-sm text-white/70">Sign in to view activity.</div>
      ) : err ? (
        <div className="text-sm text-red-400 break-words">
          Failed to load activity.
        </div>
      ) : items.length === 0 && !loading ? (
        <div className="text-sm text-white/60">No activity yet.</div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-zinc-900/60 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/70">
              <tr>
                <th className="text-left px-4 py-2 font-medium">When</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-right px-4 py-2 font-medium">Amount</th>
                <th className="text-left px-4 py-2 font-medium">
                  Counterparty
                </th>
                <th className="text-right px-4 py-2 font-medium">Tx</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {items.map((it) => (
                <tr key={it.signature} className="text-white/90">
                  <td className="px-4 py-3 text-white/70">
                    {fmtDate(it.blockTime)}
                  </td>
                  <td className="px-4 py-3">
                    {it.direction === "in" ? (
                      <span className="text-green-400 font-medium">
                        Received
                      </span>
                    ) : (
                      <span className="text-red-400 font-medium">Sent</span>
                    )}{" "}
                    <span className="text-white/60">USDC</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="font-semibold">
                      {it.direction === "in" ? "+" : "-"}
                      {fmtAmt(it.amountUi)}
                    </div>
                    <div className="text-xs text-white/50">
                      {it.amountUi.toFixed(2)} USDC
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-white/80">
                      {it.counterparty
                        ? it.counterparty.slice(0, 4) +
                          "…" +
                          it.counterparty.slice(-4)
                        : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <a
                      href={explorerTx(it.signature)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[rgb(182,255,62)] hover:underline"
                    >
                      View →
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="p-3 flex items-center justify-between">
            <div className="text-xs text-white/50">
              {loadingFx && targetCurrency !== "USD"
                ? "Updating FX…"
                : `FX: 1 USD ≈ ${rate.toFixed(4)} ${targetCurrency}`}
            </div>
            <button
              onClick={() => nextBefore && load(nextBefore)}
              disabled={!nextBefore || loading}
              className="text-xs px-3 py-1.5 rounded-md border border-white/10 text-white/80 disabled:opacity-50 hover:bg-white/10"
            >
              {loading ? "Loading…" : nextBefore ? "Load more" : "End of list"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
