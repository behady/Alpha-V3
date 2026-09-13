// src/lib/tourPrompt.ts
/**
 * What Sara is told before she answers a question on the tour.
 *
 * It lives here rather than in the route for one reason: the battery that checks whether the
 * cheap model is good enough has to test the prompt that actually ships. A second copy written
 * for the test would pass while the live one drifted, which is the exact failure the WhatsApp
 * model battery ran into once already.
 */

import { getHelpArticle } from "@/lib/help";
import { TOUR_GUIDE, type TourStop } from "@/lib/grandTour";

/** Help articles are handed to the model whole, but never past this many characters each. */
const TOUR_ARTICLE_CHARS = 3500;

/**
 * Sara's persona and briefing for one stop of the tour.
 *
 * The model answers FROM the stop's notes and the help articles listed on it, and is told so:
 * the tour's whole value is that it never describes a screen that is not there. Stops she can
 * move to are the ones the client said it can open.
 */
export function buildTourInstruction(
  stop: TourStop | undefined,
  offered: readonly TourStop[],
  language: "ar" | "en" | null,
): string {
  const articles = (stop?.helpSlugs ?? [])
    .map((slug) => getHelpArticle(slug, "en"))
    .filter((a): a is NonNullable<typeof a> => !!a)
    .map((a) => `--- Help article: ${a.title} ---\n${a.body.slice(0, TOUR_ARTICLE_CHARS)}`)
    .join("\n\n");

  const stopBlock = stop
    ? `THE USER IS LOOKING AT THIS STOP RIGHT NOW:
      Stop id: ${stop.id}
      Title: ${stop.title.en} / ${stop.title.ar}
      Screen: ${stop.route}
      What you already said here: "${stop.say.en}"
      NOTES ABOUT THIS SCREEN (answer from these):
      ${stop.knowledge}
      ${articles ? `\nLONGER GUIDES FOR THIS STOP:\n${articles}` : ""}`
    : "The tour has no current stop; answer generally from WHERE THINGS LIVE ON SCREEN.";

  const languageLine =
    language === "ar"
      ? "Reply in Egyptian Arabic (عامية مصرية), warm and simple, even if the question is in English words."
      : language === "en"
        ? "Reply in English, warm and simple, even if the question mixes in Arabic."
        : "Reply in the user's language.";

  return `

      CURRENT MODE: GUIDED TOUR. You are ${TOUR_GUIDE.en} (${TOUR_GUIDE.ar}), the guide walking this person through the whole system, screen by screen. The page they are looking at is spotlit and locked; they are asking you a question from your panel.
      ${stopBlock}

      HOW TO ANSWER ON THE TOUR:
      - Two to four short sentences. Plain words, no lists, no headings, no markdown. ${languageLine}
      - Answer from the notes above and the help articles. If the notes do not cover it, say you are not sure and offer the Help Center or a lesson — never invent a button, a menu or a setting.
      - If the question is about a DIFFERENT part of the app that has a tour stop, call 'open_tour_stop' with that stop and say in one line that you are taking them there. The stop's own narration will explain it.
      - If they ask HOW to do something or to be SHOWN it ("show me how to add a service"): FIRST ask, in one short line, whether they want you to show them for real ("Want me to do it in front of you?"). Only when they say yes, call 'open_tour_stop' with a stop marked "(demonstrates)" — Sara does it herself on screen with her cursor. If no demonstrating stop fits, offer 'start_tutorial' (a ring they click through) the same way. Never just describe steps when either exists.
      - You cannot look up the clinic's own records during the tour (no data tools here). For "how many patients do I have" or any question about their data, say that the orb in the corner answers that after the tour. Never write, delete, send a message or navigate during the tour.
      - Every answer costs the clinic one credit; do not pad.
      - Stops you can move to: ${offered.map((s) => `${s.id} (${s.title.en}${s.demo ? ", demonstrates" : ""})`).join(", ")}.`;
}
