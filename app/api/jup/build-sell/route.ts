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

const USDC_DECIMALS = 6;
const FIXED_FEE_UI = 0.25;
const FIXED_FEE_UNITS = Math.round(FIXED_FEE_UI * 10 ** USDC_DECIMALS);

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

async function jupLiteQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: string;
}) {
  // Lite free tier: don't set restrictIntermediateTokens=false
  const url =
    `${LITE_QUOTE}?` +
    new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      slippageBps: params.slippageBps,
      dynamicSlippage: "true",
      maxAccounts: "12",
    });
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    let j: unknown = null;
    try {
      j = await res.json();
    } catch {}
    const obj = (j ?? {}) as Record<string, unknown>;
    const code = obj.errorCode as string | undefined;
    if (code === "COULD_NOT_FIND_ANY_ROUTE" || code === "NOT_SUPPORTED")
      return null;
    const raw = j ? JSON.stringify(j) : await res.text();
    throw new Error(`Lite quote ${res.status}: ${raw}`);
  }
  return (await res.json()) as unknown;
}

async function jupV6Quote(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: string;
}) {
  const tries = ["12", "16", "24", "32"];
  for (const maxAccounts of tries) {
    const url =
      `${V6_QUOTE}?` +
      new URLSearchParams({
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: params.amount,
        slippageBps: params.slippageBps,
        onlyDirectRoutes: "false",
        asLegacyTransaction: "false",
        maxAccounts,
      });
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) return (await res.json()) as unknown;
    let j: unknown = null;
    try {
      j = await res.json();
    } catch {}
    const obj = (j ?? {}) as Record<string, unknown>;
    if ((obj.errorCode as string | undefined) === "COULD_NOT_FIND_ANY_ROUTE")
      continue;
    const raw = j ? JSON.stringify(j) : await res.text();
    throw new Error(`v6 quote ${res.status}: ${raw}`);
  }
  return null;
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

/* ───────── route ───────── */
export async function POST(req: Request) {
  try {
    if (!RPC?.includes("mainnet")) throw new Error("RPC must be mainnet");
    if (!HAVEN_FEEPAYER || !TREASURY_OWNER) {
      throw new Error(
        "Missing env: NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS / NEXT_PUBLIC_APP_TREASURY_OWNER"
      );
    }

    const {
      fromOwnerBase58,
      inputMint,
      amountUnits,
      slippageBps = 50,
    } = (await req.json()) as {
      fromOwnerBase58: string;
      inputMint: string;
      amountUnits: number;
      slippageBps?: number;
    };

    if (
      !fromOwnerBase58 ||
      !inputMint ||
      !Number.isFinite(amountUnits) ||
      amountUnits <= 0
    ) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const conn = new Connection(RPC, "confirmed");
    const userOwner = new PublicKey(fromOwnerBase58);
    const inMint = new PublicKey(inputMint);
    const isWSOL = inMint.equals(WSOL_MINT);

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

    // ----- Balance guard for WSOL vs native SOL -----
    // If input is WSOL mint:
    //  - Prefer SPL WSOL ATA balance (selling wrapped SOL)
    //  - Fallback to native lamports (selling native SOL via wrapping) if WSOL ATA is insufficient
    let useNativeSol = false;
    if (isWSOL) {
      // Check WSOL ATA first
      const inProgId = await detectTokenProgramId(conn, inMint); // should be TOKEN_PROGRAM_ID
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
        // OK: we will sell WSOL as SPL; NO wrap/unwrap required
        useNativeSol = false;
      } else {
        // Try native SOL instead
        const lamports = await conn.getBalance(userOwner, "confirmed");
        if (lamports < amountUnits) {
          return NextResponse.json(
            { error: "Insufficient SOL / WSOL balance." },
            { status: 400 }
          );
        }
        useNativeSol = true; // wrap during swap
      }
    } else {
      // Non-WSOL: standard SPL guard
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
        return NextResponse.json(
          { error: "Insufficient token balance." },
          { status: 400 }
        );
      }
    }

    /* 1) QUOTE (Lite → v6 fallback) */
    const quoteArgs = {
      inputMint: inMint.toBase58(),
      outputMint: SWAP_USDC_MINT.toBase58(),
      amount: String(amountUnits),
      slippageBps: String(slippageBps),
    };

    let quoteResponse: unknown = await jupLiteQuote(quoteArgs);
    let quoteKind: "lite" | "v6" = "lite";
    if (!quoteResponse) {
      quoteResponse = await jupV6Quote(quoteArgs);
      quoteKind = "v6";
    }

    if (!quoteResponse) {
      return NextResponse.json(
        {
          error:
            "No swap route found for this token → USDC. Liquidity may be limited right now.",
          errorCode: "NO_ROUTE",
        },
        { status: 422 }
      );
    }

    /* 2) SWAP INSTRUCTIONS
       Set wrap/unwrap ONLY if using native SOL path. If we're selling WSOL ATA, leave it false.
    */
    const swapIxs = await jupSwapIxs(quoteKind, {
      quoteResponse,
      userPublicKey: userOwner.toBase58(),
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
      wrapAndUnwrapSol: useNativeSol, // <<< critical line
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
      ? swapIxs.addressLookupTableAddresses
      : [];
    if (!swapIxRaw) throw new Error("Jupiter returned no swapInstruction");

    // Load ALTs
    const altAccounts: AddressLookupTableAccount[] = [];
    for (const k of altKeys) {
      const { value } = await conn.getAddressLookupTable(new PublicKey(k));
      if (value) altAccounts.push(value);
    }

    /* 3) Sponsored ATAs (minimize bytes) */
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

    // Filter Jupiter ATA-creates we already cover
    const skipSet = new Set<string>([userUsdcAta.toBase58()]);
    if (needTreasuryAta) skipSet.add(treasuryUsdcAta.toBase58());

    const setupFiltered = setupIxsRaw.map(toIx).filter((ix) => {
      if (!ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) return true;
      const ata = ix.keys?.[1]?.pubkey?.toBase58?.();
      return ata ? !skipSet.has(ata) : true;
    });

    // Post-swap $0.25 USDC fee (user -> treasury)
    const feeIx = createTransferCheckedInstruction(
      userUsdcAta,
      SWAP_USDC_MINT,
      treasuryUsdcAta,
      userOwner,
      FIXED_FEE_UNITS,
      USDC_DECIMALS,
      [],
      usdcProgId
    );

    const ixsCore = [toIx(swapIxRaw)];
    const ixsHead = [...ourAtas, ...setupFiltered];
    const ixsTail = cleanupIxsRaw.map(toIx);

    const ixsWithFee = [...ixsHead, ...ixsCore, feeIx, ...ixsTail];
    const ixsNoFee = [...ixsHead, ...ixsCore, ...ixsTail];

    /* 4) Compile & size guard */
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
    let postChargeFeeCents: number | undefined;

    if (encodedLen > MAX_ENCODED_LEN) {
      tx = compile(ixsNoFee);
      encodedLen = Buffer.from(tx.serialize()).length;
      postChargeFeeCents = 25;
    }

    if (encodedLen > MAX_ENCODED_LEN) {
      return NextResponse.json(
        {
          error:
            "Route is too large to fit in one transaction. Try a smaller amount or a simpler route.",
          errorCode: "TX_TOO_LARGE",
          encodedLen,
          limit: MAX_ENCODED_LEN,
        },
        { status: 413 }
      );
    }

    const b64 = Buffer.from(tx.serialize()).toString("base64");
    return NextResponse.json({
      transaction: b64,
      recentBlockhash: blockhash,
      lastValidBlockHeight,
      ...(postChargeFeeCents ? { postChargeFeeCents } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
