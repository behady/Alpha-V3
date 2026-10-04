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

/** What to call somebody in a rail two inches wide. Exported for the profile's plain sentence. */
export function shortName(name: string): string {
  return nameParts(name)[0] || name.trim() || "?";
}

/**
 * The team, as a row of people you tap.
 *
 * This is the shape the owner asked for — "a sub tab for each staff member" — and it is the right
 * one for a clinic: a dental practice is six to fifteen people, they are all known by face and
 * first name, and a table of surnames is a worse way to find Hana than a row of faces. It scrolls
 * sideways rather than wrapping, so the profile below it never moves down the page as the team
 * grows, and it never becomes the two-thirds-empty second row that a grid of tiles does.
 *
 * The dot is the only colour: green while somebody is clocked in, amber when their period has
 * something in it worth looking at. Everything else about a person is on their profile, because a
 * rail that tried to summarise nine people would be a table again.
 *
 * Sized for reading at arm's length (2026-10 redesign): the owner found the 13px names and 10px roles
 * hard to read, and nobody could guess what the two dots meant — so they are now spelled out in a
 * one-line key under the row, shown only when a dot is actually on screen.
 */
export default function TeamRail({
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
  return (
    <div className="space-y-2">
    <div
      data-tour="team-rail"
      className="no-scrollbar -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1"
      role="tablist"
      aria-label={isAr ? "الفريق" : "Team"}
    >
      {people.map((p) => {
        const active = p.id === selectedId;
        return (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(p.id)}
            className={`flex shrink-0 items-center gap-3 rounded-full py-2 ps-2 pe-5 text-start transition-colors ${
              active ? "bg-ink-slab text-white" : "border border-line bg-surface hover:bg-surface-muted"
            }`}
          >
            <span className="relative shrink-0">
              {p.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.photoURL} alt="" className="size-12 rounded-full object-cover" />
              ) : (
                <span
                  className={`grid size-12 place-items-center rounded-full text-[15px] font-black ${
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
    {(anyOnFloor || anyAttention) && (
      <p className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-[13px] font-semibold text-ink-muted">
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
    </div>
  );
}
