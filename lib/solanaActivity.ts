// lib/solanaActivity.ts
import "server-only";

const HELIUS_API_KEY = process.env.HELIUS_API_KEY!;
if (!HELIUS_API_KEY) throw new Error("Missing HELIUS_API_KEY");

const USDC_MINT = (process.env.NEXT_PUBLIC_USDC_MINT || "").trim();
if (!USDC_MINT) throw new Error("Missing NEXT_PUBLIC_USDC_MINT");

// You can tweak these if needed
const CACHE_TTL_MS = 10_000; // 10s
const BACKOFF_TRIES = 4;
const BACKOFF_BASE_MS = 300;

export type ActivityItem = {
  signature: string;
  blockTime: number | null; // epoch seconds
  direction: "in" | "out";
  amountUi: number; // USDC
  counterparty?: string | null;
  feeLamports?: number | null;
};

// ---- tiny in-memory cache to soften reloads ----
type CacheVal = { ts: number; items: ActivityItem[] };
const CACHE = new Map<string, CacheVal>();

/** Robust backoff for 429s / transient network errors. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function looksRateLimited(e: unknown) {
  const m = (() => {
    if (typeof e === "string") return e;
    if (e instanceof Error) return e.message;
    if (e && typeof e === "object") {
      const rec = e as Record<string, unknown>;
      if (typeof rec.message === "string") return rec.message;
      const ts = rec.toString;
      if (typeof ts === "function") return ts.call(e);
    }
    return "";
  })();
  return /429|Too Many Requests|rate limit/i.test(String(m));
}
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

/** Defensive helpers because Helius fields can differ slightly across versions. */
function n(v: unknown): number {
  const x = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
}
function toUiAmount(tokenAmount: unknown, decimals?: unknown): number {
  // Some responses already give a float count; some give integer raw units.
  const d = Number.isFinite(Number(decimals)) ? Number(decimals) : 6;
  if (typeof tokenAmount === "number") return tokenAmount; // already UI
  const raw = n(tokenAmount);
  return raw / Math.pow(10, d);
}

/** Normalize a single Helius tx into a delta for `owner58` if it includes USDC transfers. */
function normalizeHeliusTxToActivity(owner58: string, tx: unknown): ActivityItem[] {
  const o = (tx ?? {}) as Record<string, unknown>;
  const transaction = o.transaction as Record<string, unknown> | undefined;
  const signatures = Array.isArray(transaction?.signatures)
    ? (transaction!.signatures as unknown[])
    : [];
  const sig =
    (typeof o.signature === "string" && o.signature) ||
    (typeof signatures[0] === "string" ? (signatures[0] as string) : "");
  const ts: number | null = n(o.timestamp) || null;
  const feeLamports: number | null = Number.isFinite(n(o.fee))
    ? n(o.fee)
    : null;

  // Try multiple shapes where token transfers may live.
  const directTT: unknown[] = Array.isArray(o.tokenTransfers)
    ? (o.tokenTransfers as unknown[])
    : [];
  const events = o.events as Record<string, unknown> | undefined;
  const eventsTTUnknown =
    (events?.tokenTransfers as unknown) ??
    (events?.fungibleTokenTransfers as unknown) ??
    (events?.splTransfers as unknown) ??
    [];
  const eventsTT: unknown[] = Array.isArray(eventsTTUnknown)
    ? (eventsTTUnknown as unknown[])
    : [];
  const tts: unknown[] = [...directTT, ...eventsTT];

  // Filter to USDC transfers only
  const usdc = tts.filter((t) => {
    const rec = (t ?? {}) as Record<string, unknown>;
    const mint = (
      (rec.mint as unknown) ??
      (rec.tokenAddress as unknown) ??
      (rec.mintAddress as unknown) ??
      ""
    )?.toString?.() ?? "";
    return mint === USDC_MINT;
  });
  if (usdc.length === 0) return [];

  // Compute net delta for this owner across all USDC transfers in this tx
  let delta = 0;
  let cpIn: string | undefined;
  let cpOut: string | undefined;

  for (const t of usdc) {
    const rec = (t ?? {}) as Record<string, unknown>;
    const from = ((rec.fromUserAccount as unknown) ?? rec.from ?? "").toString();
    const to = ((rec.toUserAccount as unknown) ?? rec.to ?? "").toString();
    const ui = toUiAmount(
      (rec.tokenAmount as unknown) ?? rec.amount ?? rec.rawTokenAmount,
      rec.decimals
    );

    if (to === owner58) {
      delta += ui;
      cpIn = cpIn || from || undefined;
    } else if (from === owner58) {
      delta -= ui;
      cpOut = cpOut || to || undefined;
    }
  }

  if (delta === 0) return [];

  return [
    {
      signature: sig,
      blockTime: ts,
      direction: delta > 0 ? "in" : "out",
      amountUi: Math.abs(delta),
      counterparty: delta > 0 ? cpIn ?? null : cpOut ?? null,
      feeLamports,
    },
  ];
}

/**
 * Fetch recent USDC activity for an owner (wallet) using Helius Enhanced Transactions.
 * Uses `/v0/addresses/{address}/transactions?type=TRANSFER` and normalizes to simple rows.
 */
export async function getUsdcActivityForOwner(
  owner58: string,
  opts?: { limit?: number; before?: string }
): Promise<ActivityItem[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 30, 1), 100);
  const before = opts?.before;

  // Cache key
  const ck = `${owner58}|${before || ""}|${limit}`;
  const cached = CACHE.get(ck);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.items;

  const base = `https://api-devnet.helius.xyz/v0/addresses/${encodeURIComponent(
    owner58
  )}/transactions`;
  const qs = new URLSearchParams({
    "api-key": HELIUS_API_KEY,
    type: "TRANSFER", // narrower set; includes SPL token transfers
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

  // Already newest→oldest from Helius. Keep as-is.
  CACHE.set(ck, { ts: Date.now(), items });
  return items;
}
