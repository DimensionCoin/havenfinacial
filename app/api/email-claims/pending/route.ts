// app/api/email-claims/pending/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connect } from "@/lib/db";
import EmailClaim from "@/models/EmailClaim";
import User from "@/models/User";
import { verifyClaimToken } from "@/lib/claim-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DECIMALS = 6;

const jerr = (status: number, error: string, extra?: unknown) =>
  NextResponse.json(extra ? { error, extra } : { error }, { status });

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token") || "";
    const parsed = z.string().min(10).safeParse(token);
    if (!parsed.success) return jerr(400, "Missing or invalid token");

    const payload = verifyClaimToken(token);
    if (!payload?.recipientEmail || !payload?.expiresAt) {
      return jerr(401, "Invalid or expired token");
    }

    // If token is expired, just tell the user; don’t list anything
    if (Date.now() > new Date(payload.expiresAt).getTime()) {
      return jerr(410, "This claim link has expired");
    }

    await connect();

    const now = new Date();
    const claims = await EmailClaim.find({
      recipientEmail: payload.recipientEmail.toLowerCase().trim(),
      status: "pending",
      tokenExpiresAt: { $gt: now },
    })
      .sort({ createdAt: 1 })
      .lean();

    if (claims.length === 0) {
      return NextResponse.json({
        ok: true,
        claims: [],
        totalCount: 0,
        totalAmountUi: 0,
      });
    }

    // attach sender emails in one round-trip
    const senderIds = Array.from(
      new Set(claims.map((c) => String(c.senderUserId)))
    );
    const senders = await User.find(
      { _id: { $in: senderIds } },
      { email: 1 }
    ).lean();

    const emailById = new Map(senders.map((s) => [String(s._id), s.email]));

    const normalized = claims.map((c) => ({
      id: String(c._id),
      createdAt: c.createdAt,
      amountUi: Number(c.amountUnits) / 10 ** DECIMALS,
      note: c.note || null,
      senderEmail: emailById.get(String(c.senderUserId)) || "Unknown sender",
      escrowSignature: c.escrowSignature || null,
      currency: c.currency || "USDC",
    }));

    const totalAmountUi = normalized.reduce((a, c) => a + c.amountUi, 0);

    return NextResponse.json({
      ok: true,
      claims: normalized,
      totalCount: normalized.length,
      totalAmountUi,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jerr(500, msg);
  }
}
