// lib/solanaActivity.ts
import "server-only";

/**
 * Required env:
 *  - HELIUS_API_KEY
 *  - NEXT_PUBLIC_USDC_MINT
 *
 * Optional:
 *  - HELIUS_NETWORK = mainnet-beta | devnet | testnet (default: mainnet-beta)
 *  - HELIUS_BASE_URL (default: https://api.helius.xyz)
 *  - USDC_DECIMALS (default: 6)
 */

const HELIUS_API_KEY = process.env.HELIUS_API_KEY!;
if (!HELIUS_API_KEY) throw new Error("Missing HELIUS_API_KEY");

const USDC_MINT = (process.env.NEXT_PUBLIC_USDC_MINT || "").trim();
if (!USDC_MINT) throw new Error("Missing NEXT_PUBLIC_USDC_MINT");

const USDC_DECIMALS = Number(process.env.USDC_DECIMALS ?? 6);
const HELIUS_BASE_URL = (
  process.env.HELIUS_BASE_URL || "https://api.helius.xyz"
).replace(/\/+$/, "");
const HELIUS_NETWORK = (process.env.HELIUS_NETWORK || "mainnet-beta") as
  | "mainnet-beta"
  | "devnet"
  | "testnet";

// ⬇️ Mark your escrow owner here (email transfer)
export const HAVEN_ESCROW_OWNER58 =
  "4Xu6nK8U6dAmC3vkHXeDNzmeetf3NbED7jdq16XJaHCa";

// Cache/backoff
const CACHE_TTL_MS = 10_000;
const BACKOFF_TRIES = 4;
const BACKOFF_BASE_MS = 300;

export type ActivityItem = {
  signature: string;
  blockTime: number | null;
  direction: "in" | "out"; // USDC direction
  amountUi: number; // USDC amount
  counterparty?: string | null; // USDC cp (if any)
  feeLamports?: number | null;

  // New:
  kind?: "transfer" | "swap" | "email";
  swapBoughtMint?: string; // when kind === "swap"
  swapBoughtAmountUi?: number; // when kind === "swap"
};

type CacheVal = { ts: number; items: ActivityItem[] };
const CACHE = new Map<string, CacheVal>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const looksRateLimited = (error: unknown): boolean => {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message)
      : "";
  return /429|Too Many Requests|rate limit/i.test(message);
};
async function withBackoff<T>(fn: () => Promise<T>) {
  let last: unknown;
  for (let i = 0; i < BACKOFF_TRIES; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < BACKOFF_TRIES - 1 && looksRateLimited(e)) {
        const wait =
          BACKOFF_BASE_MS * Math.pow(2, i) + Math.floor(Math.random() * 100);
        await sleep(wait);
        continue;
      }
      break;
    }
  }
  throw last ?? new Error("withBackoff failed");
}

const toNumber = (value: unknown): number => {
  const parsed = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toStringSafe = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toString" in value) {
    try {
      const result = (value as { toString: () => string }).toString();
      if (typeof result === "string") return result;
    } catch {
      /* ignore */
    }
  }
  return "";
};
function toUiAmount(
  tokenAmount: unknown,
  decimals?: unknown,
  fallbackDecimals = USDC_DECIMALS
): number {
  const d =
    Number.isFinite(Number(decimals)) && Number(decimals) !== 0
      ? Number(decimals)
      : fallbackDecimals;
  if (typeof tokenAmount === "number") return tokenAmount;
  const raw =
    typeof tokenAmount === "object" && tokenAmount != null
      ? toNumber(
          (tokenAmount as { amount?: unknown; value?: unknown }).amount ??
            (tokenAmount as { amount?: unknown; value?: unknown }).value
        )
      : toNumber(tokenAmount);
  return raw / Math.pow(10, d);
}

/** Parse token transfer array from various Helius shapes */
function extractAllTokenTransfers(o: Record<string, unknown>): unknown[] {
  const directTT: unknown[] = Array.isArray(o.tokenTransfers)
    ? (o.tokenTransfers as unknown[])
    : [];
  const events = o.events as Record<string, unknown> | undefined;
  const eventsTTUnknown =
    (events?.tokenTransfers as unknown) ??
    (events?.fungibleTokenTransfers as unknown) ??
    ((events as { splTransfers?: unknown[] })?.splTransfers as unknown) ??
    [];
  const eventsTT: unknown[] = Array.isArray(eventsTTUnknown)
    ? (eventsTTUnknown as unknown[])
    : [];
  return [...directTT, ...eventsTT];
}

function normalizeHeliusTxToActivity(
  owner58: string,
  tx: unknown
): ActivityItem[] {
  const o = (tx ?? {}) as Record<string, unknown>;
  const transaction = o.transaction as Record<string, unknown> | undefined;
  const signatures = Array.isArray(transaction?.signatures)
    ? (transaction!.signatures as unknown[])
    : [];
  const signature =
    (typeof o.signature === "string" && o.signature) ||
    (typeof signatures[0] === "string" ? (signatures[0] as string) : "");
  const blockTime: number | null =
    toNumber(o.timestamp) ||
    (typeof (o as { blockTime?: unknown }).blockTime === "number"
      ? ((o as { blockTime?: number }).blockTime as number)
      : null);

  // Fee (if available)
  const feeLamports: number | null = (() => {
    const feeCandidates = [
      toNumber((transaction as { fee?: unknown })?.fee),
      toNumber((o as { fee?: unknown })?.fee),
    ];
    const fee = feeCandidates.find((val) => Number.isFinite(val) && val !== 0);
    return Number.isFinite(fee) ? (fee as number) : null;
  })();

  const tts = extractAllTokenTransfers(o);

  // Compute USDC net delta + find a potential bought token in the same tx
  let usdcDelta = 0;
  let cpIn: string | undefined;
  let cpOut: string | undefined;

  type Xfer = {
    mint: string;
    from: string;
    to: string;
    ui: number;
    decimals?: number;
  };
  const parsed: Xfer[] = [];

  for (const t of tts) {
    const rec = (t ?? {}) as Record<string, unknown>;
    const mint =
      toStringSafe(
        rec.mint ??
          rec.tokenAddress ??
          rec.mintAddress ??
          (
            (rec as { token?: { mint?: unknown } }).token
              ? (rec as { token?: { mint?: unknown } }).token?.mint
              : undefined
          )
      ) || "";
    if (!mint) continue;

    const from = toStringSafe(
      rec.fromUserAccount ??
        rec.from ??
        (rec as { source?: unknown }).source
    );
    const to = toStringSafe(
      rec.toUserAccount ??
        rec.to ??
        (rec as { destination?: unknown }).destination
    );
    const amountField =
      (rec as { tokenAmount?: unknown }).tokenAmount ??
      rec.amount ??
      (rec as { rawTokenAmount?: unknown }).rawTokenAmount;
    const decimals =
      (rec as { decimals?: unknown }).decimals ??
      (typeof amountField === "object" && amountField != null
        ? (amountField as { decimals?: unknown }).decimals
        : undefined);

    const ui = toUiAmount(
      amountField,
      decimals,
      mint === USDC_MINT ? USDC_DECIMALS : undefined
    );
    if (!Number.isFinite(ui) || ui <= 0) continue;

    parsed.push({
      mint,
      from,
      to,
      ui,
      decimals: typeof decimals === "number" ? decimals : undefined,
    });

    if (mint === USDC_MINT) {
      if (to === owner58) {
        usdcDelta += ui;
        cpIn = cpIn || from || undefined;
      } else if (from === owner58) {
        usdcDelta -= ui;
        cpOut = cpOut || to || undefined;
      }
    }
  }

  if (usdcDelta === 0) return []; // We only list rows impacting USDC

  const direction = usdcDelta > 0 ? "in" : "out";
  const counterparty = usdcDelta > 0 ? cpIn ?? null : cpOut ?? null;

  // Detect swaps: owner spent USDC and received a non-USDC token in same tx
  let kind: ActivityItem["kind"] = "transfer";
  let swapBoughtMint: string | undefined;
  let swapBoughtAmountUi: number | undefined;

  if (direction === "out") {
    // Look for the largest non-USDC inbound to owner — usually the "bought" token
    let best: Xfer | undefined;
    for (const x of parsed) {
      if (x.mint === USDC_MINT) continue;
      if (x.to === owner58) {
        if (!best || x.ui > best.ui) best = x;
      }
    }
    if (best) {
      kind = "swap";
      swapBoughtMint = best.mint;
      swapBoughtAmountUi = best.ui;
    }
  }

  // Special-case Haven email transfer (escrow counterparty)
  if (counterparty && counterparty === HAVEN_ESCROW_OWNER58) {
    kind = "email";
  }

  return [
    {
      signature,
      blockTime,
      direction,
      amountUi: Math.abs(usdcDelta),
      counterparty: counterparty ?? null,
      feeLamports,
      kind,
      ...(kind === "swap" ? { swapBoughtMint, swapBoughtAmountUi } : undefined),
    },
  ];
}

export async function getUsdcActivityForOwner(
  owner58: string,
  opts?: { limit?: number; before?: string }
): Promise<ActivityItem[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 30, 1), 100);
  const before = opts?.before;

  const ck = `${owner58}|${before || ""}|${limit}|${HELIUS_NETWORK}`;
  const cached = CACHE.get(ck);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.items;

  const base = `${HELIUS_BASE_URL}/v0/addresses/${encodeURIComponent(
    owner58
  )}/transactions`;
  const qs = new URLSearchParams({
    "api-key": HELIUS_API_KEY,
    network: HELIUS_NETWORK,
    type: "TRANSFER",
    limit: String(limit),
  });
  if (before) qs.set("before", before);

  const url = `${base}?${qs.toString()}`;
  const raw = await withBackoff(async () => {
    const r = await fetch(url, { method: "GET", next: { revalidate: 0 } });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`Helius ${r.status}: ${text || r.statusText}`);
    }
    const j = (await r.json()) as unknown;
    return Array.isArray(j) ? (j as unknown[]) : [];
  });

  const items: ActivityItem[] = [];
  for (const tx of raw) {
    const rows = normalizeHeliusTxToActivity(owner58, tx);
    if (rows.length) items.push(...rows);
  }

  CACHE.set(ck, { ts: Date.now(), items });
  return items;
}
