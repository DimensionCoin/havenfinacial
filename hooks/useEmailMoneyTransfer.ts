// hooks/useEmailMoneyTransfer.ts
"use client";

import { useCallback, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSponsoredUsdcTransfer } from "./useSponsoredUsdcTransfer";

type SendEmailTransferInput = {
  /** Sender's deposit owner pubkey (base58) — user.depositWallet.address */
  fromOwnerBase58: string;
  /** Recipient email (non-Haven user) */
  recipientEmail: string;
  /** Amount the recipient should receive (USDC, UI) */
  amountUi: number;
  /** Optional note to include in the email */
  note?: string;
  /** Optional idempotency key for retries */
  idempotencyKey?: string;
};

export function useEmailMoneyTransfer() {
  const { getAccessToken } = usePrivy();
  const { send: sendSponsored, error: sponsoredErr } =
    useSponsoredUsdcTransfer();

  const [loading, setLoading] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Prefer explicit NEXT_PUBLIC escrow owner; fallback to fee payer address
  const ESCROW_OWNER =
    process.env.NEXT_PUBLIC_HAVEN_ESCROW_OWNER ||
    process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS ||
    "";

  const send = useCallback(
    async (input: SendEmailTransferInput) => {
      setLoading(true);
      setError(null);
      setTxSignature(null);
      setClaimId(null);

      try {
        if (!ESCROW_OWNER) throw new Error("Escrow owner not configured.");
        if (!input.recipientEmail || !/\S+@\S+\.\S+/.test(input.recipientEmail))
          throw new Error("Invalid recipient email");
        if (!Number.isFinite(input.amountUi) || input.amountUi <= 0)
          throw new Error("Enter a positive amount");

        // 1) On-chain: send USDC to escrow (fee charged on top by your existing backend)
        const accessToken = await getAccessToken().catch(() => null);

        const sig = await sendSponsored({
          fromOwnerBase58: input.fromOwnerBase58,
          toOwnerBase58: ESCROW_OWNER,
          amountUi: input.amountUi,
          accessToken,
          // keep using your existing /api/transfer — no changes needed there
          backendUrl: "/api/transfer",
        });

        // 2) Record + email claim link
        const res = await fetch("/api/email-claims/record", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            txSignature: sig,
            recipientEmail: input.recipientEmail.trim().toLowerCase(),
            amountUi: input.amountUi,
            note: input.note || undefined,
            idempotencyKey: input.idempotencyKey || undefined,
          }),
        });

        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.ok)
          throw new Error(j?.error || `HTTP ${res.status}`);

        setTxSignature(sig);
        setClaimId(j?.claimId || null);
        return { signature: sig as string, claimId: String(j?.claimId || "") };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg || sponsoredErr || "Failed to send email transfer");
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [ESCROW_OWNER, getAccessToken, sendSponsored, sponsoredErr]
  );

  return { send, loading, txSignature, claimId, error };
}
