// lib/claim-token.ts
import jwt, { JwtPayload } from "jsonwebtoken";

const CLAIM_TOKEN_SECRET = process.env.CLAIM_TOKEN_SECRET!;
if (!CLAIM_TOKEN_SECRET) throw new Error("Missing CLAIM_TOKEN_SECRET");

export interface ClaimTokenPayload {
  claimId: string;
  recipientEmail: string;
  expiresAt: string;
}
const toIso = (d: Date | string) =>
  typeof d === "string" ? new Date(d).toISOString() : d.toISOString();

export function signClaimToken(input: {
  claimId: string;
  recipientEmail: string;
  expiresAt: Date | string;
}): string {
  const expiresAtIso = toIso(input.expiresAt);
  const expSeconds = Math.floor(new Date(expiresAtIso).getTime() / 1000);
  return jwt.sign(
    {
      claimId: input.claimId,
      recipientEmail: input.recipientEmail.toLowerCase(),
      expiresAt: expiresAtIso,
      exp: expSeconds,
    },
    CLAIM_TOKEN_SECRET
  );
}

export function verifyClaimToken(token: string): ClaimTokenPayload | null {
  try {
    const raw = jwt.verify(token, CLAIM_TOKEN_SECRET) as JwtPayload;
    const claimId = raw?.claimId ?? raw?.cid;
    const recipientEmail = (raw?.recipientEmail ?? raw?.eml)?.toLowerCase?.();
    const expiresAt =
      typeof raw?.expiresAt === "string"
        ? new Date(raw.expiresAt).toISOString()
        : typeof raw?.exp === "number"
        ? new Date(raw.exp * 1000).toISOString()
        : undefined;
    if (
      typeof claimId === "string" &&
      typeof recipientEmail === "string" &&
      typeof expiresAt === "string"
    ) {
      return { claimId, recipientEmail, expiresAt };
    }
    return null;
  } catch {
    return null;
  }
}
