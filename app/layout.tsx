// app/layout.tsx
import type React from "react";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import PrivyProviders from "@/providers/PrivyProviders";
// Optional: registers a no-op service worker so Chrome considers the app "installable"
import RegisterSW from "./register-sw"; // create this file below (or remove if not needed)

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "Haven",
  title: "Haven",
  description: "Send USDC by email and grow your savings with Solana DeFi.",
  manifest: "/manifest.webmanifest",
  themeColor: "#b6ff3e",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    title: "Haven",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  // (Optional) SEO niceties – harmless to keep
  metadataBase: new URL("https://your-domain.com"),
};

export const viewport: Viewport = {
  themeColor: "#b6ff3e",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* subtle lime glow */}
        <div className="fixed inset-0 -z-10">
          <div className="absolute inset-0 bg-[radial-gradient(60%_40%_at_80%_10%,rgba(182,255,62,0.08),transparent),radial-gradient(40%_30%_at_10%_80%,rgba(182,255,62,0.06),transparent)]" />
        </div>

        <Toaster
          position="top-right"
          gutter={10}
          containerStyle={{ zIndex: 2147483647 }}
          toastOptions={{
            style: {
              zIndex: 2147483647,
              background: "rgba(24,24,27,0.9)",
              color: "white",
              border: "1px solid rgba(255,255,255,0.12)",
              backdropFilter: "blur(8px)",
              boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
            },
            success: {
              iconTheme: { primary: "rgb(182,255,62)", secondary: "#111111" },
            },
          }}
        />

        {/* Registers a tiny SW so Chrome can show the “Install app” prompt.
            Safe to remove if you truly don't want any SW at all. */}
        <RegisterSW />

        <PrivyProviders>
          <div className="min-h-screen flex flex-col">
            <main className="flex-1">
              <div className="mx-auto w-full">{children}</div>
            </main>

            {/* Hide web-only footer when running as an installed PWA */}
            <footer className="border-t border-border web-only">
              <div className="mx-auto w-full max-w-6xl px-4 py-4 text-xs text-muted-foreground">
                © {new Date().getFullYear()} Haven
              </div>
            </footer>
          </div>
        </PrivyProviders>
      </body>
    </html>
  );
}
