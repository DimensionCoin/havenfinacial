"use client";

import { useState } from "react";
import { ShoppingCart, Wallet } from "lucide-react";
import WalletHoldings from "@/components/invest/WalletHoldings";
import TokenCatalog from "@/components/invest/TokenCatalog";
import { Button } from "@/components/ui/button";

export default function InvestmentApp() {
  const [activeTab, setActiveTab] = useState<"portfolio" | "discover">(
    "discover"
  );

  return (
    <div className="min-h-screen bg-black/20">
      {/* Tab Navigation */}
      <div className="bg-black/40 backdrop-blur-[40px] border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex justify-between p-4">
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
              <span>Purchase Assets</span>
            </Button>
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
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {activeTab === "portfolio" ? (
            <div className="space-y-6">
              <WalletHoldings />
            </div>
          ) : (
            <div className="space-y-6">
              <TokenCatalog />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
