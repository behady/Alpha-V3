// src/lib/whatsNew.ts
/**
 * "Here's what changed" — the release notes nobody reads, walked instead.
 *
 * A changelog in a help article is read by the person who wrote it. The tour engine already knows
 * how to stand on a screen, point at a thing and explain it, so a release gets two or three stops
 * of the same, offered once on Getting started and never again after it is seen.
 *
 * These are ordinary tour stops in a chapter of their own, which is what keeps this honest: a
 * stop whose anchor does not exist fails the same way any other stop does, so a release note for
 * a feature that was never shipped cannot quietly sit here looking true.
 *
 * Rules for adding one:
 *   - Write it for the clinic, not for us. "The supply store" is news; "we refactored the tour
 *     runner" is not.
 *   - Two or three stops. A release that needs ten stops is a chapter, not a what's-new.
 *   - Newest first. `LATEST_RELEASE` is the head of this list.
 */

import type { Localized, TourStop } from "@/lib/grandTour";

export interface WhatsNewRelease {
  /** Stable, sortable, and the key the "seen" list stores. */
  id: string;
  title: Localized;
  /** What the card on Getting started says under the title. */
  blurb: Localized;
  stops: TourStop[];
}

const l = (en: string, ar: string): Localized => ({ en, ar });

export const WHATS_NEW: WhatsNewRelease[] = [
  {
    id: "2026-09",
    title: l("New in September", "الجديد في سبتمبر"),
    blurb: l("The supply store, and me.", "متجر المستلزمات، وأنا."),
    stops: [
      {
        id: "whatsnew-2026-09-store",
        chapter: "whatsnew",
        route: "/store",
        navKey: "store",
        spot: ["page-main"],
        title: l("Order your supplies from here", "اطلب مستلزماتك من هنا"),
        say: l(
          "This is new: a supply store inside the system. Gloves, burs, impression material — ordered from the same screen you run the clinic on, paid cash on delivery, and delivered to the clinic. Prices are the supplier's own.",
          "دي حاجة جديدة: متجر مستلزمات جوّه النظام. جوانتيات، فرايز، مواد طبعة — بتتطلب من نفس الشاشة اللي بتشتغل عليها، الدفع عند الاستلام، والتوصيل للعيادة. والأسعار أسعار المورّد نفسه.",
        ),
        ask: [
          { en: "Who delivers, and how long does it take?", ar: "مين بيوصّل، وبياخد قد إيه؟" },
          { en: "Can I order without paying up front?", ar: "أقدر أطلب من غير ما أدفع مقدم؟" },
        ],
        knowledge:
          "The Supply Store (/store) lists a partner supplier's catalogue inside the app: browse by category, add to a cart, and place an order paid cash on delivery to the clinic's address. The clinic pays the supplier's own listed price. Orders and their status appear on the same page. It is a convenience, not a stock system — what arrives still has to be added to Inventory to be tracked.",
      },
      {
        id: "whatsnew-2026-09-sara",
        chapter: "whatsnew",
        route: "/welcome",
        spot: ["tour-hero"],
        title: l("And me, whenever you want", "وأنا، وقت ما تحب"),
        say: l(
          "And I'm new. Ten minutes on the daily basics whenever a new person joins, short chapters for anything else, and lessons you click through yourself. Ask me to teach you a screen — 'teach me Finance' — and I'll take you there.",
          "وأنا كمان جديدة. عشر دقايق على أساسيات اليوم لأي حد جديد يدخل الفريق، وفصول قصيرة لأي حاجة تانية، ودروس تضغط فيها بنفسك. قولّي علّميني شاشة — «علّميني الحسابات» — وهوديك لها.",
        ),
        ask: [
          { en: "Can my staff take the tour too?", ar: "الفريق بتاعي يقدر ياخد الجولة؟" },
          { en: "Do questions cost credits?", ar: "الأسئلة بتتكلف رصيد؟" },
        ],
        knowledge:
          "The guided tour is opened from Getting started (/welcome) or the account menu. A short core tour covers the daily basics and differs by job: reception and owners get the desk, a dentist gets the chair. Every other chapter opens on its own from Getting started, or by asking the assistant to teach a screen. Lessons (the pulsing ring) are free from the 'Teach me' menu. Questions asked during a person's first tour are free; after that each costs one credit.",
      },
    ],
  },
];

/** The release a person is offered if they have not seen it. */
export const LATEST_RELEASE: WhatsNewRelease | undefined = WHATS_NEW[0];

/** All release stops, for the tour's own stop list. */
export const WHATS_NEW_STOPS: TourStop[] = WHATS_NEW.flatMap((r) => r.stops);

export function releaseById(id: string): WhatsNewRelease | undefined {
  return WHATS_NEW.find((r) => r.id === id);
}
