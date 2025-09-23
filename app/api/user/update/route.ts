// /app/api/user/update/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { connect } from "@/lib/db";
import User from "@/models/User";
import { PrivyClient } from "@privy-io/server-auth";

const privy = new PrivyClient(
  process.env.PRIVY_APP_ID!,
  process.env.PRIVY_APP_SECRET!
);

// Allow-list of fields a user can update themselves
const ALLOWED_KEYS = new Set([
  "firstName",
  "lastName",
  "displayName",
  "displayCurrency",
  "countryISO",
  "phoneNumber",
  "dob",
  "address", // nested
]);

type Address = {
  line1: string;
  line2?: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  country: string; // ISO-3166 alpha-2
};

function pickAllowed(body: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!body || typeof body !== "object") return out;
  for (const k of Object.keys(body as Record<string, unknown>)) {
    if (!ALLOWED_KEYS.has(k)) continue;
    out[k] = (body as Record<string, unknown>)[k];
  }
  return out;
}

type UpdateDoc = Partial<{
  firstName: string;
  lastName: string;
  displayName: string;
  displayCurrency: string;
  countryISO: string;
  phoneNumber: string;
  dob: Date;
  address: Address;
}>;

function validateAndCoerce(input: Record<string, unknown>): UpdateDoc {
  const out: UpdateDoc = {};

  if (typeof input.firstName === "string")
    out.firstName = input.firstName.trim();
  if (typeof input.lastName === "string") out.lastName = input.lastName.trim();
  if (typeof input.displayName === "string")
    out.displayName = input.displayName.trim();

  if (typeof input.displayCurrency === "string") {
    const cur = input.displayCurrency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur))
      throw new Error("displayCurrency must be a 3-letter ISO code.");
    out.displayCurrency = cur;
  }

  if (typeof input.countryISO === "string") {
    const cc = input.countryISO.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc))
      throw new Error("countryISO must be a 2-letter ISO code.");
    out.countryISO = cc;
  }

  if (typeof input.phoneNumber === "string") {
    const pn = input.phoneNumber.trim();
    // very light validation; you can replace with libphonenumber if desired
    if (pn.length < 6 || pn.length > 32)
      throw new Error("phoneNumber looks invalid.");
    out.phoneNumber = pn;
  }

  if (input.dob != null) {
    const d = new Date(input.dob as string | number | Date);
    if (Number.isNaN(d.getTime())) throw new Error("dob must be a valid date.");
    out.dob = d;
  }

  if (input.address != null) {
    const a = input.address as Partial<Address>;
    const clean: Address = {
      line1: String(a.line1 ?? "").trim(),
      line2: String(a.line2 ?? "").trim(),
      city: String(a.city ?? "").trim(),
      stateOrProvince: String(a.stateOrProvince ?? "").trim(),
      postalCode: String(a.postalCode ?? "").trim(),
      country: String(a.country ?? "")
        .trim()
        .toUpperCase(),
    };
    // required fields
    if (
      !clean.line1 ||
      !clean.city ||
      !clean.stateOrProvince ||
      !clean.postalCode ||
      !/^[A-Z]{2}$/.test(clean.country)
    ) {
      throw new Error(
        "address is missing required fields or has invalid country."
      );
    }
    out.address = clean;
  }

  return out;
}

async function getPrivyUserId(req: Request) {
  const authz =
    req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authz?.startsWith("Bearer "))
    throw new Error("Missing Authorization bearer token.");
  const token = authz.slice("Bearer ".length).trim();
  const verified = await privy.verifyAuthToken(token); // throws on failure
  return verified.userId; // privyId
}

export async function PATCH(req: Request) {
  try {
    const privyId = await getPrivyUserId(req);
    const json = await req.json().catch(() => ({}));
    const allowed = pickAllowed(json);
    const update = validateAndCoerce(allowed);

    if (!Object.keys(update).length) {
      return NextResponse.json(
        { ok: false, error: "No valid fields to update." },
        { status: 400 }
      );
    }

    await connect();

    const user = await User.findOneAndUpdate(
      { privyId },
      { $set: update },
      { new: true, runValidators: true }
    );

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "User not found." },
        { status: 404 }
      );
    }

    // By design, fields with select:false (dob, phoneNumber, address) will not be included
    // unless you explicitly select them. Usually returning the public profile is fine.
    return NextResponse.json({ ok: true, user });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = /authorization|bearer|token/i.test(msg) ? 401 : 400;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}

// Optional: allow POST for older callers
export const POST = PATCH;
