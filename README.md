# Haven Financial Web App

A Next.js 15 application that powers Haven's consumer dashboard: onboarding, wallet management, savings flows, and on-chain activity tracking for Solana accounts.

## Prerequisites

- **Node.js** 20 or newer (recommended: install via [nvm](https://github.com/nvm-sh/nvm))
- **npm** 10+ (bundled with modern Node installations)
- Access to required third-party services (MongoDB, Privy, Helius, Marginfi, Resend, etc.)

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Create your environment file**
   - Sign up for the required services if you have not already:
     - [Privy dashboard](https://dashboard.privy.io/) — create an app to obtain the client ID, server secret, wallet auth keys, and fee payer wallet ID.
     - [Resend](https://resend.com/) — configure a verified sending domain to get an API key and sender email.
   - Copy the template below into `.env` (or create `.env.local` to keep secrets outside version control) and replace each placeholder with real credentials.

   ```dotenv
   # Database
   MONGODB_URL=mongodb+srv://<username>:<password>@cluster.mongodb.net/<db-name>

   # Privy authentication (client + server)
   NEXT_PUBLIC_PRIVY_APP_ID=<privy-app-id>
   PRIVY_APP_ID=<privy-app-id>
   PRIVY_SECRET_KEY=<privy-server-secret>
   PRIVY_AUTH_PRIVATE_KEY_B64=<privy-wallet-auth-private-key-b64>
   PRIVY_AUTH_KEY_ID=<privy-auth-key-id>

   # Haven auth (JWT + signing keys)
   HAVEN_AUTH_ID=<haven-auth-id>
   HAVEN_AUTH_PUBLIC_KEY=<base64-public-key>
   JWT_SECRET=<random-64-char-secret>

   # Solana / RPC configuration
   NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta
   SOLANA_CLUSTER=mainnet-beta
   NEXT_PUBLIC_SOLANA_RPC=https://mainnet.helius-rpc.com/?api-key=<helius-api-key>
   HELIUS_API_KEY=<helius-api-key>
   NEXT_PUBLIC_USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

   # Treasury + fee payer info
   NEXT_PUBLIC_APP_TREASURY_OWNER=<public-key>
   NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS=<public-key>
   HAVEN_FEEPAYER_WALLET_ID=<privy-wallet-id>

   # Savings / Marginfi configuration (mainnet values shown)
   MARGINFI_PROGRAM_ID=MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA
   MARGINFI_GROUP=4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8
   MARGINFI_USDC_BANK=2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB
   MARGINFI_USDC_BANK_LIQ_VAULT=7jaiZR5Sk8hdYN9MxTpczTcwbWpb5WEoxSANuUwveuat
   NEXT_PUBLIC_MARGINFI_GROUP=4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8
   NEXT_PUBLIC_MARGINFI_USDC_BANK=2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB

   # Emails
   RESEND_API_KEY=<resend-api-key>
   RESEND_FROM=<support@your-domain.com>

   # App URLs & misc
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   NEXT_PUBLIC_HAVEN_ESCROW_OWNER=<public-key>
   CLAIM_TOKEN_SECRET=<secure-random-secret>
   TRANSFER_FEE_UI=0.015
   NEXT_PUBLIC_TRANSFER_FEE_UI=0.015
   NEXT_PUBLIC_JUP_TOKENS_STRICT=https://token.jup.ag/strict
   NEXT_PUBLIC_JUP_TOKENS_FALLBACK=https://tokens.jup.ag/tokens?tags=verified
   NEXT_PUBLIC_JUP_PRICE_BASE=https://lite-api.jup.ag/price/v3
   ```

   > **Security reminder:** never commit real secrets. Use a secrets manager or CI environment variables in production.

3. **Run the development server**
   ```bash
   npm run dev
   ```
   Visit [http://localhost:3000](http://localhost:3000) to use the app.

4. **Optional scripts**
   - `npm run lint` — check code quality
   - `npm run build` — production build (`.next/` is cleaned automatically)
   - `npm run start` — run production build locally

## Application Overview

The project uses the Next.js App Router (`app/`) with feature-focused subdirectories.

### Key Pages

| Route | File | Description |
| ----- | ---- | ----------- |
| `/` | `app/(auth)/page.tsx` | Landing / authentication entry point. |
| `/sign-in`, `/sign-up`, `/onboarding` | `app/(auth)/sign-in/page.tsx` etc. | Auth flow powered by Privy; handles KYC gating. |
| `/dashboard` | `app/(pages)/dashboard/page.tsx` | Primary account overview showing balances, actions, and toasts. |
| `/activity` | `app/(pages)/activity/page.tsx` | Timeline of on-chain transfers and in-app actions (uses `components/shared/ActivityList`). |
| `/invest` | `app/(pages)/invest/page.tsx` | Token catalog, wallet positions, and Jupiter-powered swaps/sells. |
| `/cards` | `app/(pages)/cards/page.tsx` | Card management and card-related balances or actions. |
| `/settings` | `app/(pages)/settings/page.tsx` | Profile, key export, and feature toggles. |
| `/claim/[token]` | `app/claim/[token]/page.tsx` | Email claim redemption for escrowed transfers. |

### Supporting Modules

- `providers/BalanceProvider.tsx`: centralizes balance fetching (deposit/invest/savings) and exposes context for UI components.
- `providers/UserProvider.tsx`: wraps Privy session data and MongoDB profile info.
- `lib/solana.ts`, `lib/marginfi_idl.json`, `lib/solanaActivity.ts`: Solana primitives, Marginfi integrations, and activity parsing.
- `app/api/**`: Next.js route handlers for user profile updates, savings flows, Jupiter builds, transfer management, etc. Most routes expect the secrets configured above.

## Running in Production

1. Ensure production secrets are set in your deployment environment (Vercel, container, etc.).
2. Build once: `npm run build`
3. Start the server: `npm run start`

For Vercel deployments, set all environment variables through the Vercel dashboard. The project uses dynamic routes and Node.js runtime (`force-dynamic`) in many APIs, so verify your plan supports background request timeouts you require.

## Troubleshooting

- **Mongo connection errors** — confirm `MONGODB_URL` contains the correct username/password and IP whitelist covers your machine.
- **Privy auth issues** — ensure the client-side `NEXT_PUBLIC_PRIVY_APP_ID` matches the server keys and that the redirect origins include `http://localhost:3000` for development.
- **Solana RPC failures** — rate limits on Helius can trigger 429s; consider a dedicated API key per environment.
- **Emails not sending** — ensure `RESEND_API_KEY` is verified and `RESEND_FROM` matches an authorized domain.

## Contributing

1. Create a new branch.
2. Make your changes and add tests if relevant.
3. Run `npm run lint`.
4. Submit a pull request with a clear description.

---

Questions or issues? Open a GitHub issue or reach out to the Haven engineering team.
