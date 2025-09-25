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
const FIXED_FEE_UI = 0.25; // $0.25

/* ───────── utils ───────── */
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

/* ───────── route ───────── */
export async function POST(req: Request) {
  try {
    if (!RPC?.includes("mainnet")) throw new Error("RPC must be mainnet");
    if (!USDC_MINT || !HAVEN_FEEPAYER_PUBKEY || !TREASURY_OWNER) {
      throw new Error(
        "Missing env: USDC_MINT / NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS / NEXT_PUBLIC_APP_TREASURY_OWNER"
      );
    }

    const {
      fromOwnerBase58,
      outputMint,
      amountUnits,
      slippageBps = 50,
    } = (await req.json()) as {
      fromOwnerBase58: string; // user (will sign)
      outputMint: string; // token to buy
      amountUnits: number; // net USDC-in (base units), fee is separate
      slippageBps?: number;
    };

    if (
      !fromOwnerBase58 ||
      !outputMint ||
      !Number.isFinite(amountUnits) ||
      amountUnits <= 0
    ) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const userOwner = new PublicKey(fromOwnerBase58);
    const outMint = new PublicKey(outputMint);

    const conn = new Connection(RPC, "confirmed");
    const usdcProgramId = await detectTokenProgramId(conn, USDC_MINT);
    const outProgramId = await detectTokenProgramId(conn, outMint);

    // ATAs (user + treasury)
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
    const feeUnits = Math.round(FIXED_FEE_UI * 10 ** USDC_DECIMALS);
    const minRequired = amountUnits + feeUnits;

    const balResp = await conn
      .getTokenAccountBalance(userUsdcAta, "confirmed")
      .catch(() => null);
    const available = Number(balResp?.value?.amount || "0");
    if (available < minRequired) {
      return NextResponse.json(
        { error: "Insufficient USDC to cover purchase + $0.25 fee." },
        { status: 400 }
      );
    }

    /* 1) Jupiter quote on the **net** amount */
    const qUrl =
      `${JUP_QUOTE}?` +
      new URLSearchParams({
        inputMint: USDC_MINT.toBase58(),
        outputMint: outMint.toBase58(),
        amount: String(amountUnits),
        slippageBps: String(slippageBps),
        restrictIntermediateTokens: "true",
        dynamicSlippage: "true",
      });
    const qRes = await fetch(qUrl, { cache: "no-store" });
    if (!qRes.ok)
      throw new Error(
        `Jupiter quote failed: ${qRes.status} ${await qRes.text()}`
      );
    const quoteResponse = await qRes.json();

    /* 2) Jupiter swap instructions */
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
    if (!swapIxRes.ok) {
      throw new Error(
        `swap-instructions failed: ${
          swapIxRes.status
        } ${await swapIxRes.text()}`
      );
    }
    const j = (await swapIxRes.json()) as Record<string, unknown>;

    // Raw arrays from Jupiter
    const setupIxsRaw = (j.setupInstructions as unknown[]) ?? [];
    const swapIxRaw = j.swapInstruction;
    const cleanupIxsRaw = (j.cleanupInstructions as unknown[]) ?? [];
    const altKeys: string[] = Array.isArray(j.addressLookupTableAddresses)
      ? (j.addressLookupTableAddresses as string[])
      : [];
    if (!swapIxRaw) throw new Error("Jupiter returned no swapInstruction");

    /* 3) Load ALTs */
    const altAccounts: AddressLookupTableAccount[] = [];
    for (const k of altKeys) {
      const { value } = await conn.getAddressLookupTable(new PublicKey(k));
      if (value) altAccounts.push(value);
    }

    /* 4) Build instructions
          We sponsor ATAs ourselves with Haven as payer and drop Jupiter's ATA creates for those ATAs. */
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
      createTransferCheckedInstruction(
        // $0.25 fee AFTER the swap (authority = user, so user must sign)
        userUsdcAta,
        USDC_MINT,
        treasuryUsdcAta,
        userOwner,
        Math.round(FIXED_FEE_UI * 10 ** USDC_DECIMALS),
        USDC_DECIMALS,
        [],
        usdcProgramId
      ),
      ...cleanupIxsRaw.map(toIx),
    ];

    /* 5) Fresh blockhash (processed) and compile to v0 with ALTs */
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
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
