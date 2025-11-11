"use client";

import React from "react";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

const PrivacyPolicyPage: React.FC = () => {
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
                Haven Privacy Policy
              </h1>
              <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded-lg bg-[rgb(182,255,62)]/10 border border-[rgb(182,255,62)]/30 text-[rgb(182,255,62)]/90">
                Privacy & Security
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
        {/* Intro */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-3">
          <h2 className="text-xl sm:text-2xl font-semibold">1. Introduction</h2>
          <p className="text-xs sm:text-sm text-white/70">
            This Privacy Policy explains how Haven (&quot;Haven,&quot;
            &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) collects, uses,
            and protects information when you access or use our website, web
            app, and related services (collectively, the &quot;Services&quot;).
          </p>
          <p className="text-xs sm:text-sm text-white/70">
            Haven is built around a simple principle:{" "}
            <span className="font-semibold text-white">
              your money and your data should stay yours
            </span>
            . We use modern authentication and security tools, rely on
            non-custodial on-chain accounts for user funds, and delegate private
            key management to specialized providers like Privy.
          </p>
          <p className="text-[11px] text-white/50 leading-relaxed border border-yellow-500/30 bg-yellow-500/5 rounded-xl px-3 py-2">
            This document is a working draft intended to be reviewed and
            customized by qualified legal counsel. It is not final legal advice
            and may not cover all legal requirements applicable to your
            jurisdiction or business model.
          </p>
        </section>

        {/* 2. What this policy covers */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-2.5">
          <h2 className="text-lg sm:text-xl font-semibold">
            2. What This Policy Covers
          </h2>
          <p className="text-xs sm:text-sm text-white/70">
            This Privacy Policy applies to:
          </p>
          <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
            <li>
              Users who create a Haven account or log in using supported
              authentication methods (e.g., Google, email OTP).
            </li>
            <li>
              Users whose on-chain wallets are created or connected via Haven,
              including embedded wallets provided by third-party providers such
              as Privy.
            </li>
            <li>
              Visitors to our website or app, including users who browse,
              explore features, or interact with support.
            </li>
          </ul>
          <p className="text-xs sm:text-sm text-white/70">
            It does <span className="font-semibold text-white">not</span> govern
            how third-party protocols (e.g., DeFi platforms, on/off-ramp
            providers, analytics services) handle your data. Those services are
            subject to their own privacy policies and terms.
          </p>
        </section>

        {/* 3. Key principles */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-2.5">
          <h2 className="text-lg sm:text-xl font-semibold">
            3. Our Privacy & Security Principles
          </h2>
          <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
            <li>
              <span className="font-semibold text-white">
                On-chain by default.
              </span>{" "}
              User funds are held in on-chain wallets, not pooled custodial
              accounts wherever possible.
            </li>
            <li>
              <span className="font-semibold text-white">
                We don&apos;t want your keys.
              </span>{" "}
              Raw private keys are never handled or stored by Haven. Key
              management is delegated to trusted providers like Privy or to your
              own self-custodial wallets.
            </li>
            <li>
              <span className="font-semibold text-white">
                Minimal data, maximum clarity.
              </span>{" "}
              We collect only what we need to provide the Service, comply with
              law, and improve the product, and we aim to explain it in plain
              language.
            </li>
            <li>
              <span className="font-semibold text-white">Security first.</span>{" "}
              We use modern security practices (encryption, access controls,
              environment isolation, and monitoring) to protect the data we do
              hold.
            </li>
          </ul>
        </section>

        {/* 4. Information we collect */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-3">
          <h2 className="text-lg sm:text-xl font-semibold">
            4. Information We Collect
          </h2>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white">
              4.1 Account & Identity Information
            </h3>
            <p className="text-xs sm:text-sm text-white/70">
              When you sign up or log in to Haven, we may collect:
            </p>
            <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
              <li>Your name or display name (if provided).</li>
              <li>
                Your email address (required for all users as a primary contact
                and account identifier).
              </li>
              <li>
                Authentication metadata from our auth provider(s) (e.g., Google
                account ID, email verification status, session identifiers).
              </li>
              <li>
                KYC/AML information if required by law or by certain integrated
                partners (e.g., name, address, date of birth, government ID
                details) — often processed via third-party providers.
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white">
              4.2 Wallet & Transaction Information
            </h3>
            <p className="text-xs sm:text-sm text-white/70">
              Because Haven is built on public blockchains, some information is
              inherently public and on-chain. We may collect and associate with
              your account:
            </p>
            <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
              <li>
                On-chain wallet addresses created or linked in Haven (e.g.,
                deposit wallet, savings wallet, or other program accounts).
              </li>
              <li>
                Transaction history related to your Haven activity (e.g.,
                transfers, swaps, deposits into DeFi protocols, withdrawals).
              </li>
              <li>
                Protocol-level positions and balances from integrated platforms
                (e.g., savings/vault balances, perp positions, rewards).
              </li>
            </ul>
            <p className="text-xs sm:text-sm text-white/70">
              While transaction data is public on-chain, our systems may also
              maintain internal mappings between your Haven profile and the
              relevant wallet addresses to power the app’s experience.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white">
              4.3 Usage, Device & Log Data
            </h3>
            <p className="text-xs sm:text-sm text-white/70">
              When you use Haven, we may automatically collect:
            </p>
            <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
              <li>
                App usage data (e.g., pages visited, buttons clicked, features
                used, timestamps).
              </li>
              <li>
                Device and browser information (e.g., type, OS, version, IP
                address, basic locale, and language).
              </li>
              <li>
                Diagnostic data for performance and security (e.g., error logs,
                suspicious activity patterns).
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white">
              4.4 Communications & Support
            </h3>
            <p className="text-xs sm:text-sm text-white/70">
              If you contact us (e.g., via email, in-app chat, or support
              forms), we may collect:
            </p>
            <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
              <li>Your contact details and any info you choose to share.</li>
              <li>
                Metadata about the communication (time, channel, status,
                internal notes to help resolve your issue).
              </li>
            </ul>
          </div>
        </section>

        {/* 5. How we use information */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-3">
          <h2 className="text-lg sm:text-xl font-semibold">
            5. How We Use Your Information
          </h2>
          <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
            <li>To create, maintain, and secure your Haven account.</li>
            <li>
              To authenticate you and authorize sensitive actions (e.g.
              transfers, swaps, withdrawals), potentially with additional
              confirmation via email or an authentication app, depending on the
              security model.
            </li>
            <li>
              To power core features (balances, portfolio views, transaction
              history, savings and investment summaries).
            </li>
            <li>
              To process on-chain actions you request (e.g., swaps, deposits,
              withdrawals) through integrated protocols.
            </li>
            <li>
              To monitor for fraud, abuse, and suspicious activity and to
              enforce our Terms of Service.
            </li>
            <li>
              To comply with legal obligations, including KYC/AML and reporting
              requirements where applicable.
            </li>
            <li>
              To analyze usage, improve performance, and develop new features
              and products.
            </li>
            <li>
              To communicate with you about updates, security, and support.
            </li>
          </ul>
        </section>

        {/* 6. Wallets, keys, Privy, on-chain funds */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-3">
          <h2 className="text-lg sm:text-xl font-semibold">
            6. Wallets, Private Keys & On-Chain Funds
          </h2>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white">
              6.1 Non-Custodial, On-Chain Funds
            </h3>
            <p className="text-xs sm:text-sm text-white/70">
              Haven is designed so that user funds are held in on-chain wallets,
              rather than in pooled custodial accounts controlled by Haven. When
              you deposit assets, interact with DeFi, or move funds, those
              actions generally occur directly on the blockchain under addresses
              associated with you or your embedded wallet.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white">
              6.2 Private Keys Managed by Privy & Other Providers
            </h3>
            <p className="text-xs sm:text-sm text-white/70">
              For embedded wallets, Haven relies on specialized third-party
              providers (such as Privy) to manage encryption, storage, and use
              of private keys. In this model:
            </p>
            <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
              <li>
                Haven does <span className="font-semibold text-white">not</span>{" "}
                see or store your raw private keys.
              </li>
              <li>
                Key material is generated, encrypted, and used by the wallet
                provider’s systems and/or locally in your browser or device,
                according to their security model.
              </li>
              <li>
                When you approve a transaction in Haven, the underlying signing
                operation is performed by Privy or another wallet provider on
                your behalf, consistent with your session and security settings.
              </li>
            </ul>
            <p className="text-xs sm:text-sm text-white/70">
              Your use of embedded wallets is also governed by the applicable
              wallet provider&apos;s documentation and terms. We encourage you
              to review those carefully.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white">
              6.3 Self-Custodial Wallets
            </h3>
            <p className="text-xs sm:text-sm text-white/70">
              If you connect your own self-custodial wallet, you remain fully
              responsible for safeguarding your keys, seed phrase, and devices.
              Haven never has access to that information. We simply receive
              signed transactions or read publicly available on-chain data.
            </p>
          </div>
        </section>

        {/* 7. Authentication, security, & access control */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-3">
          <h2 className="text-lg sm:text-xl font-semibold">
            7. Authentication, Security & Access Control
          </h2>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white">
              7.1 Sign-In & Session Management
            </h3>
            <p className="text-xs sm:text-sm text-white/70">
              Haven uses a dedicated authentication layer to sign you in and
              authorize actions. This may include:
            </p>
            <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
              <li>Identity providers such as Google sign-in.</li>
              <li>
                Email one-time passcodes (OTP) or similar mechanisms to verify
                control of your email.
              </li>
              <li>
                Session tokens (e.g., short-lived access tokens and secure
                HttpOnly cookies) to keep you logged in and protect against
                token theft.
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white">
              7.2 Additional Verification for Sensitive Actions
            </h3>
            <p className="text-xs sm:text-sm text-white/70">
              For sensitive operations (such as changing security settings,
              initiating large transfers, or performing high-risk actions), we
              may:
            </p>
            <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
              <li>
                Require re-authentication (e.g., re-entering OTP, refreshing
                login).
              </li>
              <li>
                Prompt for an additional confirmation step within the app or via
                email.
              </li>
              <li>
                In the future, support multi-factor authentication (MFA), such
                as authenticator app codes, where available.
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white">
              7.3 Technical & Organizational Measures
            </h3>
            <p className="text-xs sm:text-sm text-white/70">
              To protect the data we control, Haven may implement measures such
              as:
            </p>
            <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
              <li>
                Transport-layer encryption (HTTPS/TLS) for data in transit.
              </li>
              <li>
                Encryption of sensitive data at rest where appropriate (e.g.,
                secrets, tokens).
              </li>
              <li>
                Role-based access control and the principle of least privilege
                for internal tools.
              </li>
              <li>
                Environment separation (e.g., development vs. production) and
                API key scoping.
              </li>
              <li>
                Monitoring and logging for anomalies, abuse, or unauthorized
                access attempts.
              </li>
            </ul>
            <p className="text-xs sm:text-sm text-white/70">
              No system can be perfectly secure, but we are committed to
              continuously improving our security posture and responding
              promptly to issues.
            </p>
          </div>
        </section>

        {/* 8. Cookies & analytics */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-3">
          <h2 className="text-lg sm:text-xl font-semibold">
            8. Cookies, Local Storage & Analytics
          </h2>
          <p className="text-xs sm:text-sm text-white/70">
            Haven may use a combination of cookies, local storage, and similar
            technologies to:
          </p>
          <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
            <li>Maintain your session and keep you logged in securely.</li>
            <li>Remember preferences (e.g., display currency, theme).</li>
            <li>
              Measure usage of features, performance, and errors to improve the
              app.
            </li>
          </ul>
          <p className="text-xs sm:text-sm text-white/70">
            We may also use privacy-respecting analytics tools or third-party
            analytics, subject to applicable law and consent requirements. Where
            required, you will be able to manage your cookie/analytics
            preferences.
          </p>
        </section>

        {/* 9. Sharing of information */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-3">
          <h2 className="text-lg sm:text-xl font-semibold">
            9. How We Share Information
          </h2>
          <p className="text-xs sm:text-sm text-white/70">
            We do not sell your personal information. We may share information
            in the following situations:
          </p>
          <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
            <li>
              <span className="font-semibold text-white">
                Service providers & partners:
              </span>{" "}
              With vendors who help us operate the Service (e.g.,
              authentication, wallet providers such as Privy, cloud hosting,
              analytics, KYC/AML, customer support).
            </li>
            <li>
              <span className="font-semibold text-white">
                DeFi & on/off-ramp integrations:
              </span>{" "}
              With third-party protocols or on/off-ramp providers to execute
              transactions you request.
            </li>
            <li>
              <span className="font-semibold text-white">
                Legal & compliance:
              </span>{" "}
              Where required by law, regulation, legal process, or governmental
              request, or to protect the rights, property, or safety of Haven,
              our users, or others.
            </li>
            <li>
              <span className="font-semibold text-white">
                Business transfers:
              </span>{" "}
              In connection with a merger, acquisition, financing, or sale of
              assets, subject to appropriate confidentiality and legal
              safeguards.
            </li>
          </ul>
        </section>

        {/* 10. Data retention */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-3">
          <h2 className="text-lg sm:text-xl font-semibold">
            10. Data Retention
          </h2>
          <p className="text-xs sm:text-sm text-white/70">
            We retain information for as long as reasonably necessary to:
          </p>
          <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
            <li>Provide and improve the Services you use.</li>
            <li>Maintain appropriate business and financial records.</li>
            <li>
              Comply with legal, regulatory, tax, or accounting obligations.
            </li>
            <li>Resolve disputes and enforce our agreements.</li>
          </ul>
          <p className="text-xs sm:text-sm text-white/70">
            Because blockchain transactions are public and immutable, on-chain
            data cannot be deleted or altered by Haven.
          </p>
        </section>

        {/* 11. Your rights */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-3">
          <h2 className="text-lg sm:text-xl font-semibold">
            11. Your Rights & Choices
          </h2>
          <p className="text-xs sm:text-sm text-white/70">
            Depending on your jurisdiction, you may have rights regarding your
            personal data, such as:
          </p>
          <ul className="list-disc pl-5 text-xs sm:text-sm text-white/70 space-y-1.5">
            <li>Accessing the personal information we hold about you.</li>
            <li>Requesting correction of inaccurate or incomplete data.</li>
            <li>
              Requesting deletion of certain personal information (subject to
              legal and contractual limitations).
            </li>
            <li>
              Objecting to or restricting certain processing activities, or
              withdrawing consent where processing is based on consent.
            </li>
          </ul>
          <p className="text-xs sm:text-sm text-white/70">
            To exercise any applicable rights, you can contact us using the
            details in the <span className="font-semibold">Contact Us</span>{" "}
            section below. We may need to verify your identity before responding
            to such requests.
          </p>
        </section>

        {/* 12. Children */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-3">
          <h2 className="text-lg sm:text-xl font-semibold">
            12. Children&apos;s Privacy
          </h2>
          <p className="text-xs sm:text-sm text-white/70">
            Haven is not intended for, and we do not knowingly collect personal
            information from, children under the age of 18 (or the age of
            majority in your jurisdiction). If we learn that we have collected
            personal information from a child without appropriate consent, we
            will take steps to delete that information where feasible.
          </p>
        </section>

        {/* 13. International transfers */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-3">
          <h2 className="text-lg sm:text-xl font-semibold">
            13. International Data Transfers
          </h2>
          <p className="text-xs sm:text-sm text-white/70">
            Haven may process and store information in countries other than the
            one in which you are located, including in jurisdictions that may
            have different data protection laws. Where required, we implement
            appropriate safeguards (such as contractual protections) to protect
            your information when it is transferred across borders.
          </p>
        </section>

        {/* 14. Changes */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-3">
          <h2 className="text-lg sm:text-xl font-semibold">
            14. Changes to This Privacy Policy
          </h2>
          <p className="text-xs sm:text-sm text-white/70">
            We may update this Privacy Policy from time to time to reflect
            changes in our practices, the law, or our Services. When we do, we
            will update the &quot;Last updated&quot; date at the top of this
            page and may provide additional notice (such as an in-app banner or
            email). Your continued use of Haven after changes become effective
            constitutes your acceptance of the updated policy.
          </p>
        </section>

        {/* 15. Contact */}
        <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-2xl p-4 sm:p-5 space-y-3">
          <h2 className="text-lg sm:text-xl font-semibold">15. Contact Us</h2>
          <p className="text-xs sm:text-sm text-white/70">
            If you have questions about this Privacy Policy, our security
            practices, or how we handle your data, you can contact us at:
          </p>
          <p className="mt-1 text-xs sm:text-sm text-white/80">
            <span className="font-medium">Email:</span>{" "}
            <span className="text-[rgb(182,255,62)]">privacy@haven.app</span>
            {/* Replace with your real privacy/support email */}
          </p>
        </section>

        {/* Footer note */}
        <section className="border-t border-white/10 pt-3 mt-2 mb-4">
          <p className="text-[10px] text-white/40">
            This Privacy Policy is a working draft for review by legal counsel.
            Implementing this policy may require additional disclosures and
            controls depending on your jurisdiction, data flows, and integrated
            service providers.
          </p>
        </section>
      </main>
    </div>
  );
};

export default PrivacyPolicyPage;
