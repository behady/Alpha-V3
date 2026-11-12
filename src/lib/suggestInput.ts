/**
 * Which choices show under a type-or-pick field (SuggestInput).
 *
 * An empty field, or one already holding one of the choices, opens on the whole list, the way a
 * drop-down does. Typing narrows it to the choices containing the text, the ones that start with
 * it first. A name that matches nothing is still allowed: the field is free text.
 */
export function suggestionsFor(options: readonly string[], typed: string): string[] {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of options) {
    const option = String(raw ?? "").trim();
    const key = option.toLowerCase();
    if (!option || seen.has(key)) continue;
    seen.add(key);
    clean.push(option);
  }
  const text = typed.trim().toLowerCase();
  if (!text || seen.has(text)) return clean;
  const starts = clean.filter((o) => o.toLowerCase().startsWith(text));
  const contains = clean.filter((o) => !o.toLowerCase().startsWith(text) && o.toLowerCase().includes(text));
  return [...starts, ...contains];
}
