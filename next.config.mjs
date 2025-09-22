/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["mongoose"],
  transpilePackages: [
    "@solana/spl-token",
    "@solana/web3.js",
    "@mrgnlabs/marginfi-client-v2",
    "@mrgnlabs/mrgn-common",
  ],

  // ✅ The key is "*" so it applies even if Next changes the internal route id
  outputFileTracingExcludes: {
    "*": [
      // Enormous native/compiler bits we never need inside serverless zips
      "node_modules/@next/swc-*/**",
      "node_modules/next/dist/compiled/@next/swc/**",
      "node_modules/next/dist/compiled/edge-runtime/**",
      "node_modules/lightningcss-*/**",
      "node_modules/@img/**",
      "node_modules/sharp/**",
      "node_modules/@napi-rs/**",

      // Tooling that's irrelevant at runtime
      "node_modules/typescript/**",
      "node_modules/eslint/**",
      "node_modules/@typescript-eslint/**",
      "node_modules/axe-core/**",

      // UI icon/font packs that sometimes get pulled into server traces
      "node_modules/@heroicons/**",
      "node_modules/react-icons/**",
      "node_modules/lucide-react/**",
      "node_modules/@phosphor-icons/**",

      // Bulky data lists
      "node_modules/caniuse-lite/**",
    ],
  },

  experimental: {
    serverMinification: true, // small server-side wins
  },

  images: { disableStaticImages: true }, // prevents sharp/libvips from being traced
};

export default nextConfig;
