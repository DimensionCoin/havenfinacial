"use client";

import { useState } from "react";
import { ShoppingCart, Wallet } from "lucide-react";
import WalletHoldings from "@/components/invest/WalletHoldings";
import TokenCatalog from "@/components/invest/TokenCatalog";
import { Button } from "@/components/ui/button";

export default function InvestmentApp() {
  const [activeTab, setActiveTab] = useState<"portfolio" | "discover">(
    "portfolio"
  );

  return (
    <div className="min-h-screen bg-black/20">
      {/* Professional Header */}
      <header className="professional-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo and Brand */}
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
  
                <h1 className="text-xl font-bold bg-gradient-to-r from-white to-white/80 bg-clip-text text-transparent">
                  Haven Investments
                </h1>
              </div>
            </div>


            
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="bg-black/40 backdrop-blur-[40px] border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex justify-between p-4">
            <Button
              variant="ghost"
              onClick={() => setActiveTab("portfolio")}
              className={`flex items-center space-x-2 px-4 py-2 rounded-full font-medium transition-all duration-200 ${
                activeTab === "portfolio"
                  ? "bg-[rgb(182,255,62)]/20 text-[rgb(182,255,62)] border border-[rgb(182,255,62)]/30"
                  : "text-white/70 hover:text-white hover:bg-white/10"
              }`}
            >
              <Wallet className="h-4 w-4" />
              <span>My Portfolio</span>
            </Button>
            <Button
              variant="ghost"
              onClick={() => setActiveTab("discover")}
              className={`flex items-center space-x-2 px-4 py-2 rounded-full font-medium transition-all duration-200 ${
                activeTab === "discover"
                  ? "bg-[rgb(182,255,62)]/20 text-[rgb(182,255,62)] border border-[rgb(182,255,62)]/30"
                  : "text-white/70 hover:text-white hover:bg-white/10"
              }`}
            >
              <ShoppingCart className="h-4 w-4" />
              <span>Discover Tokens</span>
            </Button>
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {activeTab === "portfolio" ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold bg-gradient-to-r from-white to-white/80 bg-clip-text text-transparent">
                  Portfolio Overview
                </h2>
                <div className="flex items-center space-x-2 text-sm text-white/60">
                  <div className="w-2 h-2 bg-[rgb(182,255,62)] rounded-full animate-pulse"></div>
                  <span>Live prices</span>
                </div>
              </div>
              <WalletHoldings />
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold bg-gradient-to-r from-white to-white/80 bg-clip-text text-transparent">
                  Discover Tokens
                </h2>
                <div className="flex items-center space-x-2 text-sm text-white/60">
                  <div className="w-2 h-2 bg-[rgb(182,255,62)] rounded-full animate-pulse"></div>
                  <span>Real-time data</span>
                </div>
              </div>
              <TokenCatalog />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
