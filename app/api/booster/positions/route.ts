// app/api/booster/positions/route.ts
import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

import {
  JUPITER_PERPETUALS_PROGRAM_ID,
  JLP_POOL_ACCOUNT_PUBKEY,
  CUSTODY_PUBKEY,
} from "@/types/constants";

export const runtime = "nodejs";

// Shared RPC (you can swap to RPC_CONNECTION if you prefer)
const RPC = new Connection(
  process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com",
  "confirmed"
);

/* -------------------------------------------------------------------------- */
/*                               PDA DERIVATION                               */
/* -------------------------------------------------------------------------- */

// Side seed: 0=none, 1=long, 2=short – we only use 1/2.
type PerpSide = "long" | "short";

// Decoded side object (matches Anchor enum shape but uses safe object types)
type PerpsSideDecoded = {
  long?: Record<string, never>;
  short?: Record<string, never>;
  none?: Record<string, never>;
};

function generatePositionPda(args: {
  custody: PublicKey;
  collateralCustody: PublicKey;
  walletAddress: PublicKey;
  side: PerpSide;
}) {
  const { custody, collateralCustody, walletAddress, side } = args;

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

  return { position, bump };
}

/* -------------------------------------------------------------------------- */
/*                         POSITION ACCOUNT DECODING                          */
/* -------------------------------------------------------------------------- */

/**
 * Manual decoder for the on-chain `Position` account.
 *
 * Layout (from Jupiter docs):
 *   discriminator:        [0..8)
 *   owner:                [8..40)
 *   pool:                 [40..72)
 *   custody:              [72..104)
 *   collateralCustody:    [104..136)
 *   openTime (i64):       [136..144)
 *   updateTime (i64):     [144..152)
 *   side (u8):            [152..153)
 *   price (u64):          [153..161)
 *   sizeUsd (u64):        [161..169)
 *   collateralUsd (u64):  [169..177)
 *   realisedPnlUsd (i64): [177..185)
 *   cumulativeInterest (u128): [185..201)
 *   lockedAmount (u64):   [201..209)
 *   bump (u8):            [209..210)
 */
function decodePositionAccount(data: Buffer): {
  owner: PublicKey;
  pool: PublicKey;
  custody: PublicKey;
  collateralCustody: PublicKey;
  side: PerpsSideDecoded;
  price: BN;
  sizeUsd: BN;
  collateralUsd: BN;
} {
  if (data.length < 210) {
    throw new Error(`Position account too small: ${data.length} bytes`);
  }

  let offset = 0;

  // Skip discriminator
  offset += 8;

  const owner = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  // pool (we don't use it but need to advance cursor)
  const pool = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const custody = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const collateralCustody = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  // openTime + updateTime (two i64s)
  offset += 8; // openTime
  offset += 8; // updateTime

  const sideByte = data.readUInt8(offset);
  offset += 1;

  let side: PerpsSideDecoded = {};
  if (sideByte === 1) side = { long: {} };
  else if (sideByte === 2) side = { short: {} };
  else side = { none: {} };

  const price = new BN(data.subarray(offset, offset + 8), "le");
  offset += 8;

  const sizeUsd = new BN(data.subarray(offset, offset + 8), "le");
  offset += 8;

  const collateralUsd = new BN(data.subarray(offset, offset + 8), "le");
  offset += 8;

  // realisedPnlUsd (i64) – skip for now
  offset += 8;

  // cumulativeInterestSnapshot (u128) – skip
  offset += 16;

  // lockedAmount (u64) – skip
  offset += 8;

  // bump (u8) – skip
  // offset += 1;

  return {
    owner,
    pool,
    custody,
    collateralCustody,
    side,
    price,
    sizeUsd,
    collateralUsd,
  };
}

/* -------------------------------------------------------------------------- */
/*                                   ROUTE                                    */
/* -------------------------------------------------------------------------- */

export async function POST(req: Request) {
  try {
    const { ownerBase58 } = (await req.json()) as {
      ownerBase58?: string;
    };

    if (!ownerBase58) {
      return NextResponse.json(
        { error: "ownerBase58 is required" },
        { status: 400 }
      );
    }

    const ownerPk = new PublicKey(ownerBase58);

    // Custody pubkeys from your constants
    const SOL_CUSTODY = new PublicKey(CUSTODY_PUBKEY.SOL);
    const ETH_CUSTODY = new PublicKey(CUSTODY_PUBKEY.ETH);
    const BTC_CUSTODY = new PublicKey(CUSTODY_PUBKEY.BTC);
    const USDC_CUSTODY = new PublicKey(CUSTODY_PUBKEY.USDC);
    const USDT_CUSTODY = new PublicKey(CUSTODY_PUBKEY.USDT);

    // All 9 Jupiter position “slots”
    const combos: Array<{
      symbol: "SOL" | "ETH" | "BTC";
      side: PerpSide;
      custody: PublicKey;
      collateralCustody: PublicKey;
    }> = [
      // Longs
      {
        symbol: "SOL",
        side: "long",
        custody: SOL_CUSTODY,
        collateralCustody: SOL_CUSTODY,
      },
      {
        symbol: "ETH",
        side: "long",
        custody: ETH_CUSTODY,
        collateralCustody: ETH_CUSTODY,
      },
      {
        symbol: "BTC",
        side: "long",
        custody: BTC_CUSTODY,
        collateralCustody: BTC_CUSTODY,
      },

      // Shorts (USDC collateral)
      {
        symbol: "SOL",
        side: "short",
        custody: SOL_CUSTODY,
        collateralCustody: USDC_CUSTODY,
      },
      {
        symbol: "ETH",
        side: "short",
        custody: ETH_CUSTODY,
        collateralCustody: USDC_CUSTODY,
      },
      {
        symbol: "BTC",
        side: "short",
        custody: BTC_CUSTODY,
        collateralCustody: USDC_CUSTODY,
      },

      // Shorts (USDT collateral) – optional, but included for completeness
      {
        symbol: "SOL",
        side: "short",
        custody: SOL_CUSTODY,
        collateralCustody: USDT_CUSTODY,
      },
      {
        symbol: "ETH",
        side: "short",
        custody: ETH_CUSTODY,
        collateralCustody: USDT_CUSTODY,
      },
      {
        symbol: "BTC",
        side: "short",
        custody: BTC_CUSTODY,
        collateralCustody: USDT_CUSTODY,
      },
    ];

    // Derive PDAs for this owner
    const positionPDAs = combos.map(
      (c) =>
        generatePositionPda({
          custody: c.custody,
          collateralCustody: c.collateralCustody,
          walletAddress: ownerPk,
          side: c.side,
        }).position
    );

    const infos = await RPC.getMultipleAccountsInfo(positionPDAs, "confirmed");

    const zero = new BN(0);

    // Decode everything that exists & has sizeUsd > 0
    const openPositions = infos
      .map((info, idx) => {
        if (!info || !info.data) return null;

        try {
          const decoded = decodePositionAccount(info.data);

          if (!decoded.sizeUsd.gt(zero)) return null;
          if (decoded.owner.toBase58() !== ownerPk.toBase58()) {
            // Should always match, but be safe
            return null;
          }

          const combo = combos[idx];

          return {
            publicKey: positionPDAs[idx].toBase58(),
            symbol: combo.symbol,
            side: combo.side,
            account: decoded,
          };
        } catch (e) {
          console.error(
            "[/api/booster/positions] decode error for",
            positionPDAs[idx].toBase58(),
            e
          );
          return null;
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    // Serialize BN/PublicKey → JSON-safe strings for frontend
    const jsonPositions = openPositions.map((p) => ({
      publicKey: p.publicKey,
      symbol: p.symbol,
      side: p.side,
      account: {
        owner: p.account.owner.toBase58(),
        custody: p.account.custody.toBase58(),
        collateralCustody: p.account.collateralCustody.toBase58(),
        price: p.account.price.toString(),
        collateralUsd: p.account.collateralUsd.toString(),
        sizeUsd: p.account.sizeUsd.toString(),
        side: p.account.side,
      },
    }));

    return NextResponse.json({ positions: jsonPositions }, { status: 200 });
  } catch (e) {
    console.error("[/api/booster/positions] error", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: msg || "Failed to fetch positions" },
      { status: 500 }
    );
  }
}
