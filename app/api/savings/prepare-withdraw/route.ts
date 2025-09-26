import "server-only";
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import {
  BorshAccountsCoder,
  BorshInstructionCoder,
  type Idl,
} from "@coral-xyz/anchor";
import BN from "bn.js";
import { Buffer } from "buffer";
import { createHash } from "crypto";
import marginfiIdl from "@/lib/marginfi_idl.json";

/* ───────── env ───────── */
function required(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}
const RPC = required("NEXT_PUBLIC_SOLANA_RPC");
const USDC_MINT = new PublicKey(required("NEXT_PUBLIC_USDC_MINT")); // EPjF...
const HAVEN_PUBKEY = new PublicKey(
  required("NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS")
);
const MARGINFI_PROGRAM_ID = new PublicKey(required("MARGINFI_PROGRAM_ID"));
const MARGINFI_GROUP = new PublicKey(required("MARGINFI_GROUP"));

/* ───────── helpers ───────── */
function jsonError(message: string, status = 500, extra?: unknown) {
  if (status >= 400) {
    if (extra) console.error("[/api/savings/prepare-withdraw]", message, extra);
    else console.error("[/api/savings/prepare-withdraw]", message);
  }
  return NextResponse.json({ error: message }, { status });
}

function uiToBN(amountUi: number | string, decimals: number): BN {
  const s = String(amountUi);
  const [wRaw, fRaw = ""] = s.split(".");
  const w = wRaw.replace(/\D/g, "") || "0";
  const f = ((fRaw.replace(/\D/g, "") || "") + "0".repeat(decimals)).slice(
    0,
    decimals
  );
  const base = new BN(10).pow(new BN(decimals));
  return new BN(w).mul(base).add(new BN(f));
}

async function detectTokenProgramId(conn: Connection, mint: PublicKey) {
  const info = await conn.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error("USDC mint not found on chain");
  return info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asNumberArray = (value: unknown): number[] | null =>
  Array.isArray(value) && value.every((n) => typeof n === "number")
    ? (value as number[])
    : null;

const getNestedRecord = (
  value: UnknownRecord,
  key: string
): UnknownRecord | null => {
  const nested = value[key];
  return isRecord(nested) ? nested : null;
};

/** Public, robust discriminator util */
function accountDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
}

/** Try a few common names quickly */
function tryDecodeAny(
  coder: BorshAccountsCoder,
  data: Buffer,
  names: string[]
): { name: string; decoded: UnknownRecord } | null {
  for (const name of names) {
    try {
      const decoded = coder.decode(name, data) as unknown;
      if (isRecord(decoded)) return { name, decoded };
    } catch {}
  }
  return null;
}

/** Decode by discriminator using only public IDL */
function decodeByDisc(
  coder: BorshAccountsCoder,
  data: Buffer
): { name: string; decoded: UnknownRecord } {
  const maybeIdl = (coder as unknown as { idl?: Idl }).idl;
  if (!maybeIdl) {
    throw new Error("BorshAccountsCoder missing idl property");
  }
  const idl = maybeIdl;
  const disc = data.subarray(0, 8);

  const quick = tryDecodeAny(coder, data, [
    "MarginfiAccount",
    "MarginfiGroup",
    "Bank",
    "marginfiAccount",
    "marginfiGroup",
    "bank",
  ]);
  if (quick) return quick;

  for (const acc of idl.accounts ?? []) {
    if (accountDiscriminator(acc.name).equals(disc)) {
      const decoded = coder.decode(acc.name, data) as unknown;
      if (!isRecord(decoded)) {
        throw new Error(`Decoded ${acc.name} is not an object`);
      }
      return { name: acc.name, decoded };
    }
  }
  throw new Error("Unknown account discriminator");
}

const toB58 = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof PublicKey) return value.toBase58();
  if (isRecord(value) && typeof value.data === "string") return value.data;
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    try {
      return new PublicKey(value).toBase58();
    } catch {
      return null;
    }
  }
  const toBase58Method = (value as { toBase58?: unknown }).toBase58;
  if (typeof toBase58Method === "function") {
    try {
      return toBase58Method.call(value);
    } catch {
      return null;
    }
  }
  return null;
};

/** best-effort pull of an asset balance entry */
function extractBalanceInfo(entry: UnknownRecord) {
  const activeValue =
    entry["active"] ??
    entry["isActive"] ??
    entry["Active"] ??
    entry["activeFlag"];
  const active = Boolean(activeValue);

  const sharesCandidate =
    entry["asset_shares"] ??
    entry["assetShares"] ??
    entry["assets_shares"] ??
    entry["assetsShares"] ??
    entry["assets"] ??
    entry["deposit_shares"] ??
    entry["depositShares"];

  let assetShares: BN | null = null;
  if (sharesCandidate instanceof BN) {
    assetShares = sharesCandidate;
  } else {
    const sharesValue = isRecord(sharesCandidate)
      ? sharesCandidate["value"]
      : sharesCandidate;
    const arr = asNumberArray(sharesValue);
    if (!assetShares && arr) {
      assetShares = new BN(Uint8Array.from(arr), "le");
    }
  }

  const bankPk = toB58(
    entry["bank_pk"] ?? entry["bankPk"] ?? entry["bank"]
  );
  return { active, bankPk, assetShares };
}

/* ---------- remaining accounts builder (bank, oracle pairs; chosen first) ---------- */
type Meta = { pubkey: PublicKey; isSigner: false; isWritable: false };

async function collectRemainingAccountMetas(
  conn: Connection,
  acctCoder: BorshAccountsCoder,
  balances: UnknownRecord[],
  groupPk: PublicKey
): Promise<{ pairs: Array<[PublicKey, PublicKey]> }> {
  const pairs: Array<[PublicKey, PublicKey]> = [];

  for (const b of balances) {
    const { active, bankPk, assetShares } = extractBalanceInfo(b);
    if (!active || !bankPk || !assetShares || assetShares.isZero()) continue;

    const bankPubkey = new PublicKey(bankPk);
    const info = await conn.getAccountInfo(bankPubkey, "confirmed");
    if (!info?.data) continue;

    const { decoded: bankAny } = decodeByDisc(acctCoder, info.data);
    const bankConfig = getNestedRecord(bankAny, "config");

    const bankGroup =
      toB58(bankAny["group"]) ??
      (bankConfig ? toB58(bankConfig["group"]) : null) ??
      toB58(bankAny["bankGroup"]);
    if (bankGroup !== groupPk.toBase58()) continue;

    const oracleKeysSource =
      bankAny["oracle_keys"] ??
      bankAny["oracleKeys"] ??
      (bankConfig
        ? bankConfig["oracle_keys"] ?? bankConfig["oracleKeys"]
        : null) ??
      [];
    const oracleKeys = (Array.isArray(oracleKeysSource)
      ? oracleKeysSource
      : [])
      .map(toB58)
      .filter((key): key is string => typeof key === "string");
    const defaultKey = PublicKey.default.toBase58();
    const oracleB58 = oracleKeys.find((key) => key !== defaultKey);
    if (!oracleB58) continue;

    pairs.push([bankPubkey, new PublicKey(oracleB58)]);
  }

  return { pairs };
}

/* ───────── route ───────── */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      owner58?: string;
      amountUi?: number;
      decimals?: number; // default 6
      ensureAta?: boolean; // default true
      marginfiAccount?: string; // required
      withdrawAll?: boolean; // default false
    } | null;

    const owner58 = body?.owner58?.trim();
    const marginfiAccountStr = body?.marginfiAccount?.trim();
    const withdrawAll = body?.withdrawAll === true;
    const amountUi = Number(body?.amountUi);
    const decimals = Number.isFinite(body?.decimals)
      ? Number(body!.decimals)
      : 6;
    const ensureAta = body?.ensureAta !== false;

    if (!owner58 || !marginfiAccountStr) {
      return jsonError("owner58 and marginfiAccount are required", 400);
    }
    if (!withdrawAll && !Number.isFinite(amountUi)) {
      return jsonError("amountUi is required unless withdrawAll is true", 400);
    }

    const owner = new PublicKey(owner58);
    const marginfiAccountPk = new PublicKey(marginfiAccountStr);

    const conn = new Connection(RPC, "confirmed");
    const acctCoder = new BorshAccountsCoder(marginfiIdl as Idl);
    const ixCoder = new BorshInstructionCoder(marginfiIdl as Idl);

    // --- FeeState PDA ---
    const [feeStatePk] = PublicKey.findProgramAddressSync(
      [Buffer.from("feestate")],
      MARGINFI_PROGRAM_ID
    );

    // Debug: group, account owners
    const groupInfo = await conn.getAccountInfo(MARGINFI_GROUP, "confirmed");
    console.log(
      "[prepare-withdraw] group owner",
      groupInfo?.owner.toBase58() || "not found"
    );

    const mAccInfo = await conn.getAccountInfo(marginfiAccountPk, "confirmed");
    console.log(
      "[prepare-withdraw] marginfiAccount owner",
      mAccInfo?.owner.toBase58() || "not found"
    );
    if (!mAccInfo?.data)
      return jsonError("MarginfiAccount not found on chain", 404);

    const { decoded: mAcc } = decodeByDisc(acctCoder, mAccInfo.data);
    const balancesSrc =
      (isRecord(mAcc["lending_account"])
        ? (mAcc["lending_account"] as UnknownRecord)["balances"]
        : undefined) ??
      mAcc["balances"] ??
      (isRecord(mAcc["lendingAccount"])
        ? (mAcc["lendingAccount"] as UnknownRecord)["balances"]
        : undefined) ??
      [];
    const balances: UnknownRecord[] = Array.isArray(balancesSrc)
      ? balancesSrc.filter(isRecord)
      : [];

    // Pick the USDC bank (same group) with nonzero shares
    let chosenBankPk: PublicKey | null = null;
    for (const b of balances) {
      const { active, bankPk, assetShares } = extractBalanceInfo(b);
      if (!active || !bankPk || !assetShares || assetShares.isZero()) continue;

      const bankPkPub = new PublicKey(bankPk);
      const info = await conn.getAccountInfo(bankPkPub, "confirmed");
      if (!info?.data) continue;

      const { decoded: bankAny } = decodeByDisc(acctCoder, info.data);
      const bankConfig = getNestedRecord(bankAny, "config");
      const mintStr =
        toB58(bankAny["mint"]) ??
        (bankConfig ? toB58(bankConfig["mint"]) : null) ??
        toB58(bankAny["bankMint"]);
      if (mintStr !== USDC_MINT.toBase58()) continue;

      const bankGroup =
        toB58(bankAny["group"]) ??
        (bankConfig ? toB58(bankConfig["group"]) : null) ??
        toB58(bankAny["bankGroup"]);
      if (bankGroup !== MARGINFI_GROUP.toBase58()) continue;

      chosenBankPk = bankPkPub;
      break;
    }

    if (!chosenBankPk) {
      return jsonError(
        "MarginfiAccount has no active USDC asset in this group; cannot withdraw",
        400,
        { marginfiAccount: marginfiAccountPk.toBase58() }
      );
    }

    // Bank & vault details
    const bankInfo = await conn.getAccountInfo(chosenBankPk, "confirmed");
    console.log(
      "[prepare-withdraw] bank owner",
      bankInfo?.owner.toBase58() || "not found"
    );
    if (!bankInfo?.data) return jsonError("Chosen Bank not found", 500);
    if (!bankInfo.owner.equals(MARGINFI_PROGRAM_ID)) {
      return jsonError("Chosen Bank not owned by marginfi program", 500, {
        owner: bankInfo.owner.toBase58(),
        expected: MARGINFI_PROGRAM_ID.toBase58(),
      });
    }

    const { decoded: bank } = decodeByDisc(acctCoder, bankInfo.data);
    const bankConfig = getNestedRecord(bank, "config");

    // extra debug
    const rawOperationalState = bankInfo.data.readUInt8(600);
    const rawOracleSetup = bankInfo.data.readUInt8(601);
    console.log(
      "[prepare-withdraw] raw operational_state u8",
      rawOperationalState
    );
    console.log("[prepare-withdraw] raw oracle_setup u8", rawOracleSetup);

    const vaultB58 = toB58(
      bank["liquidity_vault"] ?? bank["liquidityVault"]
    );
    if (!vaultB58) return jsonError("Bank missing liquidity_vault", 500);
    const bankLiquidityVault = new PublicKey(vaultB58);

    const vaultInfo = await conn.getAccountInfo(
      bankLiquidityVault,
      "confirmed"
    );
    console.log(
      "[prepare-withdraw] bankLiquidityVault owner",
      vaultInfo?.owner.toBase58() || "not found"
    );

    const [bankLiquidityVaultAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from("liquidity_vault_auth"), chosenBankPk.toBuffer()],
      MARGINFI_PROGRAM_ID
    );

    // Oracle debug (pyth push)
    const oracleSetupRaw =
      bank["oracle_setup"] ??
      bank["oracleSetup"] ??
      (bankConfig
        ? bankConfig["oracle_setup"] ?? bankConfig["oracleSetup"]
        : undefined);
    const oracleSetup = isRecord(oracleSetupRaw) ? oracleSetupRaw : null;
    console.log("[prepare-withdraw] bank.oracle_setup", oracleSetup);

    const oracleKeysSource =
      bank["oracle_keys"] ??
      bank["oracleKeys"] ??
      (bankConfig
        ? bankConfig["oracle_keys"] ?? bankConfig["oracleKeys"]
        : null) ??
      [];
    const oracleKeys = (Array.isArray(oracleKeysSource)
      ? oracleKeysSource
      : [])
      .map(toB58)
      .filter((key): key is string => typeof key === "string")
      .filter((key) => key !== PublicKey.default.toBase58());
    console.log("[prepare-withdraw] oracleKeys", oracleKeys);

    const needsPythPush =
      oracleSetup != null &&
      Object.prototype.hasOwnProperty.call(oracleSetup, "PythPushOracle");
    console.log("[prepare-withdraw] needsPythPush", needsPythPush);

    const oraclePk =
      needsPythPush && oracleKeys.length > 0
        ? new PublicKey(oracleKeys[0])
        : null;

    if (oraclePk) {
      const oracleInfo = await conn.getAccountInfo(oraclePk, "confirmed");
      console.log(
        "[prepare-withdraw] oracle owner",
        oracleInfo?.owner.toBase58() || "not found"
      );
    }

    // Destination ATA
    const detectedTokenProgram = await detectTokenProgramId(conn, USDC_MINT);
    console.log(
      "[prepare-withdraw] detectedTokenProgram",
      detectedTokenProgram.toBase58()
    );

    const userUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      owner,
      false,
      detectedTokenProgram
    );

    // --- Build remaining accounts: [bank, oracle] pairs for all active balances (chosen first), + feeState last
    const { pairs } = await collectRemainingAccountMetas(
      conn,
      acctCoder,
      balances,
      MARGINFI_GROUP
    );

    // ensure chosen bank is first in order
    const idx = pairs.findIndex(([bankPk]) => bankPk.equals(chosenBankPk!));
    if (idx > 0) {
      const [chosenPair] = pairs.splice(idx, 1);
      pairs.unshift(chosenPair);
    }

    const orderedRemaining: Meta[] = pairs
      .flat()
      .map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }));

    // If USDC is Token-2022, prepend mint to remaining (marginfi expects it)
    if (detectedTokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
      orderedRemaining.unshift({
        pubkey: USDC_MINT,
        isSigner: false,
        isWritable: false,
      });
    }

    // FeeState LAST
    orderedRemaining.push({
      pubkey: feeStatePk,
      isSigner: false,
      isWritable: false,
    });

    // 4) Build ixs
    const ixs = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 86_160 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 106_603 }),
    ];

    if (ensureAta) {
      ixs.push(
        createAssociatedTokenAccountIdempotentInstruction(
          HAVEN_PUBKEY,
          userUsdcAta,
          owner,
          USDC_MINT,
          detectedTokenProgram
        )
      );
    }

    // Sort balances ix (gapless)
    const sortData = ixCoder.encode("lending_account_sort_balances", {});
    ixs.push({
      programId: MARGINFI_PROGRAM_ID,
      keys: [{ pubkey: marginfiAccountPk, isSigner: false, isWritable: true }],
      data: sortData,
    });

    // Withdraw ix
    const amountBN = withdrawAll ? new BN(0) : uiToBN(amountUi, decimals);
    const withdrawIxData = ixCoder.encode("lending_account_withdraw", {
      amount: amountBN,
      withdraw_all: withdrawAll ? true : null, // Option<bool>
    });

    const baseKeys = [
      { pubkey: MARGINFI_GROUP, isSigner: false, isWritable: false },
      { pubkey: marginfiAccountPk, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: chosenBankPk, isSigner: false, isWritable: true },
      { pubkey: userUsdcAta, isSigner: false, isWritable: true },
      { pubkey: bankLiquidityVaultAuth, isSigner: false, isWritable: false },
      { pubkey: bankLiquidityVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    ixs.push({
      programId: MARGINFI_PROGRAM_ID,
      keys: [...baseKeys, ...orderedRemaining],
      data: withdrawIxData,
    });

    // 5) Compile sponsored tx
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash(
      "processed"
    );
    const msg = new TransactionMessage({
      payerKey: HAVEN_PUBKEY,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);
    const b64 = Buffer.from(tx.serialize()).toString("base64");

    console.log("[/api/savings/prepare-withdraw] built", {
      marginfiAccount: marginfiAccountPk.toBase58(),
      pickedBank: chosenBankPk.toBase58(),
      group: MARGINFI_GROUP.toBase58(),
      owner: owner.toBase58(),
      userUsdcAta: userUsdcAta.toBase58(),
      vault: bankLiquidityVault.toBase58(),
      bankLiquidityVaultAuth: bankLiquidityVaultAuth.toBase58(),
      oracle: oraclePk ? oraclePk.toBase58() : null,
      feeState: feeStatePk.toBase58(),
      remainingCount: orderedRemaining.length,
    });

    return NextResponse.json({
      transaction: b64,
      marginfiAccount: marginfiAccountPk.toBase58(),
      bank: chosenBankPk.toBase58(),
      userUsdcAta: userUsdcAta.toBase58(),
      oracle: oraclePk ? oraclePk.toBase58() : null,
      feePayer: HAVEN_PUBKEY.toBase58(),
      lastValidBlockHeight,
      requiredClientSigner: owner.toBase58(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonError(msg, 500, e);
  }
}
