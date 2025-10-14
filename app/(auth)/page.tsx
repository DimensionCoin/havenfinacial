"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";

/* Content */
const QUOTES = [
  {
    pill: "Everything",
    headlineTop: "money",
    headlineBottom: "in one solution",
    lines: ["Make your money work harder.", "Up to 8% on savings deposits."],
  },
  {
    pill: "Smarter",
    headlineTop: "finance",
    headlineBottom: "for real life",
    lines: ["Instant transfers. Real yield.", "Security you can feel."],
  },
  {
    pill: "Effortless",
    headlineTop: "saving",
    headlineBottom: "and earning",
    lines: ["Automate in seconds.", "Watch it compound."],
  },
];

const IMAGES = [
  { src: "/app-hero-1.png", alt: "Haven app preview 1" },
  { src: "/app-hero-2.png", alt: "Haven app preview 2" },
  { src: "/app-hero-3.png", alt: "Haven app preview 3" },
];

const AUTO_MS = 15000;

export default function Landing() {
  const [idx, setIdx] = useState(0);
  const slide = QUOTES[idx];

  const next = () => setIdx((i) => (i + 1) % QUOTES.length);
  const prev = () => setIdx((i) => (i - 1 + QUOTES.length) % QUOTES.length);

  // Auto-advance
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(next, AUTO_MS);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  // Swipe
  const startX = useRef<number | null>(null);
  const endX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    endX.current = null;
    startX.current = e.targetTouches[0].clientX;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    endX.current = e.targetTouches[0].clientX;
  };
  const onTouchEnd = () => {
    const s = startX.current;
    const e = endX.current;
    if (s == null || e == null) return;
    const dx = e - s;
    const THRESH = 40;
    if (dx > THRESH) prev();
    if (dx < -THRESH) next();
  };

  return (
    <main className="min-h-[100svh] bg-black/90 text-white relative overflow-hidden">
      {/* Global BG glow */}
      <div className="fixed inset-0 -z-50">
        <div className="absolute inset-0 bg-[radial-gradient(60%_40%_at_80%_10%,rgba(182,255,62,0.08),transparent),radial-gradient(40%_30%_at_10%_80%,rgba(182,255,62,0.06),transparent)]" />
      </div>

      <div className="pwa-top-offset">
        {/* Top nav */}
        <header className="container mx-auto max-w-6xl px-6 py-6 flex items-center justify-between">
          <div className="text-xl font-bold tracking-tight">Haven</div>
          <nav className="flex items-center gap-3">
            <Link href="/sign-in">
              <div className="items-center rounded-full px-6 py-3 text-sm font-medium bg-white/10 hover:bg-white/20 border border-white/20 backdrop-blur-md transition">
                Sign in
              </div>
            </Link>
            <Link href="/sign-up">
              <div className="items-center rounded-full px-6 py-3 text-sm font-medium bg-white/10 hover:bg-white/20 border border-white/20 backdrop-blur-md transition">
                Sign up
              </div>
            </Link>
          </nav>
        </header>

        {/* Hero */}
        <section
          className="relative container mx-auto max-w-6xl px-6 pt-4 md:pt-10 pb-20 md:pb-28 select-none"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* Collage sits behind the text */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[52%] w-[130vw] md:w-[95vw] max-w-[1400px] z-0"
          >
            <div className="relative aspect-[16/9]">
              {/* Ambient green glow (under) */}
              <div className="absolute -inset-8 rounded-[3rem] bg-[rgb(182,255,62)]/12 blur-3xl" />

              {/* TILES: keep crisp */}
              <div className="relative z-0">
                <div className="absolute left-[6%] top-[6%] w-[26%] aspect-[9/16] rotate-[-6deg] overflow-hidden rounded-3xl border border-white/10 shadow-2xl shadow-black/40">
                  <div className="relative h-full w-full">
                    <Image
                      src={IMAGES[0].src}
                      alt={IMAGES[0].alt}
                      fill
                      sizes="(max-width: 768px) 40vw, 26vw"
                      className="object-cover"
                      priority
                    />
                  </div>
                </div>

                <div className="absolute left-[38%] top-[2%] w-[24%] aspect-[9/16] rotate-[4deg] overflow-hidden rounded-3xl border border-white/10 shadow-2xl shadow-black/40">
                  <div className="relative h-full w-full">
                    <Image
                      src={IMAGES[1].src}
                      alt={IMAGES[1].alt}
                      fill
                      sizes="(max-width: 768px) 36vw, 24vw"
                      className="object-cover"
                    />
                  </div>
                </div>

                <div className="absolute right-[6%] top-[10%] w-[26%] aspect-[9/16] rotate-[-2deg] overflow-hidden rounded-3xl border border-white/10 shadow-2xl shadow-black/40">
                  <div className="relative h-full w-full">
                    <Image
                      src={IMAGES[2].src}
                      alt={IMAGES[2].alt}
                      fill
                      sizes="(max-width: 768px) 40vw, 26vw"
                      className="object-cover"
                    />
                  </div>
                </div>
              </div>

              {/* Dark overlays ABOVE tiles for text contrast */}
              <div className="absolute inset-0 z-10 rounded-[3rem] bg-black/25 md:bg-black/30 mix-blend-normal" />
              <div className="absolute inset-0 z-10 rounded-[3rem] bg-gradient-to-b from-black/60 via-transparent to-black/70" />
            </div>
          </div>

          {/* Text overlay with a small local scrim directly behind the text */}
          <div className="relative z-20 mx-auto max-w-3xl min-h-[60svh] md:min-h-[68svh] flex items-center justify-center text-center">
            <div className="relative w-full px-3 md:px-4">
              {/* Local scrim only under the text block */}
              <div
                aria-hidden
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[102%] md:w-[105%] h-[105%] md:h-[110%] rounded-[2rem] bg-black/28 md:bg-black/26 backdrop-brightness-90 backdrop-contrast-110"
              />

              {/* Pill */}
              <span className="relative inline-flex items-center rounded-full border border-[rgb(182,255,62)]/35 bg-[rgb(182,255,62)]/15 px-4 py-1.5 text-[26px] md:text-[38px] font-extrabold tracking-tight drop-shadow-[0_2px_10px_rgba(0,0,0,0.65)]">
                <span className="translate-y-[1px]">{slide.pill}</span>
              </span>

              {/* Headline */}
              <h1 className="relative mt-5 font-extrabold tracking-[-0.02em] leading-[0.95] text-[44px] sm:text-[58px] md:text-[76px] drop-shadow-[0_5px_26px_rgba(0,0,0,0.6)]">
                {slide.headlineTop}
                <br />
                {slide.headlineBottom}
              </h1>

              {/* Value props */}
              <div className="relative mt-4 space-y-1.5 md:space-y-2 text-white/95 text-[15px] md:text-lg drop-shadow-[0_3px_16px_rgba(0,0,0,0.6)]">
                {slide.lines.map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </div>

              {/* Dots */}
              <div className="relative mt-4 flex items-center justify-center gap-2">
                {QUOTES.map((_, i) => (
                  <button
                    key={i}
                    aria-label={`Go to slide ${i + 1}`}
                    onClick={() => setIdx(i)}
                    className={`transition-all ${
                      i === idx
                        ? "w-6 h-1.5 rounded-full bg-[rgb(182,255,62)]"
                        : "w-1.5 h-1.5 rounded-full bg-white/40"
                    }`}
                  />
                ))}
              </div>

              {/* CTA row */}
              <div className="relative mt-6 flex items-center justify-center gap-5">
                <button
                  onClick={next}
                  className="group inline-flex items-center justify-center h-16 w-16 md:h-[4.5rem] md:w-[4.5rem] rounded-full bg-[rgb(182,255,62)]/18 border border-[rgb(182,255,62)]/40 hover:border-[rgb(182,255,62)]/60 hover:bg-[rgb(182,255,62)]/24 transition relative"
                  aria-label="Next"
                >
                  <span className="absolute inset-0 rounded-full pointer-events-none bg-[radial-gradient(circle_at_50%_20%,rgba(182,255,62,0.25),transparent_60%)]" />
                  <svg
                    className="w-7 h-7 text-[rgb(182,255,62)] transition-transform group-hover:translate-x-0.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 12h14m-6-6l6 6-6 6"
                    />
                  </svg>
                </button>

                <Link
                  href="/sign-up"
                  className="inline-flex items-center justify-center rounded-2xl px-6 py-3 text-sm font-semibold bg-[rgb(182,255,62)] hover:bg-[rgb(182,255,62)]/90 text-black shadow-lg shadow-[rgb(182,255,62)]/30 transition"
                >
                  Get started
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Slim value band */}
        <section className="px-6 pb-14">
          <div className="mx-auto max-w-4xl rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl px-5 py-4 text-sm text-white/70 text-center">
            Everything money in one place — spending, saving, and real yield up
            to <span className="text-[rgb(182,255,62)] font-semibold">8%</span>.
          </div>
        </section>
      </div>
    </main>
  );
}
