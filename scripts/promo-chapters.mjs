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
export const STAR_PATIENT = { id: "REv947qYLGBe5SIQA2I9", name: "Ziad Refaat", phone: "201000000117" };

export const CHAPTERS = {
  // ---------------------------------------------------------------------
  diary: {
    title: "The Diary",
    slug: "1-diary",
    beats: [
      {
        // /appointments opens on the WEEK, so the day view has to be asked for explicitly.
        n: 0, label: "day-view", url: "/appointments", settle: 6000,
        actions: [
          { do: "click", role: "button", text: "يوم", exact: true },
          { do: "wait", ms: 4000 },
        ],
      },
      {
        n: 1, label: "week-view", settle: 1500,
        actions: [
          { do: "click", role: "button", text: "أسبوع", exact: true },
          { do: "wait", ms: 4000 },
        ],
      },
      {
        n: 2, label: "gaps", settle: 500,
        actions: [{ do: "wheel", ms: 5000, dy: 70 }],
      },
      {
        n: 3, label: "open-booking", settle: 500,
        actions: [
          { do: "click", role: "button", text: "يوم", exact: true },
          { do: "wait", ms: 2000 },
          { do: "click", text: "إضافة موعد" },
          { do: "wait", ms: 3500 },
        ],
      },
      {
        n: 4, label: "find-patient", settle: 500,
        actions: [
          { do: "fill", placeholder: "دور بالاسم أو رقم الموبايل", text: "Ziad", perChar: 110 },
          { do: "wait", ms: 3000 },
          { do: "clickFirst", text: "Ziad Refaat" },
          { do: "wait", ms: 2000 },
        ],
      },
      {
        n: 5, label: "pick-slot", settle: 500,
        actions: [
          // Identified by an option only that dropdown has — see selectWhere in the recorder.
          { do: "selectWhere", has: "09:00 ص", pick: "05:00 م" },
          { do: "wait", ms: 1200 },
          { do: "selectWhere", has: "Dr. Youssef", pick: "Dr. Hana" },
          { do: "wait", ms: 1200 },
          { do: "selectWhere", has: "15 دقيقة", pick: "30 دقيقة" },
          { do: "wait", ms: 2000 },
        ],
      },
      {
        n: 6, label: "confirm", settle: 500,
        actions: [
          { do: "click", text: "أكّد الحجز" },
          { do: "wait", ms: 5000 },
        ],
      },
      {
        // The payoff shot: the booking just made, sitting in the day at five o'clock. Without
        // the wheel the diary is still showing the morning and the new row is off screen.
        // No view switch here: beat 3 already put the diary in day view, so the Day button is
        // the selected one and clicking it just times out.
        n: 7, label: "in-the-diary", settle: 2500,
        actions: [
          { do: "wheel", ms: 2500, dy: 90 },
          // The booking just made is the last of this patient's rows in the day.
          { do: "scrollTo", text: "Ziad Refaat", which: "last", ms: 3500 },
          { do: "wait", ms: 3000 },
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
