import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    serverExternalPackages: ["mongoose"],
  transpilePackages: [
    "@solana/spl-token",
    "@solana/web3.js",
    "@mrgnlabs/marginfi-client-v2",
    "@mrgnlabs/mrgn-common",
  ],
};

export default nextConfig;
