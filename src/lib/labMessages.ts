/**
 * What the lab is told, in writing.
 *
 * The printed order travels in the bag; this is the same facts sent ahead so the lab has them
 * legibly even when the paper arrives smudged, or the case goes out as files with no paper at all.
 *
 * Two rules carry over from the printed sheet and are the reason this is its own module rather
 * than a string built at the call site:
 *
 *   - **Only the patient's FIRST name.** The full name does not leave the clinic, on paper or in a
 *     message. The code carries the identity.
 *   - **Only the fields this work type wants.** A surgical guide has no shade; sending one a shade
 *     line reading "—" invites a technician to go looking for the answer.
 *
 * Deliberately NOT routed through `patientNotifications`. That path carries the opt-out footer and
 * the consent checks, which exist to protect PATIENTS from a clinic that messages them. A lab is a
 * business the clinic buys from — it has no opt-out to honour, and stapling one to a work order
 * would be nonsense. Sending is a click-to-send `wa.me` open, so nothing is ever sent silently.
 */

import {
  ABUTMENT_OPTIONS,
  GUIDE_TYPE_OPTIONS,
  RETENTION_OPTIONS,
  formatPalmer,
  optionLabel,
  workTypeFor,
  workTypeLabel,
  type LabCase,
} from "@/lib/labCases";

function line(label: string, value: string | undefined | null): string | null {
  const v = String(value ?? "").trim();
  return v ? `${label}: ${v}` : null;
}

function fmtDate(iso: string | undefined, language: "en" | "ar"): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(language === "ar" ? "ar-EG" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The order as a WhatsApp message.
 *
 * Plain text with no formatting tricks: WhatsApp's own markup renders differently across the app,
 * the web client and the desktop build, and a lab order is not the place to find that out.
 */
export function buildLabOrderMessage(
  labCase: LabCase,
  clinicName: string,
  language: "en" | "ar"
): string {
  const isAr = language === "ar";
  const wt = workTypeFor(labCase.workType);
  const t = isAr
    ? {
        head: "أمر معمل",
        from: "من",
        patient: "المريض",
        work: "الشغل",
        units: "العدد",
        teeth: "الأسنان",
        material: "الخامة",
        body: "لون الجسم",
        cervical: "لون العنق",
        gum: "لون اللثة",
        implant: "الزرعة",
        platform: "المقاس",
        abutment: "الدعامة",
        retention: "التثبيت",
        guide: "الدليل",
        sleeve: "الكم",
        due: "ميعاد التسليم",
        price: "السعر المتفق عليه",
        notes: "ملاحظات",
        remake: "إعادة عمل — بدل",
        digital: "الملفات هتتبعت رقميًا.",
      }
    : {
        head: "Lab order",
        from: "From",
        patient: "Patient",
        work: "Work",
        units: "Units",
        teeth: "Teeth",
        material: "Material",
        body: "Body shade",
        cervical: "Cervical shade",
        gum: "Gum shade",
        implant: "Implant system",
        platform: "Platform",
        abutment: "Abutment",
        retention: "Retention",
        guide: "Guide type",
        sleeve: "Sleeve system",
        due: "Due back",
        price: "Agreed price",
        notes: "Notes",
        remake: "REMAKE — replaces",
        digital: "Files are being sent digitally.",
      };

  const parts: Array<string | null> = [
    `*${t.head} ${labCase.code}*`,
    clinicName ? `${t.from}: ${clinicName}` : null,
    labCase.remakeOfCode ? `${t.remake} ${labCase.remakeOfCode}` : null,
    "",
    // First name only. The code is the identity that travels.
    line(t.patient, labCase.patientFirstName),
    line(t.work, [workTypeLabel(labCase.workType, language), labCase.workDescription].filter(Boolean).join(" — ")),
    wt.units && labCase.units ? line(t.units, String(labCase.units)) : null,
    labCase.teeth.length ? line(t.teeth, formatPalmer(labCase.teeth, language)) : null,
    line(t.material, labCase.material),
    wt.bodyShade ? line(t.body, labCase.bodyShade) : null,
    wt.cervicalShade ? line(t.cervical, labCase.cervicalShade) : null,
    wt.gumShade ? line(t.gum, labCase.gumShade) : null,
    wt.implant ? line(t.implant, labCase.implantSystem) : null,
    wt.implant ? line(t.platform, labCase.implantPlatform) : null,
    wt.implant ? line(t.abutment, optionLabel(ABUTMENT_OPTIONS, labCase.abutmentType, language)) : null,
    wt.implant ? line(t.retention, optionLabel(RETENTION_OPTIONS, labCase.retention, language)) : null,
    wt.guide ? line(t.guide, optionLabel(GUIDE_TYPE_OPTIONS, labCase.guideType, language)) : null,
    wt.guide ? line(t.sleeve, labCase.sleeveSystem) : null,
    labCase.dueDate ? line(t.due, fmtDate(labCase.dueDate, language)) : null,
    // A price of zero is a real answer on a remake the lab is redoing at its own cost, and saying
    // "0" out loud is the point — it is the thing both sides need to have agreed.
    labCase.agreedPrice > 0 ? line(t.price, `${Math.round(labCase.agreedPrice).toLocaleString("en-US")} EGP`) : null,
    labCase.notes ? `${t.notes}: ${labCase.notes}` : null,
    labCase.sentVia === "digital" ? `\n${t.digital}` : null,
  ];

  return parts.filter((p) => p !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
