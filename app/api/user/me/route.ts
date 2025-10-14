// app/api/user/me/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { connect } from "@/lib/db";
import User, { type IUser } from "@/models/User";
import { PrivyClient } from "@privy-io/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ---- Env ---- */
const APP_ID = process.env.PRIVY_APP_ID!;
const SECRET = process.env.PRIVY_SECRET_KEY!;
const JWT_SECRET = process.env.JWT_SECRET!;
if (!APP_ID || !SECRET || !JWT_SECRET)
  throw new Error("Missing PRIVY_APP_ID / PRIVY_SECRET_KEY / JWT_SECRET");

const privy = new PrivyClient(APP_ID, SECRET);
const enc = new TextEncoder();

// ❗ match the cookie you SET in /api/auth/session
const SESSION_COOKIE = "haven_session";

// Added savingsBaselineUi?: unknown so we don't need `as any`
type UserDocLean = IUser & { _id: unknown; savingsBaselineUi?: unknown };

async function verifySessionCookie(token?: string) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, enc.encode(JWT_SECRET));
    const rec = payload as Record<string, unknown>;
    const uid =
      (typeof rec.uid === "string" && rec.uid) ||
      (typeof rec.userId === "string" && rec.userId) ||
      null;
    return typeof uid === "string" ? uid : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    await connect();

    // Try Privy bearer FIRST, but don't fail if it’s missing/expired
    const auth = req.headers.get("authorization") || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;

    let userDoc: UserDocLean | null = null;

    if (bearer) {
      try {
        const claims = await privy.verifyAuthToken(bearer);
        const privyUserId = claims.userId;
        userDoc = await User.findOne({
          privyId: privyUserId,
        }).lean<UserDocLean>();
      } catch {
        // swallow bearer errors and fall through to cookie
      }
    }

    if (!userDoc) {
      const cookieTok = req.cookies.get(SESSION_COOKIE)?.value;
      const uid = await verifySessionCookie(cookieTok);
      if (!uid) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      userDoc = await User.findById(uid).lean<UserDocLean>();
    }

    if (!userDoc) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const hasDepositWallet = !!userDoc.depositWallet?.address;
    const hasMarginfiAccount = !!userDoc.marginfi?.accountPk;

    const toIso = (v: unknown): string | null =>
      v instanceof Date
        ? v.toISOString()
        : typeof v === "number" || typeof v === "string"
        ? new Date(v).toISOString()
        : null;

    // Removed `as any`; rely on the typed optional field
    const rawBaseline = userDoc.savingsBaselineUi;
    const savingsBaselineUi = typeof rawBaseline === "number" ? rawBaseline : 0;

    const payload = {
      id: String(userDoc._id),
      privyId: userDoc.privyId,
      email: userDoc.email,
      firstName: userDoc.firstName ?? null,
      lastName: userDoc.lastName ?? null,
      displayName:
        userDoc.displayName ||
        [userDoc.firstName, userDoc.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        null,
      countryISO: userDoc.countryISO ?? null,
      displayCurrency: userDoc.displayCurrency ?? "USD",
      status: userDoc.status,
      kycStatus: userDoc.kycStatus,
      riskLevel: userDoc.riskLevel,
      features: {
        onramp: !!userDoc.features?.onramp,
        cards: !!userDoc.features?.cards,
        lend: !!userDoc.features?.lend,
      },
      depositWallet: userDoc.depositWallet ?? null,
      tokenAccounts: {
        usdc2022: {
          depositAta: userDoc.tokenAccounts?.usdc2022?.depositAta || null,
        },
      },
      marginfi: {
        accountPk: userDoc.marginfi?.accountPk || null,
        usdcBankPk: userDoc.marginfi?.usdcBankPk || null,
        lastApy:
          typeof userDoc.marginfi?.lastApy === "number"
            ? userDoc.marginfi.lastApy
            : null,
        lastApyAt: userDoc.marginfi?.lastApyAt
          ? toIso(userDoc.marginfi.lastApyAt)
          : null,
      },
      savingsConsent: {
        enabled: !!userDoc.savingsConsent?.enabled,
        acceptedAt: userDoc.savingsConsent?.acceptedAt
          ? toIso(userDoc.savingsConsent.acceptedAt)
          : null,
        version: userDoc.savingsConsent?.version ?? "",
      },
      savingsBaselineUi,
      flags: {
        hasDepositWallet,
        hasMarginfiAccount,
        canOfframpFromDeposit: hasDepositWallet,
      },
      createdAt: userDoc.createdAt ? toIso(userDoc.createdAt) : null,
      updatedAt: userDoc.updatedAt ? toIso(userDoc.updatedAt) : null,
    };

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store", Vary: "Cookie" },
    });
  } catch (e) {
    console.error("GET /api/user/me error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
