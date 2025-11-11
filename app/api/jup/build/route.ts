// app/api/jup/build/route.ts
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

/* ───────── env ───────── */
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC!;
const USDC_MINT = new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT!);
const HAVEN_FEEPAYER_PUBKEY = new PublicKey(
  process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS!
);
const TREASURY_OWNER = new PublicKey(
  process.env.NEXT_PUBLIC_APP_TREASURY_OWNER!
);

// Jupiter Lite
const JUP_QUOTE = "https://lite-api.jup.ag/swap/v1/quote";
const JUP_SWAP_INSTRUCTIONS =
  "https://lite-api.jup.ag/swap/v1/swap-instructions";

// constants
const USDC_DECIMALS = 6;
const USDC_UNIT = 10 ** USDC_DECIMALS;

// Tiered Haven fee model:
//  - 1% for notional < $1,000
//  - 0.5% for notional >= $1,000
//
// IMPORTANT: this route receives **net** USDC in `amountUnits`.
// For a given fee rate r, if:
//   net = gross * (1 - r)
//   fee = gross * r = net * r / (1 - r)
//
// For r = 1%   → r/(1-r) = 1/99
// For r = 0.5% → r/(1-r) = 1/199
//
// We approximate the tier boundary in terms of **net** by using:
//   gross >= $1,000  ⇒ net >= $1,000 * (1 - 0.5%) = $995
// so if net >= $995 we treat it as 0.5% tier.
const FEE_TIER_1_RATE = 0.01; // 1%
const FEE_TIER_2_RATE = 0.005; // 0.5%
const FEE_TIER_NET_USD_CUTOFF = 995; // approximate net cutoff
const FEE_TIER_NET_UNITS_CUTOFF = FEE_TIER_NET_USD_CUTOFF * USDC_UNIT;

/* ───────── utils ───────── */

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
  // Server logs for you, but user only sees `userMessage` on the client.
  console.error("[/api/jup/build] error", status, payload);
  return NextResponse.json(payload, { status });
}

async function detectTokenProgramId(conn: Connection, mint: PublicKey) {
  const info = await conn.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error(`Mint not found on chain: ${mint.toBase58()}`);
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
    data: Buffer.from(String(dataStr), "base64"),
  });
}

// Constant program id for SPL Associated Token Program
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

/**
 * Given the **net** USDC amount in base units that we send into Jupiter,
 * compute the Haven fee units and which fee rate we used.
 *
 * - If net < ~$995 → this corresponds to gross < $1,000 → 1% tier
 * - If net ≥ ~$995 → gross ≥ $1,000 → 0.5% tier
 */
function computeTieredFeeUnitsForNet(netUnits: number) {
  if (!Number.isFinite(netUnits) || netUnits <= 0) {
    return { feeUnits: 0, rate: 0 };
  }

  const useLowFeeTier = netUnits >= FEE_TIER_NET_UNITS_CUTOFF; // 0.5% tier
  const divisor = useLowFeeTier ? 199 : 99; // r/(1-r)
  const feeUnits = Math.round(netUnits / divisor);
  const rate = useLowFeeTier ? FEE_TIER_2_RATE : FEE_TIER_1_RATE;

  return { feeUnits, rate };
}

/* ───────── route ───────── */
export async function POST(req: Request) {
  const stageBase = { stage: "init" as string };

  // populated after we compute the fee from `amountUnits`
  let feeUnits = 0;
  let feeRate = 0;

  try {
    if (!RPC?.includes("mainnet")) {
      return jsonError(500, {
        code: "NON_MAINNET_RPC",
        error: "RPC must be mainnet",
        userMessage: "Something's misconfigured on our side.",
        tip: "Please try again later while we fix the connection.",
        ...stageBase,
      });
    }

    if (!USDC_MINT || !HAVEN_FEEPAYER_PUBKEY || !TREASURY_OWNER) {
      return jsonError(500, {
        code: "MISSING_ENV",
        error:
          "Missing env: USDC_MINT / NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS / NEXT_PUBLIC_APP_TREASURY_OWNER",
        userMessage: "We couldn't set up this trade.",
        tip: "Please try again in a bit while we sort this out.",
        ...stageBase,
      });
    }

    const body = (await req.json().catch(() => null)) as {
      fromOwnerBase58?: string;
      outputMint?: string;
      amountUnits?: number; // **net** amount going into Jupiter
      slippageBps?: number;
    } | null;

    const fromOwnerBase58 = body?.fromOwnerBase58 ?? "";
    const outputMint = body?.outputMint ?? "";
    const amountUnits = body?.amountUnits ?? 0;
    const slippageBps = body?.slippageBps ?? 50;

    if (
      !fromOwnerBase58 ||
      !outputMint ||
      !Number.isFinite(amountUnits) ||
      amountUnits <= 0
    ) {
      return jsonError(400, {
        code: "INVALID_PAYLOAD",
        error:
          "Invalid payload (need fromOwnerBase58, outputMint, positive amountUnits)",
        userMessage: "Something went wrong building this trade.",
        tip: "Please refresh the page and try again.",
        ...stageBase,
      });
    }

    const userOwner = new PublicKey(fromOwnerBase58);
    const outMint = new PublicKey(outputMint);

    const conn = new Connection(RPC, "confirmed");

    stageBase.stage = "detectTokenProgram";
    const usdcProgramId = await detectTokenProgramId(conn, USDC_MINT);
    const outProgramId = await detectTokenProgramId(conn, outMint);

    // ATAs (user + treasury)
    stageBase.stage = "deriveATAs";
    const userUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      userOwner,
      false,
      usdcProgramId
    );
    const userOutAta = getAssociatedTokenAddressSync(
      outMint,
      userOwner,
      false,
      outProgramId
    );
    const treasuryUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      TREASURY_OWNER,
      false,
      usdcProgramId
    );

    /* ------- guard: user has enough USDC for net + fee ------- */
    stageBase.stage = "checkBalance";

    const netUnits = amountUnits;
    const feeInfo = computeTieredFeeUnitsForNet(netUnits);
    feeUnits = feeInfo.feeUnits;
    feeRate = feeInfo.rate;

    const minRequired = netUnits + feeUnits;

    const balResp = await conn
      .getTokenAccountBalance(userUsdcAta, "confirmed")
      .catch(() => null);
    const available = Number(balResp?.value?.amount || "0");

    if (available < minRequired) {
      return jsonError(400, {
        code: "INSUFFICIENT_USDC",
        error: `Insufficient USDC to cover purchase and fee. Required: ${minRequired}, available: ${available}.`,
        userMessage:
          "You don't have enough USDC to cover this purchase and the Haven fee.",
        tip: "Add more USDC or try a smaller trade amount.",
        ...stageBase,
        details: {
          required: String(minRequired),
          available: String(available),
          feeUnits: String(feeUnits),
          feeRate,
        },
      });
    }

    /* 1) Jupiter quote on the **net** amount */
    stageBase.stage = "jupQuote";
    const qUrl =
      `${JUP_QUOTE}?` +
      new URLSearchParams({
        inputMint: USDC_MINT.toBase58(),
        outputMint: outMint.toBase58(),
        amount: String(netUnits),
        slippageBps: String(slippageBps),
        restrictIntermediateTokens: "true",
        dynamicSlippage: "true",
      });

    const qRes = await fetch(qUrl, { cache: "no-store" });
    const qText = await qRes.text().catch(() => "");
    if (!qRes.ok) {
      return jsonError(qRes.status, {
        code: "JUP_QUOTE_FAILED",
        error: `Jupiter quote failed: ${qRes.status} ${qText}`,
        userMessage: "We couldn't find a reliable route for this trade.",
        tip: "Try a smaller amount or a different token and try again.",
        ...stageBase,
        details: { body: qText },
      });
    }

    let quoteResponse: unknown;
    try {
      quoteResponse = qText ? JSON.parse(qText) : {};
    } catch {
      quoteResponse = {};
    }

    /* 2) Jupiter swap instructions */
    stageBase.stage = "jupSwapInstructions";
    const swapIxRes = await fetch(JUP_SWAP_INSTRUCTIONS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: userOwner.toBase58(),
        dynamicComputeUnitLimit: true,
        dynamicSlippage: true,
        // Jupiter may propose ATA creates with payer=user; we'll sponsor them with Haven instead
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: 1_000_000,
            priorityLevel: "veryHigh",
          },
        },
      }),
    });

    const swapText = await swapIxRes.text().catch(() => "");
    if (!swapIxRes.ok) {
      return jsonError(swapIxRes.status, {
        code: "JUP_SWAP_INSTRUCTIONS_FAILED",
        error: `swap-instructions failed: ${swapIxRes.status} ${swapText}`,
        userMessage: "We couldn't prepare this trade.",
        tip: "Please try again in a few seconds.",
        ...stageBase,
        details: { body: swapText },
      });
    }

    const j = (swapText ? JSON.parse(swapText) : {}) as Record<string, unknown>;

    // Raw arrays from Jupiter
    const setupIxsRaw = (j.setupInstructions as unknown[]) ?? [];
    const swapIxRaw = j.swapInstruction;
    const cleanupIxsRaw = (j.cleanupInstructions as unknown[]) ?? [];
    const altKeys: string[] = Array.isArray(j.addressLookupTableAddresses)
      ? (j.addressLookupTableAddresses as string[])
      : [];
    if (!swapIxRaw) {
      return jsonError(500, {
        code: "NO_SWAP_INSTRUCTION",
        error: "Jupiter returned no swapInstruction",
        userMessage: "We couldn't prepare this trade route.",
        tip: "Try again with a slightly different amount.",
        ...stageBase,
      });
    }

    /* 3) Load ALTs */
    stageBase.stage = "loadALTs";
    const altAccounts: AddressLookupTableAccount[] = [];
    for (const k of altKeys) {
      const { value } = await conn.getAddressLookupTable(new PublicKey(k));
      if (value) altAccounts.push(value);
    }

    /* 4) Build instructions
          We sponsor ATAs ourselves with Haven as payer and drop Jupiter's ATA creates for those ATAs. */
    stageBase.stage = "buildInstructions";

    const ourAtas = [
      createAssociatedTokenAccountIdempotentInstruction(
        HAVEN_FEEPAYER_PUBKEY,
        userUsdcAta,
        userOwner,
        USDC_MINT,
        usdcProgramId
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        HAVEN_FEEPAYER_PUBKEY,
        userOutAta,
        userOwner,
        outMint,
        outProgramId
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        HAVEN_FEEPAYER_PUBKEY,
        treasuryUsdcAta,
        TREASURY_OWNER,
        USDC_MINT,
        usdcProgramId
      ),
    ];

    // Filter out any Jupiter setup ix that are Associated Token Program creates for the ATAs we just sponsored
    const skipSetups = new Set(
      [userUsdcAta, userOutAta, treasuryUsdcAta].map((p) => p.toBase58())
    );

    const filteredSetup = setupIxsRaw.map(toIx).filter((ix) => {
      const isAtaProg = ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID);
      if (!isAtaProg) return true;
      // For AToken create, accounts[1] is the ATA address
      const ata = ix.keys?.[1]?.pubkey?.toBase58?.();
      return ata ? !skipSetups.has(ata) : true;
    });

    const ixs: TransactionInstruction[] = [
      ...ourAtas, // sponsor ATAs (payer = Haven)
      ...filteredSetup, // keep Jupiter compute/prio, etc., minus their ATA creates
      toIx(swapIxRaw), // Jupiter swap
      // Haven fee AFTER the swap (authority = user, so user must sign)
      ...(feeUnits > 0
        ? [
            createTransferCheckedInstruction(
              userUsdcAta,
              USDC_MINT,
              treasuryUsdcAta,
              userOwner,
              feeUnits,
              USDC_DECIMALS,
              [],
              usdcProgramId
            ),
          ]
        : []),
      ...cleanupIxsRaw.map(toIx),
    ];

    /* 5) Fresh blockhash (processed) and compile to v0 with ALTs */
    stageBase.stage = "compileTransaction";
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash(
      "processed"
    );
    const msg = new TransactionMessage({
      payerKey: HAVEN_FEEPAYER_PUBKEY, // fee payer = Haven (server co-signs)
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message(altAccounts);

    const unsignedTx = new VersionedTransaction(msg);

    // Return base64-encoded bytes for the client to user-sign (then server co-signs Haven)
    const b64 = Buffer.from(unsignedTx.serialize()).toString("base64");

    return NextResponse.json({
      transaction: b64,
      recentBlockhash: blockhash,
      lastValidBlockHeight,
      // optional: echo fee info for client-side display if you want it later
      // feeUnits,
      // feeRate,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonError(500, {
      code: "UNHANDLED_BUILD_ERROR",
      error: msg,
      userMessage: "We couldn't build this trade.",
      tip: "Please try again. If it keeps failing, contact support.",
      stage: stageBase.stage,
    });
  }
}
