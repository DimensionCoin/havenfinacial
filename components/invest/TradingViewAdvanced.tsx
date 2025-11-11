"use client";

import { useEffect, useRef, useState } from "react";

/* ======================= Types ======================= */

type TVWidget = { remove?: () => void };
type TVLib = { widget: new (opts: unknown) => TVWidget };

declare global {
  interface Window {
    TradingView?: TVLib;
    __tvScriptLoadingPromise?: Promise<void>;
  }
}

/* ======================= TradingView Script Loader ======================= */

function loadTradingViewScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.TradingView) return Promise.resolve();
  if (!window.__tvScriptLoadingPromise) {
    window.__tvScriptLoadingPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://s3.tradingview.com/tv.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = (e) => reject(e);
      document.head.appendChild(script);
    });
  }
  return window.__tvScriptLoadingPromise;
}

/* ======================= TradingViewChart Component ======================= */

export default function TradingViewChart({
  symbol,
  height = 420,
}: {
  symbol: string;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<string>(`tv_${Math.random().toString(36).slice(2)}`);
  const widgetRef = useRef<TVWidget | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function mountWidget() {
      setIsLoading(true);
      try {
        await loadTradingViewScript();
        if (cancelled) return;
        const el = containerRef.current;
        if (!el || !window.TradingView) return;

        el.id = idRef.current;
        const w = new (window.TradingView as TVLib).widget({
          autosize: true,
          symbol,
          interval: "15",
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1",
          locale: "en",
          hide_top_toolbar: true,
          hide_legend: true,
          container_id: idRef.current,
          backgroundColor: "rgba(0,0,0,0.2)",
          gridColor: "rgba(255,255,255,0.06)",
        });
        widgetRef.current = w;
        if (!cancelled)
          setTimeout(() => !cancelled && setIsLoading(false), 150);
      } catch {
        if (!cancelled) setIsLoading(false);
      }
    }
    void mountWidget();
    return () => {
      cancelled = true;
      try {
        widgetRef.current?.remove?.();
      } catch {}
      widgetRef.current = null;
    };
  }, [symbol]);

  return (
    <div className="relative w-full" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-white/50">Loading chart...</div>
        </div>
      )}
    </div>
  );
}
