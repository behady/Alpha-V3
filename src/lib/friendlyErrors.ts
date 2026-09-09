/**
 * What the sign-up screens say when a server route says no.
 *
 * The routes answer in English, and until now the screens showed that sentence as-is — so an
 * Arabic-speaking owner whose clinic name was rejected, or whose colleague's invite had expired,
 * read a message in the wrong language at the one moment they most needed to understand it.
 *
 * Routes now also return a short `code` beside `error`. This table turns a code into the sentence
 * for the reader's language; an unknown code falls back to a generic line rather than to the raw
 * server text, because "Failed to create clinic: 7 PERMISSION_DENIED" helps nobody who is not a
 * developer. Pure, so the table can be checked for completeness.
 */

export type ErrorCode =
  | "unauthorized"
  | "clinic-name-required"
  | "clinic-create-failed"
  | "clinic-id-required"
  | "clinic-not-found"
  | "already-member"
  | "join-failed"
  | "invite-not-found"
  | "invite-unusable"
  | "invite-revoked"
  | "invite-expired"
  | "invite-used"
  | "invite-failed"
  | "network";

type Lang = "en" | "ar";

export const ERROR_TEXT: Record<ErrorCode, { en: string; ar: string }> = {
  unauthorized: {
    en: "Your session has ended. Sign in again and try once more.",
    ar: "انتهت الجلسة. سجّل الدخول تاني وجرّب مرة كمان.",
  },
  "clinic-name-required": {
    en: "Type a name for your clinic first.",
    ar: "اكتب اسم العيادة الأول.",
  },
  "clinic-create-failed": {
    en: "We couldn't create the clinic just now. Wait a moment and press Create again — you won't get a second clinic.",
    ar: "معرفناش نعمل العيادة دلوقتي. استنى لحظة واضغط «إنشاء» تاني — مش هتتعمل عيادة تانية.",
  },
  "clinic-id-required": {
    en: "Paste the Clinic ID first.",
    ar: "الصق معرّف العيادة الأول.",
  },
  "clinic-not-found": {
    en: "No clinic has that ID. Check it with your clinic and try again — or ask them for an invite link instead.",
    ar: "مفيش عيادة بالمعرّف ده. اتأكد منه من العيادة وجرّب تاني — أو اطلب منهم رابط دعوة بدل كده.",
  },
  "already-member": {
    en: "You already work at this clinic. Sign in and it will be there.",
    ar: "انت بالفعل شغال في العيادة دي. سجّل الدخول وهتلاقيها.",
  },
  "join-failed": {
    en: "We couldn't send the request just now. Wait a moment and try again.",
    ar: "معرفناش نبعت الطلب دلوقتي. استنى لحظة وجرّب تاني.",
  },
  "invite-not-found": {
    en: "This invite link doesn't exist. Ask the clinic for a new one.",
    ar: "الرابط ده مش موجود. اطلب رابط جديد من العيادة.",
  },
  "invite-unusable": {
    en: "This invite link can't be used. Ask the clinic for a new one.",
    ar: "الرابط ده مينفعش يتستخدم. اطلب رابط جديد من العيادة.",
  },
  "invite-revoked": {
    en: "The clinic cancelled this invite link.",
    ar: "العيادة لغت الرابط ده.",
  },
  "invite-expired": {
    en: "This invite link has expired. Ask the clinic for a new one.",
    ar: "الرابط ده انتهت صلاحيته. اطلب رابط جديد من العيادة.",
  },
  "invite-used": {
    en: "This invite link has already been used. Ask the clinic for a new one.",
    ar: "الرابط ده اتستخدم بالفعل. اطلب رابط جديد من العيادة.",
  },
  "invite-failed": {
    en: "We couldn't add you to the clinic just now. Open the link again in a moment.",
    ar: "معرفناش نضيفك للعيادة دلوقتي. افتح الرابط تاني بعد لحظة.",
  },
  network: {
    en: "No connection. Check your internet and try again.",
    ar: "مفيش اتصال بالإنترنت. اتأكد من الشبكة وجرّب تاني.",
  },
};

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ERROR_TEXT, value);
}

/**
 * The sentence to show for a failed response.
 *
 * `payload` is whatever the route sent back (or nothing, when the request itself failed).
 * `fallback` is the code for "this operation failed and the server did not say why".
 */
export function friendlyError(
  payload: { code?: unknown; error?: unknown } | null | undefined,
  language: Lang,
  fallback: ErrorCode
): string {
  const code = isErrorCode(payload?.code) ? payload.code : fallback;
  return ERROR_TEXT[code][language];
}

/** A thrown fetch failure (offline, DNS) rather than a refusal the server wrote. */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError && /fetch|network/i.test(error.message);
}
