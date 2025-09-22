"use client";

import { useState, useCallback } from "react";
import { PublicKey } from "@solana/web3.js";

export function useResolveDepositOwnerByEmail() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolve = useCallback(async (email: string): Promise<PublicKey> => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/user/resolve-deposit-owner?email=${encodeURIComponent(email)}`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: { accept: "application/json" },
        }
      );
      const j = await r.json();
      if (!r.ok || !j?.depositOwner) {
        throw new Error(j?.error || "User not found");
      }
      return new PublicKey(j.depositOwner);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { resolve, loading, error, setError };
}
