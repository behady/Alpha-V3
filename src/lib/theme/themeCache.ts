import type { ThemeTokens } from "./tokens";

/**
 * The last theme this browser painted, per clinic.
 *
 * The theme lives in Firestore, which resolves three network hops after first paint — auth, then
 * the user document, then the clinic. Without a cache every load would paint the default and then
 * repaint, which is a visible flicker on every navigation. The cache is the guess we paint before
 * the truth arrives; Firestore corrects it a moment later.
 *
 * Keyed by clinic because a user can belong to several, and painting clinic A's brand while
 * clinic B loads is worse than painting the default.
 */
const KEY = "alpha.theme.v1";
const VERSION = 1;

export interface ThemeCache {
  v: number;
  /** The clinic last actually painted — the boot script's fallback guess. */
  clinicId: string | null;
  byClinic: Record<string, { presetId: string; tokens: ThemeTokens }>;
}

const EMPTY: ThemeCache = { v: VERSION, clinicId: null, byClinic: {} };

/**
 * Every access is guarded. localStorage throws outright in a partitioned iframe and in browsers
 * set to block site data, and this runs on every page load — an unguarded read would take the
 * whole app down for those users rather than just losing a colour.
 */
export function readCache(): ThemeCache {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as ThemeCache;
    if (!parsed || parsed.v !== VERSION || typeof parsed.byClinic !== "object") return EMPTY;
    return { v: VERSION, clinicId: parsed.clinicId ?? null, byClinic: parsed.byClinic ?? {} };
  } catch {
    return EMPTY;
  }
}

export function writeCache(clinicId: string, presetId: string, tokens: ThemeTokens): void {
  try {
    const cache = readCache();
    cache.clinicId = clinicId;
    cache.byClinic[clinicId] = { presetId, tokens };
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* a browser that will not store is not a reason to fail; it just flickers once per load */
  }
}

/** Called on sign-out: the next person at this machine must not inherit the last one's brand. */
export function clearCache(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
