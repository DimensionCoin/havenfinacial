// app/api/fx/route.ts
import { NextResponse, NextRequest } from "next/server";
import { PrivyClient } from "@privy-io/server-auth";
import { jwtVerify } from "jose";
import { connect } from "@/lib/db";
import User from "@/models/User";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_ID = process.env.PRIVY_APP_ID!;
const SECRET = process.env.PRIVY_SECRET_KEY!;
const JWT_SECRET = process.env.JWT_SECRET!;
if (!APP_ID || !SECRET || !JWT_SECRET) throw new Error("Missing env vars");

const privy = new PrivyClient(APP_ID, SECRET);
const enc = new TextEncoder();
const SESSION_COOKIE = "haven_session";

// ---------- helpers ----------
function readBearer(req: Request): string | null {
  const authz = req.headers.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ")) {
    const t = authz.slice(7).trim();
    if (t) return t;
  }
  return null;
}

function readCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  const target = name.toLowerCase() + "=";
  const part = cookie
    .split(";")
    .map((s) => s.trim())
    .find((c) => c.toLowerCase().startsWith(target));
  return part ? decodeURIComponent(part.substring(target.length)) : null;
}

async function getUserDocFromRequest(req: Request) {
  // 1) Prefer Privy bearer: verify and find by privyId
  const bearer = readBearer(req);
  if (bearer) {
    try {
      const claims = await privy.verifyAuthToken(bearer);
      const privyId = claims.userId;
      await connect();
      const byPrivy = await User.findOne({ privyId }).lean();
      if (byPrivy) return byPrivy;
    } catch {
      // fall through to cookie
    }
  }

  // 2) Fallback to app session cookie (haven_session) -> verify JWT -> find by _id
  const sessionJwt = readCookie(req, SESSION_COOKIE);
  if (!sessionJwt) return null;

  try {
    const { payload } = await jwtVerify(sessionJwt, enc.encode(JWT_SECRET));
    const uid =
      (typeof payload.uid === "string" && payload.uid) ||
      (typeof payload.userId === "string" && payload.userId) ||
      null;
    if (!uid) return null;
    await connect();
    const byId = await User.findById(uid).lean();
    return byId;
  } catch {
    return null;
  }
}

const norm3 = (s?: string) => (s || "").trim().toUpperCase();
const normalizeTargetCurrency = (c: string) =>
  norm3(c) === "USDC" ? "USD" : norm3(c);

// ---------- external providers (free, no key) ----------
async function fetchRateUSDTo_Frankfurter(
  target: string
): Promise<{ rate: number; asOf?: string; source: string }> {
  const r = await fetch(
    `https://api.frankfurter.app/latest?from=USD&to=${encodeURIComponent(
      target
    )}`,
    { next: { revalidate: 300 } }
  );
  if (!r.ok) throw new Error(`Frankfurter error ${r.status}`);
  const j = (await r.json()) as {
    rates?: Record<string, number>;
    date?: string;
  };
  const rate = Number(j?.rates?.[target]);
  if (!isFinite(rate) || rate <= 0) throw new Error("Frankfurter missing rate");
  return { rate, asOf: j.date, source: "frankfurter" };
}

async function fetchRateUSDTo_ERAPI(
  target: string
): Promise<{ rate: number; asOf?: string; source: string }> {
  const r = await fetch("https://open.er-api.com/v6/latest/USD", {
    next: { revalidate: 300 },
  });
  if (!r.ok) throw new Error(`ER-API error ${r.status}`);
  const j = (await r.json()) as {
    rates?: Record<string, number>;
    time_last_update_utc?: string;
  };
  const rate = Number(j?.rates?.[target]);
  if (!isFinite(rate) || rate <= 0) throw new Error("ER-API missing rate");
  return { rate, asOf: j.time_last_update_utc, source: "open.er-api.com" };
}

async function fetchRateUSDTo_ExchangerateHost(
  target: string
): Promise<{ rate: number; asOf?: string; source: string }> {
  const r = await fetch(
    `https://api.exchangerate.host/latest?base=USD&symbols=${encodeURIComponent(
      target
    )}`,
    { next: { revalidate: 300 } }
  );
  if (!r.ok) throw new Error(`exchangerate.host error ${r.status}`);
  const j = (await r.json()) as {
    rates?: Record<string, number>;
    date?: string;
  };
  const rate = Number(j?.rates?.[target]);
  if (!isFinite(rate) || rate <= 0)
    throw new Error("exchangerate.host missing rate");
  return { rate, asOf: j.date, source: "exchangerate.host" };
}

async function fetchRateUSDTo(target: string) {
  const attempts = [
    fetchRateUSDTo_Frankfurter,
    fetchRateUSDTo_ERAPI,
    fetchRateUSDTo_ExchangerateHost,
  ];
  let lastErr: unknown = null;
  for (const fn of attempts) {
    try {
      return await fn(target);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("No FX provider available");
}

// ---------- route ----------
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    // Accept either ?currency=CAD or ?to=CAD
    const toParam =
      url.searchParams.get("currency") || url.searchParams.get("to");
    const amountStr = url.searchParams.get("amount") || "0"; // amount in USDC (≈ USD)
    const amount = Number(amountStr);
    if (!isFinite(amount) || amount < 0) {
      return new NextResponse("Invalid amount", { status: 400 });
    }

    // auth (bearer OR haven_session)
    const userDoc = await getUserDocFromRequest(req);
    if (!userDoc) return new NextResponse("Unauthorized", { status: 401 });

    // find user's target currency if not provided
    const target = normalizeTargetCurrency(
      toParam || userDoc.displayCurrency || "USD"
    );

    // USDC is pegged to USD
    if (target === "USD") {
      return NextResponse.json(
        {
          base: "USD",
          target: "USD",
          rate: 1,
          amount,
          converted: amount,
          asOf: null,
          source: "peg",
          timestamp: Date.now(),
        },
        {
          headers: {
            "Cache-Control": "no-store",
            Vary: "Authorization, Cookie",
          },
        }
      );
    }

    // Get USD→target rate with robust fallbacks
    const { rate, asOf, source } = await fetchRateUSDTo(target);

    return NextResponse.json(
      {
        base: "USD",
        target,
        rate,
        amount,
        converted: amount * rate,
        asOf: asOf ?? null,
        source,
        timestamp: Date.now(),
      },
      {
        headers: { "Cache-Control": "no-store", Vary: "Authorization, Cookie" },
      }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new NextResponse(`FX failed: ${msg}`, { status: 400 });
  }
}
