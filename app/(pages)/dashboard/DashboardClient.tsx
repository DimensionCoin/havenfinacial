"use client";

import PendingEmailClaims from "@/components/shared/PendingEmailClaims";
import { Section } from "lucide-react";
import nextDynamic from "next/dynamic";

function HeroSkeleton() {
  return (
    <div className="mb-2">
      <div className="h-5 w-44 bg-white/10 rounded mb-2 animate-pulse" />
      <div className="h-6 w-32 bg-white/10 rounded animate-pulse" />
    </div>
  );
}
function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-6 animate-pulse">
      <div className="h-4 w-24 bg-white/10 rounded mb-3" />
      <div className="h-8 w-40 bg-white/10 rounded" />
    </div>
  );
}

const Hero = nextDynamic(() => import("@/components/dash/Hero"), {
  ssr: false,
  loading: () => <HeroSkeleton />,
});

const AccountsCarousel = nextDynamic(
  () => import("@/components/dash/AccountsCarousel"),
  { ssr: false }
);

const DepositAccount = nextDynamic(
  () => import("@/components/dash/DepositAccount"),
  { ssr: false, loading: () => <CardSkeleton /> }
);

const SavingsAccount = nextDynamic(
  () => import("@/components/dash/SavingsAccountCard"),
  { ssr: false, loading: () => <CardSkeleton /> }
);

const InvestAccount = nextDynamic(
  () => import("@/components/dash/InvestAccount"),
  { ssr: false, loading: () => <CardSkeleton /> }
);

export default function DashboardClient() {
  return (
    <main className="py-3 px-4 space-y-4">
      <div>
        <p className="text-white font-semibold text-2xl">Welcome to Haven</p>
        <PendingEmailClaims />

        {/* Accounts (horizontal) */}
        <AccountsCarousel title="Accounts">
          <DepositAccount />
          <SavingsAccount />
        </AccountsCarousel>

        {/* Invest below */}
        <section className="space-y-2 mt-4">
          <h2 className="text-sm font-semibold text-white/80">Invest</h2>
          <InvestAccount />
        </section>
        <section className="mt-8">
          <Hero />
        </section>
      </div>
    </main>
  );
}
