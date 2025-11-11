"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Info, ShieldCheck, FileText } from "lucide-react";
import Link from "next/link";
import { useUser } from "@/providers/UserProvider";

/* ----------------------------- helpers ----------------------------- */

/** Minimal allowlist to avoid passing unsupported fiat codes */
const SUPPORTED_FIAT = new Set([
  "USD",
  "CAD",
  "EUR",
  "GBP",
  "AUD",
  "NZD",
  "SGD",
  "JPY",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "MXN",
  "BRL",
  "CLP",
  "COP",
  "ARS",
  "TRY",
  "ILS",
  "AED",
  "HKD",
  "KRW",
  "ZAR",
  "INR",
]);

function normalizeFiat(displayCurrency?: string): string {
  const code = (displayCurrency || "USD").toUpperCase().trim();
  return SUPPORTED_FIAT.has(code) ? code : "USD";
}

/** Build Banxa referral URL for iframe usage (buy only, USDC on SOL) */
function buildBanxaUrl(opts: {
  sandbox: boolean;
  fiatType: string;
  fiatAmount?: number;
  walletAddress?: string;
  theme?: "dark" | "light";
  backgroundColor?: string; // hex without #
  primaryColor?: string; // hex without #
  secondaryColor?: string; // hex without #
  textColor?: string; // hex without #
  // If you have a configured callback on your Banxa account, it will be used.
  // Otherwise you can add your own public callback page and pass here:
  // returnUrl?: string;
}) {
  const base = opts.sandbox
    ? "https://buy.sandbox.banxa.com/"
    : "https://buy.banxa.com/";
  const u = new URL(base);

  // — Locked choices —
  u.searchParams.set("orderType", "buy");
  u.searchParams.set("coinType", "USDC");
  u.searchParams.set("blockchain", "SOL");

  // — User / UI passed params —
  u.searchParams.set("fiatType", opts.fiatType);
  if (
    Number.isFinite(opts.fiatAmount || NaN) &&
    (opts.fiatAmount as number) > 0
  ) {
    u.searchParams.set("fiatAmount", String(opts.fiatAmount));
  }
  if (opts.walletAddress)
    u.searchParams.set("walletAddress", opts.walletAddress);

  // Theming (all optional)
  if (opts.theme) u.searchParams.set("theme", opts.theme);
  if (opts.backgroundColor)
    u.searchParams.set("backgroundColor", opts.backgroundColor);
  if (opts.primaryColor) u.searchParams.set("primaryColor", opts.primaryColor);
  if (opts.secondaryColor)
    u.searchParams.set("secondaryColor", opts.secondaryColor);
  if (opts.textColor) u.searchParams.set("textColor", opts.textColor);

  // If you have a public callback page, you can optionally add it:
  // if (opts.returnUrl) u.searchParams.set("returnUrl", opts.returnUrl);

  return u.toString();
}

/* ------------------------------ component ------------------------------ */

export default function Buy() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { user } = useUser();

  // Persisted consent gate (client-only)
  const CONSENT_KEY = "haven.depositConsent.v1";
  const [agreed, setAgreed] = useState(false);
  useEffect(() => {
    if (!mounted) return;
    try {
      const v = localStorage.getItem(CONSENT_KEY);
      setAgreed(v === "true");
    } catch {
      /* ignore */
    }
  }, [mounted]);
  const setAndPersistAgree = (val: boolean) => {
    setAgreed(val);
    try {
      localStorage.setItem(CONSENT_KEY, String(val));
    } catch {
      /* ignore */
    }
  };

  // Amount input in user's fiat
  const userFiat = normalizeFiat(user?.displayCurrency);
  const [fiatAmount, setFiatAmount] = useState<string>("200");
  const fiatAmountNum = useMemo(() => {
    const n = Number.parseFloat(fiatAmount);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }, [fiatAmount]);

  // Your app’s SOL deposit address for the user (adjust to your schema)
  const depositWallet: string | undefined = (
    user as unknown as { depositWallet?: { address?: string } }
  )?.depositWallet?.address;

  // Choose sandbox via env or feature flag
  const sandbox = process.env.NEXT_PUBLIC_BANXA_ENV === "sandbox";

  // Build iframe URL when inputs change
  const iframeUrl = useMemo(
    () =>
      buildBanxaUrl({
        sandbox,
        fiatType: userFiat,
        fiatAmount: fiatAmountNum,
        walletAddress: depositWallet,
        theme: "dark",
        backgroundColor: "0b0b0b",
        primaryColor: "b6ff3e",
        secondaryColor: "84cc16",
        textColor: "ffffff",
        // returnUrl: typeof window !== "undefined" ? `${window.location.origin}/deposit/banxa/callback` : undefined,
      }),
    [sandbox, userFiat, fiatAmountNum, depositWallet]
  );

  return (
    <div className="space-y-5">
      {/* Callout */}
      <div className="flex items-start gap-3 rounded-xl border border-[rgb(182,255,62)]/20 bg-[rgb(182,255,62)]/10 px-3 py-2.5">
        <Info className="mt-0.5" size={16} />
        <p className="text-sm text-white/85">
          Haven partners with{" "}
          <Link href="https://banxa.com" target="_blank" rel="noreferrer">
            <span className="text-[rgb(182,255,62)] font-medium">Banxa</span>
          </Link>{" "}
          to process bank card and transfer deposits. Funds are converted to{" "}
          <span className="text-white">USDC</span> on{" "}
          <span className="text-white">Solana</span> and delivered to your Haven
          Deposit Account.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-5">
        {/* Left: explainer + legal */}
        <div className="md:col-span-3 space-y-4">
          <div>
            <h4 className="flex items-center gap-2 text-white font-semibold">
              <ShieldCheck size={16} />
              Add funds from your bank
            </h4>
            <p className="mt-1 text-sm text-white/70">
              Complete checkout inside Banxa. Your deposit will arrive as USDC
              on Solana.
            </p>
            <ul className="mt-3 space-y-2 text-sm text-white/80">
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[rgb(182,255,62)]" />
                Availability varies by region and payment method.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[rgb(182,255,62)]" />
                Fees, FX, and timing are determined by Banxa and your
                bank/provider.
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2 text-sm text-white/85">
              <FileText size={16} />
              <span className="font-semibold">Deposit Terms</span>
            </div>
            <ol className="mt-3 list-decimal pl-5 space-y-2 text-sm text-white/80">
              <li>
                By continuing, you agree to Banxa&apos;s{" "}
                <a
                  className="text-[rgb(182,255,62)] underline decoration-dotted underline-offset-2"
                  href="https://banxa.com/terms-of-use/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Terms of Use
                </a>{" "}
                and{" "}
                <a
                  className="text-[rgb(182,255,62)] underline decoration-dotted underline-offset-2"
                  href="https://banxa.com/privacy-policy/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Privacy Policy
                </a>
                .
              </li>
              <li>
                Deposits are auto-converted to USDC and sent to your Haven
                wallet address.
              </li>
              <li>
                Fees, exchange rates, and settlement times are set by Banxa
                and/or your bank.
              </li>
              <li>
                Blockchain transfers are typically irreversible—always verify
                your address.
              </li>
              <li>
                Haven is not a bank and does not custody your assets. See our{" "}
                <a
                  className="text-[rgb(182,255,62)] underline decoration-dotted underline-offset-2"
                  href="/tos"
                  target="_blank"
                  rel="noreferrer"
                >
                  Terms
                </a>{" "}
                and{" "}
                <a
                  className="text-[rgb(182,255,62)] underline decoration-dotted underline-offset-2"
                  href="/policy"
                  target="_blank"
                  rel="noreferrer"
                >
                  Privacy Notice
                </a>
                .
              </li>
            </ol>

            <label className="mt-3 flex items-start gap-3 text-sm text-white/85">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAndPersistAgree(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                I’ve read and agree to the Deposit Terms and authorize Banxa to
                process my payment.
              </span>
            </label>
          </div>
        </div>

        {/* Right: widget area with consent gate */}
        <div className="relative md:col-span-2">
          <div
            className={`rounded-xl border border-white/10 bg-white/5 p-3 transition ${
              !agreed ? "opacity-50" : ""
            }`}
          >
            {/* Amount input */}
            <div className="mb-3">
              <label className="block text-[11px] text-white/60 mb-1">
                Deposit amount ({userFiat})
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={fiatAmount}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "" || /^\d*\.?\d*$/.test(v)) setFiatAmount(v);
                }}
                placeholder={`0.00 ${userFiat}`}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-[rgb(182,255,62)]/50"
              />
              <div className="mt-2 flex gap-2">
                {["100", "200", "500"].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setFiatAmount(preset)}
                    className="px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-white/70 text-xs hover:bg-white/10"
                  >
                    {preset} {userFiat}
                  </button>
                ))}
              </div>
              <div className="mt-2 text-[10px] text-white/50">
                Coin: <span className="text-white">USDC</span> · Network:{" "}
                <span className="text-white">Solana</span>
              </div>
            </div>

            <div className="h-[360px] grid place-items-center text-sm text-white/70 overflow-hidden rounded-lg">
              {agreed ? (
                depositWallet ? (
                  <iframe
                    key={iframeUrl}
                    src={iframeUrl}
                    title="Banxa On/Off Ramp"
                    allow="camera; microphone; clipboard-write; autoplay; payment"
                    sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
                    className="w-full h-full rounded-lg border border-white/10"
                  />
                ) : (
                  <div>Please create your Deposit Account first.</div>
                )
              ) : (
                "Accept terms to enable onramp"
              )}
            </div>

            <div className="mt-2 text-[10px] text-white/50 text-center">
              Payments are provided by Banxa.
            </div>
          </div>

          {!agreed && (
            <div className="absolute inset-0 grid place-items-center rounded-xl bg-black/40 backdrop-blur-sm">
              <div className="text-center">
                <p className="text-sm text-white/80">
                  Please accept the Deposit Terms to enable bank deposits.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
