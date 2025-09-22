/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Avoid bundling next/image runtime (cuts sharp/libvips)
  images: { unoptimized: true },

  // Tell Next not to bundle these into serverless funcs
  serverExternalPackages: [
    "mongoose",
    "bson",

    // Native / huge things we never need inside this API route
    "@next/swc-linux-x64-gnu",
    "@next/swc-linux-x64-musl",
    "@img/sharp-libvips-linux-x64",
    "@img/sharp-libvips-linuxmusl-x64",
    "lightningcss-linux-x64-gnu",
    "lightningcss-linux-x64-musl",

    // Big UI libs (safe to treat external on the server)
    "react-icons",
    "@heroicons/react",
    "@phosphor-icons/webcomponents",

    // Dev-only hogs that sometimes get traced
    "eslint",
    "typescript",
  ],

  // You already had these; keep if you need them
  transpilePackages: [
    "@solana/web3.js",
    "@solana/spl-token",
    "@mrgnlabs/marginfi-client-v2",
    "@mrgnlabs/mrgn-common",
  ],

  // CRITICAL: must be top-level (not under `experimental`)
  outputFileTracingExcludes: {
    "*": [
      "node_modules/@next/swc-*/**",
      "node_modules/@img/**",
      "node_modules/lightningcss-*/**",
      "node_modules/react-icons/**",
      "node_modules/@heroicons/**",
      "node_modules/@phosphor-icons/**",
      "node_modules/caniuse-lite/**",
      "node_modules/typescript/**",
      "node_modules/eslint/**",
    ],
  },

  // Extra safety: make sure webpack treats these as externals on the server
  webpack: (config, { isServer }) => {
    if (isServer) {
      const extra = [
        "@next/swc-linux-x64-gnu",
        "@next/swc-linux-x64-musl",
        "@img/sharp-libvips-linux-x64",
        "@img/sharp-libvips-linuxmusl-x64",
        "lightningcss-linux-x64-gnu",
        "lightningcss-linux-x64-musl",
        "react-icons",
        "@heroicons/react",
        "@phosphor-icons/webcomponents",
        "eslint",
        "typescript",
      ];
      config.externals = [...(config.externals ?? []), ...extra];
    }
    return config;
  },
};

export default nextConfig;
