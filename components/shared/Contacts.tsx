// components/shared/Contacts.tsx
"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePrivy } from "@privy-io/react-auth";

type Contact = {
  id: string;
  firstName: string;
  lastName?: string;
  email: string;
};
type Props = {
  onPick?: (contact: Contact) => void;
  buttonLabel?: string;
  className?: string;
  autoFocusSearch?: boolean;
};

export default function Contacts({
  onPick,
  buttonLabel = "Choose Contact",
  className,
  autoFocusSearch = true,
}: Props) {
  const { getAccessToken, ready, authenticated, login } = usePrivy();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState<string | null>(null);

  // add-contact mode
  const [adding, setAdding] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");

  // search
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  const resetAddForm = () => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setAdding(false);
  };

  /** Build headers that never contain undefined values. */
  const buildAuthHeaders = useCallback(async (): Promise<HeadersInit> => {
    try {
      const token = await getAccessToken().catch(() => null);
      return token ? ({ authorization: `Bearer ${token}` } as HeadersInit) : {};
    } catch {
      return {};
    }
  }, [getAccessToken]);

  /** Hit /api/user/me with Privy bearer to (re)set __session cookie. */
  const refreshSession = useCallback(async () => {
    const headers = await buildAuthHeaders();
    const res = await fetch("/api/user/me", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json", ...headers },
    });
    return res.ok;
  }, [buildAuthHeaders]);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    setError(null);
    let triedRefresh = false;

    const run = async () => {
      const headers: HeadersInit = await buildAuthHeaders();
      const res = await fetch("/api/user/contact", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers,
      });
      if (res.status === 401 && !triedRefresh) {
        triedRefresh = true;
        const ok = await refreshSession();
        if (ok) return run(); // retry once after session refresh
      }
      const data = (await res.json().catch(() => null)) as
        | { contacts?: Contact[]; error?: unknown }
        | null;
      if (!res.ok) {
        if (res.status === 401)
          throw new Error("Unauthorized. Please sign in to view contacts.");
        const message =
          data && typeof data.error === "string"
            ? data.error
            : `Failed to load contacts (${res.status})`;
        throw new Error(message);
      }
      setContacts((data?.contacts as Contact[] | undefined) ?? []);
    };

    try {
      await run();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message || "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, [buildAuthHeaders, refreshSession]);

  useEffect(() => {
    if (open) {
      if (!ready) return;
      if (!authenticated) {
        setError("You need to sign in to use contacts.");
        return;
      }
      fetchContacts();
      if (autoFocusSearch) setTimeout(() => searchRef.current?.focus(), 50);
    } else {
      setQ("");
      resetAddForm();
      setError(null);
    }
  }, [open, fetchContacts, autoFocusSearch, ready, authenticated]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return contacts;
    return contacts.filter((c) =>
      `${c.firstName} ${c.lastName ?? ""} ${c.email}`.toLowerCase().includes(t)
    );
  }, [q, contacts]);

  const emailRegex = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/, []);

  const handleCreate = useCallback(async () => {
    setError(null);

    const payload = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
    };
    if (!payload.firstName) {
      setError("First name is required.");
      return;
    }
    if (!payload.email || !emailRegex.test(payload.email)) {
      setError("Please enter a valid email.");
      return;
    }

    let triedRefresh = false;
    const run = async () => {
      const headers: HeadersInit = {
        ...(await buildAuthHeaders()),
        "Content-Type": "application/json",
      };
      const res = await fetch("/api/user/contact", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (res.status === 401 && !triedRefresh) {
        triedRefresh = true;
        const ok = await refreshSession();
        if (ok) return run(); // retry once after session refresh
      }
      const data = (await res.json().catch(() => null)) as
        | { contact?: Contact; error?: unknown }
        | null;
      if (!res.ok) {
        if (res.status === 401)
          throw new Error("Unauthorized. Please sign in and try again.");
        const message =
          data && typeof data.error === "string"
            ? data.error
            : `Failed to create contact (${res.status})`;
        throw new Error(message);
      }
      const created = data?.contact;
      if (created) {
        setContacts((prev) => [created, ...prev]);
        resetAddForm();
      }
    };

    try {
      await run();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message || "Failed to create contact");
    }
  }, [
    firstName,
    lastName,
    email,
    buildAuthHeaders,
    refreshSession,
    emailRegex,
  ]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "inline-flex items-center gap-2 rounded-2xl border border-white/20 px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/10 transition-colors"
        }
      >
        <span>👥</span>
        <span>{buttonLabel}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50" aria-modal="true" role="dialog">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-x-0 top-[8vh] mx-auto w-[92vw] max-w-xl rounded-3xl border border-white/20 bg-black/40 backdrop-blur-[40px] backdrop-saturate-[200%] shadow-[0_32px_64px_rgba(0,0,0,0.4),0_16px_32px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(0,0,0,0.2)]">
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/5 via-transparent to-transparent pointer-events-none" />
            <div className="relative flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold text-white">
                  Your Contacts
                </span>
                <span className="text-xs text-white/50">
                  {contacts.length} saved
                </span>
              </div>
              <div className="flex items-center gap-2">
                {!authenticated && ready && (
                  <button
                    type="button"
                    onClick={login}
                    className="rounded-xl border border-white/20 px-3 py-1.5 text-sm text-white/90 hover:bg-white/10"
                  >
                    Sign in
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setAdding((s) => !s)}
                  className="rounded-xl border border-white/20 px-3 py-1.5 text-sm text-white/90 hover:bg-white/10"
                  title="Add contact"
                >
                  + Add
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-xl border border-white/20 px-3 py-1.5 text-sm text-white/90 hover:bg-white/10"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>

            {adding && (
              <div className="grid grid-cols-1 gap-3 border-b border-white/10 px-5 py-4 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-white/70">
                    First name
                  </label>
                  <input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/40 focus:border-[rgb(182,255,62)]"
                    placeholder="Alice"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70">
                    Last name
                  </label>
                  <input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/40 focus:border-[rgb(182,255,62)]"
                    placeholder="Lee"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70">
                    Email
                  </label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/40 focus:border-[rgb(182,255,62)]"
                    placeholder="alice@example.com"
                  />
                </div>
                <div className="sm:col-span-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={resetAddForm}
                    className="rounded-xl border border-white/20 px-3 py-1.5 text-sm text-white/90 hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCreate}
                    className="rounded-xl bg-[rgb(182,255,62)] px-3 py-1.5 text-sm font-semibold text-black hover:bg-[rgb(182,255,62)]/90"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 px-5 py-3">
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/40 focus:border-[rgb(182,255,62)]"
                placeholder="Search name or email…"
                aria-label="Search contacts"
              />
            </div>

            {error && (
              <div className="px-5 pb-2 text-sm text-red-400">{error}</div>
            )}

            <div className="max-h-[55vh] overflow-auto px-3 pb-5">
              {loading ? (
                <div className="px-3 py-8 text-center text-sm text-white/70">
                  <div className="mx-auto mb-3 h-5 w-5 rounded-full border-2 border-white/30 border-t-[rgb(182,255,62)] animate-spin" />
                  Loading…
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-3 py-10 text-center text-sm text-white/60">
                  {q
                    ? "No matches."
                    : "No contacts yet. Click “+ Add” to create one."}
                </div>
              ) : (
                <ul className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/[0.03]">
                  {filtered.map((c) => (
                    <li
                      key={c.id}
                      className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-white/[0.06] transition-colors"
                      onClick={() => {
                        onPick?.(c);
                        setOpen(false);
                      }}
                      title={`Pick ${c.firstName} ${c.lastName ?? ""}`.trim()}
                    >
                      <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">
                        {(c.firstName?.[0] ?? "") + (c.lastName?.[0] ?? "") ||
                          "•"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-white">
                          {c.firstName} {c.lastName}
                        </div>
                        <div className="truncate text-xs text-white/60">
                          {c.email}
                        </div>
                      </div>
                      <div className="text-xs text-[rgb(182,255,62)]">
                        Select
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
