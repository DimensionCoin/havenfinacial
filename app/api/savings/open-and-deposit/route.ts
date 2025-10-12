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
  getAccount,
  getMint,
} from "@solana/spl-token";
import { BorshInstructionCoder } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Buffer } from "buffer";
import marginfiIdl from "@/lib/marginfi_idl.json";

/* DB */
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

function json(status: number, body: Record<string, unknown>) {
  if (status >= 400) console.error("[/api/savings/open-and-deposit]", body);
  return NextResponse.json(body, { status });
}

/* ───────── POST: build tx (server pre-signs marginfi kp; NO DB writes) ───────── */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      owner58?: string; // user deposit wallet (authority)
      amountUi?: number; // USDC UI units
      decimals?: number; // defaults to mint.decimals
      ensureAta?: boolean; // default true
      marginfiAccount?: string; // optional reuse (if already exists)
    } | null;

    const owner58 = body?.owner58?.trim();
    const amountUi = Number(body?.amountUi);
    const ensureAta = body?.ensureAta !== false;

    if (!owner58 || !Number.isFinite(amountUi) || amountUi <= 0) {
      return json(400, { error: "owner58 and positive amountUi are required" });
    }

    // Ensure user exists
    await connectMongo();
    const existing = await User.findOne(
      { "depositWallet.address": owner58 },
      { _id: 1, "marginfi.accountPk": 1 }
    ).lean();

    if (!existing?._id) {
      return json(404, {
        error: "User not found for provided owner58",
        owner58,
      });
    }

    const owner = new PublicKey(owner58);
    const conn = new Connection(RPC, "confirmed");
    const coder = new BorshInstructionCoder(marginfiIdl as Idl);

    // Mint + decimals + program detection
    const mintForDecimals = await getMint(conn, USDC_MINT);
    const decimals = Number.isFinite(body?.decimals)
      ? Number(body!.decimals)
      : mintForDecimals.decimals;

    const mintAccountInfo = await conn.getAccountInfo(USDC_MINT, "confirmed");
    if (!mintAccountInfo)
      return json(400, { error: "USDC mint not found on chain" });

    const detectedTokenProgram = mintAccountInfo.owner.equals(
      TOKEN_2022_PROGRAM_ID
    )
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

    const userUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      owner,
      false,
      detectedTokenProgram
    );

    // Gentle balance preflight (if ATA exists)
    const amountBn = uiToBN(amountUi, decimals);
    const ataInfo = await conn.getAccountInfo(userUsdcAta, "confirmed");
    if (ataInfo) {
      const acc = await getAccount(
        conn,
        userUsdcAta,
        "confirmed",
        detectedTokenProgram
      );
      const userRaw = BigInt(acc.amount.toString());
      if (userRaw < BigInt(amountBn.toString())) {
        const availableUi = Number(userRaw) / 10 ** decimals;
        const shortfallUi = amountUi - availableUi;
        return json(400, {
          error: "Insufficient USDC balance",
          details: {
            requiredUi: amountUi,
            availableUi,
            shortfallUi: Math.max(0, shortfallUi),
          },
        });
      }
    }

    // marginfi account: reuse if provided/known, otherwise create ephemeral kp on server and pre-sign
    const reusePk =
      (body?.marginfiAccount && new PublicKey(body.marginfiAccount)) ||
      (existing?.marginfi?.accountPk &&
        new PublicKey(existing.marginfi.accountPk)) ||
      null;

    let marginfiAccountPk: PublicKey;
    let marginfiSigner: Keypair | null = null;

    if (reusePk) {
      marginfiAccountPk = reusePk;
    } else {
      marginfiSigner = Keypair.generate();
      marginfiAccountPk = marginfiSigner.publicKey;
    }

    // Build instructions
    const ixs = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 86_157 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 100_003 }),
    ];

    if (ensureAta) {
      ixs.push(
        createAssociatedTokenAccountIdempotentInstruction(
          HAVEN_PUBKEY, // sponsor pays rent
          userUsdcAta,
          owner,
          USDC_MINT,
          detectedTokenProgram
        )
      );
    }

    // 1) Initialize marginfi account (requires: marginfiAccount signer + owner signer + HAVEN signer)
    if (!reusePk) {
      const initIxData = coder.encode("marginfi_account_initialize", {});
      ixs.push({
        programId: MARGINFI_PROGRAM_ID,
        keys: [
          { pubkey: MARGINFI_GROUP, isSigner: false, isWritable: false },
          { pubkey: marginfiAccountPk, isSigner: true, isWritable: true }, // server will pre-sign if we created it
          { pubkey: owner, isSigner: true, isWritable: false }, // user signs client-side
          { pubkey: HAVEN_PUBKEY, isSigner: true, isWritable: true }, // HAVEN signs in /api/savings/send
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
        ],
        data: initIxData,
      });
    }

    // 2) Deposit USDC (owner must sign)
    const depositIxData = coder.encode("lending_account_deposit", {
      amount: amountBn,
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
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // classic token program (matches your working tx)
      ],
      data: depositIxData,
    });

    // Build tx (sponsored fees)
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash(
      "processed"
    );
    const msg = new TransactionMessage({
      payerKey: HAVEN_PUBKEY,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);

    // If we created the marginfi account, pre-sign it server-side now.
    if (marginfiSigner) tx.sign([marginfiSigner]);

    // IMPORTANT: do NOT sign with HAVEN here;
    // your /api/savings/send should attach the HAVEN signature right before sending.
    const b64 = Buffer.from(tx.serialize()).toString("base64");

    return NextResponse.json({
      transaction: b64,
      marginfiAccount: marginfiAccountPk.toBase58(),
      userUsdcAta: userUsdcAta.toBase58(),
      feePayer: HAVEN_PUBKEY.toBase58(),
      lastValidBlockHeight,
      requiredClientSigner: owner.toBase58(), // helpful for client logs
      note: "Client should sign as owner, then POST to /api/savings/send which will attach HAVEN signature and broadcast.",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "prepare failed";
    return json(500, { error: message });
  }
}

/* ───────── PATCH: verify txSig, then record baseline & marginfi link ───────── */
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      owner58?: string;
      amountUi?: number;
      txSig?: string;
      marginfiAccount?: string; // optional: set if missing
    } | null;

    const owner58 = body?.owner58?.trim();
    const amountUi = Number(body?.amountUi);
    const txSig = body?.txSig?.trim();
    const marginfiAccount = body?.marginfiAccount?.trim();

    if (!owner58 || !Number.isFinite(amountUi) || amountUi <= 0 || !txSig) {
      return json(400, {
        error: "owner58, positive amountUi, and txSig are required",
      });
    }

    // Verify the tx succeeded before recording baseline
    const conn = new Connection(RPC, "confirmed");
    const st = (
      await conn.getSignatureStatuses([txSig], {
        searchTransactionHistory: true,
      })
    ).value?.[0];
    if (!st || st.err) {
      return json(400, {
        error: "Transaction not confirmed/successful",
        txSig,
        err: st?.err ?? null,
      });
    }

    await connectMongo();

    // Write-once marginfi.accountPk setter if provided
    const setPatch: Record<string, unknown> = {};
    if (marginfiAccount) {
      setPatch["marginfi.accountPk"] = {
        $cond: [
          {
            $or: [
              { $eq: ["$marginfi", null] },
              { $eq: ["$marginfi.accountPk", null] },
              { $eq: ["$marginfi.accountPk", ""] },
            ],
          },
          marginfiAccount,
          "$marginfi.accountPk",
        ],
      };
    }

    const res = await User.updateOne(
      { "depositWallet.address": owner58 },
      [
        {
          $set: {
            // nested baseline
            "savings.baselineValueUi": {
              $add: [
                { $ifNull: ["$savings.baselineValueUi", 0] },
                Number(amountUi),
              ],
            },
            // legacy mirror (if anything still reads it)
            savingsBaselineUi: {
              $add: [{ $ifNull: ["$savingsBaselineUi", 0] }, Number(amountUi)],
            },
            ...(Object.keys(setPatch).length ? setPatch : {}),
          },
        },
      ],
      { writeConcern: { w: "majority" } }
    );

    if (res.matchedCount !== 1) {
      return json(404, { error: "User not found for provided owner58" });
    }

    return json(200, { ok: true, recordedUi: Number(amountUi), txSig });
  } catch (e) {
    const message = e instanceof Error ? e.message : "record failed";
    return json(500, { error: message });
  }
}
