// app/settings/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import ExportKeysModal from "./ExportKeysModal";
import { usePrivy } from "@privy-io/react-auth";
import { useUser } from "@/providers/UserProvider";

type Address = {
  line1: string;
  line2: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  country: string; // ISO-3166 alpha-2
};

type FormState = {
  firstName: string;
  lastName: string;
  displayName: string;
  displayCurrency: string; // 3-letter
  countryISO: string; // 2-letter (profile-level)
  dob: string; // yyyy-mm-dd (HTML <input type="date">)
  address: Address;
};

const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
  "SGD",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "HKD",
  "INR",
  "BRL",
  "MXN",
];
const COUNTRIES = [
  "US",
  "CA",
  "GB",
  "DE",
  "FR",
  "ES",
  "IT",
  "NL",
  "SE",
  "NO",
  "DK",
  "FI",
  "IE",
  "SG",
  "AU",
  "NZ",
  "JP",
  "HK",
  "MX",
  "BR",
  "IN",
];

function toDateInput(d?: string | Date | null) {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  const iso = new Date(dt).toISOString();
  return iso.slice(0, 10); // yyyy-mm-dd
}

function trimOrEmpty(v?: string | null) {
  return (v ?? "").trim();
}

export default function SettingsPage() {
  const { user } = useUser();
  const { getAccessToken } = usePrivy();

  // NOTE: dob and address may not be present on the user object if they are
  // excluded by select:false. We simply initialize empty and let user fill in.
  const initial: FormState = useMemo(() => {
    const u = user as unknown;
    let dob = "";
    let address: Address = {
      line1: "",
      line2: "",
      city: "",
      stateOrProvince: "",
      postalCode: "",
      country: (user?.countryISO || "US").toUpperCase(),
    };
    if (u && typeof u === "object") {
      const rec = u as Record<string, unknown>;
      const d = rec.dob;
      if (typeof d === "string" || d instanceof Date) dob = toDateInput(d as string | Date);
      const a = rec.address;
      if (a && typeof a === "object") {
        const ar = a as Record<string, unknown>;
        address = {
          line1: trimOrEmpty(ar.line1 as string | null | undefined),
          line2: trimOrEmpty(ar.line2 as string | null | undefined),
          city: trimOrEmpty(ar.city as string | null | undefined),
          stateOrProvince: trimOrEmpty(
            ar.stateOrProvince as string | null | undefined
          ),
          postalCode: trimOrEmpty(ar.postalCode as string | null | undefined),
          country:
            trimOrEmpty(ar.country as string | null | undefined) ||
            (user?.countryISO || "US").toUpperCase(),
        };
      }
    }
    return {
      firstName: trimOrEmpty(user?.firstName),
      lastName: trimOrEmpty(user?.lastName),
      displayName: trimOrEmpty(user?.displayName),
      displayCurrency: (user?.displayCurrency || "USD").toUpperCase(),
      countryISO: (user?.countryISO || "US").toUpperCase(),
      dob,
      address,
    };
  }, [user]);

  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);

  // track dirty state to enable/disable Save button
  const isDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial]
  );

  useEffect(() => setForm(initial), [initial]);

  const onChange = useCallback((k: keyof FormState, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setError(null);
    setOkMsg(null);
  }, []);

  const onChangeAddress = useCallback((k: keyof Address, v: string) => {
    setForm((f) => ({ ...f, address: { ...f.address, [k]: v } }));
    setError(null);
    setOkMsg(null);
  }, []);

  // Simple validators mirroring your API constraints
  const validate = () => {
    if (!/^[A-Z]{3}$/.test(form.displayCurrency)) {
      return "Display currency must be a 3-letter ISO code.";
    }
    if (!/^[A-Z]{2}$/.test(form.countryISO)) {
      return "Country must be a 2-letter ISO code.";
    }
    if (form.dob) {
      const d = new Date(form.dob);
      if (Number.isNaN(d.getTime())) return "Birthday must be a valid date.";
      // Optional: don’t allow future dates
      const today = new Date();
      if (d > today) return "Birthday cannot be in the future.";
    }
    // Address: either fully blank (no update) or all required fields present
    const a = form.address;
    const anyAddressFilled =
      a.line1 ||
      a.line2 ||
      a.city ||
      a.stateOrProvince ||
      a.postalCode ||
      a.country;
    if (anyAddressFilled) {
      if (!a.line1 || !a.city || !a.stateOrProvince || !a.postalCode) {
        return "Please fill all required address fields.";
      }
      if (!/^[A-Z]{2}$/.test(a.country.toUpperCase())) {
        return "Address country must be a 2-letter ISO code.";
      }
    }
    return null;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const v = validate();
      if (v) throw new Error(v);

      const token = await getAccessToken();

      // Build minimal payload: only send changed fields
      type UpdatePayload = Partial<
        Pick<
          FormState,
          "firstName" | "lastName" | "displayName" | "displayCurrency" | "countryISO"
        >
      > & { dob?: string; address?: Address };
      const payload: UpdatePayload = {};
      const add = (
        k: "firstName" | "lastName" | "displayName" | "displayCurrency" | "countryISO"
      ) => {
        if (form[k] !== initial[k]) {
          (payload as Record<string, string | undefined>)[k] = (form[k] as string) || undefined;
        }
      };
      add("firstName");
      add("lastName");
      add("displayName");
      add("displayCurrency");
      add("countryISO");

      // dob: convert yyyy-mm-dd -> Date/string acceptable by server
      if (form.dob !== initial.dob) {
        payload.dob = form.dob ? new Date(form.dob).toISOString() : undefined;
      }

      // address: only send if any field changed vs initial AND at least required fields present
      if (JSON.stringify(form.address) !== JSON.stringify(initial.address)) {
        const a = form.address;
        if (a.line1 && a.city && a.stateOrProvince && a.postalCode) {
          payload.address = {
            line1: a.line1.trim(),
            line2: a.line2.trim(),
            city: a.city.trim(),
            stateOrProvince: a.stateOrProvince.trim(),
            postalCode: a.postalCode.trim(),
            country: a.country.trim().toUpperCase(),
          };
        } else {
          // if user cleared address completely, omit; server treats “no address” as no-op
          // (If you want to support clearing address on server, implement a separate endpoint/flag.)
        }
      }

      if (!Object.keys(payload).length) {
        setOkMsg("No changes to save.");
        setSaving(false);
        return;
      }

      const res = await fetch("/api/user/update", {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Save failed.");

      setOkMsg("Settings updated.");
      // If your UserProvider doesn't auto-refresh, you can soft refresh:
      // router.refresh() (if using next/navigation) or window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold text-white">Settings</h1>
      <p className="text-sm text-zinc-400 mt-1">
        Update your profile details and manage recovery/export.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-8">
        {/* ---------- Profile ---------- */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-sm font-semibold text-white/90">Profile</h2>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm text-zinc-300">First name</span>
              <input
                className="mt-1 w-full rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/40"
                value={form.firstName}
                onChange={(e) => onChange("firstName", e.target.value)}
                placeholder="Ada"
                autoComplete="given-name"
              />
            </label>
            <label className="block">
              <span className="text-sm text-zinc-300">Last name</span>
              <input
                className="mt-1 w-full rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/40"
                value={form.lastName}
                onChange={(e) => onChange("lastName", e.target.value)}
                placeholder="Lovelace"
                autoComplete="family-name"
              />
            </label>
          </div>

          <label className="block mt-4">
            <span className="text-sm text-zinc-300">Display name</span>
            <input
              className="mt-1 w-full rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/40"
              value={form.displayName}
              onChange={(e) => onChange("displayName", e.target.value)}
              placeholder="Ada L."
              autoComplete="nickname"
            />
          </label>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm text-zinc-300">Display currency</span>
              <select
                className="mt-1 w-full rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/40"
                value={form.displayCurrency}
                onChange={(e) =>
                  onChange("displayCurrency", e.target.value.toUpperCase())
                }
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c} className="bg-zinc-900">
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm text-zinc-300">Country</span>
              <select
                className="mt-1 w-full rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/40"
                value={form.countryISO}
                onChange={(e) =>
                  onChange("countryISO", e.target.value.toUpperCase())
                }
                autoComplete="country"
              >
                {COUNTRIES.map((c) => (
                  <option key={c} value={c} className="bg-zinc-900">
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block mt-4">
            <span className="text-sm text-zinc-300">Birthday</span>
            <input
              type="date"
              className="mt-1 w-full rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/40"
              value={form.dob}
              onChange={(e) => onChange("dob", e.target.value)}
              placeholder="YYYY-MM-DD"
              max={toDateInput(new Date())}
              autoComplete="bday"
            />
          </label>
        </section>

        {/* ---------- Address ---------- */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-sm font-semibold text-white/90">
            Mailing address
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Fill all required fields to update your address.
          </p>

          <label className="block mt-4">
            <span className="text-sm text-zinc-300">
              Address line 1<span className="text-red-400"> *</span>
            </span>
            <input
              className="mt-1 w-full rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/40"
              value={form.address.line1}
              onChange={(e) => onChangeAddress("line1", e.target.value)}
              autoComplete="address-line1"
              placeholder="123 Innovation Way"
            />
          </label>

          <label className="block mt-3">
            <span className="text-sm text-zinc-300">Address line 2</span>
            <input
              className="mt-1 w-full rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/40"
              value={form.address.line2}
              onChange={(e) => onChangeAddress("line2", e.target.value)}
              autoComplete="address-line2"
              placeholder="Apt, suite, etc. (optional)"
            />
          </label>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block">
              <span className="text-sm text-zinc-300">
                City<span className="text-red-400"> *</span>
              </span>
              <input
                className="mt-1 w-full rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/40"
                value={form.address.city}
                onChange={(e) => onChangeAddress("city", e.target.value)}
                autoComplete="address-level2"
                placeholder="San Francisco"
              />
            </label>

            <label className="block">
              <span className="text-sm text-zinc-300">
                State / Province<span className="text-red-400"> *</span>
              </span>
              <input
                className="mt-1 w-full rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/40"
                value={form.address.stateOrProvince}
                onChange={(e) =>
                  onChangeAddress("stateOrProvince", e.target.value)
                }
                autoComplete="address-level1"
                placeholder="CA"
              />
            </label>

            <label className="block">
              <span className="text-sm text-zinc-300">
                Postal code<span className="text-red-400"> *</span>
              </span>
              <input
                className="mt-1 w-full rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/40"
                value={form.address.postalCode}
                onChange={(e) => onChangeAddress("postalCode", e.target.value)}
                autoComplete="postal-code"
                placeholder="94105"
              />
            </label>
          </div>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm text-zinc-300">
                Address country<span className="text-red-400"> *</span>
              </span>
              <select
                className="mt-1 w-full rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-[rgb(182,255,62)]/40"
                value={form.address.country}
                onChange={(e) =>
                  onChangeAddress("country", e.target.value.toUpperCase())
                }
                autoComplete="country"
              >
                {COUNTRIES.map((c) => (
                  <option key={c} value={c} className="bg-zinc-900">
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <div className="text-xs text-zinc-500 self-end">
              Tip: Address country can differ from your profile country if
              needed.
            </div>
          </div>
        </section>

        {/* ---------- Feedback ---------- */}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200 text-sm">
            {error}
          </div>
        )}
        {okMsg && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-200 text-sm">
            {okMsg}
          </div>
        )}

        {/* ---------- Actions ---------- */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || !isDirty}
            className="rounded-xl bg-[rgb(182,255,62)] text-black font-semibold px-5 py-2.5 hover:bg-[rgb(182,255,62)]/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>

          <button
            type="button"
            onClick={() => setShowExport(true)}
            className="rounded-xl border border-white/15 text-white px-5 py-2.5 hover:bg-white/10"
          >
            Export recovery / keys
          </button>
        </div>
      </form>

      {/* Modal */}
      {showExport && <ExportKeysModal onClose={() => setShowExport(false)} />}

      {/* Security footnote */}
      <div className="mt-8 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
        <p className="text-xs text-amber-200">
          <strong>Security reminder:</strong> Exporting recovery/private keys
          grants full control over your account. Store offline and never share.
        </p>
      </div>
    </div>
  );
}
