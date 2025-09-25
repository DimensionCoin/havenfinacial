"use client";

import { useState } from "react";
import { PieChart, ShoppingCart } from "lucide-react";
import WalletHoldings from "@/components/invest/WalletHoldings";
import TokenCatalog from "@/components/invest/TokenCatalog";
import { Button } from "@/components/ui/button";

export default function Page() {
  const [activeTab, setActiveTab] = useState<"portfolio" | "buy">("portfolio");

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 bg-black/40 backdrop-blur-[40px]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            <h1 className="text-sm lg:text-lg font-bold text-white">Investment Center</h1>

            <nav className="flex items-center gap-2">
              <Button
                variant={activeTab === "portfolio" ? "default" : "ghost"}
                onClick={() => setActiveTab("portfolio")}
                className={`text-sm font-medium px-3 py-1 ${
                  activeTab === "portfolio"
                    ? "bg-[rgb(182,255,62)] text-black hover:bg-[rgb(182,255,62)]/90"
                    : "text-white/70 hover:text-white hover:bg-white/10"
                }`}
              >
                <PieChart className="h-3 w-3 mr-1" />
                My Portfolio
              </Button>
              <Button
                variant={activeTab === "buy" ? "default" : "ghost"}
                onClick={() => setActiveTab("buy")}
                className={`text-sm font-medium px-3 py-1 ${
                  activeTab === "buy"
                    ? "bg-[rgb(182,255,62)] text-black hover:bg-[rgb(182,255,62)]/90"
                    : "text-white/70 hover:text-white hover:bg-white/10"
                }`}
              >
                <ShoppingCart className="h-3 w-3 mr-1" />
                Buy Tokens
              </Button>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {activeTab === "portfolio" ? <WalletHoldings /> : <TokenCatalog />}
      </main>
    </div>
  );
}
