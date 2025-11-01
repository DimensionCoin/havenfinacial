"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

/**
 * Blocker
 * - Full-screen modal overlay that cannot be closed.
 * - Blurs whatever is behind it (backdrop-blur).
 * - Auto-detects the current page name from the URL and shows a message.
 * - Provides a button to return to /dashboard.
 * - Add this component to any page to block interaction until removed by the team.
 *
 * Optional props allow manual override of the title/message if desired.
 */
type BlockerProps = {
  /** Override the detected page name (e.g., "Invest"). Defaults to the last URL segment. */
  pageNameOverride?: string;
  /** Optional custom headline. Defaults to "This page isn't ready yet." */
  headlineOverride?: string;
  /** Optional description override beneath the headline. */
  descriptionOverride?: string;
};

export default function Blocker({
  pageNameOverride,
  headlineOverride,
  descriptionOverride,
}: BlockerProps) {
  const pathname = usePathname();
  const router = useRouter();

  // Prevent background scrolling while blocker is mounted
  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Derive a human-friendly page name from the URL (last non-empty segment)
  const pageName = React.useMemo(() => {
    if (pageNameOverride?.trim()) return pageNameOverride.trim();

    // Fallbacks for root or dashboard
    if (!pathname || pathname === "/") return "Home";
    const segments = pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? "Page";

    // Convert kebab/slug to Title Case (e.g., "investment-plans" -> "Investment Plans")
    const titled = last
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (m) => m.toUpperCase());

    // If we’re on /dashboard specifically, say "Dashboard"
    if (last.toLowerCase() === "dashboard") return "Dashboard";
    return titled || "Page";
  }, [pathname, pageNameOverride]);

  const headline =
    headlineOverride ?? `The ${pageName.toLowerCase()} page isn’t ready yet.`;

  const description =
    descriptionOverride ??
    `We’re still building this experience. Thanks for your patience—check back soon!`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="blocker-title"
      aria-describedby="blocker-desc"
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      // Ensure all pointer events are captured here (blocking the page)
    >
      {/* Backdrop with blur + dim */}
      <div className="absolute inset-0 bg-black/10 backdrop-blur-md" />

      {/* Content card */}
      <div className="relative mx-4 w-full max-w-lg rounded-2xl border border-white/10 bg-black/70 p-8 shadow-2xl">
        <div className="mb-6">
          <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-white/70" />
            <span className="text-xs uppercase tracking-wider text-white/70">
              Under Construction
            </span>
          </div>
        </div>

        <h1
          id="blocker-title"
          className="mb-3 text-2xl font-semibold text-white"
        >
          {headline}
        </h1>

        <p id="blocker-desc" className="mb-8 text-white/80">
          {description}
        </p>

        <div className="flex items-center gap-3">
          {/* Primary action: take user to dashboard */}
          <Link
            href="/dashboard"
            prefetch
            className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/90 px-4 py-2 text-sm font-medium text-black transition hover:bg-white"
            onClick={(e) => {
              // Ensure it navigates even if Link prefetch is disabled
              e.preventDefault();
              router.push("/dashboard");
            }}
          >
            Go to Dashboard
          </Link>

          {/* Secondary text hint (non-interactive) */}
          <span className="text-sm text-white/60">
            You can safely leave this page.
          </span>
        </div>

        {/* No close button by design. This overlay persists until removed from the page. */}
      </div>
    </div>
  );
}
