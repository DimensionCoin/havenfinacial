"use client";

import Link from "next/link";

const Landing = () => {
  return (
    <main className="min-h-[100svh] bg-black text-white relative">
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(60%_40%_at_80%_10%,rgba(182,255,62,0.08),transparent),radial-gradient(40%_30%_at_10%_80%,rgba(182,255,62,0.06),transparent)]" />
      </div>

      {/* Top nav */}
      <header className="container mx-auto max-w-6xl px-6 py-6 flex items-center justify-between">
        <div className="text-xl font-bold tracking-tight">Haven</div>
        <nav className="flex items-center gap-3">
          <Link href="/sign-in">
            <div className=" items-center rounded-full px-6 py-3 text-sm font-medium bg-white/10 hover:bg-white/20 border border-white/20 backdrop-blur-md transition">
              Sign in
            </div>
          </Link>
          <Link href="/sign-up">
            <div className=" items-center rounded-full px-6 py-3 text-sm font-medium bg-white/10 hover:bg-white/20 border border-white/20 backdrop-blur-md transition">
              Sign up
            </div>
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="container mx-auto max-w-6xl px-6 py-16 md:py-24 grid md:grid-cols-2 gap-10 items-center">
        <div>
          <h1 className="text-4xl md:text-6xl font-extrabold leading-tight text-balance">
            Earn More on Your
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-[rgb(182,255,62)] to-lime-300">
              Savings with DeFi
            </span>
          </h1>

          <p className="mt-6 text-lg text-white/80 leading-relaxed">
            Haven combines the security of traditional banking with the power of
            decentralized finance. Maximize your savings potential while
            maintaining the trust and reliability you expect.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center rounded-2xl px-6 py-3 text-sm font-semibold bg-[rgb(182,255,62)] hover:bg-[rgb(182,255,62)]/90 text-black shadow-lg shadow-[rgb(182,255,62)]/30 transition"
            >
              Open Account
            </Link>
            <Link
              href="/faq"
              className="inline-flex items-center justify-center rounded-2xl px-6 py-3 text-sm font-medium bg-white/10 hover:bg-white/20 border border-white/20 text-white transition"
            >
              Learn More
            </Link>
          </div>
        </div>

        {/* Banking app mockup */}
        <div className="relative">
          <div className="relative rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 shadow-2xl">
            <div className="space-y-4">
              {/* Balance card */}
              <div className="rounded-2xl bg-gradient-to-br from-[rgb(182,255,62)]/20 to-[rgb(182,255,62)]/10 border border-[rgb(182,255,62)]/20 p-6">
                <div className="text-sm text-white/60 mb-2">Total Balance</div>
                <div className="text-3xl font-bold text-white">$24,567.89</div>
                <div className="text-sm text-[rgb(182,255,62)] mt-1">
                  +8.2% APY
                </div>
              </div>

              {/* Account options */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/5 border border-white/10 p-4">
                  <div className="w-8 h-8 rounded-full bg-[rgb(182,255,62)]/20 mb-2"></div>
                  <div className="text-sm font-medium">Savings</div>
                  <div className="text-xs text-white/60">8.2% APY</div>
                </div>
                <div className="rounded-xl bg-white/5 border border-white/10 p-4">
                  <div className="w-8 h-8 rounded-full bg-blue-500/20 mb-2"></div>
                  <div className="text-sm font-medium">Checking</div>
                  <div className="text-xs text-white/60">0.5% APY</div>
                </div>
              </div>
            </div>
          </div>

          <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-r from-[rgb(182,255,62)]/20 via-[rgb(182,255,62)]/10 to-[rgb(182,255,62)]/20 blur-2xl" />
        </div>
      </section>

      {/* Features section */}
      <section className="container mx-auto max-w-6xl px-6 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">Why Choose Haven?</h2>
          <p className="text-white/70 max-w-2xl mx-auto">
            Experience the future of banking with traditional security and DeFi
            innovation
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-[rgb(182,255,62)]/20 border border-[rgb(182,255,62)]/30 mx-auto mb-4 flex items-center justify-center">
              <div className="w-6 h-6 bg-[rgb(182,255,62)] rounded"></div>
            </div>
            <h3 className="font-semibold mb-2">Higher Yields</h3>
            <p className="text-sm text-white/70">
              Earn up to 8% APY on your savings through carefully selected DeFi
              protocols
            </p>
          </div>

          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-purple-500/20 border border-purple-500/30 mx-auto mb-4 flex items-center justify-center">
              <div className="w-6 h-6 bg-purple-400 rounded"></div>
            </div>
            <h3 className="font-semibold mb-2">Easy Access</h3>
            <p className="text-sm text-white/70">
              Manage your money with our intuitive app and instant transfers
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10">
        <div className="container mx-auto max-w-6xl px-6 py-8 flex items-center justify-between text-xs text-white/50">
          <span>© {new Date().getFullYear()} Haven</span>
          <div className="flex gap-4">
            <a className="hover:text-white/80" href="#">
              Privacy
            </a>
            <a className="hover:text-white/80" href="#">
              Terms
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
};

export default Landing;
