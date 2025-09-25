// app/api/savings/balance/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { Connection, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { createHash } from "crypto";
import BN from "bn.js";

import { connect as connectMongo } from "@/lib/db";
import User from "@/models/User";
import marginfiIdl from "@/lib/marginfi_idl.json";

/* ────────── ENV ────────── */
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC!;
const USDC_BANK_PK = process.env.NEXT_PUBLIC_MARGINFI_USDC_BANK!;
const USDC_BANK_LIQ_VAULT = process.env.MARGINFI_USDC_BANK_LIQ_VAULT!;

if (!RPC || !USDC_BANK_PK || !USDC_BANK_LIQ_VAULT) {
  throw new Error(
    "Missing NEXT_PUBLIC_SOLANA_RPC or NEXT_PUBLIC_MARGINFI_USDC_BANK or MARGINFI_USDC_BANK_LIQ_VAULT"
  );
}

/* ────────── utils ───────── */
const disc = (name: string) =>
  createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asNumberArray = (value: unknown): number[] | null => {
  if (Array.isArray(value) && value.every((n) => typeof n === "number")) {
    return value;
  }
  return null;
};

function decodeByDiscriminator(
  coder: BorshAccountsCoder,
  buf: Buffer
): { name: string; decoded: UnknownRecord } {
  const d = buf.subarray(0, 8);
  const idl = coder["idl"] as anchor.Idl;
  for (const a of idl.accounts ?? []) {
    if (disc(a.name).equals(d)) {
      const decoded = coder.decode(a.name, buf) as unknown;
      if (!isRecord(decoded)) {
        throw new Error(`Decoded account ${a.name} is not an object`);
      }
      return { name: a.name, decoded };
    }
  }
  throw new Error("Unknown account discriminator");
}

// Deep search BN (or bytes->BN container) with key regex
function bnFromPossible(value: unknown): BN | null {
  if (BN.isBN(value)) return value;

  const arr = asNumberArray(value);
  if (arr) return new BN(Uint8Array.from(arr), "le");

  if (isRecord(value)) {
    const direct = asNumberArray(value.value);
    if (direct) return new BN(Uint8Array.from(direct), "le");
    for (const nested of Object.values(value)) {
      const found = bnFromPossible(nested);
      if (found) return found;
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = bnFromPossible(item);
      if (found) return found;
    }
  }

  return null;
}

function deepFindBN(value: unknown, keyRegex: RegExp): BN | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const inner = deepFindBN(item, keyRegex);
      if (inner) return inner;
    }
    return null;
  }

  if (!isRecord(value)) return null;

  for (const [k, v] of Object.entries(value)) {
    if (keyRegex.test(k)) {
      const found = bnFromPossible(v);
      if (found) return found;
    }
    const inner = deepFindBN(v, keyRegex);
    if (inner) return inner;
  }
  return null;
}

// Try multiple common field names for asset_per_share (I80F48)
function extractAssetsPerShare(bank: UnknownRecord): BN | null {
  const keys = [
    /asset[_]?share[_]?value/i,
    /assets[_]?per[_]?share/i,
    /asset.*per.*share/i,
    /deposit[_]?index/i,
  ];
  for (const r of keys) {
    const bn = deepFindBN(bank, r);
    if (bn) return bn;
  }
  return null;
}

// Try to read total asset shares from Bank
function extractTotalAssetShares(bank: UnknownRecord): BN | null {
  const keys = [
    /total[_]?asset[_]?shares/i,
    /asset[_]?shares[_]?total/i,
    /deposit[_]?shares/i,
    /liquidity[_]?shares/i,
    /assets[_]?shares/i,
  ];
  for (const r of keys) {
    const bn = deepFindBN(bank, r);
    if (bn) return bn;
  }
  return null;
}

// User asset_shares (u128 Q48.0 or similar) from balance entry
function extractUserAssetShares(balance: UnknownRecord): BN | null {
  const bn =
    deepFindBN(balance, /^asset[_]?shares$/i) ||
    deepFindBN(balance, /assets[_]?shares/i) ||
    deepFindBN(balance, /asset.*shares/i);
  return bn && !bn.isZero() ? bn : null;
}

// Read mint decimals (fallback 6)
function extractMintDecimals(bank: UnknownRecord): number {
  const direct = bank.mint_decimals;
  if (typeof direct === "number" && direct >= 0 && direct <= 18) {
    return direct;
  }

  const mintField = bank.mint;
  if (isRecord(mintField)) {
    const decimals = mintField.decimals;
    if (typeof decimals === "number" && decimals >= 0 && decimals <= 18) {
      return decimals;
    }
  }

  return 6;
}

// (user_shares * vault_amount) / total_shares — using big-int math
function mulDivFloor(a: BN, b: BN, d: BN): BN {
  const prod = a.mul(b);
  return prod.div(d.isZero() ? new BN(1) : d);
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const owner58 = (url.searchParams.get("owner58") || "").trim();

    if (!owner58) {
      return NextResponse.json({ error: "Missing owner58" }, { status: 400 });
    }

    // 1) Find marginfi accountPk from DB
    await connectMongo();
    const user = await User.findOne({ "depositWallet.address": owner58 })
      .select({ "marginfi.accountPk": 1, "depositWallet.address": 1 })
      .lean();

    const accountPk = user?.marginfi?.accountPk as string | undefined;
    if (!accountPk) {
      return NextResponse.json(
        { error: "No accountPk found" },
        { status: 404 }
      );
    }

    // 2) Fetch marginfi account + bank + vault balance
    const conn = new Connection(RPC, { commitment: "confirmed" });
    const coder = new BorshAccountsCoder(marginfiIdl as anchor.Idl);

    const [mAccInfo, bankInfo, vaultBal] = await Promise.all([
      conn.getAccountInfo(new PublicKey(accountPk), "confirmed"),
      conn.getAccountInfo(new PublicKey(USDC_BANK_PK), "confirmed"),
      conn.getTokenAccountBalance(new PublicKey(USDC_BANK_LIQ_VAULT)),
    ]);

    if (!mAccInfo?.data) {
      return NextResponse.json(
        { error: "Marginfi account not found" },
        { status: 404 }
      );
    }
    if (!bankInfo?.data) {
      return NextResponse.json({ amountUi: 0 }, { status: 200 });
    }

    const { decoded: mAcc } = decodeByDiscriminator(coder, mAccInfo.data);
    const { decoded: bank } = decodeByDiscriminator(coder, bankInfo.data);

    const balancesSource =
      (mAcc.lending_account as UnknownRecord | undefined)?.balances ??
      mAcc.balances ??
      [];

    const balances = Array.isArray(balancesSource)
      ? balancesSource.map((entry) =>
          isRecord(entry) ? entry : ({ ...entry } as UnknownRecord)
        )
      : [];

    const detail = balances.map((b) => {
      const activeField = b?.active;
      const active =
        typeof activeField === "number" ? activeField > 0 : Boolean(activeField);
      const shares = extractUserAssetShares(b);
      const bankPkField = b?.bank_pk ?? b?.bankPk;
      const bankPk = typeof bankPkField === "string" ? bankPkField : null;
      return {
        active,
        bank_pk: bankPk,
        shares: shares ? shares.toString() : "0",
      };
    });

    const candidateIndex = detail.findIndex(
      (d) => d.active && d.shares !== "0"
    );
    if (candidateIndex < 0) {
      return NextResponse.json({ amountUi: 0 }, { status: 200 });
    }

    const userBalance = balances[candidateIndex];
    const userShares = extractUserAssetShares(userBalance);
    if (!userShares) {
      return NextResponse.json({ amountUi: 0 }, { status: 200 });
    }
    const mintDecimals = extractMintDecimals(bank);

    // 4a) Preferred: use bank's I80F48 assets-per-share (deposit index)
    const aps = extractAssetsPerShare(bank);
    if (aps) {
      // shares ≈ assets << 48 / index  →  assets ≈ floor(shares * index >> 96)
      const amountBaseBn = userShares.mul(aps).shrn(96);
      const amountUi = amountBaseBn.toNumber() / Math.pow(10, mintDecimals);
      return NextResponse.json({ amountUi }, { status: 200 });
    }

    // 4b) Fallback: derive via vault / total_shares
    const vaultAmountBase = new BN(vaultBal?.value?.amount ?? "0"); // base units
    const totalShares =
      extractTotalAssetShares(bank) ||
      deepFindBN(bank, /total.*shares/i) ||
      deepFindBN(bank, /shares.*total/i);

    if (!totalShares || totalShares.isZero()) {
      return NextResponse.json({ amountUi: 0 }, { status: 200 });
    }

    const amountBaseBn = mulDivFloor(userShares, vaultAmountBase, totalShares);
    const amountUi = amountBaseBn.toNumber() / Math.pow(10, mintDecimals);

    return NextResponse.json({ amountUi }, { status: 200 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: message || "Unknown error" },
      { status: 500 }
    );
  }
}
