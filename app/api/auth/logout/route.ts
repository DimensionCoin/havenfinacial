// app/api/auth/logout/route.ts
import "server-only";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_COOKIE = "__session";
const PRIVY_COOKIE = "privy-token";

function clearCookie(res: NextResponse, name: string, httpOnly = false) {
  // overwrite with an immediate-expiry cookie
  res.cookies.set({
    name,
    value: "",
    httpOnly,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

async function handler() {
  const res = NextResponse.json({ ok: true });

  // clear app session
  clearCookie(res, SESSION_COOKIE, true);

  // best-effort: clear Privy token cookie if it exists on your domain
  clearCookie(res, PRIVY_COOKIE, false);

  // optional: prevent caching of this response
  res.headers.set("Cache-Control", "no-store");

  return res;
}

export const POST = handler;
export const DELETE = handler;
