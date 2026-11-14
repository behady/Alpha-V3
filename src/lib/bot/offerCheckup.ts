import { normalizeReplyText } from "@/lib/patientMessaging";

/**
 * The check-up a patient already has in their offer.
 *
 * On 14/11/2026 a patient who tapped the clinic's "كشف + تنظيف وتلميع بـ 299" ad asked about
 * veneers, then "السعر كام", and was told "والكشف عموماً 200 ج.م". The clinic's ordinary
 * check-up fee sat in the prompt twice (the "الكشف" fact and a "كشف" service at 200), the owner's
 * coaching asks for the check-up on every price question, and nothing said that the offer the
 * patient came for already includes it. So a patient promised 299 for check-up + cleaning was
 * quoted a second, standalone check-up fee.
 *
 * Everything here is pure text. respond.ts decides once per turn whether this patient's offer
 * includes the check-up (`checkupIsInAdOffer`); when it does, the prompt hides the standalone fee
 * (`checkupPriceInOffer`, `CHECKUP_IN_OFFER_FACT`, `CHECKUP_IN_OFFER_RULE`) and the model's reply
 * is checked afterwards (`stripCheckupFee`), because the model skips soft rules and the fee can
 * still reach it from approved answers or earlier bot lines in the thread. When it does not, none
 * of this runs and every reply is exactly what it was.
 */

const latinDigits = (s: string) => String(s || "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
const wholeNumbers = (s: string) => [...latinDigits(s).matchAll(/\d[\d,]*/g)].map((m) => m[0].replace(/,/g, ""));
/** Figures that can be a price: 50+, at most six digits (a phone is not a price), and not a year. */
const priceNumbers = (s: string) =>
  wholeNumbers(s).filter((n) => n.length <= 6 && Number(n) >= 50 && !(Number(n) >= 1990 && Number(n) <= 2100));

/**
 * Names the check-up: كشف with و/ف/ب/ل/ك and the article in front ("للكشف", "بالكشف", "والكشف"),
 * or the English/Franco words. "اكتشف" and "مكشوف" are not the check-up.
 */
export function namesCheckup(s: string): boolean {
  return /(^| )[وفبلك]{0,3}(ال)?كشف/.test(normalizeReplyText(s)) || /\b(consultation|check-?up|examination|exam|kashf|kshf)\b/i.test(s || "");
}

/**
 * The patient came from an ad for the RUNNING offer, and that offer includes the check-up.
 *
 * True only when the offer text names the check-up AND the ad either names it too or quotes one
 * of the offer's own prices ("299"; a year such as 2026 does not count). An ad about anything
 * else keeps today's behaviour. There is deliberately no shortcut through the greeting's offer
 * line: offerForService returns the WHOLE offers text when the ad's service is named anywhere in
 * it, so a whitening ad at a clinic whose offers also mention "كشف مجاني مع التقويم" would pass.
 */
export function checkupIsInAdOffer(a: { adText: string; offersText: string }): boolean {
  const offers = a.offersText?.trim() || "";
  if (!offers || !namesCheckup(offers)) return false;
  const offerPrices = new Set(priceNumbers(offers));
  return namesCheckup(a.adText || "") || priceNumbers(a.adText || "").some((n) => offerPrices.has(n));
}

/** The ordinary check-up service, not a specialist one like "كشف تقويم". */
export function isPlainCheckup(name: string): boolean {
  const n = normalizeReplyText(name).replace(/^ال/, "");
  return /^(كشف|كشف عام|كشف عادي|كشف واستشاره|استشاره|consultation|examination|exam|check ?up|checkup)$/.test(n);
}

/** The prices of the clinic's plain check-up services, from its service documents. */
export function plainCheckupPrices(services: Array<Record<string, unknown>>): number[] {
  return services.filter((s) => isPlainCheckup(String(s.name || ""))).map((s) => Number(s.price) || 0);
}

const serviceName = (l: string) => l.replace(/\s*:\s*يبدأ من.*$/, "").trim();

/** The prompt's price list for this patient: the plain check-up line says it is in the offer. */
export function checkupPriceInOffer(priceLines: string): string {
  return (priceLines || "")
    .split("\n")
    .map((l) => {
      const n = serviceName(l);
      return n && n !== l.trim() && isPlainCheckup(n) ? `${n}: داخل في العرض للمريض ده` : l;
    })
    .join("\n");
}

/** Replaces the clinic's "الكشف" fact for this patient only. The price is the offer's, written above. */
export const CHECKUP_IN_OFFER_FACT = "للمريض ده الكشف جزء من العرض اللي جاي عشانه (تفاصيله وسعره في العروض فوق)، فمتقولوش سعر الكشف العادي.";
export const CHECKUP_IN_OFFER_RULE =
  "- المريض ده جاي من إعلان العرض، والكشف داخل في العرض: ممنوع تقوله سعر كشف لوحده (ولا \"الكشف عموماً بكام\"). لو اتكلمت عن الكشف قول إنه داخل في العرض. لو سأل عن علاج تاني، جاوب بسعره عادي وقوله إن الدكتور هيشوف الحالة في زيارة العرض.";

/** The ordinary fee figures: the "الكشف" fact + plain check-up services, minus the offer's own figures. */
export function checkupFees(consultation: string | undefined, checkupServicePrices: number[], offersText: string): string[] {
  const offer = new Set(priceNumbers(offersText));
  return [...new Set([...priceNumbers(consultation || ""), ...checkupServicePrices.filter((p) => p > 0).map((p) => String(Math.round(p)))])].filter(
    (n) => !offer.has(n)
  );
}

/** "وبيتخصم من العلاج" / "and it's deducted…" right after a fee clause belongs to the fee. */
const CONTINUES = /^\s*(?:و?\s*(?:(?:ده|دي)\s+)?(?:بي|بت|ي|ت)تخصم|(?:and\s+)?(?:it'?s\s+|is\s+)?deducted\b)/i;
/** Stands in for the dot of "ج.م" while the reply is cut into clauses, so it is not read as a full stop. */
const SAFE = "\u0001";

/**
 * The backstop behind the prompt. The first clause that names the check-up WITH one of the
 * ordinary fee figures becomes "والكشف نفسه داخل في العرض" (English: "the check-up itself is
 * included in the offer"); later such clauses go, and so does a "وبيتخصم…" clause right after
 * one. Every other clause, figure and time is left exactly as written. A clause that names the
 * check-up with no fee figure ("والكشف بيتخصم من العلاج"), or a fee figure that is not about the
 * check-up ("الحشو يبدأ من 200"), is not touched. No fees, or no fee figure in the reply: the
 * reply comes back unchanged.
 */
export function stripCheckupFee(reply: string, fees: string[]): { text: string; stripped: boolean } {
  const feeSet = new Set(fees);
  const quotesFee = (s: string) => wholeNumbers(s).some((n) => feeSet.has(n));
  if (!reply || !feeSet.size || !quotesFee(reply)) return { text: reply, stripped: false };
  const parts = reply.replace(/ج\.م/g, `ج${SAFE}م`).split(/([.!?؟]+[ \t]*|،[ \t]*|,[ \t]+|\n)/);
  const isComma = (s?: string) => /^[،,]/.test(s || "");
  const isBreak = (s?: string) => s === "\n";
  let replaced = false;
  let stripped = false;
  let dropNext = false;
  for (let i = 0; i < parts.length; i += 2) {
    const clause = parts[i];
    if (namesCheckup(clause) && quotesFee(clause)) {
      stripped = true;
      dropNext = true;
      const before = i > 0 ? parts[i - 1] : "\n";
      if (!replaced) {
        replaced = true;
        const lead = clause.match(/^\s*/)?.[0] ?? "";
        const latin = (clause.match(/[A-Za-z]/g) || []).length > (clause.match(/[؀-ۿ]/g) || []).length;
        const opens = isBreak(before) || /^[.!?؟]/.test(before);
        parts[i] = latin
          ? `${lead}${opens ? "The" : "and the"} check-up itself is included in the offer`
          : isBreak(before)
            ? "الكشف نفسه داخل في العرض"
            : `${lead}والكشف نفسه داخل في العرض`;
      } else {
        parts[i] = "";
        if (isComma(before)) parts[i - 1] = "";
        else if (i + 1 < parts.length && !isBreak(parts[i + 1])) parts[i + 1] = "";
      }
    } else if (dropNext && CONTINUES.test(clause)) {
      parts[i] = "";
      if (isComma(parts[i - 1])) parts[i - 1] = "";
    } else if (clause.trim()) dropNext = false;
  }
  let text = parts.join("").split(SAFE).join(".").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  // Said twice? When the rest of the reply already says the offer covers the check-up, the added words go.
  const rest = text.replace(/و?الكشف نفسه داخل في العرض/, "");
  if (/عرض/.test(rest) && namesCheckup(rest))
    text = text
      .replace(/[،,]\s*والكشف نفسه داخل في العرض/, "")
      .replace(/(^|[.!?؟]\s+|\n)و?الكشف نفسه داخل في العرض[.!]?[ \t]*/, "$1")
      .trim();
  return { text: text || "الكشف نفسه داخل في العرض 👍", stripped };
}
