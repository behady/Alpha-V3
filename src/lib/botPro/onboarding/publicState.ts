/**
 * What the onboarding screen is shown of the saved state. The queue of conversation keys and the
 * lock are server bookkeeping: they never leave the API.
 *
 * Run: npm run test:pro-onboarding-routes
 */
import type { LayerVersion, OnboardingState } from "./store";

export type PublicOnboardingState = {
  scan: { status: OnboardingState["scan"]["status"]; total: number; done: number; chatsRead: number; mode: OnboardingState["scan"]["mode"]; error?: string };
  /** When the last finished reading started (ms), 0 = never: the screen's "Last read" date. */
  lastScanAt: number;
  learned: string[];
  questions: string[];
  draft: OnboardingState["draft"];
  /** Whether "Undo last change" has something to go back to (the old draft itself stays on the server). */
  hasPreviousDraft: boolean;
  liveVersion: string | null;
};

export function publicOnboardingState(s: OnboardingState): PublicOnboardingState {
  return {
    scan: {
      status: s.scan.status,
      total: s.scan.total,
      done: s.scan.done,
      chatsRead: s.scan.chatsRead,
      mode: s.scan.mode,
      ...(s.scan.error ? { error: s.scan.error } : {}),
    },
    lastScanAt: s.lastScanAt,
    learned: s.learned,
    questions: s.questions,
    draft: s.draft,
    hasPreviousDraft: s.previousDraft !== null,
    liveVersion: s.liveVersion,
  };
}

export type VersionRow = { id: string; version: number; createdAt: number; createdBy: string; passed: boolean; breaks: number };

/** One row per saved version; a version saved without a readable test counts as not passed. */
export function versionRows(versions: LayerVersion[]): VersionRow[] {
  return versions.map((v) => {
    const test = (v.test ?? null) as { passed?: unknown; breaks?: unknown } | null;
    return {
      id: v.id,
      version: v.version,
      createdAt: v.createdAt,
      createdBy: v.createdBy,
      passed: test?.passed === true,
      breaks: Array.isArray(test?.breaks) ? test.breaks.length : 0,
    };
  });
}
