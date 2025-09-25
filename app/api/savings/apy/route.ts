// app/api/savings/apy/route.ts
import "server-only";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { Connection, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { createHash } from "crypto";
import BN from "bn.js";
import marginfiIdl from "@/lib/marginfi_idl.json";

/* ────────── ENV ────────── */
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC!;
const USDC_BANK_PK = process.env.NEXT_PUBLIC_MARGINFI_USDC_BANK!;
if (!RPC || !USDC_BANK_PK) {
  throw new Error(
    "Missing NEXT_PUBLIC_SOLANA_RPC or NEXT_PUBLIC_MARGINFI_USDC_BANK"
  );
}

/* ────────── logging ───────── */
const log = (step: string, data: unknown) => {
  try {
    // pretty-print JSON-ish for readability
    console.log(`[savings/apy] ${step}:`, JSON.parse(JSON.stringify(data)));
  } catch {
    console.log(`[savings/apy] ${step}:`, data);
  }
};

/* ────────── helpers ───────── */
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

// Deep find BN (or a { value: number[] } little-endian) by key pattern
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
      const direct = bnFromPossible(v);
      if (direct) return direct;
    }
    const inner = deepFindBN(v, keyRegex);
    if (inner) return inner;
  }
  return null;
}

// Deep find a plain number by key pattern (for u32 fields decoded by Anchor)
function deepFindNumber(value: unknown, keyRegex: RegExp): number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const inner = deepFindNumber(item, keyRegex);
      if (inner !== null) return inner;
    }
    return null;
  }

  if (!isRecord(value)) return null;

  for (const [k, v] of Object.entries(value)) {
    if (keyRegex.test(k) && typeof v === "number" && Number.isFinite(v)) {
      return v;
    }
    const inner = deepFindNumber(v, keyRegex);
    if (inner !== null) return inner;
  }
  return null;
}

// I80F48 helpers
const FRAC_BITS = 48;
const ONE_I80F48 = new BN(1).ushln(FRAC_BITS);
const toFloatI80F48 = (x: BN): number => {
  const neg = x.isNeg();
  const abs = neg ? x.neg() : x;
  const int = abs.shrn(FRAC_BITS).toNumber();
  const frac = abs.and(ONE_I80F48.subn(1)).toNumber() / Math.pow(2, FRAC_BITS);
  return neg ? -(int + frac) : int + frac;
};

// Extractors
function extractAssetsPerShare(bank: UnknownRecord): BN | null {
  const keys = [
    /asset[_]?share[_]?value/i,
    /assets[_]?per[_]?share/i,
    /deposit[_]?index/i,
  ];
  for (const r of keys) {
    const bn = deepFindBN(bank, r);
    if (bn) return bn;
  }
  return null;
}
function extractLiabsPerShare(bank: UnknownRecord): BN | null {
  const keys = [
    /liab(ility)?[_]?share[_]?value/i,
    /liabilities[_]?per[_]?share/i,
    /borrow[_]?index/i,
  ];
  for (const r of keys) {
    const bn = deepFindBN(bank, r);
    if (bn) return bn;
  }
  return null;
}
function extractTotalAssetShares(bank: UnknownRecord): BN | null {
  const keys = [
    /total[_]?asset[_]?shares/i,
    /asset[_]?shares[_]?total/i,
    /deposit[_]?shares/i,
  ];
  for (const r of keys) {
    const bn = deepFindBN(bank, r);
    if (bn) return bn;
  }
  return null;
}
function extractTotalLiabShares(bank: UnknownRecord): BN | null {
  const keys = [
    /total[_]?liab(ility)?[_]?shares/i,
    /liab(ility)?[_]?shares[_]?total/i,
    /borrow[_]?shares/i,
  ];
  for (const r of keys) {
    const bn = deepFindBN(bank, r);
    if (bn) return bn;
  }
  return null;
}
function extractCurve(bank: UnknownRecord): {
  uOpt: BN | null;
  rMin: BN | null;
  rOpt: BN | null;
  rMax: BN | null;
} {
  const uOpt =
    deepFindBN(bank, /optimal[_]?util/i) ||
    deepFindBN(bank, /target[_]?util/i) ||
    deepFindBN(bank, /opt[_]?u/i);

  const rMin =
    deepFindBN(bank, /min[_]?rate/i) || deepFindBN(bank, /base[_]?rate/i);
  const rOpt =
    deepFindBN(bank, /opt(imal)?[_]?rate/i) ||
    deepFindBN(bank, /kink[_]?rate/i);
  const rMax =
    deepFindBN(bank, /max[_]?rate/i) || deepFindBN(bank, /upper[_]?rate/i);

  return { uOpt, rMin, rOpt, rMax };
}
function extractFeeRates(bank: UnknownRecord): {
  reserve: BN | null;
  insurance: BN | null;
} {
  const reserve =
    deepFindBN(bank, /(reserve|protocol).*fee.*rate/i) ||
    deepFindBN(bank, /program[_]?fee[_]?rate/i) ||
    deepFindBN(bank, /fee[_]?rate/i);

  const insurance =
    deepFindBN(bank, /insurance.*fee.*rate/i) ||
    deepFindBN(bank, /ins[_]?fee[_]?rate/i);

  return { reserve, insurance };
}

export async function GET() {
  try {
    const conn = new Connection(RPC, { commitment: "confirmed" });
    const coder = new BorshAccountsCoder(marginfiIdl as anchor.Idl);

    // Load bank
    const bankInfo = await conn.getAccountInfo(
      new PublicKey(USDC_BANK_PK),
      "confirmed"
    );
    log("rpc.fetch", {
      bankFound: !!bankInfo?.data,
      bankDataLen: bankInfo?.data?.length ?? 0,
    });
    if (!bankInfo?.data) {
      return NextResponse.json(
        { apy: 0, note: "Bank not found" },
        { status: 200 }
      );
    }

    const { name: bankType, decoded: bank } = decodeByDiscriminator(
      coder,
      bankInfo.data
    );
    log("decode.bank", { bankType });

    // 1) Preferred: read spot lending rate from BankCache.lending_rate (u32 scaled to 0..1000%)
    const lendingRateU32 =
      deepFindNumber(bank, /^lending[_]?rate$/i) ||
      deepFindNumber(bank, /bank[_]?cache.*lending[_]?rate/i);

    log("bank.cache.peek", { lendingRateU32 });

    if (lendingRateU32 !== null) {
      // u32::MAX == 1000% (10.0). Scale: APR = (lendingRateU32 / 2^32) * 10.0
      const UINT32_MAX = 0xffffffff;
      const apr = (lendingRateU32 / UINT32_MAX) * 10.0; // decimal APR, e.g. 0.0874 for 8.74%
      const apy = Math.pow(1 + apr / 365, 365) - 1;
      log("apy.method", {
        method: "bank_cache.lending_rate",
        lendingRateU32,
        apr,
        apy,
      });
      return NextResponse.json({ apy }, { status: 200 });
    }

    // 2) Fallback: derive from utilization and curve
    const totalAssetShares = extractTotalAssetShares(bank);
    const totalLiabShares = extractTotalLiabShares(bank);
    const aps = extractAssetsPerShare(bank); // I80F48
    const lps = extractLiabsPerShare(bank); // I80F48

    log("fallback.inputs", {
      hasTotalAssetShares: !!totalAssetShares,
      hasTotalLiabShares: !!totalLiabShares,
      hasAPS: !!aps,
      hasLPS: !!lps,
    });

    if (!totalAssetShares || !aps || !totalLiabShares || !lps) {
      log("apy.method", {
        method: "unavailable",
        note: "No rate fields found on bank account",
      });
      return NextResponse.json({ apy: 0 }, { status: 200 });
    }

    // Convert to base units via indices: floor(total_shares * index >> 96)
    const assetsBase = totalAssetShares.mul(aps).shrn(96);
    const liabsBase = totalLiabShares.mul(lps).shrn(96);
    const util = assetsBase.isZero()
      ? 0
      : Math.min(
          1,
          Number(liabsBase.toString()) / Number(assetsBase.toString())
        );
    log("utilization", {
      assetsBase: assetsBase.toString(),
      liabsBase: liabsBase.toString(),
      util,
    });

    const { uOpt, rMin, rOpt, rMax } = extractCurve(bank);
    log("curve.params", {
      hasUOpt: !!uOpt,
      hasRMin: !!rMin,
      hasROpt: !!rOpt,
      hasRMax: !!rMax,
    });
    if (!uOpt || !rMin || !rOpt || !rMax) {
      log("apy.method", {
        method: "unavailable",
        note: "Rate curve unavailable",
      });
      return NextResponse.json({ apy: 0 }, { status: 200 });
    }

    const uOptF = toFloatI80F48(uOpt);
    const rMinF = toFloatI80F48(rMin);
    const rOptF = toFloatI80F48(rOpt);
    const rMaxF = toFloatI80F48(rMax);
    log("curve.floats", { uOptF, rMinF, rOptF, rMaxF });

    let borrowAPR: number;
    if (uOptF > 0 && util <= uOptF) {
      borrowAPR = rMinF + (rOptF - rMinF) * (util / uOptF);
    } else if (uOptF > 0 && util > uOptF && util < 1) {
      borrowAPR = rOptF + (rMaxF - rOptF) * ((util - uOptF) / (1 - uOptF));
    } else {
      borrowAPR = util === 0 ? rMinF : rMaxF;
    }

    const { reserve, insurance } = extractFeeRates(bank);
    const reserveF = reserve ? toFloatI80F48(reserve) : 0;
    const insuranceF = insurance ? toFloatI80F48(insurance) : 0;
    const feeFactor = Math.max(0, 1 - (reserveF + insuranceF));

    const supplyAPR = Math.max(0, borrowAPR * util * feeFactor);
    const apy = Math.pow(1 + supplyAPR / 365, 365) - 1;

    log("apy.method", {
      method: "fallback_curve",
      util,
      borrowAPR,
      reserveF,
      insuranceF,
      feeFactor,
      supplyAPR,
      apy,
    });

    return NextResponse.json({ apy }, { status: 200 });
  } catch (e: unknown) {
    console.error("[savings/apy] ERROR:", e);
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: message || "Unknown error", apy: 0 },
      { status: 500 }
    );
  }
}
