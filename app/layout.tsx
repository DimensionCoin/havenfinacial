// app/layout.tsx
import type React from "react";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import PrivyProviders from "@/providers/PrivyProviders";
import AppToaster from "@/providers/AppToaster";
import PWAModeFlag from "@/providers/PWAModeFlag"; // ← remove the space in your import
import RegisterSW from "./register-sw"; // optional tiny SW so Chrome shows “Install” prompt

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "Haven",
  title: "Haven",
  description: "Send USDC by email and grow your savings with Solana DeFi.",
  metadataBase: new URL("https://havenvaults.com"),

  // This points to your real manifest file in /public
  manifest: "/manifest.webmanifest",

  // Icons for browsers (Android/desktop) and iOS (apple-touch-icon)
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      // iOS prefers 180x180. Provide this exact size.
      { url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" },
      // Optional fallbacks
      { url: "/icons/icon-152.png", sizes: "152x152", type: "image/png" },
      { url: "/icons/icon-120.png", sizes: "120x120", type: "image/png" },
    ],
  },

  appleWebApp: {
    capable: true,
    title: "Haven",
    statusBarStyle: "black-translucent",
  },

  formatDetection: { telephone: false },
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

        {/* Sets a CSS flag class when running in standalone/PWA (you already use this) */}
        <PWAModeFlag />

        {/* Toaster that respects safe areas in PWA (you already built this) */}
        <AppToaster />

        {/* Optional, tiny SW so Chrome treats your site as installable */}
        <RegisterSW />

        <PrivyProviders>
          <div className="min-h-screen flex flex-col">
            <main className="flex-1">
              <div className="mx-auto w-full">{children}</div>
            </main>

            {/* Hide web-only footer when running as an installed PWA (via your CSS) */}
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
