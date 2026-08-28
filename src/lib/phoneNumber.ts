/**
 * Arabic-Indic and Extended Arabic-Indic digits, folded to ASCII.
 *
 * Not cosmetic: a phone typed on an Arabic keyboard reaches Firestore as `٠١٢...`, and every
 * routine here strips non-digits with \D — which erases those characters completely, turning a
 * real number into an empty string. Records in the live database carry exactly that shape.
 */
export function foldArabicDigits(raw: string): string {
  return String(raw ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function normalizeToE164WithCountryCode(raw: string): string {
  const value = foldArabicDigits(raw).trim();
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

/**
 * E.164 for a number written the way people in the clinic's own country write it.
 *
 * `normalizeToE164WithCountryCode` refuses anything without an explicit international prefix, and
 * that refusal is correct where it is used: for a number typed into a form, guessing a country and
 * messaging a stranger in it is worse than rejecting the input.
 *
 * It is wrong for a patient already on the books. Receptionists type `01024348877`, because that
 * is what an Egyptian mobile looks like on a business card — and because the strict rule was the
 * only one available, every one of those patients was silently unreachable: WhatsApp threw
 * "Invalid destination phone" before dialling and SMS skipped them as `missing_phone`. Nobody
 * reports the reminder that never arrived.
 *
 * So this is the *stored patient* normaliser: a bare national number is read as belonging to the
 * clinic's country. Anything already carrying `+` or `00` keeps the country it names.
 */
export function normalizeToE164AssumingCountry(raw: string, countryCode: string = DEFAULT_COUNTRY_CODE): string {
  const strict = normalizeToE164WithCountryCode(raw);
  if (strict) return strict;

  const digits = foldArabicDigits(raw).replace(/\D/g, "");
  if (!digits) return "";

  const cc = String(countryCode || DEFAULT_COUNTRY_CODE).replace(/\D/g, "");
  if (!cc) return "";

  // A leading zero is the national trunk prefix and is dropped when the country code goes on.
  const national = digits.replace(/^0+/, "");
  if (!national) return "";

  // Already carries the country code without a plus, e.g. "201024348877" straight from WhatsApp.
  if (digits.startsWith(cc) && digits.length > cc.length) {
    return normalizeToE164WithCountryCode(`+${digits}`);
  }

  return normalizeToE164WithCountryCode(`+${cc}${national}`);
}
