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

/* ───────── DB (for baseline bump) ───────── */
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

/* ───────── route: POST (build tx + bump baseline by amountUi) ───────── */
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

    // Compile tx
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

    /* ───────── NEW: bump savingsBaselineUi by amountUi ─────────
       We do this best-effort and DO NOT block tx creation if it fails.
       If marginfi.accountPk is missing, we set it.
    */
    let dbUpdated = false;
    try {
      await connectMongo(); // safe if already connected
      const marginfiAccountB58 = marginfiAccountPk.toBase58();

      const res = await User.updateOne(
        { "depositWallet.address": owner58 },
        [
          {
            $set: {
              savingsBaselineUi: {
                $add: [{ $ifNull: ["$savingsBaselineUi", 0] }, amountUi],
              },
              "marginfi.accountPk": {
                $cond: [
                  {
                    $or: [
                      { $eq: ["$marginfi", null] },
                      { $eq: ["$marginfi.accountPk", null] },
                    ],
                  },
                  marginfiAccountB58,
                  "$marginfi.accountPk",
                ],
              },
            },
          },
        ],
        { writeConcern: { w: "majority" } }
      );
      dbUpdated = res.matchedCount === 1;
      if (!dbUpdated) {
        console.warn(
          "[/api/savings/prepare-deposit] User not found for baseline bump",
          { owner58 }
        );
      }
    } catch (e) {
      console.error(
        "[/api/savings/prepare-deposit] Failed to bump savingsBaselineUi",
        e
      );
    }

    // Return tx (unchanged), plus a small hint about DB update result
    return NextResponse.json({
      transaction: b64,
      marginfiAccount: marginfiAccountPk.toBase58(),
      userUsdcAta: userUsdcAta.toBase58(),
      feePayer: HAVEN_PUBKEY.toBase58(),
      lastValidBlockHeight,
      requiredClientSigner: owner.toBase58(),
      baselineBumped: dbUpdated, // ← for debugging/telemetry only
      bumpedByUi: amountUi, // ← echoes what we tried to add
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json(500, { error: message });
  }
}

/* ───────── PATCH remains (manual set/add if you still want it) ───────── */
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      owner58?: string; // required
      setBaselineUi?: number; // optional: hard-set baseline
      amountUi?: number; // optional: add to baseline (deposit amount)
      marginfiAccount?: string; // optional: persist if missing
      txSig?: string; // optional: for logs
    } | null;

    const owner58 = body?.owner58?.trim();
    if (!owner58) {
      return json(400, { error: "owner58 is required" });
    }

    const setBaselineUi = body?.setBaselineUi;
    const amountUi = body?.amountUi;
    const marginfiAccount = body?.marginfiAccount?.trim();

    const hasSet = Number.isFinite(setBaselineUi);
    const hasAdd = Number.isFinite(amountUi);
    if (hasSet === hasAdd) {
      return json(400, {
        error: "Provide exactly one of setBaselineUi OR amountUi.",
      });
    }

    await connectMongo();

    if (hasSet) {
      const value = Number(setBaselineUi);
      if (value < 0) return json(400, { error: "setBaselineUi must be >= 0" });

      const setDoc: Record<string, unknown> = { savingsBaselineUi: value };
      if (marginfiAccount) {
        setDoc["marginfi.accountPk"] = {
          $cond: [
            {
              $or: [
                { $eq: ["$marginfi", null] },
                { $eq: ["$marginfi.accountPk", null] },
              ],
            },
            marginfiAccount,
            "$marginfi.accountPk",
          ],
        };
      }

      const res = await User.updateOne(
        { "depositWallet.address": owner58 },
        [{ $set: setDoc }],
        { writeConcern: { w: "majority" } }
      );

      if (res.matchedCount !== 1) {
        return json(404, { error: "User not found for provided owner58" });
      }
      return json(200, { ok: true, mode: "set", savingsBaselineUi: value });
    }

    // add to baseline (deposit)
    const amt = Number(amountUi);
    if (amt <= 0) return json(400, { error: "amountUi must be > 0" });

    const pipelineSet: Record<string, unknown> = {
      savingsBaselineUi: {
        $add: [{ $ifNull: ["$savingsBaselineUi", 0] }, amt],
      },
    };
    if (marginfiAccount) {
      pipelineSet["marginfi.accountPk"] = {
        $cond: [
          {
            $or: [
              { $eq: ["$marginfi", null] },
              { $eq: ["$marginfi.accountPk", null] },
            ],
          },
          marginfiAccount,
          "$marginfi.accountPk",
        ],
      };
    }

    const res = await User.updateOne(
      { "depositWallet.address": owner58 },
      [{ $set: pipelineSet }],
      { writeConcern: { w: "majority" } }
    );

    if (res.matchedCount !== 1) {
      return json(404, { error: "User not found for provided owner58" });
    }

    return json(200, { ok: true, mode: "added", addedUi: amt });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json(500, { error: message });
  }
}
