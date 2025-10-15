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

/* ------------------------------------------------------------------ */
/* Force-reset helper: revoke Privy session and hard-reload to sign-in */
/* ------------------------------------------------------------------ */
async function hardResetToSignIn({
  logout,
  router,
}: {
  logout: () => Promise<void>;
  router: ReturnType<typeof useRouter>;
}) {
  try {
    await logout();
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") {
    window.location.replace("/sign-in");
  } else {
    router.replace("/sign-in");
  }
}

/**
 * Privy MFA: enroll (if needed) + verify, then finalize session.
 * Renders an overlay while Privy’s modals are open.
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
  const { promptMfa, init: initMfa /*, cancel */ } = useMfa();

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const hasAnyMfa =
          Array.isArray(user?.mfaMethods) &&
          (user?.mfaMethods?.length ?? 0) > 0;

        if (!hasAnyMfa) {
          // If closed/canceled by the user, this throws and is caught below.
          await showMfaEnrollmentModal();
        }

        try {
          // Some SDK versions expose init; safe to try.
          // @ts-expect-error init may be optional depending on SDK version
          await initMfa();
        } catch {
          /* noop */
        }

        // If canceled/dismissed, this throws.
        await promptMfa();

        const tok = await getAccessToken();
        if (!tok) throw new Error("Missing Privy access token after MFA");

        await postSession(tok);

        if (!mounted) return;
        onSuccess();
        router.replace("/dashboard");
      } catch (err: unknown) {
        if (!mounted) return;
        const e = err as { message?: string };

        // Treat *any* failure/dismissal as a hard reset back to sign-in.
        onFail(e?.message || "MFA was canceled or failed.");
        await hardResetToSignIn({ logout, router });
      }
    })();

    return () => {
      mounted = false;
      // Optional on newer SDKs:
      // try { cancel?.(); } catch {}
    };
  }, [
    user?.mfaMethods,
    showMfaEnrollmentModal,
    promptMfa,
    initMfa,
    getAccessToken,
    logout,
    router,
    onSuccess,
    onFail,
  ]);

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
  const { ready, logout } = usePrivy();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pendingMfa, setPendingMfa] = useState(false);

  // OAuth → then MFA
  const { initOAuth, state: oauthState } = useLoginWithOAuth({
    onComplete: () => {
      setErr(null);
      setPendingMfa(true);
    },
    onError: (code) => setErr(code || "OAuth failed"),
  });

  // Email OTP → then MFA
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
    <main className="relative min-h-[100svh] bg-black/40 text-white overflow-hidden">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(50%_35%_at_80%_10%,rgba(182,255,62,0.10),transparent),radial-gradient(40%_30%_at_10%_80%,rgba(182,255,62,0.06),transparent)]" />
      </div>

      {/* Subtle grid + vignette */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 opacity-[0.04] [background:linear-gradient(rgba(255,255,255,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.2)_1px,transparent_1px)] [background-size:24px_24px]" />
        <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_30%,rgba(0,0,0,0),rgba(0,0,0,0.5))]" />
      </div>

      {/* Centered auth card */}
      <div className="pwa-top-offset flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          {/* Brand header */}
          <div className="mb-6 text-center">
            <div className="inline-flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-[rgb(182,255,62)] animate-pulse" />
              <span className="text-sm tracking-wide text-white/60">
                Secure sign-in
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">
              Welcome back to{" "}
              <span className="text-[rgb(182,255,62)]">Haven</span>
            </h1>
            <p className="mt-1 text-sm text-white/60">
              Continue with Google or email. We’ll confirm MFA to protect your
              account.
            </p>
          </div>

          {/* Glass card */}
          <div className="relative rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 shadow-[0_10px_50px_rgba(0,0,0,0.45)]">
            {/* Subtle inner ring/glow */}
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

            {/* Email */}
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
                    {isEmailSubmitting ? "Verifying…" : "Sign in"}
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
              {(err || oauthErr || emailFlowErr) && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300">
                  {err || oauthErr || emailFlowErr}
                </div>
              )}
            </div>

            {/* Bottom line / links */}
            <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-xs text-white/60 text-center">New to Haven?</p>
              <Link href="/sign-up" className="mt-2 block">
                <button className="w-full rounded-xl bg-[rgb(182,255,62)]/12 hover:bg-[rgb(182,255,62)]/18 border border-[rgb(182,255,62)]/30 px-4 py-3 text-[rgb(182,255,62)] transition-all duration-200 font-medium">
                  Create account
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

      {/* MFA (Privy modal) — appears AFTER OAuth/Email completes */}
      {pendingMfa && (
        <PrivyMfaGate
          onSuccess={() => setPendingMfa(false)}
          onFail={async (message) => {
            setErr(message || "MFA failed.");
            setPendingMfa(false);
            await hardResetToSignIn({ logout, router });
          }}
        />
      )}
    </main>
  );
}
