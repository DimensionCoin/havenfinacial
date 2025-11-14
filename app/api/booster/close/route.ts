// app/api/booster/close/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { Commitment } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

import {
  RPC_CONNECTION,
  JUPITER_PERPETUALS_PROGRAM_ID,
  JUPITER_PERPETUALS_EVENT_AUTHORITY_PUBKEY,
  JUPITER_PERPETUALS_CONFIG_PUBKEY,
  CUSTODY_PUBKEY,
  JLP_POOL_ACCOUNT_PUBKEY,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  USDC_MINT,
} from "@/types/constants";

export const runtime = "nodejs";

/* ───────── ENV / CONSTANTS ───────── */

const HAVEN_FEEPAYER_STR = process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS!;
const APP_TREASURY_OWNER_STR = process.env.NEXT_PUBLIC_APP_TREASURY_OWNER!;

// Priority fee + compute limit — tuned for cost vs speed.
const PRIORITY_MICROLAMPORTS = 20_000;
const COMPUTE_UNIT_LIMIT = 400_000;

// === Dynamic rent math (close path) ===
const TOKEN_ACCOUNT_SPACE = 165;
// Request PDA space (use position space as upper bound)
const PERPS_POSITION_REQUEST_SPACE = 896;

// Base tx fee cushion (non-priority part)
const BASE_FEE_BUFFER_LAMPORTS = 5_000;

// Shared commitment
const PROCESSED_COMMITMENT: Commitment = "processed";

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
  console.error("[/api/booster/close] error", status, payload);
  return NextResponse.json(payload, { status });
}

async function detectTokenProgramId(mint: PublicKey) {
  console.log("[booster/close] detectTokenProgramId: start", {
    mint: mint.toBase58(),
  });
  const info = await RPC_CONNECTION.getAccountInfo(mint, PROCESSED_COMMITMENT);
  if (!info) {
    console.error("[booster/close] detectTokenProgramId: mint not found", {
      mint: mint.toBase58(),
    });
    throw new Error(`Mint not found on chain: ${mint.toBase58()}`);
  }

  const is2022 = info.owner.equals(TOKEN_2022_PROGRAM_ID);
  console.log("[booster/close] detectTokenProgramId: result", {
    owner: info.owner.toBase58(),
    is2022,
  });
  return is2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}

// Rent helpers
async function getRents() {
  const [rentTokenAcc, rentReq] = await Promise.all([
    RPC_CONNECTION.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SPACE),
    RPC_CONNECTION.getMinimumBalanceForRentExemption(
      PERPS_POSITION_REQUEST_SPACE
    ),
  ]);
  return { rentTokenAcc, rentReq };
}

async function getExistingAccounts(pubkeys: PublicKey[]) {
  const infos = await RPC_CONNECTION.getMultipleAccountsInfo(
    pubkeys,
    PROCESSED_COMMITMENT
  );
  return infos.map((i) => !!i);
}

// The `Position` PDA: ["position", walletAddress, pool, custody, collateral_custody, sideEnum]
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
  console.log("[booster/close] generatePositionPda: seeds", {
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

  console.log("[booster/close] generatePositionPda: result", {
    position: position.toBase58(),
    bump,
  });

  return { position, bump };
}

// The `positionRequest` PDA: ["position_request", positionPubkey, counter_le_u64, requestChangeEnum]
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

  console.log("[booster/close] generatePositionRequestPda: seeds", {
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

  console.log("[booster/close] generatePositionRequestPda: result", {
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

/* ───────── Manual encoding for JUP perps close ix ───────── */

// u64 (BN) → 8-byte LE buffer
function encodeU64(value: BN): Buffer {
  return value.toArrayLike(Buffer, "le", 8);
}

// Option<u64>: 0x00 for None, 0x01 + u64 for Some
function encodeOptionU64(value: BN | null): Buffer {
  if (!value) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), encodeU64(value)]);
}

// Option<bool>: 0x00 for None, 0x01 + (0x00/0x01) for Some(false/true)
function encodeOptionBool(value: boolean | null | undefined): Buffer {
  if (value === null || value === undefined) return Buffer.from([0]);
  return Buffer.from([1, value ? 1 : 0]);
}

// Discriminator for `create_decrease_position_market_request`
const CREATE_DECREASE_POSITION_DISC = crypto
  .createHash("sha256")
  .update("global:create_decrease_position_market_request")
  .digest()
  .subarray(0, 8);

/**
 * Encodes `CreateDecreasePositionMarketRequestInstructionArgs`:
 *
 * pub struct CreateDecreasePositionMarketRequestInstructionArgs {
 *   pub collateral_usd_delta: u64,
 *   pub size_usd_delta: u64,
 *   pub price_slippage: u64,
 *   pub jupiter_minimum_out: Option<u64>,
 *   pub entire_position: Option<bool>,
 *   pub counter: u64,
 * }
 */
function encodeCreateDecreasePositionMarketRequest(args: {
  collateralUsdDelta: BN;
  sizeUsdDelta: BN;
  priceSlippage: BN;
  jupiterMinimumOut: BN | null;
  entirePosition: boolean | null;
  counter: BN;
}): Buffer {
  const {
    collateralUsdDelta,
    sizeUsdDelta,
    priceSlippage,
    jupiterMinimumOut,
    entirePosition,
    counter,
  } = args;

  return Buffer.concat([
    CREATE_DECREASE_POSITION_DISC,
    encodeU64(collateralUsdDelta),
    encodeU64(sizeUsdDelta),
    encodeU64(priceSlippage),
    encodeOptionU64(jupiterMinimumOut),
    encodeOptionBool(entirePosition),
    encodeU64(counter),
  ]);
}

/* ───────── ROUTE ───────── */

export async function POST(req: Request) {
  const stageRef: { stage: string } = { stage: "init" };

  console.log("\n\n============================");
  console.log("[/api/booster/close] POST start");
  console.log("============================");

  try {
    stageRef.stage = "envCheck";
    console.log("[booster/close] stage:", stageRef.stage);

    if (!USDC_MINT || !HAVEN_FEEPAYER_STR || !APP_TREASURY_OWNER_STR) {
      return jsonError(500, {
        code: "MISSING_ENV",
        error:
          "Missing env: NEXT_PUBLIC_USDC_MINT / NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS / NEXT_PUBLIC_APP_TREASURY_OWNER",
        userMessage: "We couldn’t prepare this close request.",
        tip: "Please try again in a bit while we sort this out.",
        stage: stageRef.stage,
      });
    }

    const HAVEN_FEEPAYER = new PublicKey(HAVEN_FEEPAYER_STR);
    const APP_TREASURY_OWNER = new PublicKey(APP_TREASURY_OWNER_STR);

    stageRef.stage = "parseBody";
    console.log("[booster/close] stage:", stageRef.stage);

    const body = (await req.json().catch((err) => {
      console.error("[booster/close] req.json() failed", err);
      return null;
    })) as {
      ownerBase58?: string;
      side?: "long" | "short";
      symbol?: "BTC" | "ETH" | "SOL";
      sizeUsdDeltaUnits?: string | number;
      collateralUsdDeltaUnits?: string | number;
      priceSlippageBps?: number;
      entirePosition?: boolean;
      netCloseUsdUnits?: string | number;
    } | null;

    console.log("[booster/close] raw body:", body);

    const ownerBase58 = body?.ownerBase58 ?? "";
    const side = body?.side ?? "long";
    const symbol = (body?.symbol as "BTC" | "ETH" | "SOL") ?? "BTC";
    const priceSlippageBps = body?.priceSlippageBps ?? 500;
    const entirePosition = body?.entirePosition ?? true;

    const sizeUsdDeltaUnitsRaw = body?.sizeUsdDeltaUnits ?? 0;
    const collateralUsdDeltaUnitsRaw = body?.collateralUsdDeltaUnits ?? 0;
    const netCloseUsdUnitsRaw = body?.netCloseUsdUnits ?? 0;

    console.log("[booster/close] parsed payload", {
      ownerBase58,
      side,
      symbol,
      priceSlippageBps,
      entirePosition,
      sizeUsdDeltaUnitsRaw,
      collateralUsdDeltaUnitsRaw,
      netCloseUsdUnitsRaw,
    });

    if (
      !ownerBase58 ||
      !UNDERLYING_BY_SYMBOL[symbol] ||
      !Number.isFinite(priceSlippageBps) ||
      priceSlippageBps < 0 ||
      (side !== "long" && side !== "short")
    ) {
      return jsonError(400, {
        code: "INVALID_PAYLOAD",
        error:
          "Need ownerBase58, symbol ∈ {BTC,ETH,SOL}, side ∈ {long,short}, priceSlippageBps ≥ 0",
        userMessage: "We couldn’t prepare this close request.",
        tip: "Please refresh and try again.",
        stage: stageRef.stage,
        details: {
          ownerBase58,
          symbol,
          side,
          priceSlippageBps,
        },
      });
    }

    const owner = new PublicKey(ownerBase58);
    const custody = UNDERLYING_BY_SYMBOL[symbol];

    // collateral custody: long → underlying, short → USDC
    const collateralCustody = side === "long" ? custody : USDC_CUSTODY;

    console.log("[booster/close] derived basics", {
      owner: owner.toBase58(),
      custody: custody.toBase58(),
      collateralCustody: collateralCustody.toBase58(),
    });

    /* ───────── PDAs ───────── */

    stageRef.stage = "derivePDAs:position";
    console.log("[booster/close] stage:", stageRef.stage);

    const { position } = generatePositionPda({
      custody,
      collateralCustody,
      walletAddress: owner,
      side,
    });

    stageRef.stage = "derivePDAs:positionRequest";
    console.log("[booster/close] stage:", stageRef.stage);

    const { positionRequest, counter } = generatePositionRequestPda({
      position,
      requestChange: "decrease",
    });

    console.log("[booster/close] PDAs", {
      position: position.toBase58(),
      positionRequest: positionRequest.toBase58(),
      counter: counter.toString(),
    });

    // Ensure the position actually exists
    stageRef.stage = "checkPositionExists";
    const [positionInfo] = await RPC_CONNECTION.getMultipleAccountsInfo(
      [position],
      PROCESSED_COMMITMENT
    );
    if (!positionInfo) {
      return jsonError(400, {
        code: "POSITION_NOT_FOUND",
        error: "Position PDA does not exist for this owner/symbol/side.",
        userMessage: "We couldn't find an open boosted position to close.",
        tip: "Refresh your positions and try again.",
        stage: stageRef.stage,
        details: { position: position.toBase58() },
      });
    }

    /* ───────── Amounts (BN math) ───────── */

    stageRef.stage = "amounts";
    console.log("[booster/close] stage:", stageRef.stage);

    const zeroBn = new BN(0);

    let sizeUsdDeltaBn = new BN(
      typeof sizeUsdDeltaUnitsRaw === "string"
        ? sizeUsdDeltaUnitsRaw
        : Math.floor(Number(sizeUsdDeltaUnitsRaw || 0))
    );
    let collateralUsdDeltaBn = new BN(
      typeof collateralUsdDeltaUnitsRaw === "string"
        ? collateralUsdDeltaUnitsRaw
        : Math.floor(Number(collateralUsdDeltaUnitsRaw || 0))
    );
    const netCloseUsdUnitsBnRaw = new BN(
      typeof netCloseUsdUnitsRaw === "string"
        ? netCloseUsdUnitsRaw
        : Math.floor(Number(netCloseUsdUnitsRaw || 0))
    );
    const netCloseUsdUnitsBn = netCloseUsdUnitsBnRaw.gt(zeroBn)
      ? netCloseUsdUnitsBnRaw
      : zeroBn;

    /**
     * 🔑 If `entirePosition = true`, Jupiter expects BOTH deltas to be 0.
     * If `entirePosition = false`, at least one delta must be > 0.
     */
    if (entirePosition) {
      sizeUsdDeltaBn = zeroBn;
      collateralUsdDeltaBn = zeroBn;
    } else {
      if (sizeUsdDeltaBn.lte(zeroBn) && collateralUsdDeltaBn.lte(zeroBn)) {
        return jsonError(400, {
          code: "INVALID_CLOSE_DELTAS",
          error:
            "For partial closes you must provide size and/or collateral deltas.",
          userMessage:
            "We couldn’t prepare this close request because the close amount is zero.",
          tip: "Try again with a specific amount to close.",
          stage: stageRef.stage,
          details: {
            entirePosition,
            sizeUsdDeltaUnitsRaw,
            collateralUsdDeltaUnitsRaw,
          },
        });
      }
    }

    console.log("[booster/close] amounts (deltas)", {
      sizeUsdDeltaBn: sizeUsdDeltaBn.toString(),
      collateralUsdDeltaBn: collateralUsdDeltaBn.toString(),
      netCloseUsdUnitsBn: netCloseUsdUnitsBn.toString(),
      entirePosition,
    });

    // price_slippage is given in BPS (e.g. 500 = 5%)
    const priceSlippageBn = new BN(priceSlippageBps);

    // Let perps handle minOut; we use None here.
    const jupiterMinimumOut: BN | null = null;

    /* ───────── Token program + ATAs ───────── */

    stageRef.stage = "tokenSetup";
    console.log("[booster/close] stage:", stageRef.stage);

    const usdcProgramId = await detectTokenProgramId(USDC_MINT);
    console.log("[booster/close] usdcProgramId", usdcProgramId.toBase58());

    const userUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      owner,
      false,
      usdcProgramId
    );
    const positionRequestAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      positionRequest,
      true,
      usdcProgramId
    );
    const havenUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      APP_TREASURY_OWNER,
      false,
      usdcProgramId
    );

    console.log("[booster/close] ATAs", {
      userUsdcAta: userUsdcAta.toBase58(),
      positionRequestAta: positionRequestAta.toBase58(),
      havenUsdcAta: havenUsdcAta.toBase58(),
    });

    /* ───────── Dynamic rent math + top-ups ───────── */

    const [userAtaExists, prAtaExists, havenAtaExists] =
      await getExistingAccounts([
        userUsdcAta,
        positionRequestAta,
        havenUsdcAta,
      ]);

    const { rentTokenAcc, rentReq } = await getRents();

    // On close we only create the *request* PDA; position already exists.
    const rentNeededReq = prAtaExists ? 0 : rentReq;
    const totalRentNeeded = rentNeededReq;

    stageRef.stage = "ownerLamportsTopUp";
    const ownerLamportsBefore = await RPC_CONNECTION.getBalance(
      owner,
      PROCESSED_COMMITMENT
    );

    // We only make sure the user has enough lamports to pay the *request* rent.
    const topUpLamports =
      ownerLamportsBefore >= totalRentNeeded
        ? 0
        : totalRentNeeded - ownerLamportsBefore;

    console.log("[booster/close] owner rent math", {
      ownerLamportsBefore,
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
      (prAtaExists ? 0 : rentTokenAcc) +
      (havenAtaExists ? 0 : rentTokenAcc);

    const estimatedPriorityFeeLamports = Math.floor(
      (COMPUTE_UNIT_LIMIT * PRIORITY_MICROLAMPORTS) / 1_000_000
    );

    const requiredLamportsForThisTx =
      topUpLamports +
      missingAtaRent +
      estimatedPriorityFeeLamports +
      BASE_FEE_BUFFER_LAMPORTS;

    console.log("[booster/close] haven funds check", {
      havenLamports,
      topUpLamports,
      missingAtaRent,
      estimatedPriorityFeeLamports,
      BASE_FEE_BUFFER_LAMPORTS,
      requiredLamportsForThisTx,
      userAtaExists,
      prAtaExists,
      havenAtaExists,
      rentTokenAcc,
    });

    if (havenLamports < requiredLamportsForThisTx) {
      return jsonError(500, {
        code: "HAVEN_FEEPAYER_LOW_SOL",
        error: `Haven fee-payer has ${havenLamports} lamports, needs ${requiredLamportsForThisTx}.`,
        userMessage: "We couldn’t prepare this close request.",
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

    // 0.5% Haven fee on the net withdrawal amount (in 1e6 units)
    const havenCloseFeeUnits = netCloseUsdUnitsBn.gt(zeroBn)
      ? netCloseUsdUnitsBn.muln(5).divn(1000) // 0.5% = 5 / 1000
      : zeroBn;

    console.log("[booster/close] haven close fee units", {
      netCloseUsdUnitsBn: netCloseUsdUnitsBn.toString(),
      havenCloseFeeUnits: havenCloseFeeUnits.toString(),
    });

    /* ───────── Build instructions ───────── */

    stageRef.stage = "buildInstructions";
    console.log("[booster/close] stage:", stageRef.stage);
    const ixs: TransactionInstruction[] = [];

    // Cheap priority fee
    ixs.push(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: PRIORITY_MICROLAMPORTS,
      })
    );

    // Fund user with SOL for PDA rent (if needed)
    if (topUpLamports > 0) {
      ixs.push(
        SystemProgram.transfer({
          fromPubkey: HAVEN_FEEPAYER,
          toPubkey: owner,
          lamports: topUpLamports,
        })
      );
    }

    // Ensure ATAs exist (idempotent) — rent paid by Haven, not user
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
        positionRequestAta,
        positionRequest,
        USDC_MINT,
        usdcProgramId
      )
    );
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        HAVEN_FEEPAYER,
        havenUsdcAta,
        APP_TREASURY_OWNER,
        USDC_MINT,
        usdcProgramId
      )
    );

    console.log("[booster/close] perps args about to encode", {
      collateralUsdDeltaBn: collateralUsdDeltaBn.toString(),
      sizeUsdDeltaBn: sizeUsdDeltaBn.toString(),
      priceSlippageBn: priceSlippageBn.toString(),
      jupiterMinimumOut,
      entirePosition,
      counter: counter.toString(),
    });

    stageRef.stage = "buildPerpsIx";
    let closeIx: TransactionInstruction;
    try {
      const data = encodeCreateDecreasePositionMarketRequest({
        collateralUsdDelta: collateralUsdDeltaBn,
        sizeUsdDelta: sizeUsdDeltaBn,
        priceSlippage: priceSlippageBn,
        jupiterMinimumOut,
        entirePosition,
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

      closeIx = new TransactionInstruction({
        programId: JUPITER_PERPETUALS_PROGRAM_ID,
        keys,
        data,
      });
      console.log("[booster/close] buildPerpsIx: success");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;

      console.error("[booster/close] buildPerpsIx: FAILED", {
        err,
        message: errorMessage,
        stack: errorStack,
      });

      return jsonError(500, {
        code: "BUILD_PERPS_IX_ERROR",
        error: errorMessage,
        userMessage: "We couldn’t build the close instruction.",
        tip: "Please try again. If it keeps failing, contact support.",
        stage: stageRef.stage,
      });
    }

    ixs.push(closeIx);

    // NOTE:
    // We do NOT charge the Haven close fee in this transaction.
    // This ix only creates a decrease position *request* on Jup Perps.
    // No USDC has been paid out to the user yet, so trying to transfer
    // havenCloseFeeUnits from userUsdcAta here would fail with
    // "insufficient funds". Fee can be handled in a separate flow later.

    // Compute limit near the end
    ixs.push(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: COMPUTE_UNIT_LIMIT,
      })
    );

    /* ───────── Compile tx ───────── */

    stageRef.stage = "compile";
    console.log("[booster/close] stage:", stageRef.stage);

    const { blockhash, lastValidBlockHeight } =
      await RPC_CONNECTION.getLatestBlockhash(PROCESSED_COMMITMENT);

    console.log("[booster/close] latestBlockhash", {
      blockhash,
      lastValidBlockHeight,
      ixCount: ixs.length,
    });

    const msg = new TransactionMessage({
      payerKey: HAVEN_FEEPAYER,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const unsignedTx = new VersionedTransaction(msg);
    const b64 = Buffer.from(unsignedTx.serialize()).toString("base64");

    console.log("[booster/close] success: returning transaction", {
      symbol,
      side,
      entirePosition,
      sizeUsdDeltaUnits: sizeUsdDeltaBn.toString(),
      collateralUsdDeltaUnits: collateralUsdDeltaBn.toString(),
      netCloseUsdUnits: netCloseUsdUnitsBn.toString(),
      havenCloseFeeUnits: havenCloseFeeUnits.toString(),
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
        entirePosition,
        sizeUsdDeltaUnits: sizeUsdDeltaBn.toString(),
        collateralUsdDeltaUnits: collateralUsdDeltaBn.toString(),
        netCloseUsdUnits: netCloseUsdUnitsBn.toString(),
        havenCloseFeeUnits: havenCloseFeeUnits.toString(),
        position: position.toBase58(),
        positionRequest: positionRequest.toBase58(),
        requestCounter: counter.toString(),
        priceSlippageBps,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;

    console.error("[booster/close] UNHANDLED CATCH", {
      stage: stageRef.stage,
      error: msg,
      stack,
    });

    return jsonError(500, {
      code: "UNHANDLED_BOOSTER_CLOSE_ERROR",
      error: msg,
      userMessage: "We couldn’t build this close transaction.",
      tip: "Please try again. If it keeps failing, contact support.",
      stage: stageRef.stage,
    });
  }
}
