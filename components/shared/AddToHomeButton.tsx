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
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
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
      window.removeEventListener("beforeinstallprompt", onBIP as EventListener);
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
          <div className="fixed inset-0 z-[99999] grid place-items-center p-4">
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => {
                setShowIOSHelp(false);
                onDone?.();
              }}
            />
            <div className="relative bg-zinc-900/95 backdrop-blur-xl border border-white/20 rounded-3xl p-8 w-full max-w-md text-white shadow-2xl">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-[rgb(182,255,62)] rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <svg
                    className="w-8 h-8 text-black"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold mb-2">Install Haven Bank</h3>
                <p className="text-zinc-400 text-sm">
                  Get the full app experience on your device
                </p>
              </div>

              <div className="space-y-4 mb-6">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 bg-[rgb(182,255,62)] rounded-full flex items-center justify-center text-black font-bold text-sm flex-shrink-0 mt-0.5">
                    1
                  </div>
                  <p className="text-sm text-zinc-300">
                    Tap the{" "}
                    <span className="font-semibold text-white">Share</span> icon
                    at the bottom of Safari
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 bg-[rgb(182,255,62)] rounded-full flex items-center justify-center text-black font-bold text-sm flex-shrink-0 mt-0.5">
                    2
                  </div>
                  <p className="text-sm text-zinc-300">
                    Scroll down and select{" "}
                    <span className="font-semibold text-white">
                      "Add to Home Screen"
                    </span>
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 bg-[rgb(182,255,62)] rounded-full flex items-center justify-center text-black font-bold text-sm flex-shrink-0 mt-0.5">
                    3
                  </div>
                  <p className="text-sm text-zinc-300">
                    Tap <span className="font-semibold text-white">"Add"</span>{" "}
                    to install Haven Bank on your home screen
                  </p>
                </div>
              </div>

              <button
                className="w-full rounded-2xl bg-[rgb(182,255,62)] text-black px-6 py-4 font-bold text-lg hover:bg-[rgb(182,255,62)]/90 transition-colors"
                onClick={() => {
                  setShowIOSHelp(false);
                  onDone?.();
                }}
              >
                Got it!
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
        <div className="fixed inset-0 z-[99999] grid place-items-center p-4">
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => {
              setShowIOSHelp(false);
              onDone?.();
            }}
          />
          <div className="relative bg-zinc-900/95 backdrop-blur-xl border border-white/20 rounded-3xl p-8 w-full max-w-md text-white shadow-2xl">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-[rgb(182,255,62)] rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-black"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold mb-2">Install Haven Bank</h3>
              <p className="text-zinc-400 text-sm">
                Get the full app experience on your device
              </p>
            </div>

            <div className="space-y-4 mb-6">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 bg-[rgb(182,255,62)] rounded-full flex items-center justify-center text-black font-bold text-sm flex-shrink-0 mt-0.5">
                  1
                </div>
                <p className="text-sm text-zinc-300">
                  Tap the{" "}
                  <span className="font-semibold text-white">Share</span> icon
                  at the bottom of Safari
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 bg-[rgb(182,255,62)] rounded-full flex items-center justify-center text-black font-bold text-sm flex-shrink-0 mt-0.5">
                  2
                </div>
                <p className="text-sm text-zinc-300">
                  Scroll down and select{" "}
                  <span className="font-semibold text-white">
                    "Add to Home Screen"
                  </span>
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 bg-[rgb(182,255,62)] rounded-full flex items-center justify-center text-black font-bold text-sm flex-shrink-0 mt-0.5">
                  3
                </div>
                <p className="text-sm text-zinc-300">
                  Tap <span className="font-semibold text-white">"Add"</span> to
                  install Haven Bank on your home screen
                </p>
              </div>
            </div>

            <button
              className="w-full rounded-2xl bg-[rgb(182,255,62)] text-black px-6 py-4 font-bold text-lg hover:bg-[rgb(182,255,62)]/90 transition-colors"
              onClick={() => {
                setShowIOSHelp(false);
                onDone?.();
              }}
            >
              Got it!
            </button>
          </div>
        </div>
      )}
    </>
  );
}
