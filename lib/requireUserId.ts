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

const privy = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET_KEY);

export async function requireUserId(req: NextRequest): Promise<string> {
  // 1) Cookie session (your existing flow)
  const cookieToken = req.cookies.get("__session")?.value ?? null;
  const cookieClaims = cookieToken ? verifySession(cookieToken) : null;
  if (cookieClaims?.userId) return cookieClaims.userId;

  // 2) Privy bearer token (map privyId -> User)
  const auth =
    req.headers.get("authorization") || req.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) {
    const bearer = auth.slice(7).trim();
    try {
      const claims = await privy.verifyAuthToken(bearer);
      const privyId = claims?.userId;
      if (privyId) {
        await connect();
        const u = await User.findOne({ privyId })
          .select("_id")
          .lean<{ _id: unknown } | null>();
        if (u?._id) return String(u._id);
      }
    } catch {
      // fall through to dev escape hatch / error
    }
  }

  // 3) Dev escape hatch (optional)
  if (process.env.NODE_ENV !== "production") {
    const devId = req.headers.get("x-dev-user-id");
    if (devId) return devId;
  }

  throw new Error("Unauthorized");
}
