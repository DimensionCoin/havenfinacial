// app/api/activity/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";
import User from "@/models/User";
import { requireUserIdFromHavenSession } from "@/lib/session-claims";
import { getUsdcActivityForOwner } from "@/lib/solanaActivity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jerr(status: number, error: string) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function shortAddr(a?: string | null) {
  if (!a) return null;
  return a.length > 8 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
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

    // Core fetch (already annotates kind: "transfer" | "swap" | "email", swap fields, etc)
    const items = await getUsdcActivityForOwner(owner58, { limit, before });

    // Enrich: resolve counterparties to a friendly label when they’re Haven users
    const addrs = Array.from(
      new Set(items.map((i) => (i.counterparty || "").trim()).filter(Boolean))
    );

    const labelByAddr = new Map<string, string>();
    if (addrs.length) {
      const matches = await User.find(
        { "depositWallet.address": { $in: addrs } },
        { "depositWallet.address": 1, name: 1, email: 1 }
      ).lean<
        {
          depositWallet?: { address?: string };
          name?: string;
          email?: string;
        }[]
      >();

      for (const m of matches) {
        const a = m?.depositWallet?.address;
        if (!a) continue;
        const label =
          (m.name && m.name.trim()) ||
          (m.email && m.email.trim()) ||
          shortAddr(a) ||
          a;
        labelByAddr.set(a, label);
      }
    }

    const enriched = items.map((it) => {
      const cp = (it.counterparty || "").trim();
      let counterpartyLabel: string | null = null;

      if (cp) {
        // Prefer Haven-resolved label
        counterpartyLabel = labelByAddr.get(cp) || null;

        // Fallbacks
        if (!counterpartyLabel) {
          if (it.kind === "email") {
            counterpartyLabel = "Haven Escrow";
          } else {
            counterpartyLabel = shortAddr(cp) || cp;
          }
        }
      }

      // You can also shape a fully “statement-ready” title/subtitle here if you’d like,
      // but keeping it minimal so the client controls presentation.
      return { ...it, counterpartyLabel };
    });

    const nextBefore = enriched.length
      ? enriched[enriched.length - 1].signature
      : null;

    return NextResponse.json(
      { ok: true, items: enriched, nextBefore },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = /unauthorized/i.test(msg) ? 401 : 500;
    return jerr(code, msg);
  }
}
