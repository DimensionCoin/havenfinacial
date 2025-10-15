"use client";

import { useCallback, useEffect, useState } from "react";
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

// narrow helpers for API responses
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
type KycStatus = "none" | "pending" | "approved" | "rejected";

/* ---------------------- NEW: token refresh helpers ---------------------- */
/** Try to mint a fresh Privy token; fallback to polling until non-null. */
async function getFreshAccessToken(
  getAccessToken: (opts?: unknown) => Promise<string | null>,
  maxMs = 15_000
): Promise<string> {
  const start = Date.now();

  // Prefer a "fresh" read when supported by the SDK
  try {
    const fresh = await getAccessToken({ fresh: true });
    if (fresh) return fresh;
  } catch {
    /* ignore */
  }

  // Otherwise poll for a stable token
  while (Date.now() - start < maxMs) {
    try {
      const t = await getAccessToken();
      if (t) return t;
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Could not obtain a fresh access token");
}

/** After onboarding, ensure fresh token then hard reload to next route. */
async function postOnboardRefresh(
  getAccessToken: (opts?: unknown) => Promise<string | null>,
  nextPath: string
) {
  try {
    await getFreshAccessToken(getAccessToken, 15_000);
  } catch {
    // even if minting fails, proceed with reload to shake stale state
  }
  if (typeof window !== "undefined") {
    window.location.replace(nextPath);
  }
}
/* ----------------------------------------------------------------------- */

export default function OnboardingPage() {
  const router = useRouter();
  const { ready, authenticated, getAccessToken, user } = usePrivy();

  // Required
  const [firstName, setFirst] = useState("");
  const [lastName, setLast] = useState("");
  const [countryISO, setCountry] = useState("");
  const [displayCurrency, setCurrency] = useState("");

  // Optional PII
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

  // NEW: risk profile (basic)
  const [riskTolerance, setRiskTolerance] = useState<
    "low" | "medium" | "high" | ""
  >("");
  const [experience, setExperience] = useState<
    "beginner" | "intermediate" | "advanced" | ""
  >("");
  const [horizon, setHorizon] = useState<"short" | "medium" | "long" | "">("");

  // UI state
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // NEW: step state
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);

  // Prefill first/last from Privy
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

  useEffect(() => {
    if (!ready || !authenticated) return;
    // pre-warm a fresh token so the embedded wallet is ready for next actions
    void getFreshAccessToken(getAccessToken).catch(() => {});
  }, [ready, authenticated, getAccessToken]);


  // Helpers
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
    if (dob && !isValidDob(dob)) fe.dob = "You must be at least 18 years old.";
    setFieldErrors(fe);
    return Object.keys(fe).length === 0;
  }, [firstName, lastName, cISO, currencyChoice, tos, privacy, dob]);

  // Your existing submit (unchanged UX; only success redirect is updated)
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
        dob?: string;
        risk?: { tolerance?: string; experience?: string; horizon?: string };
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
        risk: {
          tolerance: riskTolerance || undefined,
          experience: experience || undefined,
          horizon: horizon || undefined,
        },
      };

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
      } catch {}

      if (!res.ok) {
        // Extract error message safely
        const errMsg =
          isRecord(data) && typeof data.error === "string" ? data.error : null;

        if (res.status === 400 && errMsg) {
          if (/countryISO/i.test(errMsg))
            setFieldErrors((p) => ({ ...p, countryISO: errMsg }));
          else if (/displayCurrency/i.test(errMsg))
            setFieldErrors((p) => ({ ...p, displayCurrency: errMsg }));
          else if (/First and last/i.test(errMsg))
            setFieldErrors((p) => ({
              ...p,
              firstName: "Required",
              lastName: "Required",
            }));
          else if (/dob/i.test(errMsg))
            setFieldErrors((p) => ({ ...p, dob: errMsg }));
          else setErr(errMsg);
        } else if (res.status === 403) {
          setFieldErrors((p) => ({
            ...p,
            countryISO: "Service unavailable in your country.",
          }));
        } else if (res.status === 404) {
          setErr("User not found.");
        } else {
          const genericMsg =
            isRecord(data) && typeof data.error === "string"
              ? data.error
              : null;
          setErr(genericMsg || text || "Onboarding failed");
        }
        return;
      }

      // Extract kycStatus safely
      const rawKyc =
        isRecord(data) && typeof data.kycStatus === "string"
          ? (data.kycStatus as string)
          : undefined;
      const kycStatus: KycStatus | undefined =
        rawKyc &&
        (["none", "pending", "approved", "rejected"] as const).includes(
          rawKyc as KycStatus
        )
          ? (rawKyc as KycStatus)
          : undefined;

      // 🔧 REPAIRED: force a fresh token + hard reload to ensure embedded wallet availability
      const next = kycStatus === "approved" ? "/dashboard" : "/kyc/pending";
      await postOnboardRefresh(getAccessToken, next);
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
    riskTolerance,
    experience,
    horizon,
  ]);

  if (!ready) return null;
  if (ready && !authenticated) {
    return (
      <div className="min-h-screen grid place-items-center text-white">
        <p className="text-zinc-300">Please sign in to continue.</p>
      </div>
    );
  }

  // Step gating
  const canNext =
    (step === 0 &&
      firstName.trim() &&
      lastName.trim() &&
      (!dob || isValidDob(dob))) ||
    (step === 1 &&
      cISO.length === 2 &&
      isISO2(cISO) &&
      isISO3(currencyChoice)) ||
    (step === 2 && riskTolerance && experience && horizon) ||
    (step === 3 && tos && privacy);

  const goNext = () => setStep((s) => Math.min(3, s + 1) as 0 | 1 | 2 | 3);
  const goPrev = () => setStep((s) => Math.max(0, s - 1) as 0 | 1 | 2 | 3);

  // Little inline “clip art” icons (SVG)
  const IconShield = () => (
    <svg viewBox="0 0 24 24" className="h-10 w-10 text-[rgb(182,255,62)]">
      <path
        fill="currentColor"
        d="M12 2l7 3v6c0 5-3.4 9.7-7 11-3.6-1.3-7-6-7-11V5l7-3z"
      />
    </svg>
  );
  const IconId = () => (
    <svg viewBox="0 0 24 24" className="h-10 w-10 text-[rgb(182,255,62)]">
      <rect x="3" y="5" width="18" height="14" rx="2" fill="currentColor" />
      <circle cx="9" cy="12" r="2.5" fill="black" />
      <rect x="13" y="10" width="6" height="2" fill="black" />
      <rect x="13" y="13.5" width="6" height="2" fill="black" />
    </svg>
  );
  const IconHome = () => (
    <svg viewBox="0 0 24 24" className="h-10 w-10 text-[rgb(182,255,62)]">
      <path fill="currentColor" d="M12 3l9 8h-3v9h-5v-6H11v6H6v-9H3l9-8z" />
    </svg>
  );
  const IconChart = () => (
    <svg viewBox="0 0 24 24" className="h-10 w-10 text-[rgb(182,255,62)]">
      <rect x="3" y="10" width="4" height="11" fill="currentColor" />
      <rect x="10" y="6" width="4" height="15" fill="currentColor" />
      <rect x="17" y="2" width="4" height="19" fill="currentColor" />
    </svg>
  );

  return (
    <main className="relative min-h-[100svh] bg-black/60 text-white overflow-hidden ">
      {/* Ambient background */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(60%_40%_at_80%_10%,rgba(182,255,62,0.08),transparent),radial-gradient(40%_30%_at_10%_80%,rgba(182,255,62,0.06),transparent)]" />
        <div className="absolute inset-0 opacity-[0.05] [background:linear-gradient(rgba(255,255,255,0.15)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.15)_1px,transparent_1px)] [background-size:28px_28px]" />
      </div>

      <div className="pwa-top-offset px-4 py-10 mt-4">
        <div className="mx-auto w-full max-w-2xl">
          {/* Header */}
          <header className="mb-6 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-[rgb(182,255,62)]/30 bg-[rgb(182,255,62)]/10 px-3 py-1 text-xs text-[rgb(182,255,62)]">
              <IconShield />
              <span className="font-medium">Bank-grade protection</span>
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">
              Finish setting up your account
            </h1>
            <p className="mt-1 text-sm text-white/60">
              A few quick steps to secure your Haven and personalize your
              experience.
            </p>
          </header>

          {/* Progress */}
          <div className="mb-6">
            <div className="flex items-center justify-between text-xs text-white/60">
              {["You", "Address", "Risk", "Review"].map((label, i) => (
                <div key={label} className="flex-1 flex items-center">
                  <div
                    className={`h-8 min-w-[2rem] px-2 rounded-full flex items-center justify-center border ${
                      step >= i
                        ? "border-[rgb(182,255,62)]/50 bg-[rgb(182,255,62)]/15 text-white"
                        : "border-white/10 bg-white/[0.04] text-white/60"
                    }`}
                  >
                    {i + 1}
                  </div>
                  {i < 3 && (
                    <div
                      className={`mx-2 h-px flex-1 ${
                        step > i ? "bg-[rgb(182,255,62)]/60" : "bg-white/10"
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Card */}
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl shadow-[0_10px_50px_rgba(0,0,0,0.45)]">
            {/* subtle ring */}
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-px rounded-[1.5rem] ring-1 ring-white/10"
            />

            <div className="p-6 md:p-8 space-y-6">
              {/* Step title + icon */}
              <div className="flex items-center gap-3">
                {step === 0 && <IconId />}
                {step === 1 && <IconHome />}
                {step === 2 && <IconChart />}
                {step === 3 && <IconShield />}
                <div>
                  <h2 className="text-lg font-semibold">
                    {step === 0 && "Personal details"}
                    {step === 1 && "Address & currency"}
                    {step === 2 && "Your risk profile"}
                    {step === 3 && "Review & consents"}
                  </h2>
                  <p className="text-xs text-white/60">
                    {step === 0 &&
                      "Tell us who you are to personalize your account."}
                    {step === 1 &&
                      "This helps us suggest local currency and verify eligibility."}
                    {step === 2 &&
                      "We use this to tune product tips—never to limit you."}
                    {step === 3 && "Confirm details and accept to continue."}
                  </p>
                </div>
              </div>

              {/* STEP CONTENTS */}
              {step === 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm mb-1">First name</label>
                    <input
                      value={firstName}
                      onChange={(e) => setFirst(e.target.value)}
                      className={`w-full rounded-xl bg-black/30 border px-3 py-2 outline-none focus:ring-2 ring-[rgb(182,255,62)]/30 ${
                        fieldErrors.firstName
                          ? "border-red-500/50"
                          : "border-white/10"
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
                      className={`w-full rounded-xl bg-black/30 border px-3 py-2 outline-none focus:ring-2 ring-[rgb(182,255,62)]/30 ${
                        fieldErrors.lastName
                          ? "border-red-500/50"
                          : "border-white/10"
                      }`}
                    />
                    {fieldErrors.lastName && (
                      <p className="text-xs text-red-300 mt-1">
                        {fieldErrors.lastName}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm mb-1">Date of birth</label>
                    <input
                      type="date"
                      value={dob}
                      max={todayISO()}
                      onChange={(e) => setDob(e.target.value)}
                      className={`w-full rounded-xl bg-black/30 border px-3 py-2 outline-none focus:ring-2 ring-[rgb(182,255,62)]/30 ${
                        fieldErrors.dob
                          ? "border-red-500/50"
                          : "border-white/10"
                      }`}
                    />
                    {fieldErrors.dob && (
                      <p className="text-xs text-red-300 mt-1">
                        {fieldErrors.dob}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm mb-1">
                      Phone (optional)
                    </label>
                    <input
                      placeholder="+1 555 123 4567"
                      value={phoneNumber}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2 outline-none focus:ring-2 ring-[rgb(182,255,62)]/30"
                    />
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm mb-1">Country</label>
                      <select
                        value={countryISO}
                        onChange={(e) => setCountry(e.target.value)}
                        className={`w-full rounded-xl bg-black/30 border px-3 py-2 outline-none focus:ring-2 ring-[rgb(182,255,62)]/30 uppercase ${
                          fieldErrors.countryISO
                            ? "border-red-500/50"
                            : "border-white/10"
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
                      <label className="block text-sm mb-1">
                        Display currency
                      </label>
                      <select
                        value={displayCurrency}
                        onChange={(e) => setCurrency(e.target.value)}
                        className={`w-full rounded-xl bg-black/30 border px-3 py-2 outline-none focus:ring-2 ring-[rgb(182,255,62)]/30 ${
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
                      <p className="mt-1 text-xs text-white/50">
                        We’ll suggest a currency from your country. You can
                        change it.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Address</h3>
                    <input
                      placeholder="Address line 1"
                      value={line1}
                      onChange={(e) => setLine1(e.target.value)}
                      className={`w-full rounded-xl bg-black/30 border px-3 py-2 outline-none focus:ring-2 ring-[rgb(182,255,62)]/30 ${
                        fieldErrors.line1
                          ? "border-red-500/50"
                          : "border-white/10"
                      }`}
                    />
                    <input
                      placeholder="Address line 2 (optional)"
                      value={line2}
                      onChange={(e) => setLine2(e.target.value)}
                      className="w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2 outline-none focus:ring-2 ring-[rgb(182,255,62)]/30"
                    />
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <input
                        placeholder="City"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        className={`rounded-xl bg-black/30 border px-3 py-2 outline-none focus:ring-2 ring-[rgb(182,255,62)]/30 ${
                          fieldErrors.city
                            ? "border-red-500/50"
                            : "border-white/10"
                        }`}
                      />
                      <input
                        placeholder="State / Province"
                        value={stateOrProvince}
                        onChange={(e) => setState(e.target.value)}
                        className={`rounded-xl bg-black/30 border px-3 py-2 outline-none focus:ring-2 ring-[rgb(182,255,62)]/30 ${
                          fieldErrors.stateOrProvince
                            ? "border-red-500/50"
                            : "border-white/10"
                        }`}
                      />
                      <input
                        placeholder="Postal code"
                        value={postalCode}
                        onChange={(e) => setPostal(e.target.value)}
                        className={`rounded-xl bg-black/30 border px-3 py-2 outline-none focus:ring-2 ring-[rgb(182,255,62)]/30 ${
                          fieldErrors.postalCode
                            ? "border-red-500/50"
                            : "border-white/10"
                        }`}
                      />
                    </div>
                    <p className="text-xs text-white/50">
                      Providing full address with your date of birth may qualify
                      you for instant approval.
                    </p>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="block text-sm">Risk tolerance</label>
                    <select
                      value={riskTolerance}
                      onChange={(e) =>
                        setRiskTolerance(
                          e.target.value as "low" | "medium" | "high" | ""
                        )
                      }
                      className="w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2 outline-none focus:ring-2 ring-[rgb(182,255,62)]/30"
                    >
                      <option value="">Choose…</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm">Experience</label>
                    <select
                      value={experience}
                      onChange={(e) =>
                        setExperience(
                          e.target.value as
                            | "beginner"
                            | "intermediate"
                            | "advanced"
                            | ""
                        )
                      }
                      className="w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2 outline-none focus:ring-2 ring-[rgb(182,255,62)]/30"
                    >
                      <option value="">Choose…</option>
                      <option value="beginner">Beginner</option>
                      <option value="intermediate">Intermediate</option>
                      <option value="advanced">Advanced</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm">Time horizon</label>
                    <select
                      value={horizon}
                      onChange={(e) =>
                        setHorizon(
                          e.target.value as "short" | "medium" | "long" | ""
                        )
                      }
                      className="w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2 outline-none focus:ring-2 ring-[rgb(182,255,62)]/30"
                    >
                      <option value="">Choose…</option>
                      <option value="short">0–1 years</option>
                      <option value="medium">1–3 years</option>
                      <option value="long">3+ years</option>
                    </select>
                  </div>
                  <div className="md:col-span-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
                    We use these answers to tailor education and defaults. They
                    do not restrict how you use Haven.
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm">
                    <div className="flex flex-wrap gap-3 text-white/80">
                      <span className="px-2 py-1 rounded-lg bg-black/30 border border-white/10">
                        {firstName || "—"} {lastName || ""}
                      </span>
                      <span className="px-2 py-1 rounded-lg bg-black/30 border border-white/10">
                        {cISO || "—"} • {currencyChoice || "—"}
                      </span>
                      {line1 && (
                        <span className="px-2 py-1 rounded-lg bg-black/30 border border-white/10">
                          {line1}
                        </span>
                      )}
                      {city && (
                        <span className="px-2 py-1 rounded-lg bg-black/30 border border-white/10">
                          {city}
                        </span>
                      )}
                      {stateOrProvince && (
                        <span className="px-2 py-1 rounded-lg bg-black/30 border border-white/10">
                          {stateOrProvince}
                        </span>
                      )}
                      {postalCode && (
                        <span className="px-2 py-1 rounded-lg bg-black/30 border border-white/10">
                          {postalCode}
                        </span>
                      )}
                    </div>
                  </div>

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
                      <p className="text-xs text-red-300">
                        {fieldErrors.privacy}
                      </p>
                    )}
                  </div>

                  {/* Instant approval badge */}
                  <div
                    className={`text-xs rounded-lg px-3 py-2 border ${
                      autoApproveReady
                        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                        : "border-yellow-400/30 bg-yellow-400/10 text-yellow-300"
                    }`}
                  >
                    {autoApproveReady
                      ? "Eligible for instant approval"
                      : "Add full address + DOB to be instantly approved"}
                  </div>
                </div>
              )}

              {/* Errors */}
              <div
                role="alert"
                aria-live="polite"
                className="min-h-[1.25rem] text-sm"
              >
                {err && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300">
                    {err}
                  </div>
                )}
              </div>

              {/* Nav buttons */}
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={goPrev}
                  disabled={step === 0 || busy}
                  className="rounded-xl px-4 py-2 text-sm border border-white/10 bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-50"
                >
                  Back
                </button>

                {step < 3 ? (
                  <button
                    onClick={goNext}
                    disabled={!canNext || busy}
                    className="rounded-xl px-5 py-2 text-sm font-semibold bg-[rgb(182,255,62)] text-black hover:bg-[rgb(182,255,62)]/90 disabled:opacity-50"
                  >
                    Continue
                  </button>
                ) : (
                  <button
                    onClick={submit}
                    disabled={busy || !tos || !privacy}
                    className="rounded-xl px-5 py-2 text-sm font-semibold bg-[rgb(182,255,62)] text-black hover:bg-[rgb(182,255,62)]/90 disabled:opacity-50"
                  >
                    {busy ? "Saving…" : "Finish & continue"}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Tiny reassurance footer */}
          <p className="mt-6 text-center text-[11px] text-white/45">
            Your info is encrypted in transit and at rest. You control your
            data.
          </p>
        </div>
      </div>
    </main>
  );
}
