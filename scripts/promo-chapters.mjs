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
};

export function chapter(name) {
  const c = CHAPTERS[name];
  if (!c) throw new Error(`Unknown chapter "${name}". Known: ${Object.keys(CHAPTERS).join(", ")}`);
  return c;
}
