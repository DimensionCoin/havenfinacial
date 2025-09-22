"use client";

export const dynamic = "force-static";

import type React from "react";
import Header from "@/components/shared/Header";
import { UserProvider } from "@/providers/UserProvider";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <UserProvider>
        <div className="">
          <Header />
        </div>
        <div className="">{children}</div>
      </UserProvider>
    </div>
  );
}
