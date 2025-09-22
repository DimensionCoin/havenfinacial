// lib/solana.ts
import type { SolanaCaip2ChainId } from "@privy-io/server-auth";

type Cluster = "mainnet-beta" | "testnet" | "devnet";

// Official CAIP-2 ids for Solana clusters.
// NOTE: devnet string includes the trailing "i" after Yq6.
const CAIP2_BY_CLUSTER: Record<Cluster, SolanaCaip2ChainId> = {
  "mainnet-beta": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  testnet: "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z",
  devnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
};

function resolveCluster(): Cluster {
  const c = (process.env.SOLANA_CLUSTER ||
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER ||
    "devnet") as Cluster;

  return c === "mainnet-beta" || c === "testnet" || c === "devnet"
    ? c
    : "devnet";
}

/** CAIP-2 chain id for the configured Solana cluster (used by Privy). */
export function getCaip2(): SolanaCaip2ChainId {
  return CAIP2_BY_CLUSTER[resolveCluster()];
}
