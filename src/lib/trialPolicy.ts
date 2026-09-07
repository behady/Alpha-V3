// src/lib/trialPolicy.ts
/**
 * How long a free trial lasts, and whether it ends at all.
 *
 * Everything needed to expire a trial already existed and had done for a while. `firestore.rules`
 * refuses every write once `expiresAt` has passed — its own comment says so: "a free trial ran
 * forever: nothing ever flipped status, and expiresAt was the field that was supposed to end it".
 * `lib/clinicStatus.ts` mirrors that decision for the Admin SDK routes that bypass rules,
 * `ClinicContext` turns it into `isReadOnly`, and the dashboard shows a banner explaining it.
 *
 * One link was missing: `/api/onboarding/create-clinic` never wrote the field. So the whole
 * apparatus was armed and pointed at a value that was always absent, and every self-signup trial
 * was immortal. This file is the setting that fills it in, and it lives in the database rather
 * than in a constant because the length of a trial is a commercial decision that changes without
 * a deploy — which is what "according to the super dashboard" means.
 *
 * Note what deliberately does NOT exist: a sweep that flips `status` to Expired. Expiry is
 * evaluated from `expiresAt` at the moment of each write, by the rules and by `clinicStatus`
 * together, so there is no job to fall behind, nothing to re-run after downtime, and no window in
 * which a lapsed clinic is still writable because a cron has not fired yet. Extending a trial is
 * one date edit and takes effect on the next request.
 */

/** Root collection. Superadmin-only in `firestore.rules`; refused by a per-clinic restore. */
export const PLATFORM_SETTINGS_COLLECTION = "platform_settings";
/** The single document this module reads and writes. */
export const TRIAL_POLICY_DOC = "trials";

/**
 * The fallback when nobody has saved a policy yet.
 *
 * Fourteen because that is what `lib/subscriptions.ts` has always sized the trial's AI allowance
 * against ("Fourteen days, so this is deliberately more per-day than Pro"). It was a comment
 * describing a number that existed nowhere; this is that number, once.
 */
export const DEFAULT_TRIAL_DAYS = 14;

/** Bounds, so a typo in the dashboard cannot create a one-hour trial or a thousand-year one. */
export const MIN_TRIAL_DAYS = 1;
export const MAX_TRIAL_DAYS = 3650;

/** How many days before the end the clinic starts being told, unless overridden. */
export const DEFAULT_WARN_WITHIN_DAYS = 3;

export interface TrialPolicy {
  /** Days from signup to expiry, for clinics created from now on. */
  trialDays: number;
  /**
   * Whether new trials get an expiry date at all.
   *
   * `false` restores the previous behaviour exactly — a trial with no `expiresAt`, which every
   * layer already reads as "does not expire". It is a real switch rather than a
   * `trialDays: 99999` fudge, because "we are not expiring trials right now" is a decision
   * somebody should be able to make and read back, and a clinic with no expiry date is
   * meaningfully different from one whose expiry is a century out.
   */
  expireTrials: boolean;
  /** Days before expiry that the countdown banner appears. 0 switches the warning off. */
  warnWithinDays: number;
}

export const DEFAULT_TRIAL_POLICY: TrialPolicy = {
  trialDays: DEFAULT_TRIAL_DAYS,
  expireTrials: true,
  warnWithinDays: DEFAULT_WARN_WITHIN_DAYS,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Coerce whatever is in the document into a usable policy.
 *
 * Every field falls back rather than throwing. This value decides whether a paying customer's
 * clinic accepts writes, and it is read on the signup path — a policy document holding a string
 * where a number belongs must produce the default, not a 500 on "Create clinic" or, far worse,
 * an `expiresAt` of `Invalid Date`. Same reasoning as `expiryDate` in `clinicStatus.ts`:
 * lenient about the shape, strict about the consequence.
 */
export function normalizeTrialPolicy(raw: unknown): TrialPolicy {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const rawDays = Number(data.trialDays);
  const trialDays = Number.isFinite(rawDays) && rawDays > 0
    ? clamp(Math.round(rawDays), MIN_TRIAL_DAYS, MAX_TRIAL_DAYS)
    : DEFAULT_TRIAL_DAYS;

  // Absent means "on". A policy document that exists but has never had this field written is a
  // partial save, and defaulting it to "off" would silently un-expire every future trial.
  const expireTrials = data.expireTrials === undefined ? true : data.expireTrials !== false;

  const rawWarn = Number(data.warnWithinDays);
  const warnWithinDays = Number.isFinite(rawWarn) && rawWarn >= 0
    // Never longer than the trial itself: a three-day trial with a seven-day warning is a clinic
    // that is warned it is about to expire from the moment it is created.
    ? clamp(Math.round(rawWarn), 0, trialDays)
    : Math.min(DEFAULT_WARN_WITHIN_DAYS, trialDays);

  return { trialDays, expireTrials, warnWithinDays };
}

/**
 * When a trial starting at `startedAt` should end, or null when trials do not expire.
 *
 * Null is a meaningful answer and callers must write NOTHING rather than a far-future date: an
 * absent `expiresAt` is what every other layer already reads as "no expiry", and inventing a date
 * in 2124 would make "we chose not to expire trials" indistinguishable from "somebody typed the
 * wrong year" when read back from the clinic document three years from now.
 */
export function trialExpiryFrom(startedAt: Date, policy: TrialPolicy): Date | null {
  if (!policy.expireTrials) return null;
  if (Number.isNaN(startedAt.getTime())) return null;
  return new Date(startedAt.getTime() + policy.trialDays * 86400000);
}

/**
 * Should this clinic be warned that its trial is ending, and how many whole days are left?
 *
 * Only for trials that really do have an end. A clinic on a paid plan, or one whose trial carries
 * no expiry, is told nothing — and a clinic already past its expiry is told nothing either,
 * because at that point the read-only banner is on screen saying something truer.
 */
export interface TrialWarning {
  warn: boolean;
  daysLeft: number;
}

export function trialWarning(args: {
  /** The clinic's `expiresAt`, already coerced to a Date by `expiryDate()`, or null. */
  expiresAt: Date | null;
  isTrial: boolean;
  policy: TrialPolicy;
  now?: Date;
}): TrialWarning {
  const now = args.now ?? new Date();
  if (!args.isTrial || !args.expiresAt || args.policy.warnWithinDays <= 0) {
    return { warn: false, daysLeft: 0 };
  }

  const msLeft = args.expiresAt.getTime() - now.getTime();
  // Already lapsed: the read-only banner owns the screen and says the true thing.
  if (msLeft <= 0) return { warn: false, daysLeft: 0 };

  const daysLeft = Math.ceil(msLeft / 86400000);
  return { warn: daysLeft <= args.policy.warnWithinDays, daysLeft };
}
