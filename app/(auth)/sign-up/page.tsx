"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  usePrivy,
  useLoginWithEmail,
  useLoginWithOAuth,
  useMfa,
  useMfaEnrollment,
} from "@privy-io/react-auth";
import { FcGoogle } from "react-icons/fc";
import Link from "next/link";
import { postSession } from "@/lib/postSession";

export default function SignUpPage() {
  const router = useRouter();
  const { user, getAccessToken, ready, logout } = usePrivy();
  const { promptMfa, init: initMfa } = useMfa();
  const { showMfaEnrollmentModal } = useMfaEnrollment();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const finalizingRef = useRef(false);

  async function maybeRunMfa(): Promise<boolean> {
    try {
      const hasAnyMfa =
        Array.isArray(user?.mfaMethods) && (user?.mfaMethods?.length ?? 0) > 0;

      if (!hasAnyMfa) {
        // Enroll (passkey / authenticator) if they have none
        await showMfaEnrollmentModal();
      }

      // Some SDK versions need init; it's a no-op otherwise
      try {
        // @ts-expect-error optional on some versions
        await initMfa();
      } catch {}

      await promptMfa(); // throws on cancel / wrong code / lockout
      return true;
    } catch {
      return false;
    }
  }

  // Try to create the app session. If backend needs MFA, do MFA once and retry.
  async function ensureAppSession(): Promise<boolean> {
    let tok = await getAccessToken();
    if (!tok) throw new Error("Missing Privy access token");

    try {
      await postSession(tok); // your existing server session creation
      return true; // no MFA needed
    } catch {
      // Server likely enforced MFA. Try MFA once, then retry postSession.
      const mfaOk = await maybeRunMfa();
      if (!mfaOk) return false;

      tok = await getAccessToken();
      if (!tok) throw new Error("Missing token after MFA");
      await postSession(tok); // retry after successful MFA
      return true;
    }
  }

  async function finalize() {
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    setErr(null);

    try {
      const ok = await ensureAppSession();
      if (!ok) {
        // MFA failed/cancelled → log out and send to sign-in
        try {
          await logout();
        } catch {}
        router.replace("/sign-in");
        return;
      }

      // Good to go
      router.replace("/onboarding");
    } catch (e) {
      // Any unexpected failure: clean up and show a safe error
      try {
        await logout();
      } catch {}
      setErr(e instanceof Error ? e.message : String(e));
      router.replace("/sign-in");
    } finally {
      finalizingRef.current = false;
    }
  }

  const { initOAuth, state: oauthState } = useLoginWithOAuth({
    onComplete: finalize,
    onError: (code) => setErr(code || "OAuth failed"),
  });

  const {
    sendCode,
    loginWithCode,
    state: emailState,
  } = useLoginWithEmail({
    onComplete: finalize,
    onError: (code) => setErr(code || "Email login failed"),
  });

  const isEmailAwaitingCode = emailState.status === "awaiting-code-input";
  const isEmailSending = emailState.status === "sending-code";
  const isEmailSubmitting = emailState.status === "submitting-code";
  const isOAuthLoading = oauthState.status === "loading";
  const isWorking = isOAuthLoading || isEmailSending || isEmailSubmitting;

  if (!ready) return null;

  return (
    <main className="relative min-h-[100svh] bg-black/40 text-white overflow-hidden">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(50%_35%_at_80%_10%,rgba(182,255,62,0.10),transparent),radial-gradient(40%_30%_at_10%_80%,rgba(182,255,62,0.06),transparent)]" />
        <div className="absolute inset-0 opacity-[0.04] [background:linear-gradient(rgba(255,255,255,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.2)_1px,transparent_1px)] [background-size:24px_24px]" />
        <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_30%,rgba(0,0,0,0),rgba(0,0,0,0.5))]" />
      </div>

      <div className="pwa-top-offset flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="mb-6 text-center">
            <div className="inline-flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-[rgb(182,255,62)] animate-pulse" />
              <span className="text-sm tracking-wide text-white/60">
                Create your account
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">
              Join <span className="text-[rgb(182,255,62)]">Haven</span>
            </h1>
            <p className="mt-1 text-sm text-white/60">
              Start with Google or email. We’ll verify MFA if your account
              requires it.
            </p>
          </div>

          {/* Card */}
          <div className="relative rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 shadow-[0_10px_50px_rgba(0,0,0,0.45)]">
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-px rounded-3xl ring-1 ring-white/10"
            />

            {/* Google */}
            <button
              onClick={() => {
                setErr(null);
                void initOAuth({ provider: "google" });
              }}
              disabled={isWorking}
              className="group w-full overflow-hidden rounded-xl border border-white/10 bg-white text-black px-4 py-3.5 transition hover:shadow-[0_10px_28px_rgba(255,255,255,0.1)] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isOAuthLoading ? (
                <span className="text-sm font-medium opacity-80">
                  Redirecting…
                </span>
              ) : (
                <>
                  <FcGoogle className="h-5 w-5" />
                  <span className="text-sm font-semibold tracking-tight">
                    Continue with Google
                  </span>
                </>
              )}
            </button>

            {/* Divider */}
            <div className="my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-xs text-white/50">or</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            {/* Email + OTP */}
            <div className="space-y-3">
              <label className="block text-xs font-medium text-white/70">
                Email
              </label>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
                className="w-full rounded-xl bg-black/30 border border-white/10 px-3.5 py-3 outline-none focus:ring-2 ring-[rgb(182,255,62)]/30 placeholder:text-white/35 text-sm transition"
                disabled={isWorking || isEmailAwaitingCode}
              />

              {isEmailAwaitingCode ? (
                <>
                  <label className="block text-xs font-medium text-white/70">
                    Enter 6-digit code
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.currentTarget.value)}
                    maxLength={6}
                    className="w-full rounded-xl bg-black/30 border border-white/10 px-3.5 py-3 outline-none focus:ring-2 ring-[rgb(182,255,62)]/30 tracking-[0.35em] placeholder:text-white/35 text-sm transition"
                    disabled={isWorking}
                  />
                  <button
                    onClick={() => {
                      setErr(null);
                      void loginWithCode({ code: code.trim() });
                    }}
                    disabled={isWorking || code.trim().length < 4}
                    className="w-full rounded-xl bg-[rgb(182,255,62)] text-black px-4 py-3.5 font-semibold transition hover:bg-[rgb(182,255,62)]/90 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isEmailSubmitting ? "Verifying…" : "Create account"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void sendCode({ email: email.trim() })}
                    disabled={isWorking}
                    className="w-full text-xs text-white/60 hover:text-white/85 underline underline-offset-4"
                  >
                    Resend code
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    setErr(null);
                    void sendCode({ email: email.trim() });
                  }}
                  disabled={isWorking || !email.trim()}
                  className="w-full rounded-xl bg-white/10 hover:bg-white/[0.16] border border-white/10 px-4 py-3.5 text-sm font-medium transition disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isEmailSending ? "Sending…" : "Send code"}
                </button>
              )}
            </div>

            {/* Errors */}
            <div
              role="alert"
              aria-live="polite"
              className="min-h-[1.25rem] mt-4 text-sm"
            >
              {err && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300">
                  {err}
                </div>
              )}
            </div>

            {/* Bottom line / links */}
            <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-xs text-white/60 text-center">
                Already have an account?
              </p>
              <Link href="/sign-in" className="mt-2 block">
                <button className="w-full rounded-xl bg-[rgb(182,255,62)]/12 hover:bg-[rgb(182,255,62)]/18 border border-[rgb(182,255,62)]/30 px-4 py-3 text-[rgb(182,255,62)] transition-all duration-200 font-medium">
                  Sign in
                </button>
              </Link>
            </div>
          </div>

          {/* Footnote */}
          <p className="mt-6 text-center text-[11px] text-white/45">
            By continuing, you agree to Haven’s Terms and acknowledge the
            Privacy Policy.
          </p>
        </div>
      </div>
    </main>
  );
}
