// lib/auth.ts
import "server-only";
import jwt, {
  type JwtPayload,
  type Secret,
  type SignOptions,
} from "jsonwebtoken";
import crypto from "crypto";

/* ───────────────────────── Session JWT (unchanged) ───────────────────────── */

const RAW_SECRET = process.env.JWT_SECRET;
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

function isAppClaims(x: unknown): x is AppClaims {
  if (!x || typeof x !== "object") return false;
  const rec = x as Record<string, unknown>;
  return (
    typeof rec.privyId === "string" &&
    typeof rec.userId === "string" &&
    typeof rec.email === "string"
  );
}

export function signSession(claims: AppClaims, maxAgeSec: number): string {
  const opts: SignOptions = { expiresIn: maxAgeSec, algorithm: "HS256" };
  return jwt.sign(claims, JWT_SECRET, opts);
}

export function verifySession(token?: string | null): AppClaims | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload | string;
    if (typeof decoded === "string") return null;
    return isAppClaims(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function getClaimsFromRequest(req: {
  cookies: { get(name: string): { value: string } | undefined };
}): AppClaims | null {
  const token = req.cookies.get("__session")?.value ?? null;
  return verifySession(token);
}

/* ─────────────────────────── Privy RPC helpers ──────────────────────────── */
/**
 * PRIVY_AUTH_PRIVATE_KEY_B64 is given as "wallet-auth:<base64-der-pkcs8>".
 * Convert that to a PKCS#8 PEM for Node's crypto.sign (ES256 / P-256 / SHA-256).
 */
function privyAuthKeyToPem(authKeyB64WithPrefix: string): string {
  const prefix = "wallet-auth:";
  const raw = authKeyB64WithPrefix.startsWith(prefix)
    ? authKeyB64WithPrefix.slice(prefix.length)
    : authKeyB64WithPrefix;

  const lines = raw.match(/.{1,64}/g) ?? [raw];
  return [
    "-----BEGIN PRIVATE KEY-----",
    ...lines,
    "-----END PRIVATE KEY-----",
  ].join("\n");
}

/**
 * Build an ES256 (P-256/SHA-256) signature over the *exact* JSON body string.
 * Result is DER-encoded ECDSA, base64-encoded (what Privy expects).
 */
function createPrivyAuthorizationSignature(
  bodyString: string,
  authKeyB64WithPrefix: string
): string {
  const pem = privyAuthKeyToPem(authKeyB64WithPrefix);
  const signer = crypto.createSign("sha256");
  signer.update(Buffer.from(bodyString, "utf8"));
  signer.end();
  return signer.sign({ key: pem }).toString("base64");
}

/**
 * Build headers + body for Privy Wallet RPC:
 *   POST https://api.privy.io/v1/wallets/:wallet_id/rpc
 *
 * Env required:
 *   PRIVY_APP_ID
 *   PRIVY_SECRET_KEY
 *   PRIVY_AUTH_PRIVATE_KEY_B64   // "wallet-auth:..." from Privy dashboard
 */
export async function buildPrivyRpcRequest(body: unknown): Promise<{
  headers: Record<string, string>;
  bodyString: string;
}> {
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_SECRET_KEY;
  const authKey = process.env.PRIVY_AUTH_PRIVATE_KEY_B64;

  if (!appId || !appSecret || !authKey) {
    throw new Error(
      "Missing PRIVY_APP_ID / PRIVY_SECRET_KEY / PRIVY_AUTH_PRIVATE_KEY_B64"
    );
  }

  // IMPORTANT: sign the exact string you send
  const bodyString = JSON.stringify(body);
  const signature = createPrivyAuthorizationSignature(bodyString, authKey);
  const basic = Buffer.from(`${appId}:${appSecret}`).toString("base64");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "privy-app-id": appId,
    Authorization: `Basic ${basic}`,
    "privy-authorization-signature": signature,
  };

  return { headers, bodyString };
}
