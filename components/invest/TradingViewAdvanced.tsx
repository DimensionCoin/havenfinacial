"use client";

import { useEffect, useRef } from "react";
import type { TradingViewMap } from "@/lib/tokens";

type Props = {
  tv: TradingViewMap;
  height?: number | string;
  theme?: "dark" | "light";
};

/** Full advanced chart (TradingView) */
export default function TradingViewAdvanced({
  tv,
  height = 520,
  theme = "dark",
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const script = document.createElement("script");
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tv.proName, // <<— key
      interval: tv.defaultInterval || "60",
      timezone: "Etc/UTC",
      theme,
      style: "1",
      locale: "en",
      enable_publishing: false,
      backgroundColor: "rgba(0, 0, 0, 0)",
      hide_legend: false,
      hide_side_toolbar: false,
      allow_symbol_change: false,
      details: true,
      hotlist: false,
      calendar: false,
      studies: [],
      withdateranges: true,
      save_image: false,
      range: "1M",
      support_host: "https://www.tradingview.com",
    });

    container.innerHTML = "";
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, [tv, theme]);

  return (
    <div
      ref={ref}
      style={{ width: "100%", height }}
      className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl"
    />
  );
}
