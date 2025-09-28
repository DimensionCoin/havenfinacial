// lib/requireUserId.ts
import "server-only";
import { NextRequest } from "next/server";
import { PrivyClient } from "@privy-io/server-auth";
import { verifySession } from "@/lib/auth";
import { connect } from "@/lib/db";
import User from "@/models/User";

const PRIVY_APP_ID = process.env.PRIVY_APP_ID!;
const PRIVY_SECRET_KEY = process.env.PRIVY_SECRET_KEY!;
if (!PRIVY_APP_ID || !PRIVY_SECRET_KEY) {
  throw new Error("Missing PRIVY_APP_ID / PRIVY_SECRET_KEY");
}

// Verify-only client (no walletApi needed here)
const privy = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET_KEY);

function readBearer(req: NextRequest): string | null {
  const raw =
    req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  const lower = raw.toLowerCase();
  if (!lower.startsWith("bearer ")) return null;
  return raw.slice(7).trim();
}

export async function requireUserId(req: NextRequest): Promise<string> {
  // 1) App cookie (__session) → your own JWT with userId
  const cookieToken = req.cookies.get("__session")?.value ?? null;
  const cookieClaims = cookieToken ? verifySession(cookieToken) : null;
  if (cookieClaims?.userId) return cookieClaims.userId;

  // 2) Privy bearer → map privyId → your User record
  const bearer = readBearer(req);
  if (bearer) {
    // Throws on invalid/expired token
    const { userId: privyId } = await privy.verifyAuthToken(bearer);
    if (!privyId) throw new Error("Unauthorized");

    await connect();
    const u = await User.findOne({ privyId }).select("_id").lean();
    if (!u?._id) throw new Error("Unauthorized");
    return String(u._id);
  }

  // 3) Non-prod dev escape hatch only
  if (process.env.NODE_ENV !== "production") {
    const devId = req.headers.get("x-dev-user-id");
    if (devId) return devId;
  }

  throw new Error("Unauthorized");
}
