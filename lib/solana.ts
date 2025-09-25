// lib/solana.ts
import type { SolanaCaip2ChainId } from "@privy-io/server-auth";

/** Solana clusters we care about */
export type Cluster = "mainnet-beta" | "testnet" | "devnet";

/** CAIP-2 IDs for Solana clusters (what Privy expects) */
const CAIP2_BY_CLUSTER: Record<Cluster, SolanaCaip2ChainId> = {
  "mainnet-beta": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  testnet: "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z",
  devnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
};

/** Normalize env string → valid Cluster. Default to mainnet-beta in prod, devnet otherwise. */
export function getCluster(): Cluster {
  const raw =
    process.env.SOLANA_CLUSTER ??
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER ??
    (process.env.NODE_ENV === "production" ? "mainnet-beta" : "devnet");

  // Normalize common aliases
  if (raw === "mainnet") return "mainnet-beta";
  if (raw === "beta") return "mainnet-beta";

  if (raw === "mainnet-beta" || raw === "testnet" || raw === "devnet") {
    return raw;
  }
  // Fallback if someone sets something weird
  return "devnet";
}

/** CAIP-2 chain id for the configured cluster (feed this to Privy) */
export function getCaip2(): SolanaCaip2ChainId {
  return CAIP2_BY_CLUSTER[getCluster()];
}

/** Your RPC URL (same one the client should use for blockhashes) */
export function getRpcUrl(): string {
  const url = process.env.NEXT_PUBLIC_SOLANA_RPC ?? process.env.SOLANA_RPC;
  if (!url) {
    throw new Error(
      "Missing RPC URL. Set NEXT_PUBLIC_SOLANA_RPC (and keep it consistent across client & server)."
    );
  }
  return url;
}

/** Convenience flags */
export function isMainnet(): boolean {
  return getCluster() === "mainnet-beta";
}
export function isDevnet(): boolean {
  return getCluster() === "devnet";
}
export function isTestnet(): boolean {
  return getCluster() === "testnet";
}

/** Explorer helpers */
export function txExplorerUrl(signature: string): string {
  const cluster = getCluster();
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}
export function addressExplorerUrl(address: string): string {
  const cluster = getCluster();
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/address/${address}${suffix}`;
}
