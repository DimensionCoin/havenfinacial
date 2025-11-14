"use client";

export const dynamic = "force-static";

import type React from "react";
import Header from "@/components/shared/Header";
import { UserProvider } from "@/providers/UserProvider";
import { BalanceProvider } from "@/providers/BalanceProvider";
import Wrapper from "@/components/shared/Wrapper"; // 👈 add this

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <UserProvider>
        <BalanceProvider /* autoRefreshMs={30000} optional */>
          {/* 👇 Wrapper has access to useUser and runs on every page load */}
          <Wrapper />

          <div>
            <Header />
          </div>
          <div>{children}</div>
        </BalanceProvider>
      </UserProvider>
    </div>
  );
}
