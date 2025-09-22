// app/api/fx/route.ts
import { NextResponse } from "next/server";
import { PrivyClient } from "@privy-io/server-auth";
import { connect } from "@/lib/db";
import User from "@/models/User";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_ID = process.env.PRIVY_APP_ID!;
const SECRET = process.env.PRIVY_SECRET_KEY!;
if (!APP_ID || !SECRET) throw new Error("Missing Privy env vars");

// ---------- helpers ----------
function readAccessTokenFromRequest(req: Request): string | null {
  const authz = req.headers.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ")) {
    const t = authz.slice(7).trim();
    if (t) return t;
  }
  const cookie = req.headers.get("cookie");
  if (cookie) {
    const match = cookie
      .split(";")
      .map((s) => s.trim())
      .find((c) => c.toLowerCase().startsWith("privy-token="));
    if (match)
      return decodeURIComponent(match.substring("privy-token=".length));
  }
  return null;
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
    {
      next: { revalidate: 300 },
    }
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
export async function GET(req: Request) {
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

    // auth
    const accessToken = readAccessTokenFromRequest(req);
    if (!accessToken)
      return new NextResponse("Missing access token", { status: 401 });

    const client = new PrivyClient(APP_ID, SECRET);
    const claims = await client.verifyAuthToken(accessToken);
    const privyId = claims.userId;

    // find user's target currency if not provided
    await connect();
    const doc = await User.findOne({ privyId }).lean();
    if (!doc) return new NextResponse("User not found", { status: 404 });

    const target = normalizeTargetCurrency(
      toParam || doc.displayCurrency || "USD"
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
