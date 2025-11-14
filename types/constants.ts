// types/constants.ts
import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";

/* ───────── RPC ───────── */

export const RPC_CONNECTION = new Connection(
  process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.mainnet-beta.solana.com",
  "confirmed"
);

/* ───────── Program IDs / PDAs ───────── */

export const DOVES_PROGRAM_ID = new PublicKey(
  "DoVEsk76QybCEHQGzkvYPWLQu9gzNoZZZt3TPiL597e"
);

export const JUPITER_PERPETUALS_PROGRAM_ID = new PublicKey(
  "PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu"
);

/**
 * “perpetuals” config account (the main global state account)
 * This is the one showing up as the `perpetuals` account
 * in the working JUP tx you pasted.
 */
export const JUPITER_PERPETUALS_CONFIG_PUBKEY = new PublicKey(
  "H4ND9aYttUVLFmNypZqLjZ52FYiGvdEB45GmwNoKEjTj"
);

/**
 * Event authority PDA – this is the one Jupiter’s program
 * uses as the event authority (also seen in your tx’s accounts).
 */
export const JUPITER_PERPETUALS_EVENT_AUTHORITY_PUBKEY = new PublicKey(
  "37hJBDnntwqhGbK7L6M1bLyvccj4u55CCUiLPdYkiqBN"
);

// JLP pool + mint from Jupiter docs
export const JLP_POOL_ACCOUNT_PUBKEY = new PublicKey(
  "5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq"
);

export const JLP_MINT_PUBKEY = new PublicKey(
  "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4"
);

/* ───────── Custodies / assets ───────── */

export enum CUSTODY_PUBKEY {
  SOL = "7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz",
  ETH = "AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn",
  BTC = "5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm",
  USDC = "G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa",
  USDT = "4vkNeXiYEUizLdrpdPS1eC2mccyM4NUPRtERrk6ZETkk",
}

export const CUSTODY_PUBKEYS = [
  new PublicKey(CUSTODY_PUBKEY.SOL),
  new PublicKey(CUSTODY_PUBKEY.BTC),
  new PublicKey(CUSTODY_PUBKEY.ETH),
  new PublicKey(CUSTODY_PUBKEY.USDC),
  new PublicKey(CUSTODY_PUBKEY.USDT),
];

/* ───────── USDC & math constants ───────── */

export const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ||
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);

export const USDC_DECIMALS = 6;
export const BPS_POWER = new BN(10_000);
export const DBPS_POWER = new BN(100_000);
export const RATE_POWER = new BN(1_000_000_000);
export const DEBT_POWER = RATE_POWER;
export const BORROW_SIZE_PRECISION = new BN(1000);
export const JLP_DECIMALS = 6;

/* ───────── Associated Token Program ───────── */

export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

