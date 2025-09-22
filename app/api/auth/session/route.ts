import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { PrivyClient, type WalletApiCreateRequestType } from "@privy-io/server-auth";
import { connect } from "@/lib/db";
import User from "@/models/User";
import { SignJWT } from "jose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JWT_SECRET = process.env.JWT_SECRET!;
const SESSION_DURATION = 60 * 60 * 24 * 7; // 7 days
const COOKIE = "haven_session";

const APP_ID = process.env.PRIVY_APP_ID!;
const SECRET = process.env.PRIVY_SECRET_KEY!;
if (!APP_ID || !SECRET) throw new Error("Missing Privy env vars");

const privy = new PrivyClient(APP_ID, SECRET);
const enc = new TextEncoder();

/** --------- Helpers --------- */
function extractEmailFromPrivyUser(u: unknown): string | undefined {
  if (!u || typeof u !== "object") return undefined;
  const obj = u as Record<string, unknown>;

  const emailObj = obj.email as { address?: unknown } | undefined;
  const direct = typeof emailObj?.address === "string" ? emailObj.address : undefined;
  if (typeof direct === "string" && direct.includes("@")) return direct.toLowerCase();

  const linked = obj.linkedAccounts as unknown;
  if (Array.isArray(linked)) {
    for (const a of linked) {
      const r = a as Record<string, unknown>;
      const maybe =
        (typeof r.email === "string" && r.email) ||
        (typeof r.address === "string" && r.address) ||
        (typeof (r.wallet as Record<string, unknown> | undefined)?.address === "string"
          ? ((r.wallet as Record<string, unknown>).address as string)
          : undefined);
      if (maybe && maybe.includes("@")) return maybe.toLowerCase();
    }
  }

  const providerKeys = ["google", "apple", "github", "discord", "twitter", "linkedin"] as const;
  for (const key of providerKeys) {
    const p = obj[key] as Record<string, unknown> | undefined;
    const maybe =
      (typeof p?.email === "string" && (p.email as string)) ||
      (typeof p?.emailAddress === "string" && (p.emailAddress as string));
    if (maybe && maybe.includes("@")) return maybe.toLowerCase();
  }

  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === "string" && val.includes("@")) return val.toLowerCase();
  }
  return undefined;
}

function extractSolanaWalletFromPrivyUser(
  u: unknown
): { id: string; address: string; chainType: "solana" } | undefined {
  if (!u || typeof u !== "object") return undefined;
  const obj = u as Record<string, unknown>;
  const linked = obj.linkedAccounts as unknown;
  if (Array.isArray(linked)) {
    for (const a of linked) {
      // Common shapes:
      // { type: 'wallet', chainType: 'solana', address: '...' , id: '...' }
      // or nested a.wallet?.{address, chainType}
      const r = a as Record<string, unknown>;
      const chainType =
        (r.chainType as string | undefined) ||
        ((r.wallet as Record<string, unknown> | undefined)?.chainType as string | undefined) ||
        "";
      if (chainType.toLowerCase() === "solana") {
        const address = (r.address as string | undefined) ||
          ((r.wallet as Record<string, unknown> | undefined)?.address as string | undefined);
        const id = (r.id as string | undefined) ||
          ((r.wallet as Record<string, unknown> | undefined)?.id as string | undefined);
        if (address && id) return { id, address, chainType: "solana" };
      }
    }
  }
  return undefined;
}

async function ensureSolanaWallet(privyUserId: string) {
  // Re-fetch latest user from Privy (wallets may be created async by provider setting)
  const freshUser = await privy.getUser(privyUserId);
  let sol = extractSolanaWalletFromPrivyUser(freshUser);

  if (!sol) {
    // Force-create a Solana wallet owned by the user
    try {
      const created = await privy.walletApi.createWallet({
        chainType: "solana",
        owner: { userId: privyUserId },
      } as WalletApiCreateRequestType);
      sol = {
        id: created.id,
        address: created.address,
        chainType: "solana",
      };
    } catch (e) {
      console.error("Failed to create Solana wallet:", e);
      // Bubble up; caller can choose to proceed or fail hard.
      throw new Error("Could not provision embedded wallet");
    }
  }

  return sol;
}

/** --------- Route --------- */
export async function POST(req: NextRequest) {
  try {
    await connect();

    // Accept Privy access token via Bearer header or privy-token cookie
    const hdr = req.headers.get("authorization") || "";
    const bearer = hdr.startsWith("Bearer ") ? hdr.slice(7).trim() : null;
    const cookieTok = req.cookies.get("privy-token")?.value;
    const accessToken = bearer || cookieTok;
    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing access token" },
        { status: 401 }
      );
    }

    // Verify -> claims -> userId
    const claims = await privy.verifyAuthToken(accessToken);
    const privyUserId = claims.userId;

    // Fetch user; derive email
    const privyUser = await privy.getUser(privyUserId);
    const email = extractEmailFromPrivyUser(privyUser);
    if (!email) {
      return NextResponse.json(
        { error: "Email not found on account" },
        { status: 400 }
      );
    }

    // Find or create Mongo user (merge by email if needed)
    let user = await User.findOne({ privyId: privyUserId });
    if (!user) user = await User.findOne({ email });

    let isNew = false;
    if (!user) {
      user = await User.create({
        privyId: privyUserId,
        email,
        status: "pending",
        kycStatus: "none",
      });
      isNew = true;
    } else {
      const updates: Partial<{ email: string; privyId: string }> = {};
      if (user.email !== email) updates.email = email;
      if (user.privyId !== privyUserId) updates.privyId = privyUserId;
      if (Object.keys(updates).length) {
        await User.updateOne({ _id: user._id }, { $set: updates });
        Object.assign(user, updates);
      }
    }

    // Ensure an embedded Solana wallet exists and sync to Mongo (depositWallet)
    try {
      const sol = await ensureSolanaWallet(privyUserId);
      const needSync =
        !user.depositWallet ||
        user.depositWallet.address !== sol.address ||
        user.depositWallet.walletId !== sol.id;

      if (needSync) {
        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              depositWallet: {
                walletId: sol.id,
                address: sol.address,
                chainType: "solana",
              },
            },
          }
        );
        // reflect in-memory for the JWT payload if you ever include it
        (user as unknown as {
          depositWallet?: { walletId: string; address: string; chainType: "solana" };
        }).depositWallet = {
          walletId: sol.id,
          address: sol.address,
          chainType: "solana",
        };
      }
    } catch (e) {
      // If wallet creation is mandatory for your app, return 500 here.
      // For now, log and continue to let the user in (you can gate features later).
      console.error("Wallet provisioning issue (continuing):", e);
    }

    // Sign app session (HttpOnly cookie)
    const jwt = await new SignJWT({
      uid: String(user._id),
      email: user.email,
      status: user.status,
      kycStatus: user.kycStatus,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${SESSION_DURATION}s`)
      .sign(enc.encode(JWT_SECRET));

    const res = NextResponse.json({
      ok: true,
      goTo: isNew ? "/onboarding" : "/dashboard",
    });

    res.cookies.set(COOKIE, jwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION,
    });

    return res;
  } catch (err) {
    console.error("auth/session error", err);
    return NextResponse.json(
      { error: "Invalid token or server error" },
      { status: 401 }
    );
  }
}
