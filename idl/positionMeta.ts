// /idl/positionMeta.ts
export interface PositionMeta {
  symbol: string;
  displayName: string;
  logo: string;
  priceId: string;
}

export const POSITION_META: Record<string, PositionMeta> = {
  // SOL custody (you’ll see this printed in your console)
  "7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz": {
    symbol: "SOL",
    displayName: "Solana Perp (SOL/USDC)",
    logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
    priceId:
      "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  },

  // BTC custody
  "5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm": {
    symbol: "BTC",
    displayName: "Bitcoin Perp (BTC/USDC)",
    logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh/logo.png",
    priceId:
      "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  },

  // ETH custody
  AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn: {
    symbol: "ETH",
    displayName: "Ethereum Perp (ETH/USDC)",
    logo: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png",
    priceId:
      "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  },
};
