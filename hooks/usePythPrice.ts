"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type HermesParsedPrice = {
  price: { price: string; expo: number; conf?: string; publish_time?: number };
  ema_price?: {
    price: string;
    expo: number;
    conf?: string;
    publish_time?: number;
  };
  id: string;
  metadata?: {
    slot?: number;
    prev_publish_time?: number;
    proof_available_time?: number;
  };
};

type HermesMessage = {
  binary?: { data: string[]; encoding: "hex" | "base64" };
  parsed?: HermesParsedPrice[];
};

export type UsePythPriceResult = {
  price: number | null; // USD
  lastUpdate: number | null; // epoch ms
  loading: boolean;
  error: string | null;
};

/**
 * Streams Pyth price updates via Hermes SSE and publishes the latest
 * into React state every `tickMs` (default 10s). Auto-reconnect with backoff.
 */
export function usePythPrice(
  priceId: string | null | undefined,
  tickMs = 10_000
): UsePythPriceResult {
  const [price, setPrice] = useState<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const latestRef = useRef<{ price: number | null; ts: number | null }>({
    price: null,
    ts: null,
  });
  const esRef = useRef<EventSource | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<{ tries: number }>({ tries: 0 });

  const url = useMemo(() => {
    if (!priceId) return null;
    const u = new URL("https://hermes.pyth.network/v2/updates/price/stream");
    u.searchParams.append("parsed", "true");
    u.searchParams.append("ignore_invalid_price_ids", "true");
    u.searchParams.append("ids[]", priceId);
    return u.toString();
  }, [priceId]);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      setPrice(null);
      setLastUpdate(null);
      setError(null);
      return;
    }

    let cancelled = false;

    function openStream(u: string) {
      if (cancelled) return;
      setLoading(true);
      setError(null);

      // Close any previous stream
      esRef.current?.close();
      esRef.current = null;

      const es = new EventSource(u);
      esRef.current = es;

      es.onopen = () => {
        reconnectRef.current.tries = 0;
        if (!cancelled) setLoading(false);
      };

      es.onerror = () => {
        if (cancelled) return;
        es.close();
        esRef.current = null;
        setLoading(true);

        // Exponential backoff (cap 30s)
        const tries = ++reconnectRef.current.tries;
        const delay = Math.min(30_000, 1_000 * Math.pow(2, tries));
        setTimeout(() => {
          if (!cancelled) openStream(u);
        }, delay);
      };

      es.onmessage = (ev) => {
        if (cancelled) return;
        try {
          const msg: HermesMessage = JSON.parse(ev.data);
          const p = msg?.parsed?.[0]?.price;
          if (!p) return;

          const raw = Number(p.price);
          const expo = Number(p.expo);
          if (!Number.isFinite(raw) || !Number.isFinite(expo)) return;

          const px = raw * Math.pow(10, expo); // expo is negative for USD feeds
          latestRef.current = { price: px, ts: Date.now() };
        } catch {
          // ignore individual parse errors
        }
      };
    }

    openStream(url); // <-- pass narrowed string

    // Publish latest snapshot every tickMs
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    intervalRef.current = setInterval(() => {
      const { price: px, ts } = latestRef.current;
      if (px !== null && ts !== null) {
        setPrice(px);
        setLastUpdate(ts);
        setError(null);
      }
    }, tickMs);

    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [url, tickMs]);

  return { price, lastUpdate, loading, error };
}
