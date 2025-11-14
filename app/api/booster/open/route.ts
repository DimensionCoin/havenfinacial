// app/api/booster/open/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type Commitment,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

import {
  RPC_CONNECTION,
  JUPITER_PERPETUALS_PROGRAM_ID,
  JUPITER_PERPETUALS_EVENT_AUTHORITY_PUBKEY,
  JUPITER_PERPETUALS_CONFIG_PUBKEY,
  CUSTODY_PUBKEY,
  USDC_DECIMALS,
  JLP_POOL_ACCOUNT_PUBKEY,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  USDC_MINT,
} from "@/types/constants";

export const runtime = "nodejs";

/* ───────── ENV / CONSTANTS ───────── */

const HAVEN_FEEPAYER_STR = process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS!;
const TREASURY_OWNER_STR = process.env.NEXT_PUBLIC_APP_TREASURY_OWNER!;

// Shared commitment
const PROCESSED_COMMITMENT: Commitment = "processed";

// 1.5x leverage
const BOOSTER_LEVERAGE_NUM = 15;
const BOOSTER_LEVERAGE_DEN = 10;

// Haven fee: 2% of *user margin* (amount they want to use as collateral)
const BOOSTER_FEE_BPS = 200; // 200 / 10_000 = 2%

// Priority fee + compute limit — tuned for cost vs speed.
const PRIORITY_MICROLAMPORTS = 20_000; // cheap priority
const COMPUTE_UNIT_LIMIT = 400_000; // safe headroom

// === Dynamic rent math (precise) ===
const TOKEN_ACCOUNT_SPACE = 165; // SPL token account size (fixed)
const PERPS_POSITION_SPACE = 896; // approximate; tune if you learn exact size
const PERPS_POSITION_REQUEST_SPACE = 512; // approximate; tune if you learn exact size

// Base tx fee cushion (non-priority part)
const BASE_FEE_BUFFER_LAMPORTS = 5_000;

/**
 * Very rough upper bounds for oracle price (in 1e6 decimals).
 * Chosen to be safely above any realistic price so validation passes.
 */
const MAX_PRICE_CAP_USD_1E6: Record<"BTC" | "ETH" | "SOL", BN> = {
  SOL: new BN("100000000000"), // $100k * 1e6
  ETH: new BN("200000000000"), // $200k * 1e6
  BTC: new BN("2000000000000"), // $2M * 1e6
};

/* ───────── HELPERS ───────── */

function jsonError(
  status: number,
  payload: {
    code: string;
    error: string;
    userMessage: string;
    tip?: string;
    stage?: string;
    details?: unknown;
  }
) {
  console.error("[/api/booster/open] error", status, payload);
  return NextResponse.json(payload, { status });
}

async function detectTokenProgramId(mint: PublicKey) {
  console.log("[booster/open] detectTokenProgramId: start", {
    mint: mint.toBase58(),
  });
  const info = await RPC_CONNECTION.getAccountInfo(mint, "confirmed");
  if (!info) {
    console.error("[booster/open] detectTokenProgramId: mint not found", {
      mint: mint.toBase58(),
    });
    throw new Error(`Mint not found on chain: ${mint.toBase58()}`);
  }

  const is2022 = info.owner.equals(TOKEN_2022_PROGRAM_ID);
  console.log("[booster/open] detectTokenProgramId: result", {
    owner: info.owner.toBase58(),
    is2022,
  });
  return is2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}

// Rent helpers
async function getRents() {
  const [rentTokenAcc, rentPos, rentReq] = await Promise.all([
    RPC_CONNECTION.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SPACE),
    RPC_CONNECTION.getMinimumBalanceForRentExemption(PERPS_POSITION_SPACE),
    RPC_CONNECTION.getMinimumBalanceForRentExemption(
      PERPS_POSITION_REQUEST_SPACE
    ),
  ]);
  return { rentTokenAcc, rentPos, rentReq };
}

async function getExistingAccounts(pubkeys: PublicKey[]) {
  const infos = await RPC_CONNECTION.getMultipleAccountsInfo(
    pubkeys,
    PROCESSED_COMMITMENT
  );
  return infos.map((i) => !!i);
}

// ["position", walletAddress, pool, custody, collateral_custody, sideEnum]
function generatePositionPda({
  custody,
  collateralCustody,
  walletAddress,
  side,
}: {
  custody: PublicKey;
  collateralCustody: PublicKey;
  walletAddress: PublicKey;
  side: "long" | "short";
}) {
  console.log("[booster/open] generatePositionPda: seeds", {
    walletAddress: walletAddress.toBase58(),
    pool: JLP_POOL_ACCOUNT_PUBKEY.toBase58(),
    custody: custody.toBase58(),
    collateralCustody: collateralCustody.toBase58(),
    side,
  });

  const sideSeed = side === "long" ? Buffer.from([1]) : Buffer.from([2]);

  const [position, bump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("position"),
      walletAddress.toBuffer(),
      JLP_POOL_ACCOUNT_PUBKEY.toBuffer(),
      custody.toBuffer(),
      collateralCustody.toBuffer(),
      sideSeed,
    ],
    JUPITER_PERPETUALS_PROGRAM_ID
  );

  console.log("[booster/open] generatePositionPda: result", {
    position: position.toBase58(),
    bump,
  });

  return { position, bump };
}

// ["position_request", positionPubkey, counter_le_u64, requestChangeEnum]
function generatePositionRequestPda({
  position,
  counter,
  requestChange,
}: {
  position: PublicKey;
  counter?: BN;
  requestChange: "increase" | "decrease";
}) {
  if (!counter) {
    counter = new BN(Math.floor(Math.random() * 1_000_000_000));
  }
  const requestChangeEnum =
    requestChange === "increase" ? Buffer.from([1]) : Buffer.from([2]);

  console.log("[booster/open] generatePositionRequestPda: seeds", {
    position: position.toBase58(),
    counter: counter.toString(),
    requestChange,
  });

  const [positionRequest, bump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("position_request"),
      position.toBuffer(),
      counter.toArrayLike(Buffer, "le", 8),
      requestChangeEnum,
    ],
    JUPITER_PERPETUALS_PROGRAM_ID
  );

  console.log("[booster/open] generatePositionRequestPda: result", {
    positionRequest: positionRequest.toBase58(),
    counter: counter.toString(),
    bump,
  });

  return { positionRequest, counter, bump };
}

// symbol → custody mapping
const UNDERLYING_BY_SYMBOL: Record<string, PublicKey> = {
  BTC: new PublicKey(CUSTODY_PUBKEY.BTC),
  ETH: new PublicKey(CUSTODY_PUBKEY.ETH),
  SOL: new PublicKey(CUSTODY_PUBKEY.SOL),
};

const USDC_CUSTODY = new PublicKey(CUSTODY_PUBKEY.USDC);

/* ───────── Manual encoding helpers for JUP perps ix ───────── */

// u64 (BN) → 8-byte LE buffer
function encodeU64(value: BN): Buffer {
  return value.toArrayLike(Buffer, "le", 8);
}

// Side enum: { none, long, short } -> 0/1/2
type PerpsSideArg = {
  none?: Record<string, never>;
  long?: Record<string, never>;
  short?: Record<string, never>;
};

function encodeSide(side: PerpsSideArg): Buffer {
  let v = 0;
  if ("long" in side) v = 1;
  else if ("short" in side) v = 2;
  return Buffer.from([v]);
}

// Option<u64>: 0x00 for None, 0x01 + u64 for Some
function encodeOptionU64(value: BN | null): Buffer {
  if (!value) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), encodeU64(value)]);
}

// Anchor-style discriminator for this instruction
const CREATE_INCREASE_POSITION_DISC = crypto
  .createHash("sha256")
  .update("global:create_increase_position_market_request")
  .digest()
  .subarray(0, 8);

// Encodes the data for createIncreasePositionMarketRequest
function encodeCreateIncreasePositionMarketRequest(args: {
  sizeUsdDelta: BN;
  collateralDelta: BN;
  side: PerpsSideArg;
  priceSlippage: BN;
  jupiterMinimumOut: BN | null;
  counter: BN;
}): Buffer {
  const {
    sizeUsdDelta,
    collateralDelta,
    side,
    priceSlippage,
    jupiterMinimumOut,
    counter,
  } = args;

  return Buffer.concat([
    CREATE_INCREASE_POSITION_DISC,
    encodeU64(sizeUsdDelta),
    encodeU64(collateralDelta),
    encodeSide(side),
    encodeU64(priceSlippage),
    encodeOptionU64(jupiterMinimumOut),
    encodeU64(counter),
  ]);
}

/* ───────── ROUTE ───────── */

export async function POST(req: Request) {
  const stageRef: { stage: string } = { stage: "init" };

  console.log("\n\n============================");
  console.log("[/api/booster/open] POST start");
  console.log("============================");

  try {
    stageRef.stage = "envCheck";
    console.log("[booster/open] stage:", stageRef.stage);

    console.log("[booster/open] env / constants", {
      HAVEN_FEEPAYER_STR,
      TREASURY_OWNER_STR,
      USDC_MINT: USDC_MINT?.toBase58?.(),
      JUPITER_PERPETUALS_PROGRAM_ID:
        JUPITER_PERPETUALS_PROGRAM_ID?.toBase58?.(),
      JUPITER_PERPETUALS_CONFIG_PUBKEY:
        JUPITER_PERPETUALS_CONFIG_PUBKEY?.toBase58?.(),
      JUPITER_PERPETUALS_EVENT_AUTHORITY_PUBKEY:
        JUPITER_PERPETUALS_EVENT_AUTHORITY_PUBKEY?.toBase58?.(),
      JLP_POOL_ACCOUNT_PUBKEY: JLP_POOL_ACCOUNT_PUBKEY?.toBase58?.(),
      CUSTODY_PUBKEY,
      USDC_DECIMALS,
    });

    if (!USDC_MINT || !HAVEN_FEEPAYER_STR || !TREASURY_OWNER_STR) {
      return jsonError(500, {
        code: "MISSING_ENV",
        error:
          "Missing env: NEXT_PUBLIC_USDC_MINT / NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS / NEXT_PUBLIC_APP_TREASURY_OWNER",
        userMessage: "We couldn’t prepare this boosted trade.",
        tip: "Please try again in a bit while we sort this out.",
        stage: stageRef.stage,
      });
    }

    const HAVEN_FEEPAYER = new PublicKey(HAVEN_FEEPAYER_STR);
    const TREASURY_OWNER = new PublicKey(TREASURY_OWNER_STR);

    stageRef.stage = "parseBody";
    console.log("[booster/open] stage:", stageRef.stage);

    const body = (await req.json().catch((err) => {
      console.error("[booster/open] req.json() failed", err);
      return null;
    })) as {
      ownerBase58?: string;
      side?: "long" | "short";
      symbol?: "BTC" | "ETH" | "SOL";
      marginUnits?: number;
      priceSlippageBps?: number;
    } | null;

    console.log("[booster/open] raw body:", body);

    const ownerBase58 = body?.ownerBase58 ?? "";
    const side = body?.side ?? "long";
    const symbol = body?.symbol ?? "BTC";
    const marginUnits = body?.marginUnits ?? 0;
    const priceSlippageBps = body?.priceSlippageBps ?? 500;

    console.log("[booster/open] parsed payload", {
      ownerBase58,
      side,
      symbol,
      marginUnits,
      priceSlippageBps,
    });

    if (
      !ownerBase58 ||
      !UNDERLYING_BY_SYMBOL[symbol] ||
      !Number.isFinite(marginUnits) ||
      marginUnits <= 0 ||
      !Number.isFinite(priceSlippageBps) ||
      priceSlippageBps < 0 ||
      (side !== "long" && side !== "short")
    ) {
      console.error("[booster/open] INVALID_PAYLOAD", {
        ownerBase58,
        symbol,
        side,
        marginUnits,
        priceSlippageBps,
      });

      return jsonError(400, {
        code: "INVALID_PAYLOAD",
        error:
          "Need ownerBase58, symbol ∈ {BTC,ETH,SOL}, side ∈ {long,short}, marginUnits>0",
        userMessage: "We couldn’t set up this boosted trade.",
        tip: "Please refresh and try again.",
        stage: stageRef.stage,
        details: { ownerBase58, symbol, side, marginUnits, priceSlippageBps },
      });
    }

    const owner = new PublicKey(ownerBase58);
    const custody = UNDERLYING_BY_SYMBOL[symbol];

    // collateral custody: long → underlying, short → USDC
    const collateralCustody = side === "long" ? custody : USDC_CUSTODY;

    console.log("[booster/open] derived basics", {
      owner: owner.toBase58(),
      custody: custody.toBase58(),
      collateralCustody: collateralCustody.toBase58(),
    });

    /* ───────── PDAs & counter ───────── */

    stageRef.stage = "derivePDAs:position";
    console.log("[booster/open] stage:", stageRef.stage);

    const { position } = generatePositionPda({
      custody,
      collateralCustody,
      walletAddress: owner,
      side,
    });

    stageRef.stage = "derivePDAs:positionRequest";
    console.log("[booster/open] stage:", stageRef.stage);

    const { positionRequest, counter } = generatePositionRequestPda({
      position,
      requestChange: "increase",
    });

    console.log("[booster/open] PDAs", {
      position: position.toBase58(),
      positionRequest: positionRequest.toBase58(),
      counter: counter.toString(),
    });

    // Check if PDAs already exist so we only fund rent when needed.
    const [positionInfo, positionReqInfo] =
      await RPC_CONNECTION.getMultipleAccountsInfo(
        [position, positionRequest],
        PROCESSED_COMMITMENT
      );

    const willCreatePosition = !positionInfo;
    const willCreatePositionReq = !positionReqInfo;

    /* ───────── Amounts (BN math) ───────── */

    stageRef.stage = "amounts";
    console.log("[booster/open] stage:", stageRef.stage);

    console.log("[booster/open] amounts: raw marginUnits", marginUnits);
    const marginBn = new BN(marginUnits); // user-entered amount (in USDC 1e6)
    console.log("[booster/open] amounts: marginBn", marginBn.toString());

    // Fee = 2% of the user margin, taken *out* of that margin.
    const feeUnitsBn = marginBn.muln(BOOSTER_FEE_BPS).divn(10_000);
    const collateralBn = marginBn.sub(feeUnitsBn);

    console.log("[booster/open] amounts: feeUnitsBn", feeUnitsBn.toString());
    console.log(
      "[booster/open] amounts: collateralBn (margin - fee)",
      collateralBn.toString()
    );

    if (feeUnitsBn.lten(0) || collateralBn.lten(0)) {
      console.error("[booster/open] FEE_OR_COLLATERAL_TOO_SMALL", {
        marginUnits,
        marginBn: marginBn.toString(),
        feeUnitsBn: feeUnitsBn.toString(),
        collateralBn: collateralBn.toString(),
      });

      return jsonError(400, {
        code: "FEE_OR_COLLATERAL_TOO_SMALL",
        error:
          "Fee or effective collateral rounded to zero; margin amount is too small.",
        userMessage:
          "This boosted trade is too small for our minimum fee / leverage.",
        tip: "Try a slightly larger amount.",
        stage: stageRef.stage,
        details: {
          marginUnits,
          marginBn: marginBn.toString(),
          feeUnitsBn: feeUnitsBn.toString(),
          collateralBn: collateralBn.toString(),
        },
      });
    }

    // Notional is applied to the *effective* collateral.
    const sizeUsdBn = collateralBn
      .muln(BOOSTER_LEVERAGE_NUM)
      .divn(BOOSTER_LEVERAGE_DEN);

    console.log("[booster/open] amounts: sizeUsdBn", sizeUsdBn.toString());

    // Total USDC that will leave the user's wallet is:
    // collateral going into the position + fee going to Haven = marginBn.
    const totalRequiredBn = marginBn;

    console.log("[booster/open] amounts: totalRequiredBn", {
      marginBn: marginBn.toString(),
      feeUnitsBn: feeUnitsBn.toString(),
      collateralBn: collateralBn.toString(),
      totalRequiredBn: totalRequiredBn.toString(),
    });

    /* ───────── Token program + ATAs ───────── */

    stageRef.stage = "tokenSetup";
    console.log("[booster/open] stage:", stageRef.stage);

    const usdcProgramId = await detectTokenProgramId(USDC_MINT);
    console.log("[booster/open] usdcProgramId", usdcProgramId.toBase58());

    const userUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      owner,
      false,
      usdcProgramId
    );
    const treasuryUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      TREASURY_OWNER,
      false,
      usdcProgramId
    );
    const positionRequestAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      positionRequest,
      true,
      usdcProgramId
    );

    console.log("[booster/open] ATAs", {
      userUsdcAta: userUsdcAta.toBase58(),
      treasuryUsdcAta: treasuryUsdcAta.toBase58(),
      positionRequestAta: positionRequestAta.toBase58(),
    });

    /* ───────── Balance guard (USDC) ───────── */

    stageRef.stage = "balanceGuard";
    console.log("[booster/open] stage:", stageRef.stage);

    const balResp = await RPC_CONNECTION.getTokenAccountBalance(
      userUsdcAta,
      "confirmed"
    );
    console.log("[booster/open] user balance response", balResp);

    const available = new BN(balResp?.value?.amount || "0");
    console.log("[booster/open] available vs required", {
      available: available.toString(),
      required: totalRequiredBn.toString(),
    });

    if (available.lt(totalRequiredBn)) {
      return jsonError(400, {
        code: "INSUFFICIENT_USDC",
        error: `Insufficient USDC. Required: ${totalRequiredBn.toString()}, available: ${available.toString()}`,
        userMessage:
          "You don’t have enough USDC in your deposit wallet to open this boosted trade.",
        tip: "Add more USDC or try a smaller amount.",
        stage: stageRef.stage,
        details: {
          requiredUnits: totalRequiredBn.toString(),
          availableUnits: available.toString(),
        },
      });
    }

    /* ───────── Dynamic rent math + top-ups ───────── */

    const [userAtaExists, treasuryAtaExists, prAtaExists] =
      await getExistingAccounts([
        userUsdcAta,
        treasuryUsdcAta,
        positionRequestAta,
      ]);

    const { rentTokenAcc, rentPos, rentReq } = await getRents();

    // Only charge rent for PDAs that will actually be created in this tx.
    const rentNeededPos = willCreatePosition ? rentPos : 0;
    const rentNeededReq = willCreatePositionReq ? rentReq : 0;
    const totalRentNeeded = rentNeededPos + rentNeededReq;

    stageRef.stage = "ownerLamportsTopUp";
    const ownerLamportsBefore = await RPC_CONNECTION.getBalance(
      owner,
      PROCESSED_COMMITMENT
    );

    /**
     * We only top the user up by exactly the PDA rent they will pay.
     * - Perps burn `totalRentNeeded` from the owner.
     * - We send them `topUpLamports = totalRentNeeded`.
     * => Net rent effect on the user is 0; Haven is effectively paying it.
     */
    const topUpLamports = totalRentNeeded;

    console.log("[booster/open] owner rent math", {
      ownerLamportsBefore,
      rentNeededPos,
      rentNeededReq,
      totalRentNeeded,
      topUpLamports,
    });

    stageRef.stage = "havenLamportsGuard";
    const havenLamports = await RPC_CONNECTION.getBalance(
      HAVEN_FEEPAYER,
      PROCESSED_COMMITMENT
    );

    const missingAtaRent =
      (userAtaExists ? 0 : rentTokenAcc) +
      (treasuryAtaExists ? 0 : rentTokenAcc) +
      (prAtaExists ? 0 : rentTokenAcc);

    const estimatedPriorityFeeLamports = Math.floor(
      (COMPUTE_UNIT_LIMIT * PRIORITY_MICROLAMPORTS) / 1_000_000
    );

    const requiredLamportsForThisTx =
      topUpLamports +
      missingAtaRent +
      estimatedPriorityFeeLamports +
      BASE_FEE_BUFFER_LAMPORTS;

    console.log("[booster/open] haven funds check", {
      havenLamports,
      topUpLamports,
      missingAtaRent,
      estimatedPriorityFeeLamports,
      BASE_FEE_BUFFER_LAMPORTS,
      requiredLamportsForThisTx,
      userAtaExists,
      treasuryAtaExists,
      prAtaExists,
      rentTokenAcc,
    });

    if (havenLamports < requiredLamportsForThisTx) {
      return jsonError(500, {
        code: "HAVEN_FEEPAYER_LOW_SOL",
        error: `Haven fee-payer has ${havenLamports} lamports, needs ${requiredLamportsForThisTx}.`,
        userMessage: "We couldn’t prepare this boosted trade.",
        tip: "Please try again in a bit — we’re refilling SOL for fees.",
        stage: stageRef.stage,
        details: {
          havenLamports,
          requiredLamportsForThisTx,
          topUpLamports,
          missingAtaRent,
          estimatedPriorityFeeLamports,
        },
      });
    }

    /* ───────── Build instructions ───────── */

    stageRef.stage = "buildInstructions";
    console.log("[booster/open] stage:", stageRef.stage);
    const ixs: TransactionInstruction[] = [];

    // Cheap priority fee
    ixs.push(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: PRIORITY_MICROLAMPORTS,
      })
    );

    // Fund user with SOL for PDAs (rent only, no extra buffer).
    if (topUpLamports > 0) {
      ixs.push(
        SystemProgram.transfer({
          fromPubkey: HAVEN_FEEPAYER,
          toPubkey: owner,
          lamports: topUpLamports,
        })
      );
    }

    // Ensure ATAs exist (idempotent) — all created/funded by HAVEN_FEEPAYER
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        HAVEN_FEEPAYER,
        userUsdcAta,
        owner,
        USDC_MINT,
        usdcProgramId
      )
    );
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        HAVEN_FEEPAYER,
        treasuryUsdcAta,
        TREASURY_OWNER,
        USDC_MINT,
        usdcProgramId
      )
    );
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        HAVEN_FEEPAYER,
        positionRequestAta,
        positionRequest,
        USDC_MINT,
        usdcProgramId
      )
    );

    // Side enum for perps
    const sideArg: PerpsSideArg =
      side === "long" ? { long: {} } : { short: {} };

    const basePriceCap =
      MAX_PRICE_CAP_USD_1E6[symbol as "BTC" | "ETH" | "SOL"] ??
      new BN("1000000000000");
    const priceSlippageBn = basePriceCap
      .muln(10_000 + priceSlippageBps)
      .divn(10_000);

    const jupiterMinimumOut: BN | null = new BN(1);

    console.log("[booster/open] perps args about to encode", {
      sizeUsdBn: sizeUsdBn.toString(),
      collateralBn: collateralBn.toString(),
      priceSlippageBn: priceSlippageBn.toString(),
      jupiterMinimumOut: jupiterMinimumOut?.toString() ?? null,
      counter: counter.toString(),
    });

    stageRef.stage = "buildPerpsIx";
    let openIx: TransactionInstruction;
    try {
      const data = encodeCreateIncreasePositionMarketRequest({
        sizeUsdDelta: sizeUsdBn,
        collateralDelta: collateralBn, // effective collateral (margin - fee)
        side: sideArg,
        priceSlippage: priceSlippageBn,
        jupiterMinimumOut,
        counter,
      });

      const keys = [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: userUsdcAta, isSigner: false, isWritable: true },
        {
          pubkey: JUPITER_PERPETUALS_CONFIG_PUBKEY,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: JLP_POOL_ACCOUNT_PUBKEY, isSigner: false, isWritable: true },
        { pubkey: position, isSigner: false, isWritable: true },
        { pubkey: positionRequest, isSigner: false, isWritable: true },
        { pubkey: positionRequestAta, isSigner: false, isWritable: true },
        { pubkey: custody, isSigner: false, isWritable: false },
        { pubkey: collateralCustody, isSigner: false, isWritable: false },
        { pubkey: USDC_MINT, isSigner: false, isWritable: false },
        { pubkey: PublicKey.default, isSigner: false, isWritable: false }, // referral
        { pubkey: usdcProgramId, isSigner: false, isWritable: false },
        {
          pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        {
          pubkey: JUPITER_PERPETUALS_EVENT_AUTHORITY_PUBKEY,
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: JUPITER_PERPETUALS_PROGRAM_ID,
          isSigner: false,
          isWritable: false,
        },
      ];

      openIx = new TransactionInstruction({
        programId: JUPITER_PERPETUALS_PROGRAM_ID,
        keys,
        data,
      });
      console.log("[booster/open] buildPerpsIx: success");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;

      console.error("[booster/open] buildPerpsIx: FAILED", {
        err,
        message: errorMessage,
        stack: errorStack,
      });

      return jsonError(500, {
        code: "BUILD_PERPS_IX_ERROR",
        error: errorMessage,
        userMessage: "We couldn’t build this boosted trade (perps ix).",
        tip: "Please try again. If it keeps failing, contact support.",
        stage: stageRef.stage,
      });
    }

    ixs.push(openIx);

    // Haven fee (USDC) — 2% of margin, taken from user's USDC and sent to TREASURY_OWNER.
    const feeUnits = feeUnitsBn.toNumber();
    console.log("[booster/open] feeUnits (number)", feeUnits);
    if (feeUnits > 0) {
      ixs.push(
        createTransferCheckedInstruction(
          userUsdcAta,
          USDC_MINT,
          treasuryUsdcAta,
          owner,
          feeUnits,
          USDC_DECIMALS,
          [],
          usdcProgramId
        )
      );
    }

    // Compute limit near the end
    ixs.push(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: COMPUTE_UNIT_LIMIT,
      })
    );

    /* ───────── Compile tx ───────── */

    stageRef.stage = "compile";
    console.log("[booster/open] stage:", stageRef.stage);

    const { blockhash, lastValidBlockHeight } =
      await RPC_CONNECTION.getLatestBlockhash(PROCESSED_COMMITMENT);

    console.log("[booster/open] latestBlockhash", {
      blockhash,
      lastValidBlockHeight,
      ixCount: ixs.length,
    });

    const msg = new TransactionMessage({
      payerKey: HAVEN_FEEPAYER, // 👈 fee payer pays gas
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const unsignedTx = new VersionedTransaction(msg);
    const b64 = Buffer.from(unsignedTx.serialize()).toString("base64");

    console.log("[booster/open] success: returning transaction", {
      symbol,
      side,
      leverage: BOOSTER_LEVERAGE_NUM / BOOSTER_LEVERAGE_DEN,
      marginUnits: marginBn.toString(), // user-entered
      collateralUnits: collateralBn.toString(), // margin - fee
      sizeUsdUnits: sizeUsdBn.toString(),
      feeUnits: feeUnitsBn.toString(),
      ownerLamportsBefore,
      topUpLamports,
      totalRentNeeded,
    });

    return NextResponse.json({
      transaction: b64,
      recentBlockhash: blockhash,
      lastValidBlockHeight,
      meta: {
        symbol,
        side,
        leverage: BOOSTER_LEVERAGE_NUM / BOOSTER_LEVERAGE_DEN,
        marginUnits: marginBn.toString(),
        collateralUnits: collateralBn.toString(),
        sizeUsdUnits: sizeUsdBn.toString(),
        feeUnits: feeUnitsBn.toString(),
        position: position.toBase58(),
        positionRequest: positionRequest.toBase58(),
        requestCounter: counter.toString(),
        priceSlippageBps,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;

    console.error("[booster/open] UNHANDLED CATCH", {
      stage: stageRef.stage,
      error: msg,
      stack,
    });

    return jsonError(500, {
      code: "UNHANDLED_BOOSTER_OPEN_ERROR",
      error: msg,
      userMessage: "We couldn’t build this boosted trade.",
      tip: "Please try again. If it keeps failing, contact support.",
      stage: stageRef.stage,
    });
  }
}
