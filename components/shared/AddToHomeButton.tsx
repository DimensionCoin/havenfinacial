// components/AddToHomeButton.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Minimal non-standard PWA install event shape for Chromium browsers
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void> | void;
  userChoice: Promise<unknown>;
};

type Props = {
  /** "menu" -> renders like a dropdown menu item; "floating" -> fixed CTA */
  variant?: "menu" | "floating";
  /** Called after user accepts/dismisses or closes the iOS help */
  onDone?: () => void;
  /** Optional extra classes when variant="menu" */
  className?: string;
};

function isIOS() {
  if (typeof window === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isInStandalone() {
  if (typeof window === "undefined") return false;
  return (
    (window.matchMedia &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    // iOS Safari flag
    ((window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true)
  );
}

export default function AddToHomeButton({
  variant = "floating",
  onDone,
  className = "",
}: Props) {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [eligible, setEligible] = useState(false);
  const [showIOSHelp, setShowIOSHelp] = useState(false);
  const iOS = useMemo(isIOS, []);
  const installedRef = useRef(false);

  useEffect(() => {
    // Hide entirely if already installed / running standalone
    if (isInStandalone()) {
      installedRef.current = true;
      setEligible(false);
      return;
    }
    // Android/Chromium path: show only when beforeinstallprompt fires
    const onBIP = (e: Event) => {
      e.preventDefault(); // required to show the prompt later
      const bip = e as BeforeInstallPromptEvent;
      setDeferredPrompt(bip);
      setEligible(true);
    };
    window.addEventListener("beforeinstallprompt", onBIP as EventListener);

    // iOS never fires beforeinstallprompt — we still show the entry so users can see instructions
    if (iOS) setEligible(true);

    return () =>
      window.removeEventListener(
        "beforeinstallprompt",
        onBIP as EventListener
      );
  }, [iOS]);

  if (!eligible) return null;

  const handleClick = async () => {
    try {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice; // { outcome: "accepted" | "dismissed", platform: ... }
        setDeferredPrompt(null);
        setEligible(false);
        onDone?.();
      } else if (iOS) {
        setShowIOSHelp(true);
      }
    } catch {
      // swallow
    }
  };

  // Menu variant: use your menu styles and semantics
  if (variant === "menu") {
    return (
      <>
        <button
          role="menuitem"
          className={`menu-item ${className}`}
          onClick={handleClick}
        >
          Install Haven (Add to Home)
        </button>

        {showIOSHelp && (
          <div className="fixed inset-0 z-[9999] grid place-items-center">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => {
                setShowIOSHelp(false);
                onDone?.();
              }}
            />
            <div className="relative bg-zinc-900 border border-white/10 rounded-2xl p-5 w-[90%] max-w-sm text-white">
              <h3 className="text-lg font-semibold">Add to Home Screen</h3>
              <p className="text-sm text-zinc-300 mt-2">
                1) Tap the <span className="font-semibold">Share</span> icon in
                Safari.
                <br />
                2) Choose{" "}
                <span className="font-semibold">Add to Home Screen</span>.
                <br />
                3) Open from your home screen for a full-screen experience.
              </p>
              <button
                className="mt-4 rounded-xl bg-[rgb(182,255,62)] text-black px-4 py-2 font-semibold"
                onClick={() => {
                  setShowIOSHelp(false);
                  onDone?.();
                }}
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // Floating variant (your original CTA)
  return (
    <>
      <button
        className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-xl bg-[rgb(182,255,62)] text-black px-4 py-2 font-semibold shadow-lg"
        onClick={handleClick}
      >
        Install Haven
      </button>

      {showIOSHelp && (
        <div className="fixed inset-0 z-[9999] grid place-items-center">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => {
              setShowIOSHelp(false);
              onDone?.();
            }}
          />
          <div className="relative bg-zinc-900 border border-white/10 rounded-2xl p-5 w-[90%] max-w-sm text-white">
            <h3 className="text-lg font-semibold">Add to Home Screen</h3>
            <p className="text-sm text-zinc-300 mt-2">
              1) Tap the <span className="font-semibold">Share</span> icon in
              Safari.
              <br />
              2) Choose{" "}
              <span className="font-semibold">Add to Home Screen</span>.
              <br />
              3) Open from your home screen for a full-screen experience.
            </p>
            <button
              className="mt-4 rounded-xl bg-[rgb(182,255,62)] text-black px-4 py-2 font-semibold"
              onClick={() => {
                setShowIOSHelp(false);
                onDone?.();
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
