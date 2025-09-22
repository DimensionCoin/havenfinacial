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
import { requireUserIdFromHavenSession } from "@/lib/session-claims";

function jerr(status: number, error: string, extra?: unknown) {
  return new NextResponse(
    JSON.stringify(extra ? { error, extra } : { error }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/notifications?unseen=1&limit=50 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserIdFromHavenSession(req);

    const { searchParams } = new URL(req.url);
    const parsedQuery = ZListNotificationsQuery.safeParse({
      unseen: searchParams.get("unseen") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });
    if (!parsedQuery.success)
      return jerr(400, "Invalid query", parsedQuery.error.flatten());

    const unseenOnly =
      parsedQuery.data.unseen === "1" || parsedQuery.data.unseen === "true";
    const limit = parsedQuery.data.limit ?? 50;

    const items = await listNotificationsForUser({ userId, unseenOnly, limit });

    return new NextResponse(JSON.stringify({ ok: true, items }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = /unauthorized/i.test(msg) ? 401 : 500;
    return jerr(code, msg);
  }
}

/** POST /api/notifications  { message, type?, data? }  -> create for current user */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserIdFromHavenSession(req);

    const parsed = ZCreateNotification.safeParse(
      await req.json().catch(() => ({}))
    );
    if (!parsed.success)
      return jerr(400, "Invalid body", parsed.error.flatten());

    const { message, type, data } = parsed.data;
    const item = await createNotification({ userId, message, type, data });

    return new NextResponse(JSON.stringify({ ok: true, item }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = /unauthorized/i.test(msg) ? 401 : 500;
    return jerr(code, msg);
  }
}
