// lib/auth.ts
import "server-only";
import jwt, {
  type JwtPayload,
  type Secret,
  type SignOptions,
} from "jsonwebtoken";

const RAW_SECRET = process.env.JWT_SECRET;
// Runtime guard (good error at boot) + strong typing for TS overloads:
if (!RAW_SECRET) throw new Error("Missing JWT_SECRET");
const JWT_SECRET: Secret = RAW_SECRET;

export type AppClaims = {
  /** did:privy:... */
  privyId: string;
  /** Mongo _id string for User */
  userId: string;
  /** normalized email */
  email: string;
};

// Narrow unknown payloads into AppClaims safely
function isAppClaims(x: unknown): x is AppClaims {
  if (!x || typeof x !== "object") return false;
  const rec = x as Record<string, unknown>;
  return (
    typeof rec.privyId === "string" &&
    typeof rec.userId === "string" &&
    typeof rec.email === "string"
  );
}

/** Create a signed session JWT for the "__session" cookie. */
export function signSession(claims: AppClaims, maxAgeSec: number): string {
  const opts: SignOptions = { expiresIn: maxAgeSec, algorithm: "HS256" };
  return jwt.sign(claims, JWT_SECRET, opts);
}

/** Verify a session token (returns null if invalid/expired or wrong shape). */
export function verifySession(token?: string | null): AppClaims | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload | string;
    // We sign objects, so decoded should be an object. Guard anyway:
    if (typeof decoded === "string") return null;
    return isAppClaims(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/** Optional helper to read + verify from a NextRequest-like object. */
export function getClaimsFromRequest(req: {
  cookies: { get(name: string): { value: string } | undefined };
}): AppClaims | null {
  const token = req.cookies.get("__session")?.value ?? null;
  return verifySession(token);
}
