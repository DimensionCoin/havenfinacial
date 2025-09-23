// components/notifications/NotificationBell.tsx
"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bell } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { useUser } from "@/providers/UserProvider";

type NotificationItem = {
  _id: string;
  message: string;
  type?: string;
  data?: Record<string, unknown>;
  seen?: boolean;
  createdAt?: string;
};

type ApiListResponse = { ok: true; items: NotificationItem[] };
type ApiMarkResponse = { ok: true; matched: number; modified: number };

function timeAgo(iso?: string) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

async function fetchAll(
  limit = 50,
  extraHeaders: HeadersInit = {}
): Promise<NotificationItem[]> {
  const res = await fetch(`/api/notifications?limit=${limit}`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { ...extraHeaders },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  const j = (await res.json()) as ApiListResponse;
  return j.items ?? [];
}

async function markAllRead(extraHeaders: HeadersInit = {}) {
  const res = await fetch("/api/notifications/mark-read", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify({ all: true }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await res.json()) as ApiMarkResponse;
}

export default function NotificationBell({
  limit = 50,
  pollMs = 30_000,
  className = "",
}: {
  limit?: number;
  pollMs?: number;
  className?: string;
}) {
  const { user } = useUser();
  const { ready, authenticated, getAccessToken } = usePrivy();

  const targetCurrency =
    (user?.displayCurrency || "USD").toUpperCase() === "USDC"
      ? "USD"
      : (user?.displayCurrency || "USD").toUpperCase();

  const [fxRate, setFxRate] = useState<number>(1);
  const [fxLoading, setFxLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false); // for portal
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  const unseen = items.reduce((n, it) => (it.seen ? n : n + 1), 0);

  const getAuthHeaders = useCallback(async (): Promise<HeadersInit> => {
    if (!ready || !authenticated) return {};
    try {
      const token = await getAccessToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }, [ready, authenticated, getAccessToken]);

  const load = useCallback(async () => {
    setLoading(true);
    setLastError(null);
    try {
      const headers = await getAuthHeaders();
      const list = await fetchAll(limit, headers);
      setItems(list);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastError(msg);
      console.error("notifications fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, [limit, getAuthHeaders]);

  useEffect(() => {
    if (!ready) return;
    void load();
  }, [ready, load]);

  useEffect(() => {
    if (!pollMs || pollMs <= 0) return;
    if (!ready || !authenticated) return;
    const id = setInterval(() => void load(), pollMs);
    return () => clearInterval(id);
  }, [pollMs, ready, authenticated, load]);

  // Mark read when the modal opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const run = async () => {
      if (items.every((i) => i.seen)) return;
      setMarking(true);
      try {
        const headers = await getAuthHeaders();
        await markAllRead(headers);
        if (!cancelled) {
          setItems((prev) => prev.map((it) => ({ ...it, seen: true })));
        }
      } catch (e) {
        console.error("notifications mark-read error:", e);
      } finally {
        if (!cancelled) setMarking(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [open, items, getAuthHeaders]);

  // FX load
  useEffect(() => {
    let cancelled = false;
    async function loadFx() {
      if (!ready || !authenticated) return;
      if (targetCurrency === "USD") {
        setFxRate(1);
        return;
      }
      setFxLoading(true);
      try {
        const token = await getAccessToken().catch(() => null);
        const r = await fetch(
          `/api/fx?currency=${encodeURIComponent(targetCurrency)}&amount=1`,
          {
            credentials: "include",
            cache: "no-store",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }
        );
        const j = await r.json().catch(() => null);
        const rate = r.ok && j?.rate ? Number(j.rate) : 1;
        if (!cancelled) setFxRate(isFinite(rate) && rate > 0 ? rate : 1);
      } catch {
        if (!cancelled) setFxRate(1);
      } finally {
        if (!cancelled) setFxLoading(false);
      }
    }
    void loadFx();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, targetCurrency, getAccessToken]);

  // Body scroll lock + Escape to close when modal is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const fmtCurrency = useCallback(
    (v: number | null | undefined) => {
      if (v == null || !isFinite(Number(v))) return "—";
      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: targetCurrency,
          maximumFractionDigits: 2,
        }).format(Number(v));
      } catch {
        return `${targetCurrency} ${Number(v).toFixed(2)}`;
      }
    },
    [targetCurrency]
  );

  const renderMessage = useCallback(
    (n: NotificationItem) => {
      const t = (n.type || "").toLowerCase();
      if (t === "transfer_received" || t === "money_received") {
        const raw = (n.data?.amountUi as unknown) ?? null;
        const amountUi =
          typeof raw === "string" ? Number(raw) : (raw as number | null);
        if (amountUi != null && isFinite(Number(amountUi))) {
          const local = Number(amountUi) * fxRate;
          const from =
            typeof n.data?.from === "string" && n.data.from
              ? ` from ${n.data.from}`
              : "";
          return `You received ${fmtCurrency(local)}${from}.`;
        }
      }
      return n.message;
    },
    [fxRate, fmtCurrency]
  );

  return (
    <div className={className}>
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen(true)}
        className="relative inline-flex items-center justify-center rounded-full p-2 hover:bg-white/10 transition-colors"
      >
        <Bell className="h-5 w-5 text-white/90" aria-hidden />
        {unseen > 0 && (
          <span
            aria-label={`${unseen} new notifications`}
            className="absolute -top-0.5 -right-0.5 min-w-[18px] px-1 h-[18px] rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center ring-2 ring-zinc-900"
          >
            {unseen > 99 ? "99+" : unseen}
          </span>
        )}
      </button>

      {/* Centered, full-screen overlay via portal */}
      {mounted &&
        open &&
        createPortal(
          <div
            aria-modal="true"
            role="dialog"
            className="fixed inset-0 z-[9999] flex items-center justify-center"
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />

            {/* Dialog */}
            <div
              className="relative w-full max-w-lg sm:max-w-xl lg:max-w-2xl mx-4 sm:mx-6 rounded-2xl border border-white/10 bg-zinc-900/95 backdrop-blur-xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()} // prevent closing when clicking inside
            >
              {/* Header */}
              <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-white/10 bg-zinc-900/95">
                <span className="text-sm font-semibold text-white/90">
                  Notifications
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void load()}
                    className="text-[11px] px-2 py-1 rounded-md border border-white/10 hover:bg-white/10 text-white/70"
                    disabled={loading || marking}
                  >
                    {loading ? "Refreshing…" : "Refresh"}
                  </button>
                  <button
                    onClick={() => setOpen(false)}
                    className="text-[11px] px-2 py-1 rounded-md border border-white/10 hover:bg-white/10 text-white/70"
                  >
                    Close
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="max-h-[85vh] overflow-auto">
                {!authenticated ? (
                  <div className="px-4 py-6 text-sm text-white/60">
                    Please sign in to view notifications.
                  </div>
                ) : lastError ? (
                  <div className="px-4 py-6 text-sm text-red-400 break-words">
                    Failed to load notifications.
                  </div>
                ) : items.length === 0 && !loading ? (
                  <div className="px-4 py-6 text-sm text-white/60">
                    No notifications.
                  </div>
                ) : (
                  <ul className="divide-y divide-white/10">
                    {items.map((n) => (
                      <li
                        key={n._id}
                        className={`px-4 py-3 text-sm ${
                          n.seen ? "bg-transparent" : "bg-[rgb(182,255,62)]/5"
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className={`mt-1 h-2 w-2 rounded-full flex-shrink-0 ${
                              n.seen ? "bg-zinc-500/40" : "bg-[rgb(182,255,62)]"
                            }`}
                          />
                          <div className="min-w-0">
                            <p className="text-white/90 break-words">
                              {renderMessage(n)}
                            </p>
                            <div className="mt-1 text-[11px] text-white/45">
                              {timeAgo(n.createdAt)} ago
                              {fxLoading && targetCurrency !== "USD"
                                ? " · updating rates…"
                                : null}
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                    {loading && (
                      <li className="px-4 py-3 text-sm text-white/60">
                        Loading…
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
