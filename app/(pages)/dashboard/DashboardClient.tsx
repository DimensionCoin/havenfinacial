"use client";

import nextDynamic from "next/dynamic";

// Lightweight client-only skeletons shown while chunks load
function HeroSkeleton() {
  return (
    <div className="mb-4 rounded-2xl border border-white/10 bg-black/20 p-6 animate-pulse">
      <div className="h-5 w-40 bg-white/10 rounded mb-3" />
      <div className="h-8 w-64 bg-white/10 rounded" />
    </div>
  );
}
function DepositSkeleton() {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-6 animate-pulse">
      <div className="h-5 w-24 bg-white/10 rounded mb-4" />
      <div className="h-9 w-56 bg-white/10 rounded mb-2" />
      <div className="h-9 w-40 bg-white/10 rounded" />
    </div>
  );
}

const Hero = nextDynamic(() => import("@/components/dash/Hero"), {
  ssr: false,
  loading: () => <HeroSkeleton />,
});

const DepositAccount = nextDynamic(
  () => import("@/components/dash/DepositAccount"),
  {
    ssr: false,
    loading: () => <DepositSkeleton />,
  }
);

const SavingsAccount = nextDynamic(
  () => import("@/components/dash/SavingsAccountCard"),
  {
    ssr: false,
    loading: () => <DepositSkeleton />,
  }
);

const InvestAccount = nextDynamic(
  () => import("@/components/dash/InvestAccount"),
  {
    ssr: false,
    loading: () => <DepositSkeleton />,
  }
);

export default function DashboardClient() {
  return (
    <main className="py-3 px-4">
      <Hero />
      <div className="mt-2 space-y-8">
        <DepositAccount />
        <SavingsAccount />
        <InvestAccount />
      </div>
    </main>
  );
}
