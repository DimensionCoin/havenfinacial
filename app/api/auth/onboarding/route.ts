// app/api/auth/onboarding/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { PrivyClient } from "@privy-io/server-auth";
import { connect } from "@/lib/db";
import User from "@/models/User";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ---- Env / setup ---- */
const APP_ID = process.env.PRIVY_APP_ID!;
const SECRET = process.env.PRIVY_SECRET_KEY!;
if (!APP_ID || !SECRET) throw new Error("Missing Privy env vars");
const privy = new PrivyClient(APP_ID, SECRET);

// Terms versions (override in .env when you bump legal docs)
const TOS_VERSION = process.env.TOS_VERSION ?? "1.0";
const PRIVACY_VERSION = process.env.PRIVACY_VERSION ?? "1.0";

/** ---- Helpers ---- */
const RESTRICTED_COUNTRIES = new Set(["CU", "IR", "KP", "SY"]);

function isISO2(x?: string) {
  return typeof x === "string" && /^[A-Z]{2}$/.test(x.toUpperCase());
}
function isISO3(x?: string) {
  return typeof x === "string" && /^[A-Z]{3}$/.test(x.toUpperCase());
}
function parseDOB(yyyyMmDd?: string): Date | null {
  if (!yyyyMmDd) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
function yearsBetween(dob: Date, ref = new Date()): number {
  const rY = ref.getUTCFullYear(),
    rM = ref.getUTCMonth(),
    rD = ref.getUTCDate();
  const y = dob.getUTCFullYear(),
    m = dob.getUTCMonth(),
    d = dob.getUTCDate();
  let yrs = rY - y;
  if (rM < m || (rM === m && rD < d)) yrs -= 1;
  return yrs;
}
type Address = {
  line1: string;
  line2?: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  country: string;
};

function hasFullAddress(a?: unknown): a is {
  line1: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  country: string;
} {
  return Boolean(
    a &&
      typeof (a as Record<string, unknown>).line1 === "string" &&
      typeof (a as Record<string, unknown>).city === "string" &&
      typeof (a as Record<string, unknown>).stateOrProvince === "string" &&
      typeof (a as Record<string, unknown>).postalCode === "string" &&
      typeof (a as Record<string, unknown>).country === "string" &&
      isISO2((a as Record<string, string>).country)
  );
}

export function GET() {
  return new NextResponse("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

/** ---- Route ---- */
export async function POST(req: NextRequest) {
  try {
    await connect();

    // Accept Privy access token from Authorization header or cookie (privy-token)
    const hdr = req.headers.get("authorization") || "";
    const bearer = hdr.startsWith("Bearer ") ? hdr.slice(7).trim() : null;
    const cookieTok = req.cookies.get("privy-token")?.value;
    const accessToken = bearer || cookieTok;
    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing access token" },
        { status: 401 }
      );
    }

    // Verify session and identify Privy user
    const claims = await privy.verifyAuthToken(accessToken);
    const privyUserId = claims.userId;

    type Body = {
      firstName: string;
      lastName: string;
      countryISO: string; // ISO-2
      displayCurrency?: string; // ISO-3
      phoneNumber?: string;
      dob?: string; // YYYY-MM-DD
      address?: {
        line1: string;
        line2?: string;
        city: string;
        stateOrProvince: string;
        postalCode: string;
        country?: string; // ISO-2
      };
      consents?: { tos?: boolean; privacy?: boolean };
    };
    const body = (await req.json()) as Body;

    // ---- Validate minimal fields ----
    const firstName = (body.firstName ?? "").trim();
    const lastName = (body.lastName ?? "").trim();
    const countryISO = (body.countryISO ?? "").trim().toUpperCase();
    const displayCurrency = (body.displayCurrency ?? "").trim().toUpperCase();
    const phoneNumber = (body.phoneNumber ?? "").trim();

    if (!firstName || !lastName) {
      return NextResponse.json(
        { error: "First and last name are required" },
        { status: 400 }
      );
    }
    if (!isISO2(countryISO)) {
      return NextResponse.json(
        { error: "countryISO must be ISO-3166 alpha-2" },
        { status: 400 }
      );
    }
    if (RESTRICTED_COUNTRIES.has(countryISO)) {
      return NextResponse.json(
        { error: "Service unavailable in your country" },
        { status: 403 }
      );
    }
    if (displayCurrency && !isISO3(displayCurrency)) {
      return NextResponse.json(
        { error: "displayCurrency must be ISO-4217 alpha-3" },
        { status: 400 }
      );
    }

    // Address (optional but preferred for instant approval)
    const addr: Address | undefined = body.address
      ? {
          line1: (body.address.line1 ?? "").trim(),
          line2: (body.address.line2 ?? "").trim(),
          city: (body.address.city ?? "").trim(),
          stateOrProvince: (body.address.stateOrProvince ?? "").trim(),
          postalCode: (body.address.postalCode ?? "").trim(),
          country: (body.address.country ?? countryISO).trim().toUpperCase(),
        }
      : undefined;

    const dobDate = parseDOB(body.dob);
    if (body.dob && !dobDate) {
      return NextResponse.json(
        { error: "dob must be YYYY-MM-DD" },
        { status: 400 }
      );
    }

    // ---- Simple KYC rules (adjust later) ----
    const completeAddress = hasFullAddress(addr);
    const age = dobDate ? yearsBetween(dobDate) : -1;
    const canInstantApprove = Boolean(completeAddress && dobDate && age >= 18);

    const nextKycStatus: "approved" | "pending" = canInstantApprove
      ? "approved"
      : "pending";
    const nextUserStatus: "active" | "pending" = canInstantApprove
      ? "active"
      : "pending";

    // ---- Build updates ----
    type UserSetUpdate = {
      firstName: string;
      lastName: string;
      countryISO: string;
      status: "active" | "pending";
      kycStatus: "approved" | "pending";
      displayCurrency?: string;
      phoneNumber?: string;
      dob?: Date;
      address?: Address;
    };

    const $set: UserSetUpdate = {
      firstName,
      lastName,
      countryISO,
      status: nextUserStatus,
      kycStatus: nextKycStatus,
    };
    if (displayCurrency) $set.displayCurrency = displayCurrency;
    if (phoneNumber) $set.phoneNumber = phoneNumber;
    if (dobDate) $set.dob = dobDate;
    if (addr && completeAddress) $set.address = addr;

    // consents: upsert TOS+Privacy if checked
    const wantTos = body.consents?.tos === true;
    const wantPrivacy = body.consents?.privacy === true;

    const consentsToPush: Array<{
      type: "tos" | "privacy";
      version: string;
      acceptedAt: Date;
    }> = [];
    const now = new Date();
    if (wantTos)
      consentsToPush.push({
        type: "tos",
        version: TOS_VERSION,
        acceptedAt: now,
      });
    if (wantPrivacy)
      consentsToPush.push({
        type: "privacy",
        version: PRIVACY_VERSION,
        acceptedAt: now,
      });

    // ---- Ensure user exists ----
    const user = await User.findOne({ privyId: privyUserId })
      .select("_id")
      .lean();
    if (!user)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    // ---- Apply updates without path conflicts ----
    // 1) Always set profile + KYC fields
    type BulkUpdateOp = {
      updateOne: {
        filter: Record<string, unknown>;
        update: Record<string, unknown>;
      };
    };

    const ops: BulkUpdateOp[] = [
      {
        updateOne: {
          filter: { _id: user._id },
          update: { $set },
        },
      },
    ];

    // 2) If we need to upsert consents, do pull then push as separate ops
    if (consentsToPush.length) {
      const types = consentsToPush.map((c) => c.type);
      ops.push({
        updateOne: {
          filter: { _id: user._id },
          update: { $pull: { consents: { type: { $in: types } } } },
        },
      });
      ops.push({
        updateOne: {
          filter: { _id: user._id },
          update: { $push: { consents: { $each: consentsToPush } } },
        },
      });
    }

    await User.bulkWrite(ops);

    return NextResponse.json({ ok: true, kycStatus: nextKycStatus });
  } catch (err) {
    console.error("onboarding error", err);
    return NextResponse.json({ error: "Onboarding failed" }, { status: 500 });
  }
}
