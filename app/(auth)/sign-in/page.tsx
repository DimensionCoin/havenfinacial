"use client";

import { useState, useEffect } from "react";
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

/**
 * Shows Privy’s enrollment + verification UIs (not custom UIs).
 * Flow:
 *  1) If user has no MFA methods yet → open Privy’s enrollment modal
 *  2) Open Privy’s verification modal (promptMfa)
 *  3) On success → get token, create server session, go to /dashboard
 *  4) On failure/cancel → logout, go back to /sign-in with message
 */
function PrivyMfaGate({
  onSuccess,
  onFail,
}: {
  onSuccess: () => void;
  onFail: (message?: string) => void;
}) {
  const router = useRouter();
  const { user, getAccessToken, logout } = usePrivy();
  const { showMfaEnrollmentModal } = useMfaEnrollment();
  const { promptMfa, init: initMfa } = useMfa();

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // 1) Enroll if needed (Privy default UI)
        const hasAnyMfa =
          Array.isArray(user?.mfaMethods) &&
          (user?.mfaMethods?.length ?? 0) > 0;
        if (!hasAnyMfa) {
          await showMfaEnrollmentModal();
        }

        // 2) Verify (Privy default UI)
        try {
          // @ts-expect-error init may be optional depending on SDK version
          await initMfa();
        } catch {
          // no-op if not required by this SDK version
        }
        await promptMfa(); // opens Privy’s verification modal

        // 3) If here, MFA succeeded → finalize session & go to /dashboard
        const tok = await getAccessToken();
        if (!tok) throw new Error("Missing Privy access token after MFA");
        await postSession(tok);

        if (!mounted) return;
        onSuccess();
        router.replace("/dashboard");
      } catch (err: unknown) {
        // Any error means cancel/fail → clear client session and bounce to /sign-in
        const e = err as { message?: string };
        try {
          await logout();
        } catch {
          /* ignore */
        }
        if (!mounted) return;
        onFail(e?.message || "MFA was canceled or failed.");
        router.replace("/sign-in");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [
    user?.mfaMethods, // include user to satisfy exhaustive-deps
    showMfaEnrollmentModal,
    promptMfa,
    initMfa,
    getAccessToken,
    logout,
    router,
    onSuccess,
    onFail,
  ]);

  // Lightweight overlay while Privy’s modal is active
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-4 text-center text-white">
        <p className="text-sm">Opening secure MFA…</p>
      </div>
    </div>
  );
}

export default function SignInPage() {
  const router = useRouter();
  const { ready } = usePrivy();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pendingMfa, setPendingMfa] = useState(false);

  // OAuth → after primary login completes, we push into Privy’s MFA UIs
  const { initOAuth, state: oauthState } = useLoginWithOAuth({
    onComplete: () => {
      setErr(null);
      setPendingMfa(true);
    },
    onError: (code) => setErr(code || "OAuth failed"),
  });

  // Email OTP → after primary login completes, we push into Privy’s MFA UIs
  const {
    sendCode,
    loginWithCode,
    state: emailState,
  } = useLoginWithEmail({
    onComplete: () => {
      setErr(null);
      setPendingMfa(true);
    },
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
          <h1 className="text-2xl font-semibold">Sign in to Haven</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Continue with Google or an email code. We’ll confirm MFA with
            Privy’s secure UI before taking you to your dashboard.
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
                {isEmailSubmitting ? "Verifying…" : "Sign in"}
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
              New to Haven?
            </p>
            <Link href="/sign-up">
              <button className="w-full rounded-lg bg-[rgb(182,255,62)]/10 hover:bg-[rgb(182,255,62)]/20 border border-[rgb(182,255,62)]/30 px-4 py-2 text-[rgb(182,255,62)] transition-all duration-200 font-medium">
                Create account
              </button>
            </Link>
          </div>
        </footer>
      </div>

      {/* MFA (Privy modal) — appears AFTER OAuth/Email completes */}
      {pendingMfa && (
        <PrivyMfaGate
          onSuccess={() => setPendingMfa(false)}
          onFail={(message) => {
            setErr(message || "MFA failed.");
            setPendingMfa(false);
          }}
        />
      )}
    </div>
  );
}
