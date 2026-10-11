/**
 * The branch on screen, readable from plain modules.
 *
 * `useActiveBranch` knows which branch the person is working at, but it is a React hook, and the
 * code that sends money calls (moneyApi, the insurance client) is plain modules with no hook to
 * ask. The hook publishes its answer here whenever it changes; those modules read it back — the
 * same pattern as `currentClinicId()` in db-utils. No React imports, on purpose.
 *
 * `""` means "no branch to stamp" (a clinic with no branches, or "All branches" chosen, or the
 * hook not mounted yet). Callers must omit the field rather than send an empty string.
 */
let currentScope = "";

export function setCurrentBranchScope(id: string): void {
  currentScope = id;
}

export function currentBranchId(): string {
  return currentScope;
}
