// app/api/jup/build-sell/route.ts
import { NextResponse } from "next/server";
import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";

export const runtime = "nodejs";

/* ───────── env & constants ───────── */
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC!;
const HAVEN_FEEPAYER = new PublicKey(
  process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS!
);
const TREASURY_OWNER = new PublicKey(
  process.env.NEXT_PUBLIC_APP_TREASURY_OWNER!
);

// Use classic USDC by default (best liquidity)
const CLASSIC_USDC = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
const SWAP_USDC_MINT = process.env.NEXT_PUBLIC_USDC_SWAP_MINT
  ? new PublicKey(process.env.NEXT_PUBLIC_USDC_SWAP_MINT!)
  : CLASSIC_USDC;

// WSOL mint (represents SOL for swaps)
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

// xStock mint (force Lite for this)
const XSTOCK_MINT = new PublicKey(
  "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg"
);

// If you want to add more “force Lite only” tokens later, put them here:
const FORCE_LITE_INPUTS = new Set<string>([XSTOCK_MINT.toBase58()]);

const USDC_DECIMALS = 6;
const USDC_UNIT = 10 ** USDC_DECIMALS;

// Tiered Haven fee model on **USDC proceeds**:
//  - 1% for gross USDC < $1,000
//  - 0.5% for gross USDC >= $1,000
const FEE_TIER_1_RATE = 0.01; // 1%
const FEE_TIER_2_RATE = 0.005; // 0.5%
const FEE_TIER_GROSS_USD_CUTOFF = 1000;
const FEE_TIER_GROSS_UNITS_CUTOFF = FEE_TIER_GROSS_USD_CUTOFF * USDC_UNIT;

// Jupiter endpoints
const LITE_QUOTE = "https://lite-api.jup.ag/swap/v1/quote";
const LITE_SWAP_IXS = "https://lite-api.jup.ag/swap/v1/swap-instructions";
const V6_QUOTE = "https://quote-api.jup.ag/v6/quote";
const V6_SWAP_IXS = "https://quote-api.jup.ag/v6/swap-instructions";

// tx encoded length guard
const MAX_ENCODED_LEN = 1644;

// Associated Token Program
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

/* ───────── helper: user-friendly error wrapper ───────── */
function jsonError(
  status: number,
  body: {
    code: string;
    error: string;
    userMessage: string;
    tip?: string;
    stage?: string;
    traceId?: string;
    [k: string]: unknown;
  }
) {
  console.error(
    `[jup/build-sell] ${status >= 400 ? "error" : "info"}`,
    JSON.stringify(body, null, 2)
  );
  return NextResponse.json(body, { status });
}

function shapeErr(e: unknown) {
  if (e instanceof Error) {
    return { name: e.name, message: e.message, stack: e.stack };
  }
  return { name: "Error", message: String(e) };
}

/* ───────── helpers ───────── */
async function detectTokenProgramId(conn: Connection, mint: PublicKey) {
  const info = await conn.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error(`Mint not found: ${mint.toBase58()}`);
  return info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;
}

function toIx(obj: unknown): TransactionInstruction {
  const rec = (obj ?? {}) as Record<string, unknown>;
  const pid = rec.programId;
  const dataStr = rec.data;
  const listUnknown = Array.isArray(rec.keys)
    ? (rec.keys as unknown[])
    : Array.isArray(rec.accounts)
    ? (rec.accounts as unknown[])
    : null;
  if (typeof pid !== "string" || typeof dataStr !== "string" || !listUnknown)
    throw new Error("Unexpected Jupiter instruction shape");
  const keys = listUnknown.map((k) => {
    const r = (k ?? {}) as Record<string, unknown>;
    return {
      pubkey: new PublicKey(String(r.pubkey)),
      isSigner: Boolean(r.isSigner),
      isWritable: Boolean(r.isWritable),
    };
  });
  return new TransactionInstruction({
    programId: new PublicKey(pid),
    keys,
    data: Buffer.from(dataStr, "base64"),
  });
}

/**
 * Lite quote – match your working curl as closely as possible:
 * curl "https://lite-api.jup.ag/swap/v1/quote?inputMint=...&outputMint=...&amount=1000000&slippageBps=50"
 */
async function jupLiteQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: string;
}) {
  const url =
    `${LITE_QUOTE}?` +
    new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      slippageBps: params.slippageBps,
      // keep this minimal to mirror curl
    });

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    let j: unknown = null;
    try {
      j = await res.json();
    } catch {}
    const obj = (j ?? {}) as Record<string, unknown>;
    const code = obj.errorCode as string | undefined;
    if (code === "COULD_NOT_FIND_ANY_ROUTE" || code === "NOT_SUPPORTED") {
      return null;
    }
    const raw = j ? JSON.stringify(j) : await res.text();
    throw new Error(`Lite quote ${res.status}: ${raw}`);
  }

  return (await res.json()) as unknown;
}

/**
 * v6 quote – simple, no maxAccounts so Jupiter can choose.
 * xStock will not hit this because we force Lite for it.
 */
async function jupV6Quote(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: string;
}) {
  const url =
    `${V6_QUOTE}?` +
    new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      slippageBps: params.slippageBps,
      onlyDirectRoutes: "false",
      asLegacyTransaction: "false",
    });

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    let j: unknown = null;
    try {
      j = await res.json();
    } catch {}
    const obj = (j ?? {}) as Record<string, unknown>;
    const code = obj.errorCode as string | undefined;
    if (code === "COULD_NOT_FIND_ANY_ROUTE") {
      return null;
    }
    const raw = j ? JSON.stringify(j) : await res.text();
    throw new Error(`v6 quote ${res.status}: ${raw}`);
  }

  return (await res.json()) as unknown;
}

async function jupSwapIxs(
  kind: "lite" | "v6",
  payload: Record<string, unknown>
) {
  const url = kind === "lite" ? LITE_SWAP_IXS : V6_SWAP_IXS;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const raw = await res.text();
    throw new Error(`${kind} swap-instructions failed: ${res.status} ${raw}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Given the **gross USDC proceeds** (in base units) from the quote,
 * compute Haven's fee units and which rate we applied.
 */
function computeTieredFeeUnitsFromProceeds(grossUnits: number) {
  if (!Number.isFinite(grossUnits) || grossUnits <= 0) {
    return { feeUnits: 0, rate: 0 };
  }

  const useLowRate = grossUnits >= FEE_TIER_GROSS_UNITS_CUTOFF; // >= $1,000
  const rate = useLowRate ? FEE_TIER_2_RATE : FEE_TIER_1_RATE;
  const feeUnits = Math.round(grossUnits * rate);

  return { feeUnits, rate };
}

/* ───────── route ───────── */
export async function POST(req: Request) {
  const traceId = Math.random().toString(36).slice(2, 10);
  const stageRef: { stage: string } = { stage: "init" };

  // We'll fill these after the quote so we can optionally return them
  let feeUnits = 0;
  let feeRate = 0;
  let expectedOutUnits = 0;

  try {
    stageRef.stage = "envCheck";
    if (!RPC?.includes("mainnet")) throw new Error("RPC must be mainnet");
    if (!HAVEN_FEEPAYER || !TREASURY_OWNER) {
      throw new Error(
        "Missing env: NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS / NEXT_PUBLIC_APP_TREASURY_OWNER"
      );
    }

    stageRef.stage = "parseBody";
    const {
      fromOwnerBase58,
      inputMint,
      amountUnits,
      slippageBps = 50,
    } = (await req.json()) as {
      fromOwnerBase58: string;
      inputMint: string;
      amountUnits: number; // input token base units
      slippageBps?: number;
    };

    if (
      !fromOwnerBase58 ||
      !inputMint ||
      !Number.isFinite(amountUnits) ||
      amountUnits <= 0
    ) {
      return jsonError(400, {
        code: "INVALID_PAYLOAD",
        error: "Invalid payload",
        userMessage: "We couldn't start this sell order.",
        tip: "Close and reopen Haven, then try again.",
        stage: stageRef.stage,
        traceId,
      });
    }

    stageRef.stage = "initConnection";
    const conn = new Connection(RPC, "confirmed");
    const userOwner = new PublicKey(fromOwnerBase58);
    const inMint = new PublicKey(inputMint);
    const isWSOL = inMint.equals(WSOL_MINT);
    const isForceLite = FORCE_LITE_INPUTS.has(inMint.toBase58());

    const usdcProgId = await detectTokenProgramId(conn, SWAP_USDC_MINT);
    const userUsdcAta = getAssociatedTokenAddressSync(
      SWAP_USDC_MINT,
      userOwner,
      false,
      usdcProgId
    );
    const treasuryUsdcAta = getAssociatedTokenAddressSync(
      SWAP_USDC_MINT,
      TREASURY_OWNER,
      false,
      usdcProgId
    );

    /* ----- balance guard on the INPUT token ----- */
    stageRef.stage = "balanceGuard";
    let useNativeSol = false;

    if (isWSOL) {
      // WSOL: prefer WSOL ATA balance, fallback to native SOL
      const inProgId = await detectTokenProgramId(conn, inMint);
      const userWsolAta = getAssociatedTokenAddressSync(
        inMint,
        userOwner,
        false,
        inProgId
      );
      const wsolBal = await conn
        .getTokenAccountBalance(userWsolAta, "confirmed")
        .catch(() => null);
      const wsolAvail = Number(wsolBal?.value?.amount || "0");

      if (wsolAvail >= amountUnits) {
        useNativeSol = false;
      } else {
        const lamports = await conn.getBalance(userOwner, "confirmed");
        if (lamports < amountUnits) {
          return jsonError(400, {
            code: "INSUFFICIENT_SOL_WSOL",
            error: "Insufficient SOL / WSOL balance.",
            userMessage: "You don’t have enough SOL to sell that amount.",
            tip: "Try selling a smaller amount or deposit more SOL.",
            stage: stageRef.stage,
            traceId,
            details: {
              requiredUnits: amountUnits,
              wsolAvail,
              lamports,
            },
          });
        }
        useNativeSol = true;
      }
    } else {
      // non-WSOL: standard SPL guard
      const inProgId = await detectTokenProgramId(conn, inMint);
      const userInAta = getAssociatedTokenAddressSync(
        inMint,
        userOwner,
        false,
        inProgId
      );
      const balParsed = await conn
        .getTokenAccountBalance(userInAta, "confirmed")
        .catch(() => null);
      const availableIn = Number(balParsed?.value?.amount || "0");
      if (availableIn < amountUnits) {
        return jsonError(400, {
          code: "INSUFFICIENT_TOKEN_BALANCE",
          error: "Insufficient token balance.",
          userMessage:
            "You don’t have enough of this token to sell that amount.",
          tip: "Try selling a smaller amount.",
          stage: stageRef.stage,
          traceId,
          details: {
            requiredUnits: amountUnits,
            availableIn,
          },
        });
      }
    }

    /* 1) QUOTE (Force Lite for xStock, otherwise Lite → v6 fallback) */
    stageRef.stage = "quote";
    const quoteArgs = {
      inputMint: inMint.toBase58(),
      outputMint: SWAP_USDC_MINT.toBase58(),
      amount: String(amountUnits),
      slippageBps: String(slippageBps),
    };

    let quoteResponse: unknown = null;
    let quoteKind: "lite" | "v6" = "lite";

    if (isForceLite) {
      quoteResponse = await jupLiteQuote(quoteArgs);
      if (!quoteResponse) {
        return jsonError(422, {
          code: "NO_ROUTE",
          error:
            "No swap route found for this token → USDC. Liquidity may be limited right now.",
          userMessage:
            "We couldn’t find a route to sell this asset into USDC right now.",
          tip: "Try selling a smaller amount or check again later when there’s more liquidity.",
          stage: stageRef.stage,
          traceId,
        });
      }
      quoteKind = "lite";
    } else {
      quoteResponse = await jupLiteQuote(quoteArgs);
      quoteKind = "lite";
      if (!quoteResponse) {
        quoteResponse = await jupV6Quote(quoteArgs);
        quoteKind = "v6";
      }

      if (!quoteResponse) {
        return jsonError(422, {
          code: "NO_ROUTE",
          error:
            "No swap route found for this token → USDC. Liquidity may be limited right now.",
          userMessage:
            "We couldn’t find a route to sell this token into USDC right now.",
          tip: "Try selling a smaller amount, or try again later when there’s more liquidity.",
          stage: stageRef.stage,
          traceId,
        });
      }
    }

    // 1a) Extract expected USDC proceeds from the quote and compute tiered fee
    const qrObj = quoteResponse as { outAmount?: unknown };
    const outAmountStr =
      typeof qrObj.outAmount === "string"
        ? qrObj.outAmount
        : typeof qrObj.outAmount === "number"
        ? String(qrObj.outAmount)
        : null;

    if (!outAmountStr) {
      return jsonError(500, {
        code: "MISSING_OUT_AMOUNT",
        error: "Quote missing outAmount",
        userMessage:
          "We couldn’t read the expected USDC amount for this sell route.",
        tip: "Please try again in a moment.",
        stage: stageRef.stage,
        traceId,
      });
    }

    expectedOutUnits = Number(outAmountStr);
    if (!Number.isFinite(expectedOutUnits) || expectedOutUnits <= 0) {
      return jsonError(500, {
        code: "BAD_OUT_AMOUNT",
        error: `Quote outAmount invalid: ${outAmountStr}`,
        userMessage:
          "We couldn’t read the expected USDC amount for this sell route.",
        tip: "Please try again with a slightly different amount.",
        stage: stageRef.stage,
        traceId,
      });
    }

    const feeInfo = computeTieredFeeUnitsFromProceeds(expectedOutUnits);
    feeUnits = feeInfo.feeUnits;
    feeRate = feeInfo.rate;

    if (feeUnits > 0 && feeUnits >= expectedOutUnits) {
      return jsonError(400, {
        code: "AMOUNT_TOO_SMALL_FOR_FEE",
        error: `Expected proceeds ${expectedOutUnits} too small vs fee ${feeUnits}`,
        userMessage:
          "This sell amount is too small to cover Haven’s fee on the proceeds.",
        tip: "Try selling a larger amount so the fee is a smaller percentage, or reduce the amount slightly and try again.",
        stage: stageRef.stage,
        traceId,
        details: {
          expectedOutUnits: String(expectedOutUnits),
          feeUnits: String(feeUnits),
          feeRate,
        },
      });
    }

    /* 2) SWAP INSTRUCTIONS */
    stageRef.stage = "swapInstructions";
    const swapIxs = await jupSwapIxs(quoteKind, {
      quoteResponse,
      userPublicKey: userOwner.toBase58(),
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
      wrapAndUnwrapSol: useNativeSol,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          maxLamports: 1_000_000,
          priorityLevel: "veryHigh",
        },
      },
    });

    const setupIxsRaw = (swapIxs.setupInstructions as unknown[]) ?? [];
    const swapIxRaw = swapIxs.swapInstruction;
    const cleanupIxsRaw = (swapIxs.cleanupInstructions as unknown[]) ?? [];
    const altKeys: string[] = Array.isArray(swapIxs.addressLookupTableAddresses)
      ? (swapIxs.addressLookupTableAddresses as string[])
      : [];
    if (!swapIxRaw) throw new Error("Jupiter returned no swapInstruction");

    // materialize setup instructions
    const setupIxs = setupIxsRaw.map(toIx);

    /* 3) Load ALTs */
    stageRef.stage = "loadAlts";
    const altAccounts: AddressLookupTableAccount[] = [];
    for (const k of altKeys) {
      const { value } = await conn.getAddressLookupTable(new PublicKey(k));
      if (value) altAccounts.push(value);
    }

    /* 4) Sponsored ATAs */
    stageRef.stage = "sponsorAtas";

    const ourAtas: TransactionInstruction[] = [];

    // Ensure user USDC ATA exists to receive proceeds
    ourAtas.push(
      createAssociatedTokenAccountIdempotentInstruction(
        HAVEN_FEEPAYER,
        userUsdcAta,
        userOwner,
        SWAP_USDC_MINT,
        usdcProgId
      )
    );

    // Treasury USDC ATA only if missing
    const needTreasuryAta = !(await conn.getAccountInfo(
      treasuryUsdcAta,
      "confirmed"
    ));
    if (needTreasuryAta) {
      ourAtas.push(
        createAssociatedTokenAccountIdempotentInstruction(
          HAVEN_FEEPAYER,
          treasuryUsdcAta,
          TREASURY_OWNER,
          SWAP_USDC_MINT,
          usdcProgId
        )
      );
    }

    // Replace *all* Jupiter ATA creates with our own that use HAVEN_FEEPAYER as the payer.
    const skipSet = new Set<string>([
      userUsdcAta.toBase58(),
      ...(needTreasuryAta ? [treasuryUsdcAta.toBase58()] : []),
    ]);

    for (const ix of setupIxs) {
      if (!ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) continue;
      const keys = ix.keys ?? [];
      const ata = keys[1]?.pubkey;
      const owner = keys[2]?.pubkey;
      const mint = keys[3]?.pubkey;
      const tokenProgram = keys[5]?.pubkey ?? TOKEN_PROGRAM_ID;

      if (!ata || !owner || !mint) {
        // malformed; just ignore and let Jupiter’s routing handle via other paths
        continue;
      }

      // If it’s USDC user/treasury, we already added our own above.
      if (skipSet.has(ata.toBase58())) {
        continue;
      }

      // Rebuild ATA create with HAVEN_FEEPAYER as payer.
      ourAtas.push(
        createAssociatedTokenAccountIdempotentInstruction(
          HAVEN_FEEPAYER,
          ata,
          owner,
          mint,
          tokenProgram
        )
      );
    }

    // Now keep only non-ATA Jupiter setup instructions (compute budget, etc.)
    const setupFiltered = setupIxs.filter(
      (ix) => !ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)
    );

    // Post-swap Haven fee on USDC proceeds (user -> treasury)
    const feeIx =
      feeUnits > 0
        ? createTransferCheckedInstruction(
            userUsdcAta,
            SWAP_USDC_MINT,
            treasuryUsdcAta,
            userOwner,
            feeUnits,
            USDC_DECIMALS,
            [],
            usdcProgId
          )
        : null;

    const ixsCore = [toIx(swapIxRaw)];
    const ixsHead = [...ourAtas, ...setupFiltered];
    const ixsTail = cleanupIxsRaw.map(toIx);

    const ixsWithFee = feeIx
      ? [...ixsHead, ...ixsCore, feeIx, ...ixsTail]
      : [...ixsHead, ...ixsCore, ...ixsTail];
    const ixsNoFee = [...ixsHead, ...ixsCore, ...ixsTail];

    /* 5) Compile & size guard */
    stageRef.stage = "compile";
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash(
      "processed"
    );

    const compile = (ixs: TransactionInstruction[]) =>
      new VersionedTransaction(
        new TransactionMessage({
          payerKey: HAVEN_FEEPAYER,
          recentBlockhash: blockhash,
          instructions: ixs,
        }).compileToV0Message(altAccounts)
      );

    let tx = compile(ixsWithFee);
    let encodedLen = Buffer.from(tx.serialize()).length;
    let postChargeFeeUnits: number | undefined;

    if (encodedLen > MAX_ENCODED_LEN) {
      // Drop inline fee transfer; you could charge out-of-band using postChargeFeeUnits if you want.
      tx = compile(ixsNoFee);
      encodedLen = Buffer.from(tx.serialize()).length;
      postChargeFeeUnits = feeUnits || undefined;
    }

    if (encodedLen > MAX_ENCODED_LEN) {
      return jsonError(413, {
        code: "TX_TOO_LARGE",
        error:
          "Route is too large to fit in one transaction. Try a smaller amount or a simpler route.",
        userMessage:
          "This sell route is too complex to fit in a single transaction.",
        tip: "Try selling a smaller amount or waiting for a simpler route.",
        stage: stageRef.stage,
        traceId,
        encodedLen,
        limit: MAX_ENCODED_LEN,
      });
    }

    const b64 = Buffer.from(tx.serialize()).toString("base64");
    return NextResponse.json({
      transaction: b64,
      recentBlockhash: blockhash,
      lastValidBlockHeight,
      traceId,
      ...(feeUnits
        ? {
            feeUnits,
            feeRate,
            expectedOutUnits,
          }
        : {}),
      ...(postChargeFeeUnits
        ? {
            postChargeFeeUnits,
            feeRate,
            expectedOutUnits,
          }
        : {}),
    });
  } catch (e) {
    const shaped = shapeErr(e);
    const lower = shaped.message.toLowerCase();

    const looksLikeNetwork =
      lower.includes("fetch failed") ||
      lower.includes("socket hang up") ||
      lower.includes("econnreset") ||
      lower.includes("timed out");

    if (looksLikeNetwork && stageRef.stage === "quote") {
      return jsonError(503, {
        code: "NETWORK_JUPITER",
        error: shaped.message,
        userMessage:
          "We couldn’t reach the trading engine to price this sell order.",
        tip: "Check your connection and try again in a moment.",
        stage: stageRef.stage,
        traceId,
        details: shaped,
      });
    }

    return jsonError(500, {
      code: "UNHANDLED_BUILD_SELL_ERROR",
      error: shaped.message,
      userMessage: "Something went wrong building this sell order.",
      tip: "Please try again. If it keeps happening, contact support.",
      stage: stageRef.stage,
      traceId,
      details: shaped,
    });
  }
}
