"use client";

import { useEffect, useState } from "react";

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

function isStandaloneDisplayMode() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches
  );
}

function isIOSStandalone() {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as NavigatorWithStandalone;
  return nav.standalone === true;
}

export default function useStandalone() {
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    const evaluate = () => {
      setStandalone(isStandaloneDisplayMode() || isIOSStandalone());
    };

    evaluate();

    window.addEventListener("pageshow", evaluate);
    window.addEventListener("resize", evaluate);
    document.addEventListener("visibilitychange", evaluate);

    return () => {
      window.removeEventListener("pageshow", evaluate);
      window.removeEventListener("resize", evaluate);
      document.removeEventListener("visibilitychange", evaluate);
    };
  }, []);

  return standalone;
}
