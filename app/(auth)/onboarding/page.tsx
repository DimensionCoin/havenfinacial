"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";

/** ---- Country + currency helpers ---- */
type Country = { code: string; name: string };

const COUNTRIES: Country[] = [
  { code: "AF", name: "Afghanistan" },
  { code: "AX", name: "Åland Islands" },
  { code: "AL", name: "Albania" },
  { code: "DZ", name: "Algeria" },
  { code: "AS", name: "American Samoa" },
  { code: "AD", name: "Andorra" },
  { code: "AO", name: "Angola" },
  { code: "AI", name: "Anguilla" },
  { code: "AQ", name: "Antarctica" },
  { code: "AG", name: "Antigua and Barbuda" },
  { code: "AR", name: "Argentina" },
  { code: "AM", name: "Armenia" },
  { code: "AW", name: "Aruba" },
  { code: "AU", name: "Australia" },
  { code: "AT", name: "Austria" },
  { code: "AZ", name: "Azerbaijan" },
  { code: "BS", name: "Bahamas" },
  { code: "BH", name: "Bahrain" },
  { code: "BD", name: "Bangladesh" },
  { code: "BB", name: "Barbados" },
  { code: "BY", name: "Belarus" },
  { code: "BE", name: "Belgium" },
  { code: "BZ", name: "Belize" },
  { code: "BJ", name: "Benin" },
  { code: "BM", name: "Bermuda" },
  { code: "BT", name: "Bhutan" },
  { code: "BO", name: "Bolivia (Plurinational State of)" },
  { code: "BQ", name: "Bonaire, Sint Eustatius and Saba" },
  { code: "BA", name: "Bosnia and Herzegovina" },
  { code: "BW", name: "Botswana" },
  { code: "BV", name: "Bouvet Island" },
  { code: "BR", name: "Brazil" },
  { code: "IO", name: "British Indian Ocean Territory" },
  { code: "BN", name: "Brunei Darussalam" },
  { code: "BG", name: "Bulgaria" },
  { code: "BF", name: "Burkina Faso" },
  { code: "BI", name: "Burundi" },
  { code: "CV", name: "Cabo Verde" },
  { code: "KH", name: "Cambodia" },
  { code: "CM", name: "Cameroon" },
  { code: "CA", name: "Canada" },
  { code: "KY", name: "Cayman Islands" },
  { code: "CF", name: "Central African Republic" },
  { code: "TD", name: "Chad" },
  { code: "CL", name: "Chile" },
  { code: "CN", name: "China" },
  { code: "CX", name: "Christmas Island" },
  { code: "CC", name: "Cocos (Keeling) Islands" },
  { code: "CO", name: "Colombia" },
  { code: "KM", name: "Comoros" },
  { code: "CG", name: "Congo" },
  { code: "CD", name: "Congo, Democratic Republic of the" },
  { code: "CK", name: "Cook Islands" },
  { code: "CR", name: "Costa Rica" },
  { code: "CI", name: "Côte d’Ivoire" },
  { code: "HR", name: "Croatia" },
  { code: "CU", name: "Cuba" },
  { code: "CW", name: "Curaçao" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czechia" },
  { code: "DK", name: "Denmark" },
  { code: "DJ", name: "Djibouti" },
  { code: "DM", name: "Dominica" },
  { code: "DO", name: "Dominican Republic" },
  { code: "EC", name: "Ecuador" },
  { code: "EG", name: "Egypt" },
  { code: "SV", name: "El Salvador" },
  { code: "GQ", name: "Equatorial Guinea" },
  { code: "ER", name: "Eritrea" },
  { code: "EE", name: "Estonia" },
  { code: "SZ", name: "Eswatini" },
  { code: "ET", name: "Ethiopia" },
  { code: "FK", name: "Falkland Islands (Malvinas)" },
  { code: "FO", name: "Faroe Islands" },
  { code: "FJ", name: "Fiji" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "GF", name: "French Guiana" },
  { code: "PF", name: "French Polynesia" },
  { code: "TF", name: "French Southern Territories" },
  { code: "GA", name: "Gabon" },
  { code: "GM", name: "Gambia" },
  { code: "GE", name: "Georgia" },
  { code: "DE", name: "Germany" },
  { code: "GH", name: "Ghana" },
  { code: "GI", name: "Gibraltar" },
  { code: "GR", name: "Greece" },
  { code: "GL", name: "Greenland" },
  { code: "GD", name: "Grenada" },
  { code: "GP", name: "Guadeloupe" },
  { code: "GU", name: "Guam" },
  { code: "GT", name: "Guatemala" },
  { code: "GG", name: "Guernsey" },
  { code: "GN", name: "Guinea" },
  { code: "GW", name: "Guinea-Bissau" },
  { code: "GY", name: "Guyana" },
  { code: "HT", name: "Haiti" },
  { code: "HM", name: "Heard Island and McDonald Islands" },
  { code: "VA", name: "Holy See" },
  { code: "HN", name: "Honduras" },
  { code: "HK", name: "Hong Kong" },
  { code: "HU", name: "Hungary" },
  { code: "IS", name: "Iceland" },
  { code: "IN", name: "India" },
  { code: "ID", name: "Indonesia" },
  { code: "IR", name: "Iran (Islamic Republic of)" },
  { code: "IQ", name: "Iraq" },
  { code: "IE", name: "Ireland" },
  { code: "IM", name: "Isle of Man" },
  { code: "IL", name: "Israel" },
  { code: "IT", name: "Italy" },
  { code: "JM", name: "Jamaica" },
  { code: "JP", name: "Japan" },
  { code: "JE", name: "Jersey" },
  { code: "JO", name: "Jordan" },
  { code: "KZ", name: "Kazakhstan" },
  { code: "KE", name: "Kenya" },
  { code: "KI", name: "Kiribati" },
  { code: "KP", name: "Korea (Democratic People’s Republic of)" },
  { code: "KR", name: "Korea, Republic of" },
  { code: "KW", name: "Kuwait" },
  { code: "KG", name: "Kyrgyzstan" },
  { code: "LA", name: "Lao People’s Democratic Republic" },
  { code: "LV", name: "Latvia" },
  { code: "LB", name: "Lebanon" },
  { code: "LS", name: "Lesotho" },
  { code: "LR", name: "Liberia" },
  { code: "LY", name: "Libya" },
  { code: "LI", name: "Liechtenstein" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MO", name: "Macao" },
  { code: "MG", name: "Madagascar" },
  { code: "MW", name: "Malawi" },
  { code: "MY", name: "Malaysia" },
  { code: "MV", name: "Maldives" },
  { code: "ML", name: "Mali" },
  { code: "MT", name: "Malta" },
  { code: "MH", name: "Marshall Islands" },
  { code: "MQ", name: "Martinique" },
  { code: "MR", name: "Mauritania" },
  { code: "MU", name: "Mauritius" },
  { code: "YT", name: "Mayotte" },
  { code: "MX", name: "Mexico" },
  { code: "FM", name: "Micronesia (Federated States of)" },
  { code: "MD", name: "Moldova, Republic of" },
  { code: "MC", name: "Monaco" },
  { code: "MN", name: "Mongolia" },
  { code: "ME", name: "Montenegro" },
  { code: "MS", name: "Montserrat" },
  { code: "MA", name: "Morocco" },
  { code: "MZ", name: "Mozambique" },
  { code: "MM", name: "Myanmar" },
  { code: "NA", name: "Namibia" },
  { code: "NR", name: "Nauru" },
  { code: "NP", name: "Nepal" },
  { code: "NL", name: "Netherlands" },
  { code: "NC", name: "New Caledonia" },
  { code: "NZ", name: "New Zealand" },
  { code: "NI", name: "Nicaragua" },
  { code: "NE", name: "Niger" },
  { code: "NG", name: "Nigeria" },
  { code: "NU", name: "Niue" },
  { code: "NF", name: "Norfolk Island" },
  { code: "MK", name: "North Macedonia" },
  { code: "MP", name: "Northern Mariana Islands" },
  { code: "NO", name: "Norway" },
  { code: "OM", name: "Oman" },
  { code: "PK", name: "Pakistan" },
  { code: "PW", name: "Palau" },
  { code: "PS", name: "Palestine, State of" },
  { code: "PA", name: "Panama" },
  { code: "PG", name: "Papua New Guinea" },
  { code: "PY", name: "Paraguay" },
  { code: "PE", name: "Peru" },
  { code: "PH", name: "Philippines" },
  { code: "PN", name: "Pitcairn" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "PR", name: "Puerto Rico" },
  { code: "QA", name: "Qatar" },
  { code: "RE", name: "Réunion" },
  { code: "RO", name: "Romania" },
  { code: "RU", name: "Russian Federation" },
  { code: "RW", name: "Rwanda" },
  { code: "BL", name: "Saint Barthélemy" },
  { code: "SH", name: "Saint Helena, Ascension and Tristan da Cunha" },
  { code: "KN", name: "Saint Kitts and Nevis" },
  { code: "LC", name: "Saint Lucia" },
  { code: "MF", name: "Saint Martin (French part)" },
  { code: "PM", name: "Saint Pierre and Miquelon" },
  { code: "VC", name: "Saint Vincent and the Grenadines" },
  { code: "WS", name: "Samoa" },
  { code: "SM", name: "San Marino" },
  { code: "ST", name: "Sao Tome and Principe" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "SN", name: "Senegal" },
  { code: "RS", name: "Serbia" },
  { code: "SC", name: "Seychelles" },
  { code: "SL", name: "Sierra Leone" },
  { code: "SG", name: "Singapore" },
  { code: "SX", name: "Sint Maarten (Dutch part)" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "SB", name: "Solomon Islands" },
  { code: "SO", name: "Somalia" },
  { code: "ZA", name: "South Africa" },
  { code: "GS", name: "South Georgia and the South Sandwich Islands" },
  { code: "SS", name: "South Sudan" },
  { code: "ES", name: "Spain" },
  { code: "LK", name: "Sri Lanka" },
  { code: "SD", name: "Sudan" },
  { code: "SR", name: "Suriname" },
  { code: "SJ", name: "Svalbard and Jan Mayen" },
  { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" },
  { code: "SY", name: "Syrian Arab Republic" },
  { code: "TW", name: "Taiwan, Province of China" },
  { code: "TJ", name: "Tajikistan" },
  { code: "TZ", name: "Tanzania, United Republic of" },
  { code: "TH", name: "Thailand" },
  { code: "TL", name: "Timor-Leste" },
  { code: "TG", name: "Togo" },
  { code: "TK", name: "Tokelau" },
  { code: "TO", name: "Tonga" },
  { code: "TT", name: "Trinidad and Tobago" },
  { code: "TN", name: "Tunisia" },
  { code: "TR", name: "Türkiye" },
  { code: "TM", name: "Turkmenistan" },
  { code: "TC", name: "Turks and Caicos Islands" },
  { code: "TV", name: "Tuvalu" },
  { code: "UG", name: "Uganda" },
  { code: "UA", name: "Ukraine" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "UM", name: "United States Minor Outlying Islands" },
  { code: "UY", name: "Uruguay" },
  { code: "UZ", name: "Uzbekistan" },
  { code: "VU", name: "Vanuatu" },
  { code: "VE", name: "Venezuela (Bolivarian Republic of)" },
  { code: "VN", name: "Viet Nam" },
  { code: "VG", name: "Virgin Islands (British)" },
  { code: "VI", name: "Virgin Islands (U.S.)" },
  { code: "WF", name: "Wallis and Futuna" },
  { code: "EH", name: "Western Sahara" },
  { code: "YE", name: "Yemen" },
  { code: "ZM", name: "Zambia" },
  { code: "ZW", name: "Zimbabwe" },
];

const countryToCurrency: Record<string, string> = {
  US: "USD",
  CA: "CAD",
  GB: "GBP",
  DE: "EUR",
  FR: "EUR",
  AU: "AUD",
  JP: "JPY",
  NZ: "NZD",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  SG: "SGD",
  CH: "CHF",
  CN: "CNY",
  IN: "INR",
  BR: "BRL",
  MX: "MXN",
  ZA: "ZAR",
};

const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "NZD",
  "SGD",
  "CNY",
  "INR",
  "BRL",
  "MXN",
  "ZAR",
];

/** ---- Page ---- */
type FieldErrors = Partial<{
  firstName: string;
  lastName: string;
  countryISO: string;
  displayCurrency: string;
  line1: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  dob: string;
  tos: string;
  privacy: string;
}>;

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function isISO2(code: string) {
  return /^[A-Za-z]{2}$/.test(code);
}
function isISO3(code: string) {
  return /^[A-Za-z]{3}$/.test(code);
}
function isValidDob(yyyyMmDd: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return false;
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return false;
  // Age >= 18
  const now = new Date();
  let age = now.getUTCFullYear() - y;
  const mNow = now.getUTCMonth() + 1;
  const dNow = now.getUTCDate();
  if (mNow < m || (mNow === m && dNow < d)) age -= 1;
  return age >= 18;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { ready, authenticated, getAccessToken, user } = usePrivy();

  // Required
  const [firstName, setFirst] = useState("");
  const [lastName, setLast] = useState("");
  const [countryISO, setCountry] = useState("");
  const [displayCurrency, setCurrency] = useState("");

  // Optional PII (used for instant approval)
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateOrProvince, setState] = useState("");
  const [postalCode, setPostal] = useState("");
  const [dob, setDob] = useState(""); // YYYY-MM-DD
  const [phoneNumber, setPhone] = useState("");

  // Consents
  const [tos, setTos] = useState(true);
  const [privacy, setPrivacy] = useState(true);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Prefill first/last if Privy provides a displayName
  useEffect(() => {
    if (!user) return;
    const n = (() => {
      const u = user as unknown;
      if (u && typeof u === "object") {
        const rec = u as { name?: unknown; displayName?: unknown };
        const nm = typeof rec.name === "string" ? rec.name : null;
        const dn = typeof rec.displayName === "string" ? rec.displayName : null;
        return nm || dn || "";
      }
      return "";
    })();
    if (n && !firstName && !lastName) {
      const parts = String(n).trim().split(/\s+/);
      if (parts.length) setFirst(parts[0]);
      if (parts.length > 1) setLast(parts.slice(1).join(" "));
    }
  }, [user, firstName, lastName]);

  // Suggest currency when country changes
  useEffect(() => {
    if (!countryISO || displayCurrency) return;
    const cc = countryISO.toUpperCase();
    const cur = countryToCurrency[cc];
    if (cur) setCurrency(cur);
  }, [countryISO, displayCurrency]);

  // UI helpers
  const cISO = countryISO.trim().toUpperCase();
  const hasNames = !!firstName.trim() && !!lastName.trim();
  const hasFullAddress =
    !!line1.trim() &&
    !!city.trim() &&
    !!stateOrProvince.trim() &&
    !!postalCode.trim() &&
    cISO.length === 2;
  const hasDob = !!dob;
  const autoApproveReady = hasNames && hasFullAddress && hasDob;

  const currencyChoice = (displayCurrency || countryToCurrency[cISO] || "USD")
    .trim()
    .toUpperCase();

  const validate = useCallback((): boolean => {
    const fe: FieldErrors = {};
    if (!firstName.trim()) fe.firstName = "First name is required.";
    if (!lastName.trim()) fe.lastName = "Last name is required.";
    if (!cISO || !isISO2(cISO))
      fe.countryISO = "Use a valid 2-letter country code.";
    if (currencyChoice && !isISO3(currencyChoice))
      fe.displayCurrency = "Use a valid 3-letter currency.";
    if (!tos) fe.tos = "You must accept the Terms.";
    if (!privacy) fe.privacy = "You must accept the Privacy Policy.";
    // If DOB provided, enforce 18+
    if (dob && !isValidDob(dob)) fe.dob = "You must be at least 18 years old.";
    setFieldErrors(fe);
    return Object.keys(fe).length === 0;
  }, [firstName, lastName, cISO, currencyChoice, tos, privacy, dob]);

  const isFormMinValid = useMemo(
    () =>
      hasNames &&
      cISO.length === 2 &&
      isISO2(cISO) &&
      isISO3(currencyChoice) &&
      tos &&
      privacy,
    [hasNames, cISO, currencyChoice, tos, privacy]
  );

  const submit = useCallback(async () => {
    setErr(null);
    setFieldErrors({});
    if (!validate()) return;

    try {
      if (!ready || !authenticated) throw new Error("Please sign in first.");

      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Missing Privy access token.");

      setBusy(true);

      type OnboardRequest = {
        firstName: string;
        lastName: string;
        countryISO: string; // ISO-2
        displayCurrency?: string; // ISO-3
        phoneNumber?: string;
        dob?: string; // YYYY-MM-DD
        address?: {
          line1: string;
          line2?: string;
          city: string;
          stateOrProvince: string;
          postalCode: string;
          country?: string; // ISO-2
        };
        consents?: { tos?: boolean; privacy?: boolean };
      };

      const body: OnboardRequest = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        countryISO: cISO,
        displayCurrency: currencyChoice,
        consents: { tos, privacy },
      };

      // Only send optional PII if present (your API will instant-approve if full)
      if (hasFullAddress) {
        body.address = {
          line1: line1.trim(),
          line2: line2.trim(),
          city: city.trim(),
          stateOrProvince: stateOrProvince.trim(),
          postalCode: postalCode.trim(),
          country: cISO,
        };
      }
      if (dob) body.dob = dob;
      if (phoneNumber.trim()) body.phoneNumber = phoneNumber.trim();

      const res = await fetch("/api/auth/onboarding", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      });

      const text = await res.text();
      let data: unknown = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        /* non-JSON error */
      }

      if (!res.ok) {
        // Map server-side errors to field or banner
        const errMsg = (() => {
          if (data && typeof data === "object" && "error" in data) {
            const v = (data as Record<string, unknown>).error;
            return typeof v === "string" ? v : null;
          }
          return null;
        })();
        if (res.status === 400 && errMsg) {
          // try a few common messages from your API
          if (/countryISO/i.test(errMsg))
            setFieldErrors((p) => ({ ...p, countryISO: errMsg }));
          else if (/displayCurrency/i.test(errMsg))
            setFieldErrors((p) => ({ ...p, displayCurrency: errMsg }));
          else if (/First and last/i.test(errMsg)) {
            setFieldErrors((p) => ({
              ...p,
              firstName: "Required",
              lastName: "Required",
            }));
          } else if (/dob/i.test(errMsg)) {
            setFieldErrors((p) => ({ ...p, dob: errMsg }));
          } else {
            setErr(errMsg);
          }
        } else if (res.status === 403) {
          setFieldErrors((p) => ({
            ...p,
            countryISO: "Service unavailable in your country.",
          }));
        } else if (res.status === 404) {
          setErr("User not found.");
        } else {
          const genericMsg = (() => {
            if (data && typeof data === "object" && "error" in data) {
              const v = (data as Record<string, unknown>).error;
              return typeof v === "string" ? v : null;
            }
            return null;
          })();
          setErr(genericMsg || text || "Onboarding failed");
        }
        return;
      }

      const kycStatus: "none" | "pending" | "approved" | "rejected" | undefined =
        (() => {
          if (data && typeof data === "object" && "kycStatus" in data) {
            const v = (data as Record<string, unknown>).kycStatus;
            return v === "none" || v === "pending" || v === "approved" || v === "rejected"
              ? v
              : undefined;
          }
          return undefined;
        })();
      if (kycStatus === "approved") router.replace("/dashboard");
      else router.replace("/kyc/pending");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [
    validate,
    ready,
    authenticated,
    getAccessToken,
    firstName,
    lastName,
    cISO,
    currencyChoice,
    tos,
    privacy,
    hasFullAddress,
    line1,
    line2,
    city,
    stateOrProvince,
    postalCode,
    dob,
    phoneNumber,
    router,
  ]);

  if (!ready) return null;
  if (ready && !authenticated) {
    return (
      <div className="min-h-screen grid place-items-center text-white">
        <p className="text-zinc-300">Please sign in to continue.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white px-4 py-10">
      <div className="max-w-2xl mx-auto rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">
            Finish setting up your account
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Provide name, full address, and date of birth for instant approval.
          </p>
          <div
            className={`mt-3 text-xs rounded-lg px-3 py-2 border ${
              autoApproveReady
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                : "border-yellow-400/30 bg-yellow-400/10 text-yellow-300"
            }`}
          >
            {autoApproveReady
              ? "Eligible for instant approval"
              : "Add full address + DOB to be instantly approved"}
          </div>
        </header>

        {/* Basic profile */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">First name</label>
            <input
              value={firstName}
              onChange={(e) => setFirst(e.target.value)}
              autoCapitalize="words"
              className={`w-full rounded-lg bg-black/20 border px-3 py-2 outline-none focus:ring-2 ring-white/20 ${
                fieldErrors.firstName ? "border-red-500/50" : "border-white/10"
              }`}
            />
            {fieldErrors.firstName && (
              <p className="text-xs text-red-300 mt-1">
                {fieldErrors.firstName}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm mb-1">Last name</label>
            <input
              value={lastName}
              onChange={(e) => setLast(e.target.value)}
              autoCapitalize="words"
              className={`w-full rounded-lg bg-black/20 border px-3 py-2 outline-none focus:ring-2 ring-white/20 ${
                fieldErrors.lastName ? "border-red-500/50" : "border-white/10"
              }`}
            />
            {fieldErrors.lastName && (
              <p className="text-xs text-red-300 mt-1">
                {fieldErrors.lastName}
              </p>
            )}
          </div>

          {/* Country dropdown */}
          <div>
            <label className="block text-sm mb-1">Country</label>
            <select
              value={countryISO}
              onChange={(e) => setCountry(e.target.value)}
              className={`w-full rounded-lg bg-black/20 border px-3 py-2 outline-none focus:ring-2 ring-white/20 uppercase ${
                fieldErrors.countryISO ? "border-red-500/50" : "border-white/10"
              }`}
            >
              <option value="">Select your country</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
            {fieldErrors.countryISO && (
              <p className="text-xs text-red-300 mt-1">
                {fieldErrors.countryISO}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm mb-1">Display currency</label>
            <select
              value={displayCurrency}
              onChange={(e) => setCurrency(e.target.value)}
              className={`w-full rounded-lg bg-black/20 border px-3 py-2 outline-none focus:ring-2 ring-white/20 ${
                fieldErrors.displayCurrency
                  ? "border-red-500/50"
                  : "border-white/10"
              }`}
            >
              <option value="">
                {countryToCurrency[cISO]
                  ? `Auto (${countryToCurrency[cISO]})`
                  : "Auto from country"}
              </option>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-zinc-500">
              We’ll suggest a currency from your country. You can change it.
            </p>
            {fieldErrors.displayCurrency && (
              <p className="text-xs text-red-300 mt-1">
                {fieldErrors.displayCurrency}
              </p>
            )}
          </div>
        </div>

        {/* Address */}
        <div className="space-y-3">
          <h2 className="font-medium">Address</h2>
          <input
            placeholder="Address line 1"
            value={line1}
            onChange={(e) => setLine1(e.target.value)}
            className={`w-full rounded-lg bg-black/20 border px-3 py-2 outline-none focus:ring-2 ring-white/20 ${
              fieldErrors.line1 ? "border-red-500/50" : "border-white/10"
            }`}
          />
          <input
            placeholder="Address line 2 (optional)"
            value={line2}
            onChange={(e) => setLine2(e.target.value)}
            className="w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 outline-none focus:ring-2 ring-white/20"
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              placeholder="City"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className={`rounded-lg bg-black/20 border px-3 py-2 outline-none focus:ring-2 ring-white/20 ${
                fieldErrors.city ? "border-red-500/50" : "border-white/10"
              }`}
            />
            <input
              placeholder="State / Province"
              value={stateOrProvince}
              onChange={(e) => setState(e.target.value)}
              className={`rounded-lg bg-black/20 border px-3 py-2 outline-none focus:ring-2 ring-white/20 ${
                fieldErrors.stateOrProvince
                  ? "border-red-500/50"
                  : "border-white/10"
              }`}
            />
            <input
              placeholder="Postal code"
              value={postalCode}
              onChange={(e) => setPostal(e.target.value)}
              className={`rounded-lg bg-black/20 border px-3 py-2 outline-none focus:ring-2 ring-white/20 ${
                fieldErrors.postalCode ? "border-red-500/50" : "border-white/10"
              }`}
            />
          </div>
          {/* Info text */}
          <p className="text-xs text-zinc-500">
            Address is optional, but providing it with your date of birth may
            qualify you for instant approval.
          </p>
        </div>

        {/* DOB + Phone */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">Date of birth</label>
            <input
              type="date"
              value={dob}
              max={todayISO()}
              onChange={(e) => setDob(e.target.value)}
              className={`w-full rounded-lg bg-black/20 border px-3 py-2 outline-none focus:ring-2 ring-white/20 ${
                fieldErrors.dob ? "border-red-500/50" : "border-white/10"
              }`}
            />
            {fieldErrors.dob && (
              <p className="text-xs text-red-300 mt-1">{fieldErrors.dob}</p>
            )}
          </div>
          <div>
            <label className="block text-sm mb-1">Phone (optional)</label>
            <input
              placeholder="+1 555 123 4567"
              value={phoneNumber}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 outline-none focus:ring-2 ring-white/20"
            />
          </div>
        </div>

        {/* Consents */}
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={tos}
              onChange={(e) => setTos(e.target.checked)}
            />
            <span>I agree to the Terms of Service</span>
          </label>
          {fieldErrors.tos && (
            <p className="text-xs text-red-300">{fieldErrors.tos}</p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={privacy}
              onChange={(e) => setPrivacy(e.target.checked)}
            />
            <span>I agree to the Privacy Policy</span>
          </label>
          {fieldErrors.privacy && (
            <p className="text-xs text-red-300">{fieldErrors.privacy}</p>
          )}
        </div>

        {/* Error banner */}
        <div className="min-h-[1.25rem] text-sm">
          {err && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300">
              {err}
            </div>
          )}
        </div>

        <button
          onClick={submit}
          disabled={busy || !isFormMinValid}
          className="w-full rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-60 border border-white/20 px-4 py-2 transition"
        >
          {busy ? "Saving…" : "Continue"}
        </button>
      </div>
    </div>
  );
}
