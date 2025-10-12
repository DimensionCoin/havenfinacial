// lib/tokens.ts

/* -------------------------------- Types -------------------------------- */

export type Cluster = "mainnet" | "devnet";
export type TokenCategory = "Top 3" | "DeFi" | "Meme" | "Stocks";

/** TradingView mapping for embedding charts */
export type TradingViewMap = {
  /** Full TradingView 'proName' like 'BINANCE:BTCUSDT' or 'NASDAQ:AAPL' */
  proName: string;
  /** Display-friendly pair, e.g. 'BTC/USDT' or 'AAPL' */
  short?: string;
  /** Exchange identifier TradingView uses (BINANCE, COINBASE, NASDAQ, AMEX, etc.) */
  exchange: string;
  /** Base/quote for clarity when crypto */
  base?: string;
  quote?: string;
  /** Optional default interval for your widget ('1', '5', '15', '60', '240', 'D', etc.) */
  defaultInterval?: string;
};

export type TokenMeta = {
  name: string;
  symbol: string;
  id?: string;
  logo: string; // points to /public
  category?: TokenCategory;
  decimals?: number;
  mints: Partial<Record<Cluster, string>>;
  /** NEW: TradingView mapping you’ll use to render charts */
  tv: TradingViewMap;
};

/* ------------------------------- Env/Utils ----------------------------- */

export function getCluster(): Cluster {
  const raw = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "").toLowerCase();
  if (raw.includes("dev")) return "devnet";
  return "mainnet";
}

export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/** UI-config flat fee shown to user when swapping/buying */
export const CRYPTO_FLAT_FEE_USDC_UI: number = (() => {
  const raw = process.env.NEXT_PUBLIC_CRYPTO_FEE_UI ?? "0.20";
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0.2;
})();

/* ------------------------------- Catalog ------------------------------- */

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
    tv: {
      proName: "BINANCE:SOLUSDT",
      short: "SOL/USDT",
      exchange: "BINANCE",
      base: "SOL",
      quote: "USDT",
      defaultInterval: "60", // 1h
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
    tv: {
      proName: "BINANCE:BTCUSDT",
      short: "BTC/USDT",
      exchange: "BINANCE",
      base: "BTC",
      quote: "USDT",
      defaultInterval: "60", // 1h
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
    tv: {
      proName: "BINANCE:ETHUSDT",
      short: "ETH/USDT",
      exchange: "BINANCE",
      base: "ETH",
      quote: "USDT",
      defaultInterval: "60",
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
    tv: {
      proName: "AMEX:SPY", // TV uses AMEX prefix for NYSE Arca
      short: "SPY",
      exchange: "AMEX",
      defaultInterval: "60",
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
    tv: {
      proName: "NASDAQ:TSLA",
      short: "TSLA",
      exchange: "NASDAQ",
      defaultInterval: "60",
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
    tv: {
      proName: "NASDAQ:NVDA",
      short: "NVDA",
      exchange: "NASDAQ",
      defaultInterval: "60",
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
      // devnet: "<devnet-QQQ-mint>",
    },
    tv: {
      proName: "NASDAQ:QQQ",
      short: "QQQ",
      exchange: "NASDAQ",
      defaultInterval: "60",
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
      // devnet: "<devnet-AAPL-mint>",
    },
    tv: {
      proName: "NASDAQ:AAPL",
      short: "AAPL",
      exchange: "NASDAQ",
      defaultInterval: "60",
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
      // devnet: "<devnet-GOOGL-mint>",
    },
    tv: {
      proName: "NASDAQ:GOOGL",
      short: "GOOGL",
      exchange: "NASDAQ",
      defaultInterval: "60",
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
      // devnet: "<devnet-RAY-mint>",
    },
    tv: {
      proName: "BINANCE:RAYUSDT",
      short: "RAY/USDT",
      exchange: "BINANCE",
      base: "RAY",
      quote: "USDT",
      defaultInterval: "60",
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
      // devnet: "<devnet-JUP-mint>",
    },
    tv: {
      proName: "BINANCE:JUPUSDT",
      short: "JUP/USDT",
      exchange: "BINANCE",
      base: "JUP",
      quote: "USDT",
      defaultInterval: "60",
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
      // devnet: "<devnet-KMNO-mint>",
    },
    tv: {
      proName: "BYBIT:KMNOUSDT", // change if you prefer another listing supported by TV
      short: "KMNO/USDT",
      exchange: "BYBIT",
      base: "KMNO",
      quote: "USDT",
      defaultInterval: "60",
    },
  },
  {
    name: "Bonk",
    symbol: "BONK",
    id: "bonk",
    logo: "/logos/bonk.jpg",
    category: "Meme",
    decimals: 8,
    mints: {
      mainnet: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      // devnet: "<devnet-BONK-mint>",
    },
    tv: {
      proName: "BINANCE:BONKUSDT",
      short: "BONK/USDT",
      exchange: "BINANCE",
      base: "BONK",
      quote: "USDT",
      defaultInterval: "60",
    },
  },
  {
    name: "Pump.fun",
    symbol: "PUMP",
    id: "pump",
    logo: "/logos/pump.jpg",
    category: "Meme",
    decimals: 8,
    mints: {
      mainnet: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn",
      // devnet: "<devnet-PUMP-mint>",
    },
    tv: {
      proName: "GATEIO:PUMPUSDT", // confirm your preferred supported exchange on TV
      short: "PUMP/USDT",
      exchange: "GATEIO",
      base: "PUMP",
      quote: "USDT",
      defaultInterval: "60",
    },
  },
  {
    name: "DogWifHat",
    symbol: "WIF",
    id: "wif",
    logo: "/logos/wif.jpg",
    category: "Meme",
    decimals: 8,
    mints: {
      mainnet: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
      // devnet: "<devnet-WIF-mint>",
    },
    tv: {
      proName: "BINANCE:WIFUSDT",
      short: "WIF/USDT",
      exchange: "BINANCE",
      base: "WIF",
      quote: "USDT",
      defaultInterval: "60",
    },
  },
  {
    name: "Meta",
    symbol: "META",
    id: "metax",
    logo: "/logos/meta.webp",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
      // devnet: "<devnet-META-mint>",
    },
    tv: {
      proName: "NASDAQ:META",
      short: "META",
      exchange: "NASDAQ",
      defaultInterval: "60",
    },
  },
  {
    name: "Coinbase",
    symbol: "COIN",
    id: "coinx",
    logo: "/logos/coin.webp",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu",
      // devnet: "<devnet-COIN-mint>",
    },
    tv: {
      proName: "NASDAQ:COIN",
      short: "COIN",
      exchange: "NASDAQ",
      defaultInterval: "60",
    },
  },
  {
    name: "Robinhood",
    symbol: "HOOD",
    id: "hoodx",
    logo: "/logos/hood.webp",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg",
      // devnet: "<devnet-HOOD-mint>",
    },
    tv: {
      proName: "NASDAQ:HOOD",
      short: "HOOD",
      exchange: "NASDAQ",
      defaultInterval: "60",
    },
  },
  {
    name: "Amazon",
    symbol: "AMZN",
    id: "amznx",
    logo: "/logos/amzn.webp",
    category: "Stocks",
    decimals: 8,
    mints: {
      mainnet: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg",
      // devnet: "<devnet-AMZN-mint>",
    },
    tv: {
      proName: "NASDAQ:AMZN",
      short: "AMZN",
      exchange: "NASDAQ",
      defaultInterval: "60",
    },
  },
];

/* ------------------------------- Finders -------------------------------- */

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
