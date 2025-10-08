import * as anchor from "@coral-xyz/anchor";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { createHash } from "crypto";
import BN from "bn.js";

type UnknownRecord = Record<string, unknown>;

const disc = (name: string) =>
  createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asNumberArray = (value: unknown): number[] | null =>
  Array.isArray(value) && value.every((n) => typeof n === "number")
    ? value
    : null;

export function decodeByDiscriminator(
  coder: BorshAccountsCoder,
  buf: Buffer
): { name: string; decoded: UnknownRecord } {
  const d = buf.subarray(0, 8);
  const idl = coder["idl"] as anchor.Idl;
  for (const a of idl.accounts ?? []) {
    if (disc(a.name).equals(d)) {
      const decoded = coder.decode(a.name, buf);
      if (!isRecord(decoded))
        throw new Error(`Decoded ${a.name} is not an object`);
      return { name: a.name, decoded };
    }
  }
  throw new Error("Unknown account discriminator");
}

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
      const found = deepFindBN(item, keyRegex);
      if (found) return found;
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

export function extractAssetsPerShare(bank: UnknownRecord): BN | null {
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

export function extractUserAssetShares(balance: UnknownRecord): BN | null {
  const bn =
    deepFindBN(balance, /^asset[_]?shares$/i) ||
    deepFindBN(balance, /assets[_]?shares/i) ||
    deepFindBN(balance, /asset.*shares/i);
  return bn && !bn.isZero() ? bn : null;
}

export function extractMintDecimals(bank: UnknownRecord): number {
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

  return 6; // fallback
}
