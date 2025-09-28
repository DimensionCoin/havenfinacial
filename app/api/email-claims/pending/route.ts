import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connect } from "@/lib/db";
import EmailClaim from "@/models/EmailClaim";
import User from "@/models/User";
import { verifyClaimToken } from "@/lib/claim-token";
import { verifySession } from "@/lib/auth";
import { Types } from "mongoose";
import { PrivyClient } from "@privy-io/server-auth";

const PRIVY_APP_ID = process.env.PRIVY_APP_ID!;
const PRIVY_SECRET = process.env.PRIVY_SECRET_KEY!;
const privy = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DECIMALS = 6;
const jerr = (status: number, error: string, extra?: unknown) =>
  NextResponse.json(extra ? { error, extra } : { error }, { status });

const norm = (s: string) => s.trim().toLowerCase();

function readAccessToken(req: NextRequest): string | null {
  const a =
    req.headers.get("authorization") || req.headers.get("Authorization");
  return a?.toLowerCase().startsWith("bearer ") ? a.slice(7).trim() : null;
}

async function requireSignedInEmail(req: NextRequest): Promise<string> {
  // session cookie
  const cookie = req.cookies.get("__session")?.value ?? null;
  const claims = cookie ? verifySession(cookie) : null;
  if (claims?.email) return claims.email;

  // privy bearer
  const bearer = readAccessToken(req);
  if (!bearer) throw new Error("Unauthorized");
  const { userId: privyId } = await privy.verifyAuthToken(bearer);
  if (!privyId) throw new Error("Unauthorized");
  await connect();
  const u = await User.findOne({ privyId }).select("email").lean();
  if (!u?.email) throw new Error("Unauthorized");
  return u.email;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") || "";
    const me = url.searchParams.get("me");

    await connect();

    // Mode A: token-based (existing behavior)
    if (token) {
      const parsed = z.string().min(10).safeParse(token);
      if (!parsed.success) return jerr(400, "Missing or invalid token");

      const payload = verifyClaimToken(token);
      if (!payload?.recipientEmail || !payload?.expiresAt) {
        return jerr(401, "Invalid or expired token");
      }
      if (Date.now() > new Date(payload.expiresAt).getTime()) {
        return jerr(410, "This claim link has expired");
      }

      const now = new Date();
      const claims = (await EmailClaim.find({
        recipientEmail: norm(payload.recipientEmail),
        status: "pending",
        tokenExpiresAt: { $gt: now },
      })
        .sort({ createdAt: 1 })
        .lean()) as LeanEmailClaim[];

      return respondList(claims);
    }

    // Mode B: current user (no token, or ?me=1)
    if (me === "1" || me === "true" || !token) {
      const email = await requireSignedInEmail(req);

      const now = new Date();
      const claims = (await EmailClaim.find({
        recipientEmail: norm(email),
        status: "pending",
        tokenExpiresAt: { $gt: now },
      })
        .sort({ createdAt: 1 })
        .lean()) as LeanEmailClaim[];

      return respondList(claims);
    }

    return jerr(400, "Missing token or me=1");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jerr(/unauth/i.test(msg) ? 401 : 500, msg);
  }
}

type LeanEmailClaim = {
  _id: Types.ObjectId;
  createdAt: Date;
  amountUnits: number;
  note?: string | null;
  senderUserId?: Types.ObjectId | string | null;
  escrowSignature?: string | null;
  currency?: string | null;
};

async function respondList(raw: LeanEmailClaim[]) {
  if (!raw.length) {
    return NextResponse.json({
      ok: true,
      claims: [],
      totalCount: 0,
      totalAmountUi: 0,
    });
  }

  const senderIds = Array.from(new Set(raw.map((c) => String(c.senderUserId))));
  const senders = await User.find(
    { _id: { $in: senderIds } },
    { email: 1 }
  ).lean();
  const emailById = new Map(senders.map((s) => [String(s._id), s.email]));

  const claims = raw.map((c) => ({
    id: String(c._id),
    createdAt: c.createdAt,
    amountUi: Number(c.amountUnits) / 10 ** DECIMALS,
    note: c.note || null,
    senderEmail: emailById.get(String(c.senderUserId)) || "Unknown sender",
    escrowSignature: c.escrowSignature || null,
    currency: c.currency || "USDC",
  }));
  const totalAmountUi = claims.reduce((a, c) => a + c.amountUi, 0);

  return NextResponse.json({
    ok: true,
    claims,
    totalCount: claims.length,
    totalAmountUi,
  });
}
