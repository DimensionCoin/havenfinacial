// app/api/activity/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import User from "@/models/User";
import { requireUserIdFromHavenSession } from "@/lib/session-claims"; // you already have this
import { getUsdcActivityForOwner } from "@/lib/solanaActivity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jerr(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserIdFromHavenSession(req);

    await connect();
    const user = await User.findById(userId).lean();
    if (!user) return jerr(404, "User not found");

    const owner58 = user?.depositWallet?.address;
    if (!owner58) return jerr(400, "Deposit wallet not found");

    const url = new URL(req.url);
    const before = url.searchParams.get("before") || undefined;
    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit") || 30), 1),
      100
    );

    const items = await getUsdcActivityForOwner(owner58, { limit, before });

    // Provide pagination cursor (signature of last item)
    const nextBefore = items.length ? items[items.length - 1].signature : null;

    return NextResponse.json({ ok: true, items, nextBefore });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = /unauthorized/i.test(msg) ? 401 : 500;
    return jerr(code, msg);
  }
}
