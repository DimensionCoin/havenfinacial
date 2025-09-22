// app/(pages)/dashboard/page.tsx  — Server Component
export const dynamic = "force-static"; // or remove/export a different route option if you prefer

import type { Metadata } from "next";
import DashboardClient from "./DashboardClient";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your Haven balance and actions.",
};

export default function DashboardPage() {
  // Render the client-only wrapper
  return <DashboardClient />;
}
