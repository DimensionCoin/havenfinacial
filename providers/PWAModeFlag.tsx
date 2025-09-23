"use client";
import { useEffect } from "react";
import useStandalone from "@/hooks/useStandalone";

export default function PWAModeFlag() {
  const isStandalone = useStandalone();

  useEffect(() => {
    const el = document.documentElement; // <html>
    if (isStandalone) el.setAttribute("data-standalone", "true");
    else el.removeAttribute("data-standalone");
  }, [isStandalone]);

  return null;
}
