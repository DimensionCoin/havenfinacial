// app/api/address/resolve/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import User from "@/models/User";
import { connect } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await connect();
    const owner58 = req.nextUrl.searchParams.get("owner58")?.trim();
    if (!owner58) {
      return NextResponse.json(
        { ok: false, error: "Missing owner58" },
        { status: 400 }
      );
    }

    // Broaden search: include any wallet arrays you keep in your User doc.
    // ✅ Keep/adjust only the fields you actually have in your schema.
    const u = await User.findOne({
      $or: [
        { "depositWallet.address": owner58 },
        { "wallets.address": owner58 }, // optional
        { "externalWallets.address": owner58 }, // optional
        { "privyWallets.address": owner58 }, // optional
      ],
    })
      .select("displayName email")
      .lean<{ displayName?: string; email?: string } | null>();

    if (!u) return NextResponse.json({ ok: true, name: null, email: null });

    return NextResponse.json({
      ok: true,
      name: u.displayName ?? u.email ?? null,
      email: u.email ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
