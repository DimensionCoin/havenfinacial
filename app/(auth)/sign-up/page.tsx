"use client";

import { useState } from "react";
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

  // Require MFA enrollment (if none) + verification via Privy UIs.
  // On failure/cancel, logout and redirect to /sign-in.
  async function requireMfaOrFail(): Promise<boolean> {
    try {
      const hasAnyMfa =
        Array.isArray(user?.mfaMethods) && (user?.mfaMethods?.length ?? 0) > 0;

      if (!hasAnyMfa) {
        // Force user to enroll (passkey or authenticator app) using Privy's modal
        await showMfaEnrollmentModal();
      }

      // Then require verification. Some SDK versions want init() first (no-op otherwise).
      try {
        // @ts-expect-error init may be optional depending on SDK version
        await initMfa();
      } catch {
        /* no-op */
      }
      await promptMfa();

      return true; // MFA passed
    } catch {
      // Any failure or cancel → clear auth and bounce to /sign-in
      try {
        await logout();
      } catch {}
      router.replace("/sign-in");
      return false;
    }
  }

  async function finalize() {
    // 1) Enforce MFA enrollment + verification first
    const ok = await requireMfaOrFail();
    if (!ok) return; // user cancelled/failed MFA → already redirected

    // 2) Now create your app session and go to /onboarding (as requested)
    const tok = await getAccessToken();
    if (!tok) throw new Error("Missing Privy access token");
    await postSession(tok);
    router.replace("/onboarding");
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

  const oauthErr =
    oauthState.status === "error"
      ? oauthState.error?.message ?? "OAuth failed"
      : null;
  const emailFlowErr =
    emailState.status === "error"
      ? emailState.error?.message ?? "Email login failed"
      : null;

  if (!ready) return null;

  return (
    <div className="min-h-screen flex items-center justify-center text-white px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Create your Haven account</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Sign in with Google or continue with an email code. We’ll set up
            your session and guide you through onboarding.
          </p>
        </header>

        {/* Google */}
        <button
          onClick={() => {
            setErr(null);
            void initOAuth({ provider: "google" });
          }}
          disabled={isWorking}
          className="w-full rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-60 border border-white/20 px-4 py-2 transition flex items-center justify-center gap-2"
        >
          {isOAuthLoading ? (
            "Redirecting…"
          ) : (
            <>
              <FcGoogle className="w-5 h-5" /> Continue With Google
            </>
          )}
        </button>

        <div className="relative flex items-center">
          <div className="flex-1 h-px bg-white/10" />
          <span className="px-3 text-xs text-white/50">or</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Email OTP */}
        <div className="space-y-3">
          <label className="block text-sm text-white/80">Email</label>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            className="w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 outline-none focus:ring-2 ring-white/20"
            disabled={isWorking || isEmailAwaitingCode}
          />

          {isEmailAwaitingCode ? (
            <>
              <label className="block text-sm text-white/80">
                Enter 6-digit code
              </label>
              <input
                type="text"
                inputMode="numeric"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.currentTarget.value)}
                className="w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 outline-none focus:ring-2 ring-white/20 tracking-widest"
                maxLength={6}
                disabled={isWorking}
              />
              <button
                onClick={() => {
                  setErr(null);
                  void loginWithCode({ code: code.trim() });
                }}
                disabled={isWorking || code.trim().length < 4}
                className="w-full rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-60 border border-white/20 px-4 py-2 transition"
              >
                {isEmailSubmitting ? "Verifying…" : "Create account"}
              </button>
              <button
                type="button"
                onClick={() => void sendCode({ email: email.trim() })}
                disabled={isWorking}
                className="w-full text-xs text-white/60 hover:text-white/80 underline underline-offset-4"
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
              className="w-full rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-60 border border-white/20 px-4 py-2 transition"
            >
              {isEmailSending ? "Sending…" : "Send code"}
            </button>
          )}
        </div>

        {/* Errors */}
        <div
          role="alert"
          aria-live="polite"
          className="min-h-[1.25rem] text-sm"
        >
          {(err || oauthErr || emailFlowErr) && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300">
              {err || oauthErr || emailFlowErr}
            </div>
          )}
        </div>

        <footer className="space-y-4">
          <div className="pt-4 border-t border-white/10">
            <p className="text-sm text-zinc-400 text-center mb-3">
              Already have an account?
            </p>
            <Link href="/sign-in">
              <button className="w-full rounded-lg bg-[rgb(182,255,62)]/10 hover:bg-[rgb(182,255,62)]/20 border border-[rgb(182,255,62)]/30 px-4 py-2 text-[rgb(182,255,62)] transition-all duration-200 font-medium">
                Sign In
              </button>
            </Link>
          </div>
        </footer>

        <footer className="space-y-2">
          <p className="text-xs text-zinc-500">
            By continuing, you agree to Haven’s Terms and acknowledge the
            Privacy Policy.
          </p>
        </footer>
      </div>
    </div>
  );
}
