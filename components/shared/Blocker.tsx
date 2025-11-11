"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

type BlockerProps = {
  pageNameOverride?: string;
  headlineOverride?: string;
  descriptionOverride?: string;
  primaryCtaLabelOverride?: string;
};

export default function Blocker({
  pageNameOverride,
  headlineOverride,
  descriptionOverride,
  primaryCtaLabelOverride,
}: BlockerProps) {
  const [dismissed, setDismissed] = React.useState(false);
  const pathname = usePathname();

  // Lock body scroll only while NOT dismissed
  React.useEffect(() => {
    if (dismissed) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [dismissed]);

  const pageName = React.useMemo(() => {
    if (pageNameOverride && pageNameOverride.trim()) {
      return pageNameOverride.trim();
    }

    if (!pathname || pathname === "/") return "Home";
    const segments = pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? "Page";

    const titled = last
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (m) => m.toUpperCase());

    if (last.toLowerCase() === "dashboard") return "Dashboard";
    return titled || "Page";
  }, [pathname, pageNameOverride]);

  const headline =
    headlineOverride ?? `The ${pageName.toLowerCase()} page is not ready yet.`;

  const description =
    descriptionOverride ??
    "You are seeing a work in progress version of this page. Some functionality may be missing or not working yet.";

  const primaryCtaLabel = primaryCtaLabelOverride ?? `Proceed to ${pageName}`;

  // Component stays mounted but renders nothing once dismissed
  if (dismissed) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="blocker-title"
      aria-describedby="blocker-desc"
      className="fixed inset-0 z-[9999] flex items-center justify-center"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-md" />

      {/* Card */}
      <div className="relative mx-4 w-full max-w-lg rounded-2xl border border-white/10 bg-black/80 p-8 shadow-2xl">
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

        <p id="blocker-desc" className="mb-8 text-white/80 text-sm">
          {description}
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/90 px-4 py-2 text-sm font-medium text-black transition hover:bg-white"
          >
            {primaryCtaLabel}
          </button>

          <span className="text-xs text-white/60">
            You can explore this page, but it may not be fully functional yet.
          </span>
        </div>
      </div>
    </div>
  );
}
