// app/api/notifications/mark-read/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { markNotificationsSeen } from "@/lib/notifications";
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

const Body = z
  .object({
    ids: z.array(z.string().min(8)).optional(),
    all: z.boolean().optional(),
  })
  .refine((v) => v.all === true || (Array.isArray(v.ids) && v.ids.length > 0), {
    message: "Provide `all: true` or a non-empty `ids` array.",
  });

/** POST /api/notifications/mark-read  { ids?: string[], all?: boolean } */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserIdFromHavenSession(req);

    const raw = await req.json().catch(() => ({}));
    const parsed = Body.safeParse(raw);
    if (!parsed.success) {
      return jerr(400, "Invalid body", parsed.error.flatten());
    }

    const { ids, all } = parsed.data;
    const res = await markNotificationsSeen({ userId, ids, all });

    return new NextResponse(JSON.stringify({ ok: true, ...res }), {
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
