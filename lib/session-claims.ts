// lib/session-claims.ts
import "server-only";
import { jwtVerify, type JWTPayload } from "jose";
import type { NextRequest } from "next/server";

const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

type HavenClaims = JWTPayload & {
  uid: string; // Mongo user _id (string)
  email: string;
  status?: string;
  kycStatus?: string;
};

export async function requireUserIdFromHavenSession(
  req: NextRequest
): Promise<string> {
  const tok = req.cookies.get("haven_session")?.value;
  if (!tok) throw new Error("Unauthorized");
  const { payload } = await jwtVerify(tok, secret);
  const uid = (payload as HavenClaims).uid;
  if (!uid || typeof uid !== "string") throw new Error("Unauthorized");
  return uid;
}
