"use client";

export const dynamic = "force-static";

import type React from "react";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <div>{children}</div>
    </div>
  );
}
