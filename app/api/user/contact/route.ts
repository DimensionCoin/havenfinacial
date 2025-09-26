// app/api/user/contact/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { connect } from "@/lib/db";
import User from "@/models/User";
import { verifySession, getClaimsFromRequest } from "@/lib/auth";
import { PrivyClient } from "@privy-io/server-auth";
import { Types } from "mongoose";
import type { Collection } from "mongodb"; // 👈 add this

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ------------------------------- Privy client ------------------------------ */
const privy = new PrivyClient(
  process.env.PRIVY_APP_ID!,
  process.env.PRIVY_APP_SECRET!
);

/* ----------------------------- raw collection TS --------------------------- */
// Describe only the fields we touch so TS knows `contacts` exists.
type RawContact = {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  email: string;
};

type RawUser = {
  _id: Types.ObjectId;
  contacts?: RawContact[];
};

/* --------------------------------- utils --------------------------------- */

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CreateContactSchema = z.object({
  firstName: z.string().min(1).max(100).trim(),
  lastName: z.string().max(100).trim().optional().default(""),
  email: z
    .string()
    .min(3)
    .max(320)
    .trim()
    .transform((v) => v.toLowerCase())
    .refine((v) => emailRegex.test(v), { message: "Invalid email format" }),
});

// Helper that accepts either a ResponseInit or a numeric status code
function json<T>(data: T): NextResponse<T>;
function json<T>(data: T, init: number): NextResponse<T>;
function json<T>(data: T, init: ResponseInit): NextResponse<T>;
function json<T>(data: T, init?: number | ResponseInit): NextResponse<T> {
  if (typeof init === "number")
    return NextResponse.json<T>(data, { status: init });
  return NextResponse.json<T>(data, init);
}

/* ---------------------------- authentication ------------------------------ */
/** Resolve the authenticated user’s Mongo _id, accepting either:
 *  1) Your app session cookie (__session) or Bearer of your **app** JWT
 *  2) A **Privy** Bearer (like /api/user/update), then map by privyId
 */
async function getUserId(req: NextRequest): Promise<string | null> {
  // 1) Try your app session cookie (__session) first
  const cookieClaims = getClaimsFromRequest({
    cookies: {
      get: (name: string) => req.cookies.get(name) ?? undefined,
    },
  });
  if (cookieClaims?.userId) return cookieClaims.userId;

  // 1b) Try Bearer of your **app** JWT
  const authz =
    req.headers.get("authorization") || req.headers.get("Authorization");
  if (authz?.startsWith("Bearer ")) {
    const token = authz.slice("Bearer ".length).trim();
    const appClaims = verifySession(token);
    if (appClaims?.userId) return appClaims.userId;

    // 2) If not an app JWT, treat as **Privy** bearer and verify with Privy
    try {
      const verified = await privy.verifyAuthToken(token);
      const privyId = verified.userId; // did:privy:...
      await connect();
      const u = await User.findOne({ privyId }).select("_id").lean();
      return u?._id?.toString() ?? null;
    } catch {
      // fall through
    }
  }

  return null;
}

/* ---------------------------------- GET ---------------------------------- */
/** List all contacts for the authenticated user */
export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

    await connect();

    // Use native collection with correct generic so TS knows `contacts`.
    const coll = User.collection as unknown as Collection<RawUser>;
    const doc = await coll.findOne(
      { _id: new Types.ObjectId(userId) },
      { projection: { contacts: 1 } }
    );

    if (!doc) return json({ error: "User not found" }, { status: 404 });

    const contacts = (doc.contacts ?? []).map((c) => ({
      id: c._id?.toString?.() ?? String(c._id ?? ""),
      firstName: c.firstName,
      lastName: c.lastName ?? "",
      email: c.email,
    }));

    return json({ contacts });
  } catch (err) {
    console.error("[GET /api/user/contact] error:", err);
    return json({ error: "Internal Server Error" }, { status: 500 });
  }
}

/* ---------------------------------- POST --------------------------------- */
/** Create a new contact (firstName, lastName?, email). Creates array if missing and prevents duplicates atomically. */
export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) return json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const parsed = CreateContactSchema.safeParse(body);
    if (!parsed.success) {
      return json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { firstName, lastName, email } = parsed.data;

    await connect();

    const _id = new Types.ObjectId(userId);
    const coll = User.collection as unknown as Collection<RawUser>;

    // Ensure user exists
    const existing = await coll.findOne({ _id }, { projection: { _id: 1 } });
    if (!existing) return json({ error: "User not found" }, { status: 404 });

    const newContact: RawContact = {
      _id: new Types.ObjectId(),
      firstName,
      lastName: lastName || "",
      email,
    };

    // Atomic insert if no existing contact with same email.
    const res = await coll.updateOne(
      {
        _id,
        $or: [
          { contacts: { $exists: false } },
          { contacts: { $not: { $elemMatch: { email } } } },
        ],
      },
      {
        $push: { contacts: newContact }, // TS-safe now because of RawUser generic
      }
    );

    if (res.matchedCount === 0 || res.modifiedCount === 0) {
      return json(
        { error: "Contact with this email already exists" },
        { status: 409 }
      );
    }

    // Re-fetch to return the created contact
    const after = await coll.findOne({ _id }, { projection: { contacts: 1 } });
    const created =
      after?.contacts?.find?.((c) => String(c.email).toLowerCase() === email) ??
      null;

    return json(
      {
        contact: created
          ? {
              id: created._id?.toString?.() ?? "",
              firstName: created.firstName,
              lastName: created.lastName ?? "",
              email: created.email,
            }
          : null,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/user/contact] error:", err);
    return json({ error: "Internal Server Error" }, { status: 500 });
  }
}
