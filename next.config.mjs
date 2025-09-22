/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep Mongoose external; bundle Solana libs (Turbopack-friendly)
  serverExternalPackages: ["mongoose"],
  transpilePackages: [
    "@solana/spl-token",
    "@solana/web3.js",
    "@mrgnlabs/marginfi-client-v2",
    "@mrgnlabs/mrgn-common",
  ],

  // Trim the oversized serverless function (route handler)
  // NOTE: keys are globs relative to project root; no leading slash.
  outputFileTracingExcludes: {
    // App Router API route
    "app/api/email-claims/claim/route": [
      "node_modules/@next/swc-*/**",
      "node_modules/lightningcss-*/**",
      "node_modules/@img/**",
      "node_modules/sharp/**",
      "node_modules/@napi-rs/**",
      "node_modules/typescript/**",
      "node_modules/eslint/**",
      "node_modules/@typescript-eslint/**",
      "node_modules/axe-core/**",
      "node_modules/@heroicons/**",
      "node_modules/react-icons/**",
      "node_modules/lucide-react/**",
      "node_modules/@reown/**",
      "node_modules/@phosphor-icons/**",
      "node_modules/caniuse-lite/**",
    ],
    // Safety if you later add a pages/api fallback
    "api/email-claims/claim": [
      "node_modules/@next/swc-*/**",
      "node_modules/lightningcss-*/**",
      "node_modules/@img/**",
      "node_modules/sharp/**",
      "node_modules/@napi-rs/**",
      "node_modules/typescript/**",
      "node_modules/eslint/**",
      "node_modules/@typescript-eslint/**",
      "node_modules/axe-core/**",
      "node_modules/@heroicons/**",
      "node_modules/react-icons/**",
      "node_modules/lucide-react/**",
      "node_modules/@reown/**",
      "node_modules/@phosphor-icons/**",
      "node_modules/caniuse-lite/**",
    ],
  },

  // Small server-side savings
  experimental: {
    serverMinification: true,
  },

  // Avoid pulling sharp/libvips into serverless bundles
  images: { disableStaticImages: true },
};

export default nextConfig;
