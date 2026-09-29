/**
 * The one fact the walkthrough scripts share.
 *
 * Kept in a file with no side effects on purpose. promo-find-clinic.mjs once imported this
 * constant from promo-clean-clinic.mjs, whose top level RUNS main() — so looking up the clinic
 * created on camera deleted it, because both scripts read the same --name flag. A module that
 * exports a value must not also do work when imported.
 */

/** The account the recording browser is signed in as — behady@alphadental.com. */
export const RECORDING_UID = "RXXm1JE22dc1srDUlVKZL3LkFnP2";
