// lib/requireUserId.ts
import { NextRequest } from "next/server";
import { verifySession } from "@/lib/auth";

export async function requireUserId(req: NextRequest): Promise<string> {
  // 1) Cookie session (your current flow)
  const cookieToken = req.cookies.get("__session")?.value ?? null;
  const cookieClaims = cookieToken ? verifySession(cookieToken) : null;
  if (cookieClaims?.userId) return cookieClaims.userId;

  // 2) Bearer token (wire your Privy verifier here when ready)
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const bearer = auth.slice(7).trim();

    // TEMP: if your bearer is actually your own JWT, this works:
    const bearerClaims = verifySession(bearer);
    if (bearerClaims?.userId) return bearerClaims.userId;

    // TODO (recommended): replace with a Privy token verifier
    // e.g. const { userId } = await verifyPrivyToken(bearer)
    // if (userId) return userId;
  }

  // 3) Dev-only escape hatch — super handy while debugging
  if (process.env.NODE_ENV !== "production") {
    const devId = req.headers.get("x-dev-user-id");
    if (devId) return devId;
  }

  throw new Error("Unauthorized");
}
