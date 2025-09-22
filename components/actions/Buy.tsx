"use client";

import React, { useEffect, useState } from "react";
import { Info, ShieldCheck, FileText } from "lucide-react";
import Link from "next/link";

/**
 * Buy (Onramp) component
 * - Explains fiat → USDC via provider (e.g., Ramp Network)
 * - Shows legal terms and requires consent
 * - Renders the onramp widget area (placeholder here)
 */
export default function Buy() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Persisted consent gate (client-only)
  const CONSENT_KEY = "haven.depositConsent.v1";
  const [agreed, setAgreed] = useState(false);
  useEffect(() => {
    if (!mounted) return;
    try {
      const v = localStorage.getItem(CONSENT_KEY);
      setAgreed(v === "true");
    } catch {}
  }, [mounted]);
  const setAndPersistAgree = (val: boolean) => {
    setAgreed(val);
    try {
      localStorage.setItem(CONSENT_KEY, String(val));
    } catch {}
  };

  return (
    <div className="space-y-5">
      {/* Callout */}
      <div className="flex items-start gap-3 rounded-xl border border-[rgb(182,255,62)]/20 bg-[rgb(182,255,62)]/10 px-3 py-2.5">
        <Info className="mt-0.5" size={16} />
        <p className="text-sm text-white/85">
          Haven partners with{" "}
          <Link href={"https://ramp.network/"}>
            <span className="text-[rgb(182,255,62)] font-medium">
              Ramp Network
            </span>
          </Link>{" "}
          to process bank transfers securely. Funds are converted to{" "}
          <span className="text-white">USDC</span> and delivered to your Haven
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
              Complete the transfer in Ramp&apos;s secure flow. Deposits settle
              to your Haven account as USDC.
            </p>
            <ul className="mt-3 space-y-2 text-sm text-white/80">
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[rgb(182,255,62)]" />
                Availability varies by region and financial institution.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[rgb(182,255,62)]" />
                Fees, FX, and timing are determined by Ramp Network and your
                bank.
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
                Bank transfers are facilitated by our partner Ramp. By
                continuing, you agree to Ramp&apos;s{" "}
                <a
                  className="text-[rgb(182,255,62)] underline decoration-dotted underline-offset-2"
                  href="/legal/moonpay-terms"
                  target="_blank"
                  rel="noreferrer"
                >
                  Terms of Service
                </a>{" "}
                and{" "}
                <a
                  className="text-[rgb(182,255,62)] underline decoration-dotted underline-offset-2"
                  href="/legal/Ramp-privacy"
                  target="_blank"
                  rel="noreferrer"
                >
                  Privacy Policy
                </a>
                .
              </li>
              <li>
                Deposited funds are converted to USDC and transferred to your
                Haven wallet address.
              </li>
              <li>
                Fees, exchange rates, and settlement times are set by Ramp
                and/or your bank.
              </li>
              <li>
                Blockchain transactions are typically irreversible—verify the
                destination address before confirming.
              </li>
              <li>
                Haven is not a bank and does not custody your assets. See our{" "}
                <a
                  className="text-[rgb(182,255,62)] underline decoration-dotted underline-offset-2"
                  href="/legal/terms"
                  target="_blank"
                  rel="noreferrer"
                >
                  Terms
                </a>{" "}
                and{" "}
                <a
                  className="text-[rgb(182,255,62)] underline decoration-dotted underline-offset-2"
                  href="/legal/privacy"
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
                I’ve read and agree to the Deposit Terms and authorize Ramp
                Network to process my bank transfer.
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
            <div className="h-[360px] grid place-items-center text-sm text-white/70">
              {agreed
                ? "Onramp widget goes here"
                : "Accept terms to enable onramp"}
            </div>
            <div className="mt-2 text-[10px] text-white/50 text-center">
              Bank transfers are provided by Ramp.
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
