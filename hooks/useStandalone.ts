"use client";

import { useEffect, useState } from "react";

export default function useStandalone() {
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    const isStandaloneNow =
      (window.matchMedia &&
        window.matchMedia("(display-mode: standalone)").matches) ||
      // iOS PWA:
      (window.navigator as any).standalone === true;

    setStandalone(isStandaloneNow);

    // Re-check on events that commonly indicate a mode change
    const recheck = () => {
      const s =
        (window.matchMedia &&
          window.matchMedia("(display-mode: standalone)").matches) ||
        (window.navigator as any).standalone === true;
      setStandalone(s);
    };

    window.addEventListener("pageshow", recheck);
    window.addEventListener("resize", recheck);
    document.addEventListener("visibilitychange", recheck);

    return () => {
      window.removeEventListener("pageshow", recheck);
      window.removeEventListener("resize", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, []);

  return standalone;
}
