// lib/postSession.ts
export async function postSession(accessToken: string) {
  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Session error");
  return data as { ok: true; goTo: "/onboarding" | "/dashboard" };
}
