/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // (Removed invalid experimental.turbopack flag; Turbopack is enabled via CLI)

  // Keep native deps external so they don’t get bundled
  serverExternalPackages: ["mongoose", "bson"],

  // You already had these; keep them
  transpilePackages: [
    "@solana/web3.js",
    "@solana/spl-token",
    "@mrgnlabs/marginfi-client-v2",
    "@mrgnlabs/mrgn-common",
  ],

  // IMPORTANT: this must be TOP-LEVEL, not under `experimental`
  outputFileTracingExcludes: {
    "*": [
      "node_modules/@next/swc-*/**",
      "node_modules/@img/**",
      "node_modules/lightningcss-*/**",
      "node_modules/react-icons/**",
      "node_modules/@phosphor-icons/**",
      "node_modules/@heroicons/**",
      "node_modules/eslint/**",
      "node_modules/typescript/**",
      "node_modules/@typescript-eslint/**",
      "node_modules/caniuse-lite/**",
      "node_modules/axe-core/**",
      "node_modules/libphonenumber-js/**",
      "node_modules/@tailwindcss/**",
    ],
  },
};

export default nextConfig;
