// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  // 👇 keeps Node-only deps out of the serverless bundle
  experimental: {
    outputFileTracingExcludes: {
      "*": [
        // SWC native binaries for multiple linux targets
        "node_modules/@next/swc-*",
        // Next’s internal dist (huge, not needed inside functions)
        "node_modules/next/dist/**",
        // TypeScript compiler (dev-only)
        "node_modules/typescript/**",
        // sharp prebuilt binaries (use Vercel’s image infra instead)
        "node_modules/@img/**",
        // misc heavy icon/webcomponent bundles that sometimes get traced
        "node_modules/@phosphor-icons/**",
        "node_modules/react-icons/**",
      ],
    },
  },

  // Let these resolve at runtime instead of bundling them
  serverExternalPackages: ["mongoose"],

  // Make sure these packages are transpiled for the client (safe to keep)
  transpilePackages: [
    "@solana/spl-token",
    "@solana/web3.js",
    "@mrgnlabs/marginfi-client-v2",
    "@mrgnlabs/mrgn-common",
  ],

  // Avoid bundling sharp inside serverless functions
  images: { unoptimized: true },

  // (Optional) keep deploys from failing on lint/type issues
  // eslint: { ignoreDuringBuilds: true },
  // typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
