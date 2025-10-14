"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import WalletHoldings from "@/components/invest/WalletHoldings";
import TokenCatalog from "@/components/invest/TokenCatalog";
import {
  Wallet,
  ShoppingCart,
  TrendingUp,
  HelpCircle,
 
} from "lucide-react";

/**
 * InvestmentApp (Pro)
 * - Mobile-first, professional layout
 * - Sticky, compact header with segmented tabs
 * - Clear calls-to-action and helpful context
 * - Responsive two-column content on desktop; single column on mobile
 *
 * Notes:
 * - Reuses your existing TokenCatalog and WalletHoldings.
 * - “Discover” is the default landing for new users; “Portfolio” shows holdings.
 * - The right column shows optional “Pro tips” & quick links, stays readable.
 */

export default function InvestmentApp() {
  const [activeTab, setActiveTab] = useState<"discover" | "portfolio">(
    "discover"
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-black/50 via-black/40 to-black/10">
      {/* Sticky Header */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-black/30 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-white/5 border border-white/10 grid place-items-center">
                <TrendingUp className="h-4 w-4 text-[rgb(182,255,62)]" />
              </div>
              <div className="truncate">
                <h1 className="truncate text-base sm:text-lg font-bold text-white">
                  Invest
                </h1>
                <p className="text-[11px] sm:text-xs text-white/60">
                  Buy, hold, and manage your assets like a pro.
                </p>
              </div>
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Segmented Tabs */}
            <div className="rounded-full bg-white/5 border border-white/10 p-1 flex">
              <TabChip
                isActive={activeTab === "discover"}
                onClick={() => setActiveTab("discover")}
                icon={<ShoppingCart className="h-4 w-4" />}
                label="Discover"
              />
              <TabChip
                isActive={activeTab === "portfolio"}
                onClick={() => setActiveTab("portfolio")}
                icon={<Wallet className="h-4 w-4" />}
                label="Portfolio"
              />
            </div>

            {/* Header Controls (optional) */}
            <div className="hidden sm:flex items-center gap-2 pl-2">
              
              <Button
                variant="ghost"
                className="h-9 rounded-xl border border-white/10 bg-white/5 text-white/80 hover:text-white hover:bg-white/10"
                asChild
              >
                <Link href="/help/investing">
                  <HelpCircle className="mr-2 h-4 w-4" />
                  Help
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8">

        {activeTab === "discover" ? (
          /* Discover: primary flow is exploring & buying */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <section className="lg:col-span-2 space-y-6">
              {/* Token Catalog: professional card grid with inline buy */}
              <TokenCatalog />
            </section>

            {/* Right rail: Pro Tips / Shortcuts */}
            <aside className="space-y-6">
              <SideCard title="Pro Tips">
                <ul className="space-y-3 text-sm text-white/70">
                  <li>
                    • Amounts are shown in your display currency; you&apos;ll
                    see exactly how much you’re buying before confirming.
                  </li>
                  <li>• Live quotes refresh automatically while you type.</li>
                  <li>• Fixed processing fee shown up front—no surprises.</li>
                  <li>
                    • You can always tap a token to view its dedicated chart
                    page.
                  </li>
                </ul>
              </SideCard>
            </aside>
          </div>
        ) : (
          /* Portfolio: holdings first, then context */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <section className="lg:col-span-2 space-y-6">
              {/* Your existing holdings component already computes totals, fx, etc. */}
              <WalletHoldings />

              {/* Optional: add-on card for clarity */}
              <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-xl p-4 sm:p-5">
                <h3 className="text-white font-semibold mb-2">
                  How your balance updates
                </h3>
                <p className="text-white/70 text-sm">
                  Prices and FX refresh automatically. If you complete a trade,
                  tap
                  <span className="mx-1 rounded-md border border-white/20 bg-white/10 px-2 py-0.5 text-xs">
                    Refresh
                  </span>
                  to pull the latest balances.
                </p>
              </div>
            </section>

            <aside className="space-y-6">
              <SideCard title="Resources">
                <div className="flex flex-col gap-2">
                  <QuickLink href="/help/investing" label="Investing 101" />
                  <QuickLink href="/help/fees" label="Fees explained" />
                  <QuickLink href="/help/security" label="Security basics" />
                </div>
              </SideCard>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

/* ------------------------------- UI bits -------------------------------- */

function TabChip({
  isActive,
  onClick,
  icon,
  label,
}: {
  isActive: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition
      ${
        isActive
          ? "bg-[rgb(182,255,62)]/20 text-[rgb(182,255,62)] border border-[rgb(182,255,62)]/30 shadow-[0_0_20px_rgba(182,255,62,0.25)]"
          : "text-white/70 hover:text-white hover:bg-white/10 border border-transparent"
      }`}
      aria-pressed={isActive}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SideCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-xl p-4 sm:p-5">
      <h3 className="text-white font-semibold mb-2">{title}</h3>
      <div>{children}</div>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:text-white hover:bg-white/10 transition"
    >
      {label}
    </Link>
  );
}
