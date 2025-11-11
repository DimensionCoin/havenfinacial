"use client";

import React from "react";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

const TermsOfServicePage: React.FC = () => {
  const router = useRouter();

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/dashboard");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-black/70 to-black/30 text-white">
      {/* Top bar */}
      <header className="sticky top-0 z-10 bg-black/50 border-b border-white/10 backdrop-blur-2xl">
        <div className="mx-auto w-full max-w-5xl px-3 sm:px-4 py-2.5 sm:py-3 flex items-center gap-3 sm:gap-4">
          <button
            onClick={handleBack}
            className="p-2 rounded-xl bg-white/10 border border-white/20 text-white/80 hover:text-white hover:bg-white/15"
            aria-label="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-3 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-sm sm:text-base font-semibold truncate">
                Haven Terms of Service
              </h1>
              <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded-lg bg-[rgb(182,255,62)]/10 border border-[rgb(182,255,62)]/30 text-[rgb(182,255,62)]/90">
                Legal
              </span>
            </div>
            <span className="text-[10px] sm:text-xs text-white/50">
              Last updated: November 10, 2025
            </span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-5xl px-3 sm:px-4 py-5 sm:py-8 space-y-4 sm:space-y-5">
        {/* Intro card */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-3">
          <h2 className="text-xl sm:text-2xl font-semibold">
            Welcome to Haven
          </h2>
          <p className="text-xs sm:text-sm text-white/70">
            These Terms of Service (&quot;Terms&quot;) govern your access to and
            use of Haven (&quot;Haven,&quot; &quot;we,&quot; &quot;us,&quot; or
            &quot;our&quot;), including our website, web app, and any related
            services (collectively, the &quot;Services&quot;). By creating an
            account, connecting a wallet, or using Haven in any way, you agree
            to be bound by these Terms.
          </p>
          <p className="text-[11px] text-white/50 leading-relaxed border border-yellow-500/30 bg-yellow-500/5 rounded-xl px-3 py-2">
            Haven is currently in beta and provided on an &quot;as-is&quot; and
            &quot;as-available&quot; basis. These Terms are a general template
            and should be reviewed and customized by legal counsel before
            production use.
          </p>
        </section>

        {/* 1. What Haven Is */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-2.5">
          <h2 className="text-lg sm:text-xl font-semibold">
            1. What Haven Is (and Is Not)
          </h2>
          <p className="text-xs sm:text-sm text-white/70">
            Haven is a crypto-powered financial app that wraps decentralized
            finance (&quot;DeFi&quot;) tools behind a simple, familiar interface
            so users can hold digital assets, earn yield, and move funds without
            needing to understand blockchain details.
          </p>
          <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
            <li>
              <span className="font-semibold text-white">Not a bank.</span>{" "}
              Haven is not a bank, credit union, trust company, or other
              deposit-taking institution. Your assets are not insured by any
              government deposit insurance program (including CDIC, FDIC, or
              equivalent).
            </li>
            <li>
              <span className="font-semibold text-white">
                Non-custodial / DeFi wrapper.
              </span>{" "}
              Haven primarily uses embedded wallets and DeFi protocols (such as
              on-chain savings, swap routers, and perpetual trading platforms).
              In many cases, you retain technical control over your funds via
              your wallet, and Haven provides the interface, automation, and
              transaction sponsorship.
            </li>
            <li>
              <span className="font-semibold text-white">
                Third-party integrations.
              </span>{" "}
              Savings, swaps, perps, and on/off-ramp flows may be powered by
              third-party providers (e.g., MarginFi, Jupiter, Drift, on-ramp
              partners, and others). Your use of those services is subject to
              their own terms, in addition to these Terms.
            </li>
          </ul>
        </section>

        {/* 2. Who can use Haven */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-2.5">
          <h2 className="text-lg sm:text-xl font-semibold">
            2. Who Can Use Haven
          </h2>
          <p className="text-xs sm:text-sm text-white/70">
            By using Haven, you represent and warrant that:
          </p>
          <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
            <li>
              You are at least 18 years old (or the age of majority in your
              jurisdiction).
            </li>
            <li>
              You have the legal capacity to enter into a binding contract.
            </li>
            <li>
              You are not located in, or a resident of, any jurisdiction where
              using Haven would be illegal, restricted, or require us to obtain
              licenses we do not currently have.
            </li>
            <li>
              You are not on any sanctions or restricted-persons lists
              maintained by any applicable government or regulatory authority.
            </li>
          </ul>
        </section>

        {/* 3. Account & Security */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-2.5">
          <h2 className="text-lg sm:text-xl font-semibold">
            3. Your Account and Security
          </h2>
          <p className="text-xs sm:text-sm text-white/70">
            Haven uses third-party authentication and wallet providers (such as
            Privy) to create and manage your embedded wallets and login
            sessions.
          </p>
          <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
            <li>
              <span className="font-semibold text-white">Login.</span> You may
              log in using Google or email one-time passcodes (OTP). Every user
              will always have a valid, unique email address associated with
              their account.
            </li>
            <li>
              <span className="font-semibold text-white">
                Embedded wallets.
              </span>{" "}
              When you sign up, Haven may create one or more embedded Solana
              wallets for you (for example, a &quot;Deposit Account&quot; used
              to hold USDC and perform on-chain actions).
            </li>
            <li>
              <span className="font-semibold text-white">Account levels.</span>{" "}
              Haven may distinguish between a &quot;light&quot; account (created
              after login) and a &quot;full&quot; account (activated after
              completing onboarding and KYC). Full accounts unlock additional
              features such as higher limits and certain savings or investment
              products.
            </li>
            <li>
              <span className="font-semibold text-white">Responsibility.</span>{" "}
              You are responsible for all activity that occurs via your account
              and wallets. Do not share your login credentials, and notify us
              immediately if you suspect unauthorized access.
            </li>
          </ul>
        </section>

        {/* 4. How Haven makes money */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-3">
          <h2 className="text-lg sm:text-xl font-semibold">
            4. How Haven Makes Money (Fees and Revenue)
          </h2>
          <p className="text-xs sm:text-sm text-white/70">
            We believe in being transparent about how Haven earns revenue. Our
            goal is to keep fees simple, low, and predictable while clearly
            communicating what you pay for.
          </p>

          <div className="space-y-2.5">
            <h3 className="text-sm font-semibold text-white">
              4.1 Network Fees and Sponsorship
            </h3>
            <p className="text-xs sm:text-sm text-white/70">
              On Solana, transactions require network fees and, in some cases,
              account rent. In many flows, Haven sponsors these costs so you do
              not need to hold SOL to use the app. When we sponsor fees, we may
              charge a small fixed service fee that:
            </p>
            <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
              <li>Covers network fees and account rent; and</li>
              <li>Includes a small margin that constitutes Haven’s revenue.</li>
            </ul>
          </div>

          <div className="space-y-2.5">
            <h3 className="text-sm font-semibold text-white">
              4.2 Transfers Between Haven Users
            </h3>
            <p className="text-xs sm:text-sm text-white/70">
              When you send funds (for example, USDC) to another Haven user
              (such as via email-based transfers), Haven may charge a small
              fixed fee per transfer. For example, our current design
              contemplates a fee of approximately{" "}
              <span className="font-semibold">$0.015 USD equivalent</span> per
              transfer. This fee:
            </p>
            <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
              <li>
                Is used to cover network costs and operational overhead; and
              </li>
              <li>Generates a small profit margin for Haven.</li>
            </ul>
            <p className="text-[11px] text-white/50 mt-1">
              Exact fee amounts and currencies will always be shown in-app
              before you confirm a transfer and are subject to change over time.
            </p>
          </div>

          <div className="space-y-2.5">
            <h3 className="text-sm font-semibold text-white">
              4.3 Swaps (Buying/Selling Assets)
            </h3>
            <p className="text-xs sm:text-sm text-white/70">
              When you buy or sell supported assets (for example, swapping USDC
              for SOL, BTC, or other tokens via a DEX router), Haven uses
              third-party protocols (such as Jupiter) under the hood. In
              addition to any protocol-level fees or price impact, Haven may
              charge a small fixed fee per swap. For example, our current design
              contemplates:
            </p>
            <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
              <li>
                <span className="font-semibold">
                  Up to $0.25 USD equivalent
                </span>{" "}
                fee per buy or sell transaction executed via integrated swap
                routes.
              </li>
            </ul>
            <p className="text-[11px] text-white/50 mt-1">
              The exact fee will be clearly displayed in the confirmation screen
              before you execute a trade.
            </p>
          </div>

          <div className="space-y-2.5">
            <h3 className="text-sm font-semibold text-white">
              4.4 Perpetuals and Leveraged Products
            </h3>
            <p className="text-xs sm:text-sm text-white/70">
              If you access perpetual futures or other leveraged products
              through Haven (for example, via an integrated perp DEX),
              additional fees may apply. Our current model contemplates:
            </p>
            <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
              <li>
                <span className="font-semibold">
                  Up to $0.50 USD equivalent
                </span>{" "}
                per perpetual trade (opening or closing).
              </li>
            </ul>
            <p className="text-[11px] text-white/50 mt-1">
              These fees are in addition to any protocol fees, funding payments,
              or price impact charged by the underlying perp platform.
            </p>
          </div>

          <div className="space-y-2.5">
            <h3 className="text-sm font-semibold text-white">
              4.5 Savings and Yield Products
            </h3>
            <p className="text-xs sm:text-sm text-white/70">
              Haven may integrate with yield platforms (such as MarginFi) to
              offer savings-like experiences where your assets can earn interest
              or rewards.
            </p>
            <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
              <li>
                Haven may earn a portion of the interest or rewards generated by
                your deposits (for example, by taking a small share of the yield
                paid by the protocol or via a spread between the protocol&apos;s
                rate and the rate shown in-app).
              </li>
              <li>
                The rate presented to you (for example, &quot;up to 8% savings
                yield&quot;) is a net rate that already incorporates any Haven
                share of yield, unless otherwise stated in the app.
              </li>
            </ul>
            <p className="text-[11px] text-white/50 mt-1">
              Yield rates are variable, not guaranteed, and subject to
              underlying protocol performance and market conditions.
            </p>
          </div>

          <div className="space-y-2.5">
            <h3 className="text-sm font-semibold text-white">
              4.6 Other Revenue Streams
            </h3>
            <p className="text-xs sm:text-sm text-white/70">
              In the future, Haven may introduce additional revenue sources,
              such as premium features, subscription tiers, or spreads on
              specific products. Whenever we charge a fee, we will show it
              clearly in-app before you confirm a transaction or upgrade.
            </p>
          </div>
        </section>

        {/* 5. No advice */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-2.5">
          <h2 className="text-lg sm:text-xl font-semibold">
            5. No Financial, Investment, or Tax Advice
          </h2>
          <p className="text-xs sm:text-sm text-white/70">
            Haven does not provide personalized financial, investment, or tax
            advice. Any information, charts, educational content, or portfolio
            views presented in the app are for informational and educational
            purposes only and should not be relied upon as a recommendation to
            buy, sell, or hold any asset.
          </p>
          <p className="text-xs sm:text-sm text-white/70">
            You are solely responsible for your decisions and for understanding
            the risks of digital assets, leverage, and DeFi protocols. Always do
            your own research and consider consulting a qualified professional
            before making financial decisions.
          </p>
        </section>

        {/* 6. Risks */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-2.5">
          <h2 className="text-lg sm:text-xl font-semibold">
            6. Risks You Accept
          </h2>
          <p className="text-xs sm:text-sm text-white/70">
            By using Haven, you acknowledge and accept the following risks,
            among others:
          </p>
          <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
            <li>Price volatility of digital assets (including stablecoins).</li>
            <li>
              Protocol risk (smart contract bugs, hacks, governance failures).
            </li>
            <li>
              Counterparty and integration risk with third-party services.
            </li>
            <li>Network congestion, outages, or forks.</li>
            <li>
              Regulatory changes that may affect your ability to use Haven or
              certain assets.
            </li>
            <li>
              Loss of access to your account or wallets if you lose control of
              your login methods.
            </li>
          </ul>
          <p className="text-xs sm:text-sm text-white/70">
            You understand that you can lose some or all of the value of your
            digital assets, especially when using leverage or complex products.
            Never deposit more than you can afford to lose.
          </p>
        </section>

        {/* 7. Third parties */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-2.5">
          <h2 className="text-lg sm:text-xl font-semibold">
            7. Third-Party Services and On/Off Ramps
          </h2>
          <p className="text-xs sm:text-sm text-white/70">
            Haven may integrate with third-party providers for:
          </p>
          <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
            <li>
              On-ramp and off-ramp services (fiat-to-crypto and crypto-to-fiat).
            </li>
            <li>Custody, liquidity, and yield-generating protocols.</li>
            <li>Price feeds, risk engines, KYC/AML services, and analytics.</li>
          </ul>
          <p className="text-xs sm:text-sm text-white/70">
            These third parties are independent of Haven. We do not control
            their systems, terms, or policies, and are not responsible for their
            acts or omissions. Your use of such services may require you to
            agree to additional terms and share information with those third
            parties (e.g., for KYC and compliance).
          </p>
        </section>

        {/* 8. Prohibited uses */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-2.5">
          <h2 className="text-lg sm:text-xl font-semibold">
            8. Prohibited Uses
          </h2>
          <p className="text-xs sm:text-sm text-white/70">
            You agree not to use Haven for any unlawful, abusive, or prohibited
            purpose, including but not limited to:
          </p>
          <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
            <li>
              Money laundering, terrorist financing, or sanctions evasion.
            </li>
            <li>Fraud, scams, or market manipulation.</li>
            <li>
              Illegal gambling or other prohibited activities under applicable
              law.
            </li>
            <li>
              Attacks, exploits, or attempts to compromise the security or
              integrity of Haven or any protocol.
            </li>
          </ul>
          <p className="text-xs sm:text-sm text-white/70">
            We may suspend or terminate your access to Haven if we suspect any
            prohibited or suspicious activity, or if required by law or a
            competent authority.
          </p>
        </section>

        {/* 9. Beta / changes */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-2.5">
          <h2 className="text-lg sm:text-xl font-semibold">
            9. Beta, Changes, and Availability
          </h2>
          <p className="text-xs sm:text-sm text-white/70">
            Haven is currently in beta and is evolving quickly. Features may
            change, be added, or be removed without prior notice.
          </p>
          <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
            <li>
              We may update these Terms from time to time. When we do, we will
              update the &quot;Last updated&quot; date above and may notify you
              in-app or via email. Your continued use of Haven after changes
              become effective constitutes your acceptance of the new Terms.
            </li>
            <li>
              We do not guarantee that the Services will be available 100% of
              the time. Downtime can occur for maintenance, upgrades, outages,
              or external factors beyond our control.
            </li>
          </ul>
        </section>

        {/* 10. Limitation of liability */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-2.5">
          <h2 className="text-lg sm:text-xl font-semibold">
            10. Limitation of Liability
          </h2>
          <p className="text-xs sm:text-sm text-white/70">
            To the maximum extent permitted by law, Haven and its founders, team
            members, affiliates, and partners will not be liable for any
            indirect, incidental, special, consequential, or punitive damages,
            or any loss of profits, data, or assets arising out of or in
            connection with your use of Haven.
          </p>
          <p className="text-xs sm:text-sm text-white/70">
            Our total aggregate liability to you for any claim related to Haven
            will not exceed the lesser of (a) the total fees you paid directly
            to Haven in the 12 months preceding the event giving rise to the
            claim, or (b) an amount agreed by applicable law or a court of
            competent jurisdiction.
          </p>
        </section>

        {/* 11. Indemnification */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-2.5">
          <h2 className="text-lg sm:text-xl font-semibold">
            11. Indemnification
          </h2>
          <p className="text-xs sm:text-sm text-white/70">
            You agree to indemnify and hold harmless Haven, its founders, team
            members, affiliates, and partners from and against any claims,
            liabilities, damages, losses, and expenses (including reasonable
            legal fees) arising out of or related to your use of the Services,
            your violation of these Terms, or your violation of any applicable
            law or third-party rights.
          </p>
        </section>

        {/* 12. Governing law */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-2.5">
          <h2 className="text-lg sm:text-xl font-semibold">
            12. Governing Law and Disputes
          </h2>
          <p className="text-xs sm:text-sm text-white/70">
            These Terms and your use of Haven will be governed by and construed
            in accordance with the laws of the jurisdiction where the Haven
            operating entity is organized (for example, the Province of Ontario,
            Canada), without regard to conflict of law principles.
          </p>
          <p className="text-xs sm:text-sm text-white/70">
            Any dispute arising out of or relating to these Terms or Haven shall
            be resolved in the courts located in that jurisdiction, unless
            otherwise required by local consumer protection laws.
          </p>
        </section>

        {/* 13. Contact */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-2.5">
          <h2 className="text-lg sm:text-xl font-semibold">13. Contact Us</h2>
          <p className="text-xs sm:text-sm text-white/70">
            If you have questions about these Terms or about Haven generally,
            you can contact us at:
          </p>
          <p className="mt-1 text-xs sm:text-sm text-white/80">
            <span className="font-medium">Email:</span>{" "}
            <span className="text-[rgb(182,255,62)]">support@haven.app</span>
            {/* Replace with your real support email */}
          </p>
        </section>

        {/* Footer note */}
        <section className="border-t border-white/10 pt-3 mt-2 mb-4">
          <p className="text-[10px] text-white/40">
            This Terms of Service page is a working draft. It should be reviewed
            and customized by legal counsel before being relied upon or
            presented as final.
          </p>
        </section>
      </main>
    </div>
  );
};

export default TermsOfServicePage;
