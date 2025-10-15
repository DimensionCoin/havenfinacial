// app/api/auth/logout/route.ts
import "server-only";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_SESSION = "haven_session"; // <-- your real app cookie
const PRIVY_COOKIE = "privy-token"; // if you use Privy's cookie mode
const ONBOARDED = "onboarded"; // any client cookie you set

function expire(res: NextResponse, name: string, httpOnly = false) {
  // MUST match attributes you used when setting the cookie
  res.cookies.set({
    name,
    value: "",
    httpOnly,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0, // expire immediately
  });
}

async function handler() {
  const res = NextResponse.json({ ok: true });

  // clear app session (HttpOnly)
  expire(res, APP_SESSION, true);

  // clear any non-HttpOnly app cookies you rely on
  expire(res, ONBOARDED, false);

  // best-effort: clear Privy cookie if your app is in cookie mode
  // (cookie might be HttpOnly if Privy set it that way)
  expire(res, PRIVY_COOKIE, true);

  // avoid caching this response
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export const POST = handler;
export const DELETE = handler;
