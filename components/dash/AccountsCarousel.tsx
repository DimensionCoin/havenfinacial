"use client";

import type React from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type AccountsCarouselProps = {
  children: React.ReactNode; // e.g. <DepositAccount/>, <SavingsAccount/>
  className?: string;
  title?: string;
  /** fraction (0–0.2) of the viewport to leave visible as a peek of the next card on mobile */
  peekPct?: number;
};

export default function AccountsCarousel({
  children,
  className,
  title = "Accounts",
  peekPct = 0.06,
}: AccountsCarouselProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);

  // drag state
  const [dragging, setDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartScroll = useRef(0);

  // layout/loop math
  const safePeek = Math.max(0, Math.min(0.2, peekPct));
  const items = Array.isArray(children) ? children : [children];

  // measurements
  const stepRef = useRef(0); // card step (width + gap)

  const isInteractiveElement = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;

    // Check if the element itself or any parent is interactive
    let el: HTMLElement | null = target;
    while (el && el !== trackRef.current) {
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role");

      if (
        tag === "button" ||
        tag === "a" ||
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        role === "button" ||
        el.hasAttribute("onclick") ||
        el.style.cursor === "pointer"
      ) {
        return true;
      }

      el = el.parentElement;
    }

    return false;
  };

  // Pointer handlers (smooth, native-like)
  const onPointerDown = (e: React.PointerEvent) => {
    if (isInteractiveElement(e.target)) return;

    const el = trackRef.current;
    if (!el) return;
    el.style.scrollSnapType = "none";
    el.setPointerCapture(e.pointerId);
    setDragging(true);
    dragStartX.current = e.clientX;
    dragStartScroll.current = el.scrollLeft;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const el = trackRef.current;
    if (!el) return;
    const dx = e.clientX - dragStartX.current;
    el.scrollLeft = dragStartScroll.current - dx;
  };

  const endDrag = (e: React.PointerEvent) => {
    const el = trackRef.current;
    if (!el) return;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {}
    setDragging(false);
    el.style.scrollSnapType = "x mandatory";
  };

  const scrollByOne = (dir: "prev" | "next") => {
    const el = trackRef.current;
    if (!el) return;
    const step = stepRef.current || 1;
    el.scrollBy({ left: dir === "next" ? step : -step, behavior: "smooth" });
  };

  // Robust step calculation
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    const compute = () => {
      const cardWidth = el.clientWidth * (1 - safePeek);

      // Update each card's width directly
      const cards = el.querySelectorAll<HTMLElement>("[data-carousel-card]");
      cards.forEach((c) => {
        c.style.width = `${cardWidth}px`;
      });

      // Measure step between first two cards (most reliable)
      let step = 0;
      if (cards.length >= 2) {
        const a = cards[0].getBoundingClientRect();
        const b = cards[1].getBoundingClientRect();
        step = Math.round(b.left - a.left);
      }

      // Fallback: use cardWidth + tailwind gap-2 (8px)
      if (!step || step < 1) step = Math.round(cardWidth + 8);

      stepRef.current = step;
    };

    compute();
    const id = requestAnimationFrame(compute);

    const ro = new ResizeObserver(() => compute());
    ro.observe(el);

    return () => {
      cancelAnimationFrame(id);
      ro.disconnect();
    };
  }, [safePeek]);

  return (
    <section className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white/90">{title}</h2>
        <div className="flex gap-1">
          <button
            aria-label="Previous account"
            onClick={() => scrollByOne("prev")}
            className="rounded-xl border border-white/10 px-4 py-2 text-base text-white/80 hover:bg-white/10 active:scale-[0.98] transition"
          >
            ‹
          </button>
          <button
            aria-label="Next account"
            onClick={() => scrollByOne("next")}
            className="rounded-xl border border-white/10 px-4 py-2 text-base text-white/80 hover:bg-white/10 active:scale-[0.98] transition"
          >
            ›
          </button>
        </div>
      </div>

      <div className="-mx-2 px-2">
        <div
          ref={trackRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={cn(
            "relative flex gap-2 overflow-x-auto",
            "snap-x snap-mandatory",
            "select-none",
            "[-ms-overflow-style:'none'] [scrollbar-width:'none']",
            dragging ? "cursor-grabbing" : "cursor-grab",
            "touch-pan-x",
            "[touch-action:pan-x]",
            "[will-change:scroll-position]"
          )}
          style={{ scrollSnapType: "x mandatory" }}
        >
          {/* hide scrollbar visually */}
          <style>{`div::-webkit-scrollbar{ display: none; }`}</style>

          {items.map((child, i) => (
            <div
              key={i}
              data-carousel-card
              className={cn("snap-start shrink-0 sm:w-[520px]", "rounded-2xl")}
            >
              {child}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
