export function normalizeToE164WithCountryCode(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";

  // Keep a single leading + if present, strip all other non-digits.
  const startsWithPlus = value.startsWith("+");
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";

  let normalized = "";
  if (startsWithPlus) {
    normalized = `+${digits}`;
  } else if (value.startsWith("00")) {
    normalized = `+${digits.slice(2)}`;
  } else {
    // Reject local numbers without explicit international prefix.
    return "";
  }

  // E.164: + followed by 8..15 digits in practice for this app.
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) return "";
  return normalized;
}

export const COUNTRY_CODE_OPTIONS = [
  { code: "+20", label: "Egypt (+20)" },
  { code: "+966", label: "Saudi Arabia (+966)" },
  { code: "+971", label: "UAE (+971)" },
  { code: "+965", label: "Kuwait (+965)" },
  { code: "+974", label: "Qatar (+974)" },
  { code: "+968", label: "Oman (+968)" },
  { code: "+962", label: "Jordan (+962)" },
  { code: "+964", label: "Iraq (+964)" },
  { code: "+1", label: "USA/Canada (+1)" },
  { code: "+44", label: "UK (+44)" },
] as const;

export const DEFAULT_COUNTRY_CODE = "+20";

export function buildE164FromCountryCode(countryCode: string, localNumber: string): string {
  const local = String(localNumber || "").trim();
  if (!local) return "";

  // Allow users to paste full international number directly in the local input.
  if (local.startsWith("+") || local.startsWith("00")) {
    return normalizeToE164WithCountryCode(local);
  }

  const ccDigits = String(countryCode || "").replace(/\D/g, "");
  if (!ccDigits) return "";

  const localDigits = local.replace(/\D/g, "").replace(/^0+/, "");
  if (!localDigits) return "";

  return normalizeToE164WithCountryCode(`+${ccDigits}${localDigits}`);
}

export function splitE164ToCountryAndLocal(
  value: string,
  fallbackCountryCode = DEFAULT_COUNTRY_CODE
): { countryCode: string; localNumber: string } {
  const normalized = normalizeToE164WithCountryCode(value);
  if (!normalized) return { countryCode: fallbackCountryCode, localNumber: "" };

  const match = COUNTRY_CODE_OPTIONS
    .slice()
    .sort((a, b) => b.code.length - a.code.length)
    .find((opt) => normalized.startsWith(opt.code));

  if (!match) return { countryCode: fallbackCountryCode, localNumber: normalized.replace(/^\+/, "") };
  return {
    countryCode: match.code,
    localNumber: normalized.slice(match.code.length),
  };
}
