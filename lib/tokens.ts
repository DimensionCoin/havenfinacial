// lib/tokens.ts
export type Cluster = "mainnet" | "devnet";

export type TokenCategory = "Top 3" | "DeFi" | "Meme" | "Stocks";

export type TokenMeta = {
  name: string;
  symbol: string;
  id?: string;
  logo: string; // points to /public
  category?: TokenCategory;
  decimals?: number;
  mints: Partial<Record<Cluster, string>>;
};

export function getCluster(): Cluster {
  const raw = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "").toLowerCase();
  if (raw.includes("dev")) return "devnet";
  return "mainnet";
}

export const WSOL_MINT = "So11111111111111111111111111111111111111112";

export const TOKENS: TokenMeta[] = [
  {
    name: "Solana",
    symbol: "SOL",
    id: "sol",
    logo: "/logos/sol.png",
    category: "Top 3",
    decimals: 9,
    mints: {
      mainnet: WSOL_MINT,
      devnet: WSOL_MINT,
    },
  },
  {
    name: "Bitcoin",
    symbol: "BTC",
    id: "btc",
    logo: "/logos/btc.png",
    category: "Top 3",
    decimals: 8,
    mints: {
      mainnet: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
      // devnet: "<devnet-soBTC-mint>",
    },
  },
  {
    name: "Ethereum",
    symbol: "ETH",
    id: "eth",
    logo: "/logos/eth.png",
    category: "Top 3",
    decimals: 8,
    mints: {
      mainnet: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
      // devnet: "<devnet-soETH-mint>",
    },
  },
  {
    name: "S&P500",
    symbol: "SPY",
    id: "spyx",
    logo: "/logos/spx.webp",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
      // devnet: "<devnet-SPY-mint>",
    },
  },
  {
    name: "Tesla",
    symbol: "TSLA",
    id: "tslax",
    logo: "/logos/tsla.webp",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
      // devnet: "<devnet-TSLA-mint>",
    },
  },
  {
    name: "Nvidia",
    symbol: "NVDA",
    id: "nvdax",
    logo: "/logos/nvda.webp",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
      // devnet: "<devnet-NVDA-mint>",
    },
  },
  {
    name: "NasDaq",
    symbol: "QQQ",
    id: "qqqx",
    logo: "/logos/qqq.png",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
      // devnet: "<devnet-NVDA-mint>",
    },
  },
  {
    name: "Apple",
    symbol: "AAPL",
    id: "aaplx",
    logo: "/logos/aapl.webp",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
      // devnet: "<devnet-NVDA-mint>",
    },
  },
  {
    name: "Alphabet",
    symbol: "GOOGL",
    id: "googlx",
    logo: "/logos/google.webp",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
      // devnet: "<devnet-NVDA-mint>",
    },
  },
  {
    name: "Raydium",
    symbol: "RAY",
    id: "ray",
    logo: "/logos/ray.jpg",
    category: "DeFi",
    decimals: 8,
    mints: {
      mainnet: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
      // devnet: "<devnet-SPY-mint>",
    },
  },
  {
    name: "Jupiter",
    symbol: "JUP",
    id: "jup",
    logo: "/logos/jup.webp",
    category: "DeFi",
    decimals: 8,
    mints: {
      mainnet: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
      // devnet: "<devnet-SPY-mint>",
    },
  },
  {
    name: "Kamino",
    symbol: "KMNO",
    id: "kmno",
    logo: "/logos/kmno.jpg",
    category: "DeFi",
    decimals: 8,
    mints: {
      mainnet: "KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS",
      // devnet: "<devnet-SPY-mint>",
    },
  },
];

export const CRYPTO_FLAT_FEE_USDC_UI: number = (() => {
  const raw = process.env.NEXT_PUBLIC_CRYPTO_FEE_UI ?? "0.20";
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0.2;
})();

export function getMintFor(
  token: Pick<TokenMeta, "mints">,
  cluster: Cluster = getCluster()
): string | null {
  return token.mints[cluster] ?? null;
}

export function tokensForCluster(cluster: Cluster = getCluster()): TokenMeta[] {
  return TOKENS.filter((t) => !!t.mints[cluster]);
}

export function findTokenBySymbol(symbol: string): TokenMeta | undefined {
  const s = symbol.trim().toUpperCase();
  return TOKENS.find((t) => t.symbol.toUpperCase() === s);
}

export function findTokenByMint(
  mint: string,
  cluster: Cluster = getCluster()
): TokenMeta | undefined {
  const m = mint.trim();
  return TOKENS.find((t) => t.mints[cluster] === m);
}

export function requireMintBySymbol(
  symbol: string,
  cluster: Cluster = getCluster()
): string {
  const t = findTokenBySymbol(symbol);
  if (!t) throw new Error(`Unknown token symbol: ${symbol}`);
  const mint = t.mints[cluster];
  if (!mint)
    throw new Error(
      `Token ${symbol} is not enabled on ${cluster}. Add its mint in TOKENS[].mints.${cluster}.`
    );
  return mint;
}
