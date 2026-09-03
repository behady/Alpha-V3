/**
 * The vocabulary a theme is allowed to speak, and the only place tokens are written to the DOM.
 *
 * A theme sets CSS custom properties on <html>. Inline properties outrank the stylesheet, which is
 * what makes a theme win — and also what makes it dangerous: nothing else ever removes them. Every
 * write goes through applyTokens so that clearAppliedTokens can put the stylesheet back, which is
 * the only way a clinic switch stops leaking the previous clinic's colours.
 */

/**
 * The role tokens, transcribed from the `:root` block in globals.css. Names are unprefixed here;
 * the `--` is added at write time.
 *
 * Deliberately does NOT include `color-white`. 923 `bg-white` and 435 `text-white` usages read that
 * one variable, and it is doing two jobs at once — "a card's surface" and "ink on a coloured slab".
 * Repainting it turns several hundred button labels the colour of their own button. A dark theme
 * needs `bg-white` migrated to `bg-surface` first; until then, themes move the roles below and
 * leave white alone.
 */
/**
 * WHAT IS DELIBERATELY NOT A TOKEN, so the next person does not "finish the job".
 *
 * Colour that must never follow a clinic's theme:
 *
 *   src/components/SourceIcon.tsx      Facebook blue, WhatsApp green, the four Google colours.
 *                                      Other companies' marks. Recolouring them would be wrong
 *                                      and is not ours to do.
 *   src/lib/dentalIconArt.tsx,         Teeth, roots, and diagnosis colours. Anatomy and clinical
 *   toothTreatments, diagnosisCatalog  meaning; a tooth is the colour a tooth is, and a
 *                                      diagnosis colour is a stored value patients' records key
 *                                      off.
 *   src/components/reports/            Spreadsheet fill colours, consumed by a spreadsheet
 *     reportExcelUtils.ts              writer. var() is not a colour to it.
 *   the *PdfHtml / *Pdf builders       Printed documents render inside their own detached
 *                                      document, where :root here does not reach. Patient
 *                                      paperwork also stays neutral by decision.
 *
 * And three in-app colours left as literals on purpose: the call-to-action yellow (#FACC15 with
 * its #EAB308 hover) and the briefing gold (#C8A24A). They are deliberate one-off accents rather
 * than roles, and folding them into --warn would make a primary action look like a warning.
 */
export const ROLE_TOKENS = [
  "surface-page", "surface", "surface-subtle", "surface-muted", "surface-accent",
  "line", "line-strong",
  "ink", "ink-slab", "ink-strong", "ink-body", "ink-muted", "ink-faint", "ink-on-accent",
  "accent", "accent-soft", "accent-strong", "accent-tint",
  "ok", "ok-tint", "warn", "warn-tint", "danger", "danger-tint", "info", "info-tint",
  // The four settings groups. Colour that says which family a screen belongs to, and
  // nothing else: never a status, never an action.
  "tone-personal", "tone-personal-tint", "tone-clinic", "tone-clinic-tint",
  "tone-people", "tone-people-tint", "tone-system", "tone-system-tint",
] as const;

export type RoleToken = (typeof ROLE_TOKENS)[number];
export type ThemeTokens = Record<string, string>;

export interface ClinicTheme {
  presetId: string;
  tokens: ThemeTokens;
}

const ROLE_TOKEN_SET: ReadonlySet<string> = new Set(ROLE_TOKENS);

/**
 * A colour, and nothing else. The value reaches `style.setProperty`, so it must not be able to
 * carry `url(...)`, `expression(...)`, or a second declaration smuggled past a semicolon. Values
 * come from Firestore, which an admin can write by hand.
 */
const SAFE_VALUE = /^#[0-9A-Fa-f]{3,8}$|^rgba?\([\d\s.,%/]+\)$|^hsla?\([\d\s.,%/]+\)$/;

export function isSafeTokenName(name: unknown): name is string {
  return typeof name === "string" && ROLE_TOKEN_SET.has(name);
}

export function isSafeTokenValue(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && SAFE_VALUE.test(value.trim());
}

/** Drops anything unrecognised rather than rejecting the lot: a stray key must not cost the theme. */
export function sanitizeTokens(raw: unknown): ThemeTokens {
  const out: ThemeTokens = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isSafeTokenName(k) && isSafeTokenValue(v)) out[k] = String(v).trim();
  }
  return out;
}

/** Every property this module has written, so it can be taken back off again. */
const applied = new Set<string>();

export function applyTokens(tokens: ThemeTokens): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(tokens)) {
    if (!isSafeTokenName(name) || !isSafeTokenValue(value)) continue;
    root.style.setProperty(`--${name}`, value);
    applied.add(name);
  }
}

/**
 * Restores the stylesheet by removing the inline properties, rather than by writing the default
 * values back. Writing defaults back would mean this module owning a second copy of the default
 * theme that could drift from globals.css; removing them means the stylesheet is always the source
 * of truth for "no theme chosen".
 */
export function clearAppliedTokens(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // Every role token, not just the ones this module wrote. The boot script paints the same
  // properties before the bundle loads and never touches this set, so clearing only what is
  // tracked would leave its values stranded with nothing able to remove them.
  for (const name of ROLE_TOKENS) root.style.removeProperty(`--${name}`);
  for (const name of applied) root.style.removeProperty(`--${name}`);
  applied.clear();
}

/** Swap in one step, so a partial preset cannot leave the previous theme's tokens behind. */
export function replaceTokens(tokens: ThemeTokens): void {
  clearAppliedTokens();
  applyTokens(tokens);
}
