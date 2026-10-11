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

/**
 * The one rule for putting the branch into an outgoing money body.
 *
 * A branch the caller put in the body wins, provided it is a non-empty string. Otherwise the
 * branch on screen (`scope`) is used, provided it is non-empty. Otherwise the key is absent: a body
 * must never carry `branchId: ""` or null, because the server reads that as a bad branch rather
 * than a missing one. Both chokepoints (moneyApi.post, the insurance client) call this.
 */
export function withBranch(body: Record<string, unknown>, scope: string): Record<string, unknown> {
  const { branchId: sent, ...rest } = body;
  const branchId = typeof sent === "string" && sent !== "" ? sent : scope;
  return branchId ? { ...rest, branchId } : rest;
}
