// lib/tokens.ts
export type Cluster = "mainnet" | "devnet";

export type TokenCategory = "Top 3" | "DeFi" | "Meme" | "Stocks";

export type TokenMeta = {
  name: string;
  symbol: string;
  id?: string;
  logo: string;
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
    logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
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
    logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh/logo.png",
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
    logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png",
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
    logo: "https://assets.coingecko.com/coins/images/66695/standard/Ticker_SPX__Company_Name_SP500__size_200x200_2x.png?1750266819",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
      // devnet: "<devnet-soBTC-mint>",
    },
  },
  {
    name: "Tesla",
    symbol: "TSLA",
    id: "tslax",
    logo: "https://assets.coingecko.com/coins/images/55638/standard/Ticker_TSLA__Company_Name_Tesla_Inc.__size_200x200_2x.png?1746863299",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
      // devnet: "<devnet-soBTC-mint>",
    },
  },
  {
    name: "Nividia",
    symbol: "NVDA",
    id: "nvdax",
    logo: "https://assets.coingecko.com/coins/images/55633/standard/Ticker_NVDA__Company_Name_NVIDIA_Corp__size_200x200_2x.png?1746862704",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
      // devnet: "<devnet-soBTC-mint>",
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
