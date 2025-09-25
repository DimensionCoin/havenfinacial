// components/notifications/NotificationBell.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

async function fetchAll(limit = 50, extraHeaders: HeadersInit = {}) {
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
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Name resolution caches
  const nameCacheRef = useRef<Map<string, string | null>>(new Map());
  const pendingRef = useRef<Set<string>>(new Set()); // in-flight lookups

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

  // Mark read when opened
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

  // Body scroll lock + Escape
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

  const shortAddr = (a?: unknown) => {
    const s = typeof a === "string" ? a : null;
    if (!s || s.length < 8) return null;
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
  };

  // On-the-fly address -> user name
  const resolveSenderName = useCallback(
    async (owner58: string): Promise<string | null> => {
      const cached = nameCacheRef.current.get(owner58);
      if (cached !== undefined) return cached;

      if (pendingRef.current.has(owner58)) return null;
      pendingRef.current.add(owner58);

      try {
        const headers = await getAuthHeaders();
        const r = await fetch(
          `/api/address/resolve?owner58=${encodeURIComponent(owner58)}`,
          {
            credentials: "include",
            cache: "no-store",
            headers,
          }
        );
        const j = await r.json().catch(() => null);
        const name =
          r.ok && j?.ok
            ? (j.name as string | null) ?? (j.email as string | null) ?? null
            : null;

        nameCacheRef.current.set(owner58, name);
        return name;
      } catch {
        nameCacheRef.current.set(owner58, null);
        return null;
      } finally {
        pendingRef.current.delete(owner58);
      }
    },
    [getAuthHeaders]
  );

  // Kick off resolves for any transfers with an address but no fromName
  useEffect(() => {
    const addresses = new Set<string>();
    for (const it of items) {
      const t = (it.type || "").toLowerCase();
      if (t !== "transfer_received" && t !== "money_received") continue;

      const data = it.data || {};
      const hasName = typeof data.fromName === "string" && !!data.fromName;
      const addr =
        typeof data.fromOwner58 === "string" ? data.fromOwner58.trim() : null;
      if (!addr) continue;

      // queue resolves if we don't already have a cached value
      if (!hasName && !nameCacheRef.current.has(addr)) addresses.add(addr);
    }
    if (addresses.size === 0) return;

    addresses.forEach(async (addr) => {
      const name = await resolveSenderName(addr);
      if (!name) return;

      // Write-through so this render shows the friendly label immediately
      setItems((prev) =>
        prev.map((it) => {
          const t = (it.type || "").toLowerCase();
          if (t !== "transfer_received" && t !== "money_received") return it;
          const data = it.data || {};
          const itsAddr =
            typeof data.fromOwner58 === "string"
              ? data.fromOwner58.trim()
              : null;
          const itsName =
            typeof data.fromName === "string" ? data.fromName : null;

          if (itsAddr === addr && !itsName) {
            return { ...it, data: { ...data, fromName: name } };
          }
          return it;
        })
      );
    });
  }, [items, resolveSenderName]);

  // Render message; prefer cache if fromName is absent
  const renderMessage = useCallback(
    (n: NotificationItem) => {
      const t = (n.type || "").toLowerCase();

      if (t === "transfer_received" || t === "money_received") {
        const rawAmt = (n.data?.amountUi as unknown) ?? null;
        const amountUi =
          typeof rawAmt === "string"
            ? Number(rawAmt)
            : (rawAmt as number | null);
        const amountLocal =
          amountUi != null && isFinite(Number(amountUi))
            ? fmtCurrency(Number(amountUi) * fxRate)
            : null;

        const addr =
          typeof n.data?.fromOwner58 === "string"
            ? n.data.fromOwner58.trim()
            : null;
        const fromName =
          (typeof n.data?.fromName === "string" && n.data.fromName) || null;

        // Use resolved cache if server payload didn't include a name
        const resolved = addr ? nameCacheRef.current.get(addr) : null;
        const label = fromName || resolved || shortAddr(addr) || "a sender";

        return {
          line1: amountLocal
            ? `You received ${amountLocal}.`
            : `You received a transfer.`,
          from: `From ${label}${
            addr && pendingRef.current.has(addr) ? " (resolving…)" : ""
          }`,
        };
      }

      return { line1: n.message, from: null as string | null };
    },
    [fxRate, fmtCurrency]
  );

  return (
    <div className={className}>
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen(true)}
        className="vision-button relative inline-flex items-center justify-center rounded-full p-2.5 transition-all duration-300 hover:scale-105 "
      >
        <Bell className="h-4 w-4 text-foreground/90" aria-hidden />
        {unseen > 0 && (
          <span
            aria-label={`${unseen} new notifications`}
            className="absolute -top-1 -right-1 min-w-[20px] px-1.5 h-[20px] rounded-full bg-gradient-to-r from-red-500 to-red-600 text-[10px] font-bold text-white flex items-center justify-center ring-2 ring-background shadow-lg"
          >
            {unseen > 99 ? "99+" : unseen}
          </span>
        )}
      </button>

      {mounted &&
        open &&
        createPortal(
          <div
            aria-modal="true"
            role="dialog"
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          >
            <div
              className="absolute inset-0 bg-black/70 backdrop-blur-md"
              onClick={() => setOpen(false)}
            />
            <div
              className="vision-modal relative w-full max-w-md sm:max-w-lg lg:max-w-xl mx-auto rounded-2xl overflow-hidden transform transition-all duration-300 scale-100"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="vision-surface sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <Bell className="h-4 w-4 text-foreground/70" />
                  <span className="text-base font-semibold text-foreground">
                    Notifications
                  </span>
                  {unseen > 0 && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-[rgb(182,255,62)]/20 text-[rgb(182,255,62)] rounded-full border border-[rgb(182,255,62)]/30">
                      {unseen} new
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void load()}
                    className="vision-button text-xs px-3 py-1.5 rounded-lg text-foreground/80 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={loading || marking}
                  >
                    {loading ? "Refreshing…" : "Refresh"}
                  </button>
                  <button
                    onClick={() => setOpen(false)}
                    className="vision-button text-xs px-3 py-1.5 rounded-lg text-foreground/80 hover:text-foreground"
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="vision-surface max-h-[70vh] sm:max-h-[75vh] overflow-auto">
                {!authenticated ? (
                  <div className="px-5 py-8 text-center">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-muted/20 flex items-center justify-center">
                      <Bell className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Please sign in to view notifications.
                    </p>
                  </div>
                ) : lastError ? (
                  <div className="px-5 py-8 text-center">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-destructive/20 flex items-center justify-center">
                      <Bell className="h-6 w-6 text-destructive" />
                    </div>
                    <p className="text-sm text-destructive break-words">
                      Failed to load notifications.
                    </p>
                  </div>
                ) : items.length === 0 && !loading ? (
                  <div className="px-5 py-8 text-center">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-muted/20 flex items-center justify-center">
                      <Bell className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      No notifications yet.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-white/5">
                    {items.map((n) => {
                      const content = renderMessage(n);
                      const isTransfer =
                        (n.type || "").toLowerCase() === "transfer_received" ||
                        (n.type || "").toLowerCase() === "money_received";

                      return (
                        <li
                          key={n._id}
                          className={`px-5 py-4 transition-all duration-200 hover:bg-white/5 ${
                            n.seen
                              ? "bg-transparent"
                              : "bg-[rgb(182,255,62)]/8 border-l-2 border-[rgb(182,255,62)]/50"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex-shrink-0 mt-1">
                              <span
                                className={`block h-2.5 w-2.5 rounded-full ${
                                  n.seen
                                    ? "bg-muted-foreground/40"
                                    : "bg-[rgb(182,255,62)] shadow-lg shadow-[rgb(182,255,62)]/30"
                                }`}
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-foreground leading-relaxed">
                                {content.line1}
                              </p>
                              {isTransfer && content.from && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {content.from}
                                </p>
                              )}
                              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                                <span>{timeAgo(n.createdAt)} ago</span>
                                {fxLoading && targetCurrency !== "USD" && (
                                  <>
                                    <span>•</span>
                                    <span className="text-[rgb(182,255,62)]/70">
                                      updating rates…
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                    {loading && (
                      <li className="px-5 py-4 text-center">
                        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                          <div className="w-4 h-4 border-2 border-[rgb(182,255,62)]/30 border-t-[rgb(182,255,62)] rounded-full animate-spin"></div>
                          Loading notifications…
                        </div>
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
