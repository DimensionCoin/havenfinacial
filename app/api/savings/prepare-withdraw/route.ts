// app/api/savings/prepare-withdraw/route.ts
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
  TOKEN_PROGRAM_ID, // classic SPL token program
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { BorshInstructionCoder } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Buffer } from "buffer";
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
const MARGINFI_PROGRAM_ID = new PublicKey(required("MARGINFI_PROGRAM_ID")); // MFv2...
const MARGINFI_GROUP = new PublicKey(required("MARGINFI_GROUP"));
const MARGINFI_USDC_BANK = new PublicKey(required("MARGINFI_USDC_BANK"));
const MARGINFI_USDC_BANK_LIQ_VAULT = new PublicKey(
  required("MARGINFI_USDC_BANK_LIQ_VAULT")
);

/* ───────── helpers ───────── */
function jsonError(message: string, status = 500, extra?: unknown) {
  if (extra) console.error("[/api/savings/prepare-withdraw]", message, extra);
  else console.error("[/api/savings/prepare-withdraw]", message);
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

/* ───────── route ───────── */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      owner58?: string;
      amountUi?: number; // optional if withdrawAll=true
      decimals?: number; // default 6
      ensureAta?: boolean; // default true
      marginfiAccount?: string; // required
      withdrawAll?: boolean; // default false
    } | null;

    const owner58 = body?.owner58?.trim();
    const withdrawAll = body?.withdrawAll === true;
    const amountUi = Number(body?.amountUi);
    const decimals = Number.isFinite(body?.decimals)
      ? Number(body!.decimals)
      : 6;
    const ensureAta = body?.ensureAta !== false;
    const marginfiAccountStr = body?.marginfiAccount?.trim();

    if (!owner58 || !marginfiAccountStr) {
      return jsonError("owner58 and marginfiAccount are required", 400);
    }
    if (!withdrawAll && !Number.isFinite(amountUi)) {
      return jsonError("amountUi is required unless withdrawAll is true", 400);
    }

    const owner = new PublicKey(owner58);
    const marginfiAccountPk = new PublicKey(marginfiAccountStr);

    const conn = new Connection(RPC, "confirmed");
    const coder = new BorshInstructionCoder(marginfiIdl as Idl);

    // User USDC ATA (same program as mint)
    const detectedTokenProgram = await detectTokenProgramId(conn, USDC_MINT); // EPjF => classic
    const userUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      owner,
      false,
      detectedTokenProgram
    );

    // Bank liquidity vault authority PDA: ["liquidity_vault_auth", bank]
    const [bankLiquidityVaultAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from("liquidity_vault_auth"), MARGINFI_USDC_BANK.toBuffer()],
      MARGINFI_PROGRAM_ID
    );

    // Compute budget (same as your working tx)
    const ixs = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 86_160 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 106_603 }),
    ];

    // Ensure destination ATA exists
    if (ensureAta) {
      ixs.push(
        createAssociatedTokenAccountIdempotentInstruction(
          HAVEN_PUBKEY, // sponsored fees
          userUsdcAta,
          owner,
          USDC_MINT,
          detectedTokenProgram
        )
      );
    }

    // Withdraw data
    const amountBN = withdrawAll ? new BN(0) : uiToBN(amountUi, decimals);
    const withdrawIxData = coder.encode("lending_account_withdraw", {
      amount: amountBN,
      withdraw_all: withdrawAll ? true : null, // Option<bool> (true | null)
    });

    // EXACT 8 ACCOUNTS — NO REMAINING ACCOUNTS
    const withdrawKeys = [
      { pubkey: MARGINFI_GROUP, isSigner: false, isWritable: false }, // group
      { pubkey: marginfiAccountPk, isSigner: false, isWritable: true }, // marginfi_account
      { pubkey: owner, isSigner: true, isWritable: true }, // authority
      { pubkey: MARGINFI_USDC_BANK, isSigner: false, isWritable: true }, // bank
      { pubkey: userUsdcAta, isSigner: false, isWritable: true }, // destination_token_account
      { pubkey: bankLiquidityVaultAuth, isSigner: false, isWritable: false }, // bank_liquidity_vault_authority
      {
        pubkey: MARGINFI_USDC_BANK_LIQ_VAULT,
        isSigner: false,
        isWritable: true,
      }, // liquidity_vault
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
    ];

    ixs.push({
      programId: MARGINFI_PROGRAM_ID,
      keys: withdrawKeys,
      data: withdrawIxData,
    });

    // Build server-paid tx
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
      group: MARGINFI_GROUP.toBase58(),
      owner: owner.toBase58(),
      bank: MARGINFI_USDC_BANK.toBase58(),
      userUsdcAta: userUsdcAta.toBase58(),
      bankLiquidityVaultAuth: bankLiquidityVaultAuth.toBase58(),
      vault: MARGINFI_USDC_BANK_LIQ_VAULT.toBase58(),
      remainingCount: 0,
    });

    return NextResponse.json({
      transaction: b64,
      marginfiAccount: marginfiAccountPk.toBase58(),
      userUsdcAta: userUsdcAta.toBase58(),
      feePayer: HAVEN_PUBKEY.toBase58(),
      lastValidBlockHeight,
      requiredClientSigner: owner.toBase58(),
    });
  } catch (e: unknown) {
    const message =
      e instanceof Error
        ? e.message
        : typeof e === "string"
        ? e
        : "prepare-withdraw failed";
    return jsonError(message, 500, e);
  }
}
