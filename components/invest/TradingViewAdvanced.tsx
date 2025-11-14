"use client";

import { useEffect, useRef, useState } from "react";

/* ======================= Types ======================= */

type TVWidget = {
  remove?: () => void;
  onChartReady?: (callback: () => void) => void;
  setInterval?: (interval: string, callback?: () => void) => void;
};
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
  defaultInterval = "30",
}: {
  symbol: string;
  height?: number;
  defaultInterval?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef<string>(`tv_${Math.random().toString(36).slice(2)}`);
  const widgetRef = useRef<TVWidget | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentInterval, setCurrentInterval] =
    useState<string>(defaultInterval);

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
          interval: defaultInterval, // use initial prop for first render
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1",
          locale: "en",
          hide_top_toolbar: false, // show timeframe buttons
          hide_legend: false,
          container_id: idRef.current,
          backgroundColor: "rgba(0,0,0,0.2)",
          gridColor: "rgba(255,255,255,0.06)",
          toolbar_bg: "rgba(0,0,0,0.8)",
          enable_publishing: false,
          allow_symbol_change: false,
          studies: [],
        });
        widgetRef.current = w;

        // Prefer onChartReady if available
        if (typeof w.onChartReady === "function") {
          w.onChartReady(() => {
            if (!cancelled) setIsLoading(false);
          });
        } else {
          // Fallback: clear loading after a short delay if TV doesn't expose onChartReady
          setTimeout(() => {
            if (!cancelled) setIsLoading(false);
          }, 800);
        }

        // Keep state in sync with initial interval
        setCurrentInterval(defaultInterval);
      } catch {
        if (!cancelled) setIsLoading(false);
      }
    }

    void mountWidget();

    return () => {
      cancelled = true;
      try {
        widgetRef.current?.remove?.();
      } catch {
        // ignore
      }
      widgetRef.current = null;
    };
  }, [symbol, defaultInterval]); // recreate only when symbol or default interval changes

  // Effect to handle timeframe changes without recreating the entire widget
  useEffect(() => {
    if (widgetRef.current?.setInterval) {
      widgetRef.current.setInterval(currentInterval);
    }
  }, [currentInterval]);

  return (
    <div className="relative w-full" style={{ height }}>
      {/* Chart Container */}
      <div ref={containerRef} className="absolute inset-0" />

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-white/50">Loading chart...</div>
        </div>
      )}
    </div>
  );
}
