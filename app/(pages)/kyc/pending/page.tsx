import Link from 'next/link';
import React from 'react'

const KycPending = () => {
  return (
    <div className="mt-8 flex flex-wrap gap-3">
      <Link
        href="/onboarding"
        className="inline-flex items-center justify-center rounded-2xl px-6 py-3 text-sm font-semibold bg-[rgb(182,255,62)] hover:bg-[rgb(182,255,62)]/90 text-black shadow-lg shadow-[rgb(182,255,62)]/30 transition"
      >
        finish onboarding
      </Link>
    </div>
  );
}

export default KycPending

