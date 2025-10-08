// app/api/savings/open-and-deposit/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
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

/* ✅ DB */
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

function jsonError(message: string, status = 500, extra?: unknown) {
  if (extra) console.error("[/api/savings/open-and-deposit]", message, extra);
  else console.error("[/api/savings/open-and-deposit]", message);
  return NextResponse.json({ error: message }, { status });
}

/* ───────── route ───────── */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      owner58?: string;
      amountUi?: number;
      decimals?: number;
      marginfiAccount?: string; // optional: reuse existing non-PDA account
      ensureAta?: boolean; // default true
    } | null;

    const owner58 = body?.owner58;
    const amountUi = body?.amountUi;
    const decimals = Number.isFinite(body?.decimals)
      ? Number(body!.decimals)
      : 6;
    const ensureAta = body?.ensureAta !== false;
    const reuseMarginAcc = body?.marginfiAccount;

    if (!owner58 || !Number.isFinite(Number(amountUi))) {
      return NextResponse.json(
        { error: "owner58 and amountUi are required" },
        { status: 400 }
      );
    }

    const owner = new PublicKey(owner58);
    const conn = new Connection(RPC, "confirmed");
    const coder = new BorshInstructionCoder(marginfiIdl as Idl);

    // User USDC ATA (payer = Haven)
    const detectedTokenProgram = await detectTokenProgramId(conn, USDC_MINT);
    const userUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      owner,
      false,
      detectedTokenProgram
    );

    const ixs = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 86_157 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 100_003 }),
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

    // marginfi account (non-PDA): create or reuse
    let marginfiAccountPk: PublicKey;
    let marginfiSigner: Keypair | null = null;
    if (reuseMarginAcc) {
      marginfiAccountPk = new PublicKey(reuseMarginAcc);
    } else {
      marginfiSigner = Keypair.generate();
      marginfiAccountPk = marginfiSigner.publicKey;
    }

    // ---- 1) Initialize marginfi account
    const initIxData = coder.encode("marginfi_account_initialize", {});
    ixs.push({
      programId: MARGINFI_PROGRAM_ID,
      keys: [
        { pubkey: MARGINFI_GROUP, isSigner: false, isWritable: false },
        {
          pubkey: marginfiAccountPk,
          isSigner: !reuseMarginAcc,
          isWritable: true,
        },
        { pubkey: owner, isSigner: true, isWritable: false },
        { pubkey: HAVEN_PUBKEY, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: initIxData,
    });

    // ---- 2) Deposit USDC
    const amountBN = uiToBN(amountUi!, decimals);
    const depositIxData = coder.encode("lending_account_deposit", {
      amount: amountBN,
      deposit_up_to_limit: null,
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
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: depositIxData,
    });

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash(
      "processed"
    );
    const msg = new TransactionMessage({
      payerKey: HAVEN_PUBKEY,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);
    if (marginfiSigner) tx.sign([marginfiSigner]);
    const b64 = Buffer.from(tx.serialize()).toString("base64");

    /* ✅ NEW: bump/create savingsBaselineUi by amountUi, and persist marginfi.accountPk if missing */
    let baselineBumped = false;
    try {
      await connectMongo(); // no-op if already connected

      const res = await User.updateOne(
        { "depositWallet.address": owner58 },
        [
          {
            $set: {
              savingsBaselineUi: {
                $add: [
                  { $ifNull: ["$savingsBaselineUi", 0] },
                  Number(amountUi),
                ],
              },
              "marginfi.accountPk": {
                $cond: [
                  {
                    $or: [
                      { $eq: ["$marginfi", null] },
                      { $eq: ["$marginfi.accountPk", null] },
                    ],
                  },
                  marginfiAccountPk.toBase58(),
                  "$marginfi.accountPk",
                ],
              },
            },
          },
        ],
        { writeConcern: { w: "majority" } }
      );

      baselineBumped = res.matchedCount === 1;
      if (!baselineBumped) {
        console.warn(
          "[/api/savings/open-and-deposit] User not found for baseline bump",
          { owner58 }
        );
      }
    } catch (e) {
      console.error(
        "[/api/savings/open-and-deposit] Failed to bump savingsBaselineUi",
        e
      );
    }

    return NextResponse.json({
      transaction: b64,
      marginfiAccount: marginfiAccountPk.toBase58(),
      userUsdcAta: userUsdcAta.toBase58(),
      feePayer: HAVEN_PUBKEY.toBase58(),
      lastValidBlockHeight,
      requiredClientSigner: owner.toBase58(),
      baselineBumped, // for debugging
      bumpedByUi: Number(amountUi),
    });
  } catch (e: unknown) {
    const message =
      e instanceof Error
        ? e.message
        : typeof e === "string"
        ? e
        : "prepare failed";
    return jsonError(message, 500, e);
  }
}

/* (Optional) PATCH can stay if you still want a manual setter, but not required now */
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      owner58?: string;
      amountUi?: number; // add to baseline
      setBaselineUi?: number; // hard-set baseline
      marginfiAccount?: string;
      txSig?: string;
    } | null;

    const owner58 = body?.owner58?.trim();
    if (!owner58) {
      return NextResponse.json(
        { error: "owner58 is required" },
        { status: 400 }
      );
    }

    await connectMongo();

    // hard-set
    if (Number.isFinite(body?.setBaselineUi)) {
      const v = Number(body!.setBaselineUi);
      if (v < 0) {
        return NextResponse.json(
          { error: "setBaselineUi must be >= 0" },
          { status: 400 }
        );
      }
      const setDoc: Record<string, unknown> = { savingsBaselineUi: v };
      if (body?.marginfiAccount) {
        setDoc["marginfi.accountPk"] = {
          $cond: [
            {
              $or: [
                { $eq: ["$marginfi", null] },
                { $eq: ["$marginfi.accountPk", null] },
              ],
            },
            body.marginfiAccount.trim(),
            "$marginfi.accountPk",
          ],
        };
      }
      const res = await User.updateOne(
        { "depositWallet.address": owner58 },
        [{ $set: setDoc }],
        { writeConcern: { w: "majority" } }
      );
      if (res.matchedCount !== 1)
        return NextResponse.json(
          { error: "User not found for provided owner58" },
          { status: 404 }
        );
      return NextResponse.json({ ok: true, mode: "set", savingsBaselineUi: v });
    }

    // add
    if (!Number.isFinite(body?.amountUi) || Number(body!.amountUi) <= 0) {
      return NextResponse.json(
        { error: "amountUi must be a positive number" },
        { status: 400 }
      );
    }
    const amt = Number(body!.amountUi);

    const pipelineSet: Record<string, unknown> = {
      savingsBaselineUi: {
        $add: [{ $ifNull: ["$savingsBaselineUi", 0] }, amt],
      },
    };
    if (body?.marginfiAccount) {
      pipelineSet["marginfi.accountPk"] = {
        $cond: [
          {
            $or: [
              { $eq: ["$marginfi", null] },
              { $eq: ["$marginfi.accountPk", null] },
            ],
          },
          body.marginfiAccount.trim(),
          "$marginfi.accountPk",
        ],
      };
    }

    const res = await User.updateOne(
      { "depositWallet.address": owner58 },
      [{ $set: pipelineSet }],
      { writeConcern: { w: "majority" } }
    );
    if (res.matchedCount !== 1)
      return NextResponse.json(
        { error: "User not found for provided owner58" },
        { status: 404 }
      );
    return NextResponse.json({ ok: true, mode: "added", addedUi: amt });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : "failed";
    return jsonError(message, 500, e);
  }
}
