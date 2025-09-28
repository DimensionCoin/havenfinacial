// app/api/balance/deposit/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { Connection, PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { connect as connectMongo } from "@/lib/db";
import User from "@/models/User";
import { requireUserIdFromHavenSession } from "@/lib/session-claims";

/* ----------------------------- ENV ------------------------------------- */
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC!;
const USDC_MINT_STR = process.env.NEXT_PUBLIC_USDC_MINT || "";

if (!RPC || !USDC_MINT_STR) {
  throw new Error("Missing NEXT_PUBLIC_SOLANA_RPC or NEXT_PUBLIC_USDC_MINT");
}

const USDC_MINT = new PublicKey(USDC_MINT_STR);

/* ----------------------------- Helpers --------------------------------- */
const programIdCache = new Map<string, PublicKey>();

async function detectTokenProgramForMint(
  conn: Connection,
  mint: PublicKey
): Promise<PublicKey> {
  const key = mint.toBase58();
  const cached = programIdCache.get(key);
  if (cached) return cached;

  const info = await conn.getAccountInfo(mint, "confirmed");
  const owner = info?.owner?.toBase58();
  const pid =
    owner === TOKEN_2022_PROGRAM_ID.toBase58()
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

  programIdCache.set(key, pid);
  return pid;
}

async function getAtaUiBalanceWithProgram(
  conn: Connection,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgramId: PublicKey
): Promise<number> {
  try {
    const ata = getAssociatedTokenAddressSync(
      mint,
      owner,
      false,
      tokenProgramId
    );
    const bal = await conn.getTokenAccountBalance(ata, "confirmed");
    return Number(bal?.value?.uiAmount ?? 0);
  } catch {
    return 0;
  }
}

async function fetchUsdcBalanceForOwner(
  conn: Connection,
  mint: PublicKey,
  owner58: string,
  cachedAta?: string | null
): Promise<number> {
  const owner = new PublicKey(owner58);

  // Try cached ATA first (if stored in DB)
  const viaCached = (async () => {
    if (!cachedAta) return 0;
    try {
      const bal = await conn.getTokenAccountBalance(
        new PublicKey(cachedAta),
        "confirmed"
      );
      return Number(bal?.value?.uiAmount ?? 0);
    } catch {
      return 0;
    }
  })();

  const detectedProgram = await detectTokenProgramForMint(conn, mint);
  const viaDetected = getAtaUiBalanceWithProgram(
    conn,
    mint,
    owner,
    detectedProgram
  );

  // Also try the "other" program to cover cases where the ATA is under the opposite program id
  const otherProgram = detectedProgram.equals(TOKEN_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
  const viaOther = getAtaUiBalanceWithProgram(conn, mint, owner, otherProgram);

  const [a, b, c] = await Promise.all([viaCached, viaDetected, viaOther]);
  return Math.max(a, b, c);
}

function jerr(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

/* ------------------------------- GET ----------------------------------- */
/**
 * GET /api/balance/deposit
 * Optional: ?owner58=<base58> — if omitted, uses current session user
 * Response: { ok: true, owner58, amountUi }
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const ownerParam = (url.searchParams.get("owner58") || "").trim();

    await connectMongo();

    let owner58: string | null = null;
    let cachedAta: string | null = null;

    type LeanUserDeposit = {
      depositWallet?: { address?: string | null };
      tokenAccounts?: {
        usdc2022?: {
          depositAta?: string | null;
        };
      };
    };

    if (ownerParam) {
      // Explicit wallet
      owner58 = ownerParam;
      // Try to pull cached ATA if this owner belongs to a known user
      const maybeUser = await User.findOne({
        "depositWallet.address": owner58,
      })
        .select({ "tokenAccounts.usdc2022.depositAta": 1 })
        .lean<LeanUserDeposit | null>();
      cachedAta =
        maybeUser?.tokenAccounts?.usdc2022?.depositAta ?? null;
    } else {
      // Use current session’s user
      const userId = await requireUserIdFromHavenSession(req);
      const user = await User.findById(userId)
        .select({
          "depositWallet.address": 1,
          "tokenAccounts.usdc2022.depositAta": 1,
        })
        .lean<LeanUserDeposit | null>();
      if (!user?.depositWallet?.address) {
        return jerr(404, "Deposit wallet not found");
      }
      owner58 = user.depositWallet.address;
      cachedAta = user.tokenAccounts?.usdc2022?.depositAta ?? null;
    }

    // validate public key
    try {
      new PublicKey(owner58);
    } catch {
      return jerr(400, "Invalid owner58");
    }

    const conn = new Connection(RPC, "confirmed");
    const amountUi = await fetchUsdcBalanceForOwner(
      conn,
      USDC_MINT,
      owner58,
      cachedAta
    );

    return NextResponse.json({ ok: true, owner58, amountUi });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = /unauthorized/i.test(msg) ? 401 : 500;
    return jerr(code, msg);
  }
}
