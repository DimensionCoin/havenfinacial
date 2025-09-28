// app/api/balance/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

import { connect } from "@/lib/db";
import User from "@/models/User";
import { requireUserIdFromHavenSession } from "@/lib/session-claims";

import {
  getCluster,
  tokensForCluster,
  getMintFor,
  type TokenMeta,
} from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ------------------------------ ENV / CONSTS ------------------------------ */

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC!;
if (!RPC) throw new Error("Missing NEXT_PUBLIC_SOLANA_RPC");

const JUP_PRICE_BASE =
  process.env.NEXT_PUBLIC_JUP_PRICE_BASE || "https://lite-api.jup.ag/price/v3";

// Any USDC mints we want to exclude from “invest” positions
const USDC_MINTS_ENV = [
  process.env.NEXT_PUBLIC_USDC_MINT,
  process.env.NEXT_PUBLIC_USDC_MAINNET_MINT,
  process.env.NEXT_PUBLIC_USDC_DEVNET_MINT,
  process.env.NEXT_PUBLIC_USDC_2022_MINT,
].filter(Boolean) as string[];

const DEFAULT_USDC_MINTS = ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"];
const EXCLUDED_MINTS = new Set([...DEFAULT_USDC_MINTS, ...USDC_MINTS_ENV]);

/* --------------------------------- UTILS --------------------------------- */

function jerr(status: number, error: string, extra?: unknown) {
  return NextResponse.json(
    extra ? { ok: false, error, extra } : { ok: false, error },
    { status }
  );
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchUsdPrices(mainnetMints: string[]) {
  if (!mainnetMints.length) return {} as Record<string, { usdPrice: number }>;
  const out: Record<string, { usdPrice: number }> = {};
  const batches = chunk([...new Set(mainnetMints)], 50);
  for (const ids of batches) {
    const url = `${JUP_PRICE_BASE}?ids=${ids.join(",")}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) continue;
    const j = (await r.json().catch(() => ({}))) as Record<
      string,
      { usdPrice: number }
    >;
    Object.assign(out, j || {});
  }
  return out;
}

/* ---------------------------------- GET ---------------------------------- */

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserIdFromHavenSession(req);

    await connect();
    const user = await User.findById(userId).lean();
    if (!user) return jerr(404, "User not found");

    const owner58 = user?.depositWallet?.address;
    if (!owner58) return jerr(400, "Deposit wallet not found");

    const owner = new PublicKey(owner58);
    const conn = new Connection(RPC, "confirmed");

    const cluster = getCluster(); // "mainnet" | "devnet"
    const supported = tokensForCluster(cluster);
    const byClusterMint = new Map<string, TokenMeta>();
    for (const t of supported) {
      const cm = getMintFor(t, cluster);
      if (cm) byClusterMint.set(cm, t);
    }

    // Pull both legacy and Token-2022 accounts
    const [std, v22] = await Promise.all([
      conn.getParsedTokenAccountsByOwner(owner, {
        programId: TOKEN_PROGRAM_ID,
      }),
      conn.getParsedTokenAccountsByOwner(owner, {
        programId: TOKEN_2022_PROGRAM_ID,
      }),
    ]);

    type Tot = { raw: bigint; decimals: number };
    const ZERO = BigInt(0);
    const totals = new Map<string, Tot>();

    type ParsedTokenInfo = {
      mint?: string;
      tokenAmount?: { amount?: string; decimals?: number };
    };

    const addAccounts = (
      resp: Awaited<ReturnType<typeof conn.getParsedTokenAccountsByOwner>>
    ) => {
      for (const { account } of resp.value) {
        const parsedInfo = (
          account.data as { parsed?: { info?: ParsedTokenInfo } }
        )?.parsed?.info;
        if (!parsedInfo?.mint) continue;

        const mint = parsedInfo.mint;
        // Ignore USDC and any unsupported token on this cluster
        if (EXCLUDED_MINTS.has(mint) || !byClusterMint.has(mint)) continue;

        const amtStr = parsedInfo.tokenAmount?.amount ?? "0";
        const decimals = Number(parsedInfo.tokenAmount?.decimals ?? 0);

        let raw = ZERO;
        try {
          raw = BigInt(amtStr);
        } catch {
          raw = ZERO;
        }
        if (raw <= ZERO) continue;

        const prev = totals.get(mint);
        if (!prev) totals.set(mint, { raw, decimals });
        else totals.set(mint, { raw: prev.raw + raw, decimals });
      }
    };

    addAccounts(std);
    addAccounts(v22);

    // If nothing held, return empty
    if (totals.size === 0) {
      return NextResponse.json(
        {
          ok: true,
          totalUsd: 0,
          positions: [],
          updatedAt: new Date().toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // Map to token metas and fetch prices (use MAINNET mint identifiers for pricing)
    const held = Array.from(totals.entries()).map(
      ([mint, { raw, decimals }]) => {
        const token = byClusterMint.get(mint)!; // present by construction
        return { token, mint, raw, decimals };
      }
    );

    const mainnetMints = held
      .map(({ token }) => getMintFor(token, "mainnet"))
      .filter((m): m is string => !!m);

    const prices = await fetchUsdPrices(mainnetMints);

    const positions = held.map(({ token, mint, raw, decimals }) => {
      const amountUi = Number(raw) / 10 ** decimals;
      const mainnetMint = getMintFor(token, "mainnet");
      const usdPrice = (mainnetMint && prices[mainnetMint]?.usdPrice) || 0;
      const valueUsd = amountUi * usdPrice;

      return {
        symbol: token.symbol,
        name: token.name,
        logo: token.logo,
        clusterMint: mint, // mint for current cluster
        mainnetMint: mainnetMint ?? null, // for reference/pricing
        amountUi,
        priceUsd: usdPrice,
        valueUsd,
      };
    });

    // Filter dust for neatness (optional)
    const filtered = positions.filter((p) => p.valueUsd >= 0.01);
    const totalUsd = filtered.reduce((s, r) => s + r.valueUsd, 0);

    return NextResponse.json(
      {
        ok: true,
        totalUsd,
        positions: filtered.sort((a, b) => b.valueUsd - a.valueUsd),
        updatedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = /unauthorized/i.test(msg) ? 401 : 500;
    return jerr(code, msg);
  }
}
