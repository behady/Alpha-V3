/**
 * Three things clinic owners asked the WhatsApp bot to stop, that came from code rather than from
 * the model — so no amount of coaching text could fix them:
 *
 *   1. dentist names in the booking/cancel cards, the slot labels and the AI's replies
 *      (settings/whatsapp `botHideDoctorNames`, default off);
 *   2. the "clinic is closed, we open at…" note under every hand-off (`botClosedNote`, default
 *      off — gated in respond.ts, nothing here);
 *   3. a second branch neither brain had ever been told about.
 *
 * The pure pieces live here so they can be tested: respond.ts itself cannot be imported by a
 * test. With the switch off and a single-branch clinic, everything below returns exactly what
 * respond.ts produced before it existed.
 *
 * Run: npm run test:bot-owner-rules
 */
import { arabicDayLabel, arabicTimeLabel } from "@/lib/arabicDateTime";
import type { ClinicBranch } from "@/lib/clinicLocations";

/** How an appointment reads in a chat message; `hideDoctor` drops the dentist line. */
export function appointmentLine(a: { date: string; time: string; doctor: string }, hideDoctor = false): string {
  const parts = [`📅 ${arabicDayLabel(a.date)}`, `⏰ ${arabicTimeLabel(a.time)}`];
  if (!hideDoctor && a.doctor && a.doctor.toLowerCase() !== "any") parts.push(`👨‍⚕️ ${a.doctor}`);
  return parts.join("\n");
}

/**
 * The clinic's branches as prompt lines, for a clinic that has more than one.
 *
 * Empty for no branches or one (the single address line already says it), and empty when no
 * branch has anything to say — an empty string keeps both prompts byte-identical to before.
 */
export function branchesTextOf(branches: ClinicBranch[] | undefined): string {
  if (!branches || branches.length < 2) return "";
  return branches
    .map((b) => {
      const name = String(b.name || "").trim();
      const address = String(b.address || "").trim();
      const phone = String(b.phone || "").trim();
      if (!address && !phone) return "";
      return `• ${name}${address ? `: ${address}` : ""}${phone ? ` — ت: ${phone}` : ""}`;
    })
    .filter(Boolean)
    .join("\n");
}

/** A title written before a name, in either script: "د. ", "دكتور ", "الدكتورة ", "Dr. ", "Doctor ". */
const TITLE_SOURCE = String.raw`(?:(?:ال)?دكتور[ةه]?|د\s*[./]|dr\.?|doctor)\s*`;
const TITLE_AT_START = new RegExp(`^${TITLE_SOURCE}`, "iu");

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The model's reply with every dentist's name replaced by "الدكتور" ("the doctor" in a reply
 * written mostly in Latin letters). A backstop for the prompt rule, used only while names are
 * hidden.
 *
 * Whole words only, any case, any spacing between the name's words, and a title in front of the
 * name goes with it ("د. محمد سمير" → "الدكتور", not "د. الدكتور"). An Arabic conjunction stuck to
 * the front ("ود. محمد") is kept: "والدكتور". Only full stored names are matched — a first name
 * on its own could be anybody, including the patient.
 */
export function stripDoctorNames(text: string, doctors: string[]): { text: string; stripped: boolean } {
  const cores = [...new Set(doctors.map((d) => String(d || "").trim().replace(TITLE_AT_START, "").trim()).filter((d) => d.length >= 2))].sort(
    (a, b) => b.length - a.length
  );
  if (!cores.length || !text) return { text, stripped: false };
  const latin = (text.match(/[A-Za-z]/g) || []).length > (text.match(/[؀-ۿ]/g) || []).length;
  const doctor = latin ? "the doctor" : "الدكتور";
  let out = text;
  let stripped = false;
  for (const core of cores) {
    const words = core.split(/\s+/).map(escapeRegExp).join(String.raw`\s+`);
    const re = new RegExp(String.raw`(?<![\p{L}\p{N}])([وفبل]?)(?:${TITLE_SOURCE})?${words}(?![\p{L}\p{N}])`, "giu");
    out = out.replace(re, (_m, prefix: string) => {
      stripped = true;
      if (!prefix) return doctor;
      // ل + الدكتور is written للدكتور; the others simply join.
      return latin ? `${prefix}${doctor}` : prefix === "ل" ? "للدكتور" : `${prefix}${doctor}`;
    });
  }
  return { text: out, stripped };
}
