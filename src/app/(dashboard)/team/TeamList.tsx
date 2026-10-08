"use client";

import { formatStaffRoleLabel } from "@/lib/staffRoles";

export type RailPerson = {
  id: string;
  name: string;
  role: string;
  isDentist?: boolean;
  photoURL?: string | null;
  /** Clocked in right now. */
  onFloor: boolean;
  /** Anything worth a second look this period: a missed day, an open shift, unapproved overtime. */
  needsAttention: boolean;
};

/**
 * The name without its title.
 *
 * Half a clinic's staff rows are stored as "Dr. Hana Mostafa", so taking the first word gave a rail
 * of people all called "Dr." and a monogram of "DH" for every one of them. The honorific is a title,
 * not a name.
 */
function nameParts(name: string): string[] {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((w, i) => !(i === 0 && /^(dr|dr\.|d\.|prof|prof\.|mr|mr\.|mrs|mrs\.|ms|ms\.|د|د\.|دكتور|دكتورة|أستاذ)$/i.test(w)));
}

/** Two letters, from whichever script the name is in. */
function initials(name: string): string {
  const words = nameParts(name);
  if (words.length === 0) return "?";
  const take = (w: string) => [...w][0] ?? "";
  return (take(words[0]) + (words[1] ? take(words[1]) : "")).toUpperCase();
}

/** What to call somebody in a list two inches wide. Exported for the profile's plain sentence. */
export function shortName(name: string): string {
  return nameParts(name)[0] || name.trim() || "?";
}

/**
 * The team, as a list down the side of the page.
 *
 * It was a strip of pills across the top (2026-09). That hid the list the moment you scrolled into
 * somebody's profile, so switching from Hana's shifts to Omar's meant scrolling back up and finding
 * him again. On a wide screen the list now sits beside the profile and stays put; on a phone it is
 * still the strip, because a phone has no side.
 *
 * Dentists are listed first under their own small heading, because they are the people with
 * commission, and the people the owner opens most.
 *
 * The dot is the only colour: green while somebody is clocked in, amber when their period has
 * something in it worth looking at. Everything else about a person is on their profile.
 */
export default function TeamList({
  people,
  selectedId,
  onSelect,
  isAr,
}: {
  people: readonly RailPerson[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isAr: boolean;
}) {
  if (people.length === 0) return null;
  const anyOnFloor = people.some((p) => p.onFloor);
  const anyAttention = people.some((p) => !p.onFloor && p.needsAttention);
  const dentists = people.filter((p) => p.isDentist);
  const others = people.filter((p) => !p.isDentist);
  const groups = [
    { key: "dentists", label: isAr ? "الأطباء" : "Dentists", items: dentists },
    { key: "others", label: isAr ? "باقي الفريق" : "The rest of the team", items: others },
  ].filter((g) => g.items.length > 0);

  return (
    <nav aria-label={isAr ? "الفريق" : "Team"} data-tour="team-rail" className="min-w-0 lg:sticky lg:top-5 lg:self-start">
      <div
        role="tablist"
        className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:px-0 lg:pb-0"
      >
        {groups.map((g) => (
          <div key={g.key} className="flex shrink-0 gap-2 lg:block lg:shrink">
            {/* The heading only makes sense when the list is a column. */}
            <p className={`hidden px-3 text-[12px] font-bold uppercase tracking-[0.14em] text-ink-muted lg:block ${g.key === "others" && groups.length > 1 ? "mt-6" : ""} mb-2`}>
              {g.label}
            </p>
            {g.items.map((p) => {
              const active = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onSelect(p.id)}
                  className={`flex shrink-0 items-center gap-3 rounded-2xl py-2 ps-2 pe-5 text-start transition-colors lg:w-full lg:py-2.5 lg:ps-2.5 lg:pe-3 ${
                    active ? "bg-ink-slab text-white" : "border border-line bg-surface hover:bg-surface-muted lg:border-transparent lg:bg-transparent"
                  }`}
                >
                  <span className="relative shrink-0">
                    {p.photoURL ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.photoURL} alt="" className="size-11 rounded-full object-cover" />
                    ) : (
                      <span
                        className={`grid size-11 place-items-center rounded-full text-[14px] font-black ${
                          active ? "bg-white/15 text-white" : "bg-surface-muted text-ink-body"
                        }`}
                      >
                        {initials(p.name)}
                      </span>
                    )}
                    {(p.onFloor || p.needsAttention) && (
                      <span
                        aria-hidden
                        title={p.onFloor ? (isAr ? "موجود دلوقتي" : "On the floor now") : (isAr ? "محتاج مراجعة" : "Needs a look")}
                        className={`absolute -end-0.5 -bottom-0.5 size-3.5 rounded-full border-2 ${
                          active ? "border-ink-slab" : "border-surface"
                        }`}
                        style={{ background: p.onFloor ? "var(--ok)" : "var(--warn)" }}
                      />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className={`block truncate text-[16px] font-bold leading-tight ${active ? "text-white" : "text-ink"}`}>
                      {shortName(p.name)}
                    </span>
                    <span className={`mt-0.5 block truncate text-[13px] font-semibold leading-tight ${active ? "text-white/60" : "text-ink-muted"}`}>
                      {formatStaffRoleLabel(p, isAr)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {(anyOnFloor || anyAttention) && (
        <p className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-[13px] font-semibold text-ink-muted lg:mt-6 lg:flex-col lg:items-start lg:gap-y-2 lg:px-3">
          {anyOnFloor && (
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="size-2.5 rounded-full" style={{ background: "var(--ok)" }} />
              {isAr ? "في العيادة دلوقتي" : "At work right now"}
            </span>
          )}
          {anyAttention && (
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="size-2.5 rounded-full" style={{ background: "var(--warn)" }} />
              {isAr ? "فيه حاجة محتاجة تبص عليها" : "Something needs your attention"}
            </span>
          )}
        </p>
      )}
    </nav>
  );
}
