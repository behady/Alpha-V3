/**
 * The chaptered demo: what the camera does, beat by beat.
 *
 * Each chapter is its own short video. A beat is one narration line, and the screen work that
 * happens while it is spoken. Unlike the 90-second reel — which lands on a page and holds — these
 * perform the actual job: open the booking dialog, search a patient, pick a time, confirm, and
 * watch the appointment land in the diary.
 *
 * `actions` run INSIDE the beat's recorded window, so the work is on camera. The recorder
 * measures how long they took and writes it to cuts.json; the assembler then gives the beat
 * whichever is longer, the narration or the action, so a click is never cut off mid-gesture.
 *
 * Selectors are the Arabic labels the app actually renders (the recording profile is in Arabic),
 * taken from `promo-probe-ui.mjs` rather than guessed. Re-probe after a UI change: a silently
 * missed click records a beat where nothing happens.
 *
 * NOTE: the booking chapter writes a real appointment to the DEMO clinic on every run. That is
 * the point — the diary has to visibly change — but it means repeated runs accumulate bookings.
 */

/** A patient with a full record, so anything opened from these flows looks lived-in. */
/**
 * The booking modal's patient-results dropdown, as a scope for clicking a result.
 *
 * Scoping is not optional here. Unscoped, the patient's name matches his EXISTING appointment
 * card in the schedule behind the modal; clicking that closes the booking and opens an edit
 * panel, and the rest of the flow then clicks at controls that are no longer there. The results
 * are a sibling of the search input, not a child of its wrapper — scoping to the input's parent
 * (the obvious guess) matches nothing at all.
 */
export const SEARCH_PANEL = "div.absolute.start-0.end-0";

/** The slot the diary chapter books into. Must be a time the seed leaves empty. */
export const BOOKING_SLOT = "07:00 PM";

export const STAR_PATIENT = { id: "REv947qYLGBe5SIQA2I9", name: "Ziad Refaat", phone: "201000000117" };

export const CHAPTERS = {
  // ---------------------------------------------------------------------
  diary: {
    title: "The Diary",
    slug: "1-diary",
    /**
     * Recorded on the desk dashboard ("/"), not /appointments.
     *
     * The dashboard carries the same day and week views in a denser layout, and — the reason it
     * is worth the switch — an empty slot there IS the booking button: clicking a gap opens the
     * modal with that time already filled in. The appointments page makes you press "add" and
     * then pick the time back out of a dropdown.
     */
    beats: [
      {
        n: 0, label: "the-desk", url: "/", settle: 9000,
        actions: [{ do: "wait", ms: 3000 }],
      },
      {
        n: 1, label: "week-view", settle: 1200,
        actions: [
          { do: "click", role: "button", text: "أسبوعي", exact: true },
          { do: "wait", ms: 4500 },
        ],
      },
      {
        n: 2, label: "gaps", settle: 500,
        actions: [{ do: "wheel", ms: 5000, dy: 70 }],
      },
      {
        // Clicking the gap itself. SLOT is a time with nothing booked in it — a slot covered by
        // an appointment card cannot be clicked, the card is on top of it.
        n: 3, label: "click-the-gap", settle: 500,
        actions: [
          { do: "click", role: "button", text: "يومي", exact: true },
          { do: "wait", ms: 2500 },
          { do: "clickSlot", time: BOOKING_SLOT },
          { do: "wait", ms: 3000 },
        ],
      },
      {
        n: 4, label: "find-patient", settle: 500,
        actions: [
          { do: "fill", placeholder: "دور بالاسم أو رقم الموبايل", text: "Ziad", perChar: 110 },
          { do: "wait", ms: 3000 },
          { do: "clickFirst", text: STAR_PATIENT.name, within: SEARCH_PANEL },
          { do: "wait", ms: 2000 },
        ],
      },
      {
        // No time picked here: it came from the gap. Only the dentist and the length.
        n: 5, label: "dentist-and-length", settle: 500,
        actions: [
          { do: "selectWhere", has: "Dr. Omar", pick: "Dr. Hana" },
          { do: "wait", ms: 1500 },
          { do: "selectWhere", has: "15 دقيقة", pick: "30 دقيقة" },
          { do: "wait", ms: 2000 },
        ],
      },
      {
        n: 6, label: "confirm", settle: 500,
        actions: [
          { do: "click", text: "أكّد الحجز" },
          { do: "wait", ms: 2000 },
          // Only appears if that slot is already taken — see promo-clean-bookings.mjs.
          { do: "click", text: "أيوه", optional: true, timeout: 4000 },
          { do: "wait", ms: 4000 },
        ],
      },
      {
        // The dashboard keeps every row in the DOM, so unlike the appointments grid the new
        // booking can simply be scrolled to by its time.
        n: 7, label: "in-the-day", settle: 2500,
        actions: [
          { do: "scrollTo", text: BOOKING_SLOT, ms: 3000 },
          { do: "wait", ms: 4000 },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------------
  whatsapp: {
    title: "WhatsApp",
    slug: "2-whatsapp",
    /**
     * Built entirely from conversations that already happened, not from a live demonstration.
     *
     * The built-in "try the bot" playground would have been the better shot — it runs the bot
     * against a rehearsal thread, so nothing leaves the building — but the demo clinic has
     * `whatsappIntegration` and `aiChat` without the `whatsappBot` add-on, and no settings/whatsapp
     * document, so the playground accepts a message and never answers. Enable the add-on and this
     * chapter can gain a live beat; until then, showing a question with no reply would be worse
     * than showing none.
     *
     * Replying inside a real thread is not an option either: that goes out through the live
     * WhatsApp channel to a real number.
     */
    beats: [
      { n: 0, label: "the-queue", url: "/chats", settle: 11000, actions: [{ do: "wait", ms: 3500 }] },
      {
        n: 1, label: "needs-a-human", settle: 800,
        actions: [
          { do: "click", text: "محتاج رد" },
          { do: "wait", ms: 4000 },
        ],
      },
      {
        n: 2, label: "the-handoff", settle: 500,
        actions: [
          { do: "clickFirst", text: "Heba Gamal" },
          { do: "wait", ms: 6000 },
        ],
      },
      {
        n: 3, label: "bot-booked-it", settle: 500,
        actions: [
          { do: "click", text: "الكل" },
          { do: "wait", ms: 1500 },
          { do: "clickFirst", text: "Mohamed Abdelrahman" },
          { do: "wait", ms: 6500 },
        ],
      },
      {
        n: 4, label: "reschedule", settle: 500,
        actions: [
          { do: "clickFirst", text: "Salma Ezzat" },
          { do: "wait", ms: 6500 },
        ],
      },
      {
        n: 5, label: "reminder", settle: 500,
        actions: [
          { do: "clickFirst", text: "Sherif Adly" },
          { do: "wait", ms: 6000 },
        ],
      },
      {
        n: 6, label: "take-over", settle: 500,
        actions: [
          { do: "clickFirst", text: STAR_PATIENT.name },
          { do: "wait", ms: 5500 },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------------
  botvsai: {
    title: "The Bot and the AI",
    slug: "3-bot-and-ai",
    /**
     * Three jobs, each one a setting: receptionist (botEnabled + the facts), salesman
     * (`botCoaching`, which the UI asks you to write "as you'd brief a new hire"), and first line
     * on symptoms (`botClinicalMode: "dentist"` — it answers the symptom and THEN offers the
     * appointment; the default "handoff" sends every symptom to a person).
     *
     * Shown through the settings screens and real threads rather than live in the playground: that
     * route answers {"ok":true,"status":"skipped","reason":"no_gateway"}, because a rehearsal that
     * sends nothing is still gated on the clinic having a WhatsApp gateway.
     */
    beats: [
      {
        n: 0, label: "who-answers", url: "/settings/whatsapp-bot", settle: 12000,
        actions: [{ do: "wait", ms: 4000 }],
      },
      {
        n: 1, label: "the-four-modes", settle: 500,
        actions: [{ do: "wheel", ms: 7000, dy: 60 }],
      },
      {
        n: 2, label: "ready-answers", settle: 500,
        actions: [
          { do: "click", role: "button", text: "الردود الجاهزة" },
          { do: "wait", ms: 3000 },
          { do: "wheel", ms: 5500, dy: 80 },
        ],
      },
      {
        // The coaching box lives on the AI tab: the salesman half of the story.
        n: 3, label: "coaching", url: "/settings/whatsapp-ai", settle: 11000,
        actions: [{ do: "wheel", ms: 8000, dy: 70 }],
      },
      {
        // Back to the Bot page for the clinical switch — the "how far does it go" beat.
        n: 4, label: "clinical-switch", url: "/settings/whatsapp-bot", settle: 11000,
        actions: [{ do: "wheel", ms: 7000, dy: 75 }],
      },
      {
        n: 5, label: "the-cap", url: "/settings/whatsapp-ai", settle: 11000,
        actions: [{ do: "wheel", ms: 6000, dy: 90 }],
      },
      {
        n: 6, label: "ai-in-the-wild", url: "/chats", settle: 10000,
        actions: [
          { do: "clickFirst", text: "Heba Gamal" },
          { do: "wait", ms: 6500 },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------------
  record: {
    title: "The Patient Record",
    slug: "4-patient-record",
    /**
     * Navigates by SEARCHING for the patient rather than by a hard-coded id. Re-seeding the demo
     * clinic mints new patient documents, so an id baked into a URL dies the next time the diary
     * is re-centred — and the beat then records a not-found page perfectly happily.
     */
    beats: [
      { n: 0, label: "the-register", url: "/patients", settle: 11000, actions: [{ do: "wait", ms: 3500 }] },
      {
        n: 1, label: "find-and-open", settle: 500,
        actions: [
          { do: "fill", placeholder: "بحث بالاسم أو الهاتف", text: "Ziad", perChar: 130 },
          { do: "wait", ms: 2500 },
          { do: "clickFirst", text: STAR_PATIENT.name },
          { do: "wait", ms: 6000 },
        ],
      },
      {
        n: 2, label: "the-file", settle: 1000,
        actions: [{ do: "wheel", ms: 5000, dy: 70 }],
      },
      {
        n: 3, label: "treatment-plan", settle: 500,
        actions: [
          { do: "clickFirst", text: "خطة العلاج" },
          { do: "wait", ms: 4000 },
          { do: "wheel", ms: 4000, dy: 70 },
        ],
      },
      {
        n: 4, label: "the-money", settle: 500,
        actions: [
          { do: "clickFirst", text: "المالية" },
          { do: "wait", ms: 4000 },
          { do: "wheel", ms: 4000, dy: 70 },
        ],
      },
      {
        n: 5, label: "the-visits", settle: 500,
        actions: [
          { do: "clickFirst", text: "سجل الزيارات" },
          { do: "wait", ms: 4000 },
          { do: "wheel", ms: 4000, dy: 70 },
        ],
      },
      {
        // The chart is its own route, so it goes last — there is no coming back to the tabs.
        n: 6, label: "the-chart", settle: 500,
        actions: [
          { do: "clickFirst", text: "تشخيص" },
          { do: "wait", ms: 7000 },
        ],
      },
    ],
  },

};

export async function chapter(name) {
  // The long walkthrough lives in its own module and is loaded on demand: it imports constants
  // from this file, and a static import both ways would be a cycle.
  const { WALKTHROUGH } = await import("./walkthrough-chapters.mjs");
  const c = CHAPTERS[name] || WALKTHROUGH[name];
  if (!c) throw new Error(`Unknown chapter "${name}". Known: ${[...Object.keys(CHAPTERS), ...Object.keys(WALKTHROUGH)].join(", ")}`);
  return c;
}
