/**
 * The app's confirm dialog, reachable from code that is not a component.
 *
 * `useUI().confirm` only exists inside React. The money calls in lib/moneyApi are plain functions
 * used from a dozen screens, and one answer from the server — "this treatment is on a company
 * sheet that was already sent; an Owner or Admin must confirm" — is a question to put to the
 * person, whichever screen they happen to be on. Asking it here, once, means none of those
 * screens has to know about it.
 *
 * UIProvider registers its dialog on mount and LanguageProvider its language; until then (and in
 * tests) the question falls back to the browser's own confirm box.
 */

export type BridgeConfirmOptions = { title?: string; confirmLabel?: string; cancelLabel?: string; tone?: "default" | "danger" };
type Ask = (message: string, options?: BridgeConfirmOptions) => Promise<boolean>;

let ask: Ask | null = null;
let arabic = false;

export function registerConfirm(fn: Ask | null): void {
  ask = fn;
}

export function setBridgeLanguage(language: string): void {
  arabic = language === "ar";
}

/** Put a question to the person in their language; resolves true on yes. */
export function askConfirm(text: { en: string; ar: string }, options?: { en: BridgeConfirmOptions; ar: BridgeConfirmOptions }): Promise<boolean> {
  const message = arabic ? text.ar : text.en;
  const opts = options ? (arabic ? options.ar : options.en) : undefined;
  if (ask) return ask(message, opts);
  return Promise.resolve(typeof window !== "undefined" ? window.confirm(message) : false);
}

/** Pick the words for the person's language (for a message shown without a question). */
export function inLanguage(text: { en: string; ar: string }): string {
  return arabic ? text.ar : text.en;
}
