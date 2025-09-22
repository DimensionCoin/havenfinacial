// components/FullScreenLoader.tsx
"use client";

export default function FullScreenLoader({
  message = "Loading Haven…",
}: {
  message?: string;
}) {
  return (
    <div className="fixed inset-0 z-[9998] grid place-items-center bg-black">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[rgb(182,255,62)]/60 border-t-transparent" />
        <p className="text-sm text-white/80">{message}</p>
      </div>
    </div>
  );
}
