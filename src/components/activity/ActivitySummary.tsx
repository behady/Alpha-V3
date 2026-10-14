"use client";

/**
 * The summary strip on the Money, Discounts and Insurance tabs: one line per person for the dates
 * on screen, e.g. "مَلَك — 6 خصومات · 1,200 ج". Tapping a person narrows the list to them; tapping
 * them again lets go.
 */

import { summaryItemParts, type PersonSummary } from "@/lib/activity/feed";

const TITLES: Record<"money" | "discount" | "insurance", [string, string]> = {
  money: ["مين لمس الفلوس", "Who touched the money"],
  discount: ["مين عمل خصومات", "Who gave discounts"],
  insurance: ["مين اشتغل على التأمين", "Who worked on insurance"],
};

export default function ActivitySummary({
  people,
  tab,
  isAr,
  activeUserId,
  onPick,
}: {
  people: PersonSummary[];
  tab: "money" | "discount" | "insurance";
  isAr: boolean;
  activeUserId: string;
  /** The person's key, or "" to clear the person filter. */
  onPick: (userId: string) => void;
}) {
  const lang = isAr ? "ar" : "en";
  const eyebrow = "font-display text-[11px] font-black uppercase tracking-[0.12em] text-ink-muted";

  return (
    <section aria-label={TITLES[tab][isAr ? 0 : 1]} className="rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <span className={eyebrow}>{TITLES[tab][isAr ? 0 : 1]}</span>
        {activeUserId && (
          <button
            type="button"
            onClick={() => onPick("")}
            className="text-[12px] font-bold text-ink-muted underline underline-offset-4 hover:text-ink"
          >
            {isAr ? "كل الناس" : "Everyone"}
          </button>
        )}
      </div>
      {people.length === 0 ? (
        <p className="px-4 py-4 text-[13px] font-semibold text-ink-muted sm:px-5">
          {isAr ? "مفيش حاجة هنا في الفترة دي." : "Nothing here for these dates."}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {people.map((p) => {
            const active = p.userId === activeUserId;
            return (
              <li key={p.userId}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onPick(active ? "" : p.userId)}
                  className={`flex w-full flex-col gap-1 px-4 py-3 text-start transition-colors sm:flex-row sm:items-baseline sm:gap-4 sm:px-5 ${
                    active ? "bg-surface-subtle" : "hover:bg-surface-subtle"
                  }`}
                >
                  <span className="flex shrink-0 items-center gap-2 sm:w-44">
                    {active && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ink-slab" />}
                    <bdi className="truncate text-[14px] font-bold text-ink">{p.userName || (isAr ? "غير معروف" : "Unknown")}</bdi>
                  </span>
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] text-ink-body">
                    {p.items.map((item, i) => {
                      const { counted, amount } = summaryItemParts(item, lang);
                      return (
                        <span key={item.key} className="inline-flex items-baseline gap-1.5">
                          {i > 0 && <span aria-hidden="true" className="me-1.5 text-ink-faint">|</span>}
                          {counted && <span className="font-semibold">{counted}</span>}
                          {counted && amount && <span aria-hidden="true" className="text-ink-faint">·</span>}
                          {amount && <span className="font-figure font-bold text-ink">{amount}</span>}
                        </span>
                      );
                    })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
