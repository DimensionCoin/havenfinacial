import Link from 'next/link';
import React from 'react'

const page = () => {
  return (
    <div>
      <Link
        href="/sign-up"
        className="inline-flex items-center justify-center rounded-2xl px-6 py-3 text-sm font-semibold bg-[rgb(182,255,62)] hover:bg-[rgb(182,255,62)]/90 text-black shadow-lg shadow-[rgb(182,255,62)]/30 transition"
      >
        Open Account
      </Link>
    </div>
  );
}

export default page
