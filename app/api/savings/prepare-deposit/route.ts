// app/api/savings/prepare-deposit/route.ts
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
  TOKEN_PROGRAM_ID, // force classic token program for deposit ix
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { BorshInstructionCoder } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Buffer } from "buffer";

import marginfiIdl from "@/lib/marginfi_idl.json";
import { connect as connectMongo } from "@/lib/db";
import User from "@/models/User";

/* ───────── env ───────── */
function required(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const RPC = required("NEXT_PUBLIC_SOLANA_RPC");
const USDC_MINT = new PublicKey(required("NEXT_PUBLIC_USDC_MINT"));
const HAVEN_PUBKEY = new PublicKey(
  required("NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS")
);
const MARGINFI_PROGRAM_ID = new PublicKey(required("MARGINFI_PROGRAM_ID"));
const MARGINFI_GROUP = new PublicKey(required("MARGINFI_GROUP"));
const MARGINFI_USDC_BANK = new PublicKey(required("MARGINFI_USDC_BANK"));
const MARGINFI_USDC_BANK_LIQ_VAULT = new PublicKey(
  required("MARGINFI_USDC_BANK_LIQ_VAULT")
);

/* ───────── helpers ───────── */
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

function json(status: number, body: Record<string, unknown>) {
  if (status >= 400) console.error("[/api/savings/prepare-deposit]", body);
  return NextResponse.json(body, { status });
}

/* ───────── route ───────── */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      owner58?: string;
      amountUi?: number;
      decimals?: number;
      ensureAta?: boolean; // default true
      marginfiAccount?: string | null; // optional override; otherwise fetched from DB
    } | null;

    const owner58 = body?.owner58?.trim();
    const amountUi = Number(body?.amountUi);
    const decimals = Number.isFinite(body?.decimals)
      ? Number(body!.decimals)
      : 6;
    const ensureAta = body?.ensureAta !== false;

    if (!owner58 || !Number.isFinite(amountUi) || amountUi <= 0) {
      return json(400, { error: "owner58 and positive amountUi are required" });
    }

    const owner = new PublicKey(owner58);

    // Fetch existing marginfi account (from override or DB)
    let marginfiAccountPk: PublicKey | null = null;
    if (body?.marginfiAccount) {
      marginfiAccountPk = new PublicKey(body.marginfiAccount);
    } else {
      await connectMongo();
      const user = await User.findOne({
        "depositWallet.address": owner58,
      })
        .select({ "marginfi.accountPk": 1 })
        .lean();

      const fromDb = user?.marginfi?.accountPk as string | undefined;
      if (fromDb) marginfiAccountPk = new PublicKey(fromDb);
    }

    if (!marginfiAccountPk) {
      return json(404, { error: "No existing Marginfi account found" });
    }

    // Chain clients/coder
    const conn = new Connection(RPC, "confirmed");
    const coder = new BorshInstructionCoder(marginfiIdl as Idl);

    // Determine ATA (based on actual mint program)
    const detectedTokenProgram = await detectTokenProgramId(conn, USDC_MINT);
    const userUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      owner,
      false,
      detectedTokenProgram
    );

    // Build ixs
    const ixs = [
      // Same tuning you used successfully
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 86_157 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 100_003 }),
    ];

    if (ensureAta) {
      ixs.push(
        createAssociatedTokenAccountIdempotentInstruction(
          HAVEN_PUBKEY, // payer (Haven)
          userUsdcAta,
          owner,
          USDC_MINT,
          detectedTokenProgram
        )
      );
    }

    // Deposit instruction (encode with named args)
    const amountBN = uiToBN(amountUi, decimals);
    const depositIxData = coder.encode("lending_account_deposit", {
      amount: amountBN,
      deposit_up_to_limit: null, // Option<bool>::None
    });

    ixs.push({
      programId: MARGINFI_PROGRAM_ID,
      keys: [
        { pubkey: MARGINFI_GROUP, isSigner: false, isWritable: false },
        { pubkey: marginfiAccountPk, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: MARGINFI_USDC_BANK, isSigner: false, isWritable: true },
        { pubkey: userUsdcAta, isSigner: false, isWritable: true },
        {
          pubkey: MARGINFI_USDC_BANK_LIQ_VAULT,
          isSigner: false,
          isWritable: true,
        },
        // Force classic token program for the transfer, matching your Solscan tx
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: depositIxData,
    });

    // Compile and return
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash(
      "processed"
    );
    const msg = new TransactionMessage({
      payerKey: HAVEN_PUBKEY, // sponsored fees
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);
    const b64 = Buffer.from(tx.serialize()).toString("base64");

    return NextResponse.json({
      transaction: b64,
      marginfiAccount: marginfiAccountPk.toBase58(),
      userUsdcAta: userUsdcAta.toBase58(),
      feePayer: HAVEN_PUBKEY.toBase58(),
      lastValidBlockHeight,
      requiredClientSigner: owner.toBase58(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json(500, { error: message });
  }
}
