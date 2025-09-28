// app/api/notifications/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import {
  listNotificationsForUser,
  createNotification,
} from "@/lib/notifications";
import {
  ZCreateNotification,
  ZListNotificationsQuery,
} from "@/types/notifications";
import { verifySession } from "@/lib/auth";
import { connect } from "@/lib/db";
import User from "@/models/User";
import { PrivyClient } from "@privy-io/server-auth";

const PRIVY_APP_ID = process.env.PRIVY_APP_ID!;
const PRIVY_SECRET_KEY = process.env.PRIVY_SECRET_KEY!;
if (!PRIVY_APP_ID || !PRIVY_SECRET_KEY) {
  throw new Error("Missing PRIVY_APP_ID / PRIVY_SECRET_KEY");
}
const privy = new PrivyClient(PRIVY_APP_ID, PRIVY_SECRET_KEY);

function resJson(
  body: unknown,
  init?: ResponseInit & { varyAuth?: boolean }
): NextResponse {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  if (init?.varyAuth) headers.set("Vary", "Authorization, Cookie");
  return new NextResponse(JSON.stringify(body), { ...init, headers });
}

function jerr(
  status: number,
  error: string,
  extra?: Record<string, unknown>,
  code?: string
) {
  const traceId = crypto.randomUUID();
  return resJson(
    { ok: false, error, code, traceId, ...(extra ?? {}) },
    { status, varyAuth: true }
  );
}

/**
 * Strict user resolver:
 * - If Authorization: Bearer present -> resolve to a userId via Privy.
 * - Also look for cookie session; if both exist and disagree -> reject.
 * - Else fall back to whichever exists. Reject if none.
 */
async function requireUserIdStrict(req: NextRequest): Promise<string> {
  // Cookie session path
  const cookieToken = req.cookies.get("__session")?.value ?? null;
  const cookieClaims = cookieToken ? verifySession(cookieToken) : null;
  const cookieUserId = cookieClaims?.userId ?? null;

  // Bearer path
  const auth =
    req.headers.get("authorization") || req.headers.get("Authorization");
  let bearerUserId: string | null = null;
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
        bearerUserId = u?._id ? String(u._id) : null;
      }
    } catch {
      // invalid/expired bearer -> treat as unauth
    }
  }

  // If both are present but different, reject to prevent cross-user leakage
  if (cookieUserId && bearerUserId && cookieUserId !== bearerUserId) {
    throw Object.assign(new Error("Identity mismatch"), {
      code: "IDENTITY_MISMATCH",
    });
  }

  const resolved = bearerUserId || cookieUserId;
  if (!resolved) {
    throw Object.assign(new Error("Unauthorized"), { code: "UNAUTHORIZED" });
  }
  return resolved;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/notifications?unseen=1&limit=50 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserIdStrict(req);

    const { searchParams } = new URL(req.url);
    const parsedQuery = ZListNotificationsQuery.safeParse({
      unseen: searchParams.get("unseen") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });
    if (!parsedQuery.success) {
      return jerr(
        400,
        "Invalid query",
        { details: parsedQuery.error.flatten() },
        "INVALID_QUERY"
      );
    }

    const unseenOnly =
      parsedQuery.data.unseen === "1" || parsedQuery.data.unseen === "true";
    const limit = parsedQuery.data.limit ?? 50;

    const items = await listNotificationsForUser({ userId, unseenOnly, limit });

    return resJson({ ok: true, items }, { varyAuth: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = /unauthorized/i.test(msg)
      ? "UNAUTHORIZED"
      : /mismatch/i.test(msg)
      ? "IDENTITY_MISMATCH"
      : "INTERNAL";
    const status =
      code === "UNAUTHORIZED" ? 401 : code === "IDENTITY_MISMATCH" ? 403 : 500;
    return jerr(status, msg, undefined, code);
  }
}

/** POST /api/notifications  { message, type?, data? }  -> create for current user */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserIdStrict(req);

    if (!/application\/json/i.test(req.headers.get("content-type") || "")) {
      return jerr(415, "Unsupported Media Type", undefined, "UNSUPPORTED_TYPE");
    }

    const parsed = ZCreateNotification.safeParse(
      await req.json().catch(() => ({}))
    );
    if (!parsed.success) {
      return jerr(
        400,
        "Invalid body",
        { details: parsed.error.flatten() },
        "INVALID_BODY"
      );
    }

    const { message, type, data } = parsed.data;
    const item = await createNotification({ userId, message, type, data });

    return resJson({ ok: true, item }, { varyAuth: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = /unauthorized/i.test(msg)
      ? "UNAUTHORIZED"
      : /mismatch/i.test(msg)
      ? "IDENTITY_MISMATCH"
      : "INTERNAL";
    const status =
      code === "UNAUTHORIZED" ? 401 : code === "IDENTITY_MISMATCH" ? 403 : 500;
    return jerr(status, msg, undefined, code);
  }
}
