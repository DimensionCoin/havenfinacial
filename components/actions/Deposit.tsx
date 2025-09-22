// app/components/actions/Deposit.tsx
"use client";

import { useCallback } from "react";
import QRCode from "react-qr-code";
import { useUser } from "@/providers/UserProvider";

const looksSol = (a: unknown): a is string =>
  typeof a === "string" &&
  a.length >= 32 &&
  a.length <= 64 &&
  /^[1-9A-HJ-NP-Za-km-z]+$/.test(a);

function mask(addr?: string | null) {
  if (!addr || addr.length < 4) return "****-****-0000";
  return `****-****-${addr.slice(-4)}`;
}

export default function Deposit() {
  const { user } = useUser();
  const walletAddress =
    user?.depositWallet?.address ??
    (user &&
    typeof user === "object" &&
    "walletAddress" in user &&
    typeof (user as Record<string, unknown>).walletAddress === "string"
      ? ((user as Record<string, unknown>).walletAddress as string)
      : null);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.error("Clipboard failed", e);
    }
  }, []);

  if (!looksSol(walletAddress)) {
    return (
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white">
        <header className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold">Crypto deposit</h3>
        </header>
        <p className="text-sm text-white/70">
          You don’t have a deposit wallet yet. Finish onboarding to get your
          Solana deposit address and QR code.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-black/20 backdrop-blur-xl p-5 md:p-6 text-white shadow-2xl hover:border-[rgb(182,255,62)]/30 transition-all duration-300">
      <div className="flex flex-col md:flex-row items-start md:items-start justify-between gap-5 md:gap-6">
        {/* Left: instructions + address */}
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-3 h-3 rounded-full bg-[rgb(182,255,62)]" />
            <h3 className="text-lg font-semibold text-white">Deposit</h3>
          </div>

          {/* Warning */}
          <div className="mt-1 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2">
            <p className="text-sm text-red-200">
              <strong className="text-red-300">Important:</strong> Send{" "}
              <span className="font-semibold text-white">
                USDC on Solana (SPL)
              </span>{" "}
              only. Do <em>not</em> send USDC from other networks (Ethereum,
              Polygon, etc.) or any other assets to this address — funds may be
              lost.
            </p>
          </div>

          {/* Steps */}
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-white/85">
            <li>Open your wallet app (e.g., Phantom or Solflare).</li>
            <li>
              Tap <span className="font-medium">Send / Transfer</span>.
            </li>
            <li>
              Select <span className="font-medium">USDC</span> on{" "}
              <span className="font-medium">Solana</span> (SPL).
            </li>
            <li>
              Scan the QR or paste the address below as the{" "}
              <span className="font-medium">recipient</span>.
            </li>
            <li>
              Double-check the last characters match{" "}
              <span className="font-mono">{mask(walletAddress)}</span>.
            </li>
            <li>Confirm and send. Consider a small test first.</li>
          </ol>

          {/* Address + copy */}
          <div className="mt-4 space-y-2">
            <div
              className="break-all rounded-lg border border-white/10 bg-white/5 p-3 font-mono text-xs text-white/90"
              title={walletAddress!}
            >
              {walletAddress}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => copy(walletAddress!)}
                className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs text-white/90 hover:bg-white/15 transition w-full sm:w-auto"
              >
                Copy address
              </button>
            </div>
          </div>
        </div>

        {/* Right: QR only encodes the raw address */}
        <div className="w-full md:w-auto shrink-0 rounded-2xl border border-white/10 bg-white/5 p-4 flex justify-center md:block mt-4 md:mt-0">
          {/* Mobile QR (slightly smaller) */}
          <div className="md:hidden">
            <QRCode
              value={walletAddress}
              size={152}
              aria-label="Deposit address QR (Solana address)"
            />
          </div>
          {/* Desktop QR */}
          <div className="hidden md:block">
            <QRCode
              value={walletAddress}
              size={196}
              aria-label="Deposit address QR (Solana address)"
            />
          </div>
        </div>
      </div>

      <div className="mt-4 text-xs text-zinc-500">
        Tip: Use the QR scanner inside your wallet app for best results.
      </div>
    </section>
  );
}
