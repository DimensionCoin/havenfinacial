import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/requireUserId";
import { connect } from "@/lib/db";
import EmailClaim from "@/models/EmailClaim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    await connect();

    const now = new Date();
    const claims = await EmailClaim.find({
      senderUserId: userId,
      status: "pending",
      tokenExpiresAt: { $gt: now },
    })
      .sort({ createdAt: 1 })
      .select(
        "_id recipientEmail amountUnits currency createdAt tokenExpiresAt escrowSignature"
      )
      .lean();

    const items = claims.map((c) => ({
      id: String(c._id),
      recipientEmail: c.recipientEmail,
      amountUnits: Number(c.amountUnits ?? 0), // 6dp
      currency: c.currency || "USDC",
      createdAt: c.createdAt?.toISOString?.(),
      tokenExpiresAt: c.tokenExpiresAt?.toISOString?.(),
      escrowSignature: c.escrowSignature ?? null,
    }));

    return NextResponse.json(
      { ok: true, items },
      { headers: { Vary: "Cookie" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
