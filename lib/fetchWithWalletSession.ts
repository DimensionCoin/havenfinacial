// lib/fetchWithWalletSession.ts
export async function fetchWithWalletSession(
  url: string,
  init: RequestInit,
  ensureSession?: () => Promise<void>
) {
  let res = await fetch(url, init);
  if (res.status !== 401) return res;

  // Peek at error body to see if it’s the wallet-session case
  let msg = "";
  try {
    const j = await res.clone().json();
    msg = (j?.error || "").toLowerCase();
  } catch {}

  if (ensureSession && msg.includes("wallet session required")) {
    await ensureSession(); // mint/refresh session
    res = await fetch(url, init); // retry once
  }

  return res;
}
