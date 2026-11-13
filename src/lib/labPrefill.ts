/**
 * What a lab order can know before anybody types.
 *
 * An order raised from a treatment already arrives with the patient, the dentist and the teeth.
 * The two boxes left empty were the two with the most obvious answers: the kind of work, which the
 * treatment's own name says, and the lab, which is wherever the clinic sent this work last time.
 *
 * Both are offers. They fill an empty box and never replace something a person typed.
 */

import type { LabWorkTypeId } from "@/lib/labCases";

/** Lower case, one space between words, and the Arabic alef written one way. */
function norm(text: string | null | undefined): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[إأآ]/g, "ا")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The catalogue's kind of work for a treatment's name, or "" when the name does not say.
 *
 * Read in this order on purpose. What the work sits on comes before what it is made of, because a
 * zirconia crown on an implant needs the implant's details on the order, not just a shade. And a
 * veneer is never guessed as porcelain-on-metal: the two are different pieces of work that happen
 * to share a word.
 */
export function workTypeFromTreatment(name: string | null | undefined): LabWorkTypeId | "" {
  const t = norm(name);
  if (!t) return "";
  const has = (re: RegExp) => re.test(t);

  if (has(/surgical guide|دليل جراحي/)) return "surgical_guide";
  if (has(/implant|زرع/) && has(/crown|bridge|تاج|تركيب|كوبري|zircon|زيركون|pfm|e[\s.-]?max|بورسل/)) return "implant_crown";
  if (has(/aligner|تقويم شفاف/)) return "aligner";
  if (has(/night\s*guard|bite\s*guard|واقي ليلي|نايت/)) return "night_guard";
  if (has(/cobalt|chrome|vitallium|كروم|فيتاليوم/)) return "cobalt_chrome";
  if (has(/(full|complete) denture|طقم كامل/)) return "full_denture";
  if (has(/partial denture|flexible denture|طقم جزئي/)) return "partial_denture";
  if (has(/repair|reline|rebase|اصلاح|تصليح|تبطين/)) return "acrylic_repair";
  if (has(/zircon|زيركون|زركون/)) return "zirconia";
  if (has(/e[\s.-]?max|اي ماكس|ايماكس|lithium/)) return "emax";
  if (has(/pmma|temporary|مؤقت/)) return "pmma";
  if (has(/veneer|فينير/)) return "";
  if (has(/pfm|metal ceramic|porcelain|بورسلين|بورسلان/)) return "pfm";
  return "";
}

export type PastLabOrder = { labName?: string; workType?: string; workDescription?: string };

/**
 * The work type and lab to offer for an order raised from this treatment.
 *
 * `past` is the clinic's recent orders, newest first. The last order raised from the SAME
 * treatment answers both questions, and it is the clinic's own answer, so it wins over anything
 * read from the name. A treatment never sent before gets its work type from its name, and the lab
 * that kind of work last went to.
 *
 * An order with no treatment behind it is not guessed at all.
 */
export function prefillFromPast(
  past: readonly PastLabOrder[],
  treatmentName: string | null | undefined
): { workType: string; labName: string } {
  const key = norm(treatmentName);
  if (!key) return { workType: "", labName: "" };

  const same = past.find((c) => norm(c.workDescription) === key && String(c.workType || "").trim());
  const workType = String(same?.workType || "").trim() || workTypeFromTreatment(treatmentName);
  const labName =
    String(same?.labName || "").trim() ||
    (workType ? String(past.find((c) => c.workType === workType && String(c.labName || "").trim())?.labName || "").trim() : "");
  return { workType, labName };
}
