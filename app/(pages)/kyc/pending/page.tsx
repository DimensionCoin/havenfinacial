"use client";

import Link from "next/link";
import Image from "next/image";

export default function KycPending() {
  return (
    <main className="relative min-h-[100svh] bg-black/50 text-white overflow-hidden">
      {/* Ambient background */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(60%_40%_at_80%_10%,rgba(182,255,62,0.08),transparent),radial-gradient(40%_30%_at_10%_80%,rgba(182,255,62,0.06),transparent)]" />
        <div className="absolute inset-0 opacity-[0.05] [background:linear-gradient(rgba(255,255,255,0.15)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.15)_1px,transparent_1px)] [background-size:28px_28px]" />
      </div>

      <div className="pwa-top-offset">
        <section className="container mx-auto max-w-6xl px-6 py-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
            {/* Left: copy + actions */}
            <div className="order-2 lg:order-1">
              {/* Status pill */}
              <div className="inline-flex items-center gap-2 rounded-full border border-[rgb(182,255,62)]/30 bg-[rgb(182,255,62)]/10 px-3 py-1 text-xs text-[rgb(182,255,62)]">
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M12 2l7 3v6c0 5-3.4 9.7-7 11-3.6-1.3-7-6-7-11V5l7-3z"
                  />
                </svg>
                <span className="font-medium">Identity review pending</span>
              </div>

              <h1 className="mt-4 text-3xl md:text-4xl font-extrabold tracking-tight leading-[1.05]">
                We’re verifying your details
              </h1>

              <p className="mt-3 text-white/70">
                For your security (and to comply with regulations), we review
                basic info before enabling full access. This usually takes just
                a few minutes. If we need anything else, we’ll let you know.
              </p>

              {/* Why you're here */}
              <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <h2 className="text-sm font-semibold mb-2">Why this step?</h2>
                <ul className="space-y-2 text-sm text-white/75">
                  <li className="flex items-start gap-2">
                    <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-[rgb(182,255,62)]" />
                    Verify your identity to protect your account and funds.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-[rgb(182,255,62)]" />
                    Meet banking and anti-fraud requirements.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-[rgb(182,255,62)]" />
                    Unlock transfers, higher limits, and yield features.
                  </li>
                </ul>
              </div>

              {/* What you can do */}
              <div className="mt-6">
                <h3 className="text-sm font-semibold mb-2">
                  Finish onboarding
                </h3>
                <p className="text-sm text-white/70 mb-4">
                  If you haven’t completed your details yet, finish them now to
                  speed up approval.
                </p>

                <div className="flex flex-wrap gap-3">
                  <Link
                    href="/onboarding"
                    className="inline-flex items-center justify-center rounded-2xl px-6 py-3 text-sm font-semibold bg-[rgb(182,255,62)] hover:bg-[rgb(182,255,62)]/90 text-black shadow-lg shadow-[rgb(182,255,62)]/30 transition"
                  >
                    Finish onboarding
                  </Link>

                </div>

                <p className="mt-4 text-xs text-white/50">
                  Need help?{" "}
                  <Link
                    href="/support"
                    className="underline underline-offset-4 hover:text-white/80"
                  >
                    Contact support
                  </Link>
                  . We respond quickly.
                </p>
              </div>

              {/* Timeline */}
              <div className="mt-8">
                <h3 className="text-sm font-semibold mb-3">
                  What happens next
                </h3>
                <ol className="space-y-3">
                  {[
                    [
                      "We review your info",
                      "Usually minutes, sometimes longer during peak times.",
                    ],
                    [
                      "We’ll email if we need anything",
                      "You can update missing details any time.",
                    ],
                    [
                      "You’re approved",
                      "We’ll enable full access automatically.",
                    ],
                  ].map(([title, sub], i) => (
                    <li key={i} className="flex items-start gap-3">
                      <div className="flex-shrink-0 mt-0.5 h-6 w-6 rounded-full border border-[rgb(182,255,62)]/40 bg-[rgb(182,255,62)]/10 text-[rgb(182,255,62)] grid place-items-center text-xs">
                        {i + 1}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{title}</p>
                        <p className="text-xs text-white/60">{sub}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            {/* Right: responsive imagery */}
            <div className="order-1 lg:order-2">
              <div className="relative w-full max-w-[560px] mx-auto">
                {/* Collage frame */}
                <div className="relative aspect-[4/3] rounded-3xl border border-white/10 bg-white/[0.04] overflow-hidden">
                  {/* subtle glow */}
                  <div
                    className="absolute -inset-6 rounded-[2rem] bg-[rgb(182,255,62)]/10 blur-2xl"
                    aria-hidden
                  />
                  {/* stacked device-style previews */}
                  <div className="absolute left-[6%] top-[8%] w-[42%] aspect-[9/16] rotate-[-6deg] overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/40">
                    <Image
                      src="/app-hero-1.png"
                      alt="Identity review illustration"
                      fill
                      sizes="(max-width: 1024px) 40vw, 20vw"
                      className="object-cover"
                      priority={false}
                    />
                  </div>
                  <div className="absolute left-[46%] top-[2%] w-[38%] aspect-[9/16] rotate-[5deg] overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/40">
                    <Image
                      src="/app-hero-2.png"
                      alt="Secure account preview"
                      fill
                      sizes="(max-width: 1024px) 40vw, 18vw"
                      className="object-cover"
                    />
                  </div>
                  <div className="absolute right-[6%] top-[22%] w-[40%] aspect-[9/16] rotate-[-2deg] overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/40 hidden md:block">
                    <Image
                      src="/app-hero-3.png"
                      alt="KYC success preview"
                      fill
                      sizes="(max-width: 1024px) 40vw, 18vw"
                      className="object-cover"
                    />
                  </div>

                  {/* dark scrim to keep text readable when stacked on small screens */}
                  <div
                    className="absolute inset-0 rounded-3xl bg-gradient-to-b from-black/30 via-transparent to-black/40"
                    aria-hidden
                  />
                </div>

                <p className="mt-3 text-center text-xs text-white/55">
                  Bank-grade encryption. Private by default.
                </p>
              </div>
            </div>
          </div>

          {/* Bottom reassurance card */}
          <div className="mt-10 mx-auto max-w-3xl rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl px-5 py-4 text-sm text-white/70 text-center">
            Your information is encrypted in transit and at rest. We only use it
            to verify your identity and protect your account.
          </div>
        </section>
      </div>
    </main>
  );
}
