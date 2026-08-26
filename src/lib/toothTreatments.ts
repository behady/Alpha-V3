/**
 * What has actually been DONE to each tooth, worked out from the clinical notes.
 *
 * The odontogram has always shown one thing: diagnoses a dentist typed onto a tooth by hand,
 * stored in `patients.teethData`. It has never shown a single procedure the clinic performed.
 * Book a root canal, do it, charge for it — the chart still says "pulp necrosis" and nothing
 * else, because nothing has ever connected `clinical_notes` to the picture of the mouth.
 *
 * So the chart answered "what is wrong with this patient" and could not answer "what have we
 * done about it", which is the question actually asked at the chair.
 *
 * DERIVED, NEVER STORED. This reads the notes at render time and writes nothing. Copying
 * treatments into `patients.teethData` would be faster to draw and wrong in a way nobody would
 * notice for months: that field is written wholesale with no per-tooth history (the recycle bin
 * says so in as many words), the AI assistant writes it too, and a note edited to a different
 * tooth or deleted afterwards would leave a treatment painted on the chart with nothing behind
 * it. A derived chart cannot drift from the record, because it IS the record.
 *
 * The separation of channels matters as much as the data:
 *
 *   the GLOW around a tooth  = what is WRONG with it        (diagnosis, unchanged)
 *   the BODY of the tooth    = what has been DONE to it     (this module)
 *
 * They must never compete for the same channel. A dentist reading a red halo has to know it means
 * caries, not "we filled it" — and the whole point of the owner asking for shape as well as colour
 * is that the second question should be answerable at a glance, in greyscale, with gloves on.
 */

import { parseTeethString } from "@/components/clinical-notes/utils";

/** Notes carry a status; only some of them describe work that has actually happened. */
export type NoteStatus = "Planned" | "Ongoing" | "Completed";

export type TreatmentStateId =
  | "extracted"
  | "implant"
  | "crowned"
  | "veneered"
  | "root_canal"
  | "filled"
  | "perio"
  | "treated";

export type TreatmentState = {
  id: TreatmentStateId;
  labelEn: string;
  labelAr: string;
  /**
   * Where the mark goes on the tooth. Kept apart from the diagnosis glow on purpose — see the
   * note at the top. `form` replaces the tooth's own artwork, `mark` draws over it.
   */
  channel: "form" | "mark";
  /**
   * The steel-and-slate family, deliberately. Diagnoses already own the warm and saturated end of
   * the spectrum (red caries, orange pulp, amber periapical, yellow sensitivity), and treatment is
   * not a warning — it is work that has been done. Reading as dental material rather than as alarm
   * is both truer and the only way to stay clear of eleven colours that are already spoken for.
   */
  color: string;
  /**
   * Higher wins when one tooth carries several. Clinical finality, not recency: an extracted tooth
   * is gone whatever was done to it in 2019, and a crown covers the filling underneath it.
   */
  precedence: number;
};

export const TREATMENT_STATES: Record<TreatmentStateId, TreatmentState> = {
  extracted:  { id: "extracted",  labelEn: "Extracted",        labelAr: "مخلوع",          channel: "form", color: "#334155", precedence: 100 },
  implant:    { id: "implant",    labelEn: "Implant",          labelAr: "زرعة",           channel: "form", color: "#0f766e", precedence: 90 },
  crowned:    { id: "crowned",    labelEn: "Crown",            labelAr: "تاج",            channel: "form", color: "#94a3b8", precedence: 80 },
  veneered:   { id: "veneered",   labelEn: "Veneer",           labelAr: "فينير",          channel: "form", color: "#e2e8f0", precedence: 70 },
  root_canal: { id: "root_canal", labelEn: "Root canal",       labelAr: "علاج عصب",       channel: "mark", color: "#0284c7", precedence: 60 },
  filled:     { id: "filled",     labelEn: "Filling",          labelAr: "حشو",            channel: "mark", color: "#1d4ed8", precedence: 50 },
  perio:      { id: "perio",      labelEn: "Gum treatment",    labelAr: "علاج لثة",       channel: "mark", color: "#0891b2", precedence: 40 },
  treated:    { id: "treated",    labelEn: "Treated",          labelAr: "تم علاجه",       channel: "mark", color: "#64748b", precedence: 10 },
};

/**
 * Which service categories describe work done to ONE named tooth.
 *
 * The five left out are left out because they are not true of a tooth: a scale and polish, a
 * whitening, a check-up, a course of orthodontics and a denture are things done to a mouth.
 * Painting them onto all thirty-two teeth would turn the chart grey for every returning patient
 * and teach the dentist to ignore it, which costs more than the information is worth.
 *
 * `pediatric` and `other` map to the generic `treated` rather than being dropped: the dentist
 * named specific teeth, and silently discarding that is the chart lying by omission. It says
 * "something was done here, open the note" — which is honest, and is all it can honestly say.
 */
const CATEGORY_TO_STATE: Record<string, TreatmentStateId | null> = {
  surgery: "extracted",
  implants: "implant",
  crowns: "crowned",
  veneers: "veneered",
  endo: "root_canal",
  restorative: "filled",
  perio: "perio",
  pediatric: "treated",
  other: "treated",
  // Not true of a single tooth.
  diagnostics: null,
  prevention: null,
  whitening: null,
  ortho: null,
  prostho: null,
};

export function treatmentForCategory(category: string | undefined | null): TreatmentStateId | null {
  if (!category) return null;
  return CATEGORY_TO_STATE[category] ?? null;
}

/** One thing that happened to one tooth. */
export type ToothTreatment = {
  state: TreatmentStateId;
  /** So a click can open the note this came from rather than leaving the dentist to hunt. */
  noteId: string;
  /** The procedure as written, which is more specific than the state and is what a tooltip shows. */
  procedure: string;
  status: NoteStatus;
  date: string;
};

/** The shape this module needs from a note. Deliberately narrow, so callers can pass anything. */
export type TreatmentSourceNote = {
  id: string;
  /** Comma-joined FDI text — what the API actually persists (`tooth: p.toothText`). */
  tooth?: string;
  procedure?: string;
  procedures?: string[];
  serviceId?: string | null;
  serviceIds?: string[];
  status?: string;
  date?: string;
};

function asStatus(raw: unknown): NoteStatus {
  return raw === "Completed" || raw === "Ongoing" ? raw : "Planned";
}

/**
 * Every treatment on every tooth, newest first within each tooth.
 *
 * `serviceCategoryById` maps a price-list entry to its category; `categoryForName` is the fallback
 * for a free-text procedure that matched no entry, using the same keyword guess the price list
 * itself uses when a service is created. Without that fallback, a clinic that types procedures by
 * hand instead of picking them would see an empty chart and conclude the feature is broken.
 */
export function treatmentsByTooth(
  notes: TreatmentSourceNote[],
  serviceCategoryById: (serviceId: string) => string | undefined,
  categoryForName: (name: string) => string | undefined
): Record<string, ToothTreatment[]> {
  const out: Record<string, ToothTreatment[]> = {};

  for (const note of notes || []) {
    const teeth = parseTeethString(String(note.tooth || ""));
    // "Gen" and an empty tooth field both land here: work that was not about a particular tooth.
    // parseTeethString already drops anything that is not a real FDI number, which is what keeps a
    // typo out of the chart rather than inventing a tooth.
    if (teeth.length === 0) continue;

    const ids = note.serviceIds?.length ? note.serviceIds : note.serviceId ? [note.serviceId] : [];
    const names = note.procedures?.length
      ? note.procedures
      : note.procedure
        ? [note.procedure]
        : [];

    const categories = [
      ...ids.map((id) => serviceCategoryById(id)),
      // Only consult the name when the ids named nothing — otherwise a note whose service is on
      // the price list would also be guessed at from its text, and the guess could disagree.
      ...(ids.length === 0
        ? names
            .map((n) => categoryForName(n))
            /*
             * The name guess is keyword matching over a price-list vocabulary, and it never
             * abstains — anything it does not recognise comes back as "other", which this module
             * would then have drawn as a mark on the tooth. "Follow-up review" and "Post-op check"
             * match nothing, so a note about looking at a tooth put a mark on it saying something
             * had been done to it.
             *
             * A guess with no evidence behind it does not get to make a clinical assertion. When
             * a service IS deliberately filed under "other" on the price list, the id path above
             * carries it and the mark is honest, because a human chose that category.
             */
            .filter((c) => c && c !== "other")
        : []),
    ].filter((c): c is string => Boolean(c));

    const states = Array.from(
      new Set(categories.map(treatmentForCategory).filter((s): s is TreatmentStateId => Boolean(s)))
    );
    if (states.length === 0) continue;

    /**
     * One note, several different treatments, and no record of which tooth got which.
     *
     * A single visit note routinely reads "46, 47" with procedures ["Surgical extraction",
     * "Zircon crown"] — extract one, crown the other. The note does not say which way round,
     * because nothing has ever needed it to. Drawing both states on both teeth put a ✕ through a
     * crowned molar that is sitting in occlusion, and the key underneath agreed with it: extracted
     * — 46, 47. A dentist reading that plans an implant into a tooth that is still there.
     *
     * So when the treatments in a note disagree, the note is not attributable and says so: every
     * tooth in it gets the neutral "something was done here, open the note" mark. Less information
     * than a guess, and the only honest amount.
     */
    const attributable = states.length === 1 ? states : (["treated"] as TreatmentStateId[]);

    const status = asStatus(note.status);
    const date = String(note.date || "");
    const procedure = String(note.procedure || names[0] || "");

    for (const tooth of teeth) {
      const bucket = (out[tooth] ||= []);
      for (const state of attributable) {
        bucket.push({ state, noteId: note.id, procedure, status, date });
      }
    }
  }

  for (const tooth of Object.keys(out)) {
    out[tooth].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }
  return out;
}

/**
 * The one treatment that decides how a tooth is drawn.
 *
 * Only work that has HAPPENED can change a tooth's appearance. A planned extraction is not a gap,
 * and a chart that draws one is the most dangerous thing this feature could do — the whole point
 * is to be able to trust the picture. Planned and ongoing work is still returned by
 * `treatmentsByTooth` so a badge or a tooltip can mention it; it simply may not repaint the tooth.
 */
export function dominantTreatment(entries: ToothTreatment[] | undefined): ToothTreatment | null {
  return resolveTreatments(entries).form ?? resolveTreatments(entries).mark;
}

/**
 * What to draw on a tooth: at most one change to its FORM, and at most one MARK over it.
 *
 * Reducing to a single winner threw away the more clinically important half. A tooth root-filled
 * and then crowned is the commonest pair in dentistry, and picking the crown alone drew a gold
 * crown and nothing else — so a patient returning in pain on that tooth presented as crowned and
 * vital. Vitality testing then "confirms" a non-response that reads as necrosis, and somebody cuts
 * an access cavity through a new crown to reach a pulp that was removed two years ago.
 *
 * The `form`/`mark` split has been in this module since it was written, precisely so the two can
 * coexist. This is where that promise is kept.
 */
export function resolveTreatments(entries: ToothTreatment[] | undefined): {
  form: ToothTreatment | null;
  mark: ToothTreatment | null;
} {
  const done = (entries || []).filter((e) => e.status === "Completed");
  if (done.length === 0) return { form: null, mark: null };

  const best = (channel: "form" | "mark") =>
    done
      .filter((e) => TREATMENT_STATES[e.state].channel === channel)
      .reduce<ToothTreatment | null>(
        (acc, entry) =>
          !acc || TREATMENT_STATES[entry.state].precedence > TREATMENT_STATES[acc.state].precedence
            ? entry
            : acc,
        null
      );

  let form = best("form");
  const mark = best("mark");

  /**
   * An extraction outranks everything, EXCEPT what replaced the tooth.
   *
   * Precedence is clinical finality and deliberately not recency — a filling placed after an
   * extraction is nonsense and must not win. But extraction → implant → implant crown is the most
   * ordinary sequence there is, and reading it by rank alone drew an empty socket over an
   * osseointegrated implant. A dentist plans into that ridge, quotes a second implant, and nobody
   * books the peri-implantitis recall for a site the chart says is not there.
   *
   * So one exception, narrow and dated: work that REPLACES a tooth, done after it came out.
   */
  if (form?.state === "extracted") {
    const replacement = done
      .filter((e) => (e.state === "implant" || e.state === "crowned") && (e.date || "") > (form!.date || ""))
      .reduce<ToothTreatment | null>(
        (acc, entry) =>
          !acc || TREATMENT_STATES[entry.state].precedence > TREATMENT_STATES[acc.state].precedence
            ? entry
            : acc,
        null
      );
    if (replacement) form = replacement;
  }

  return { form, mark };
}

/** Work booked or under way on this tooth but not finished. Never repaints; may be flagged. */
export function pendingTreatments(entries: ToothTreatment[] | undefined): ToothTreatment[] {
  return (entries || []).filter((e) => e.status !== "Completed");
}
