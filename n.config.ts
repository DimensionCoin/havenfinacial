// next.config.ts
import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self' https://*.stripe.com",
  "frame-ancestors 'self'",
  "script-src 'self' 'unsafe-inline' https://js.stripe.com https://crypto-js.stripe.com",
  "worker-src 'self' blob:",
  "connect-src 'self' https://api.stripe.com https://m.stripe.network https://q.stripe.com https://js.stripe.com https://crypto-js.stripe.com",
  "frame-src 'self' https://js.stripe.com https://crypto-js.stripe.com https://*.stripe.com",
  "img-src 'self' data: blob: https://*.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  isProd ? "upgrade-insecure-requests" : null,
]
  .filter(Boolean)
  .join("; ");

const nextConfig: NextConfig = {
  // ✅ keep these — they’re valid in current Next
  serverExternalPackages: ["mongoose"],
  transpilePackages: [
    "@solana/spl-token",
    "@solana/web3.js",
    "@mrgnlabs/marginfi-client-v2",
    "@mrgnlabs/mrgn-common",
  ],
  images: { unoptimized: true },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          {
            key: "Permissions-Policy",
            value: 'payment=(self "https://*.stripe.com")',
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
};

export default nextConfig;
