// lib/postSession.ts
export type PostSessionResult = { ok: true; goTo: string };

type ApiSuccess = { ok?: boolean; goTo?: unknown };
type ApiError = { ok?: boolean; error?: unknown; message?: unknown };
type ApiResponse = ApiSuccess | ApiError;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function pickErrorMessage(data: unknown, status: number): string {
  if (isRecord(data)) {
    const err = asString(data.error);
    const msg = asString(data.message);
    if (err && err.trim()) return err;
    if (msg && msg.trim()) return msg;
  }
  return `Session error (${status})`;
}

function isAbortError(e: unknown): boolean {
  // Covers DOMException AbortError and generic AbortError shapes
  if (typeof DOMException !== "undefined" && e instanceof DOMException) {
    return e.name === "AbortError";
  }
  if (isRecord(e)) {
    const name = asString((e as Record<string, unknown>).name);
    return name === "AbortError";
  }
  return false;
}

export async function postSession(
  accessToken: string
): Promise<PostSessionResult> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12_000);

  try {
    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      credentials: "include", // needed for Set-Cookie
      cache: "no-store",
      signal: ctrl.signal,
    });

    // Parse JSON defensively
    let data: unknown = null;
    try {
      data = (await res.json()) as ApiResponse;
    } catch {
      // ignore parse errors; we'll validate below
    }

    if (!res.ok) {
      throw new Error(pickErrorMessage(data, res.status));
    }

    // Extract goTo safely with defaults
    let goTo = "";
    if (isRecord(data)) {
      const candidate = asString(data.goTo);
      if (candidate) goTo = candidate.trim();
    }
    if (!goTo || !goTo.startsWith("/")) goTo = "/dashboard";

    return { ok: true, goTo };
  } catch (e: unknown) {
    if (isAbortError(e)) {
      throw new Error("Session request timed out");
    }
    // Re-throw preserving original error semantics
    throw e instanceof Error ? e : new Error(String(e));
  } finally {
    clearTimeout(timeout);
  }
}
