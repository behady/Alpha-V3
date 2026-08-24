/**
 * Holds the lint error count at its historical baseline.
 *
 * The codebase carries 80 ESLint errors that predate the test suites and the money work — almost
 * all in functions/. A plain `eslint .` therefore exits red forever, which in CI teaches everyone
 * to ignore the red, and an ignored check is worse than no check. Deleting the rule set instead
 * would let new errors land silently.
 *
 * So: the build fails only when the count RISES above the baseline — someone added a new error —
 * and prints a reminder to ratchet the number down here whenever a cleanup drops the count.
 */

import { spawnSync } from "node:child_process";

// 80 → 78 on 2026-08-24, when the seven undeployed Cloud Functions exports and their private
// helpers were deleted. Ratcheted rather than left slack: a baseline that stays above the real
// count quietly re-admits two errors nobody asked for.
const BASELINE = 78;

const result = spawnSync("npx", ["eslint", ".", "--format", "json"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  shell: process.platform === "win32",
});

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error("eslint did not produce JSON output:");
  console.error(result.stdout?.slice(0, 2000));
  console.error(result.stderr?.slice(0, 2000));
  process.exit(1);
}

const errors = report.reduce((sum, file) => sum + file.errorCount, 0);
const warnings = report.reduce((sum, file) => sum + file.warningCount, 0);

console.log(`eslint: ${errors} errors (baseline ${BASELINE}), ${warnings} warnings`);

if (errors > BASELINE) {
  const offenders = report
    .filter((f) => f.errorCount > 0)
    .map((f) => `  ${f.filePath} (${f.errorCount})`)
    .join("\n");
  console.error(
    `\nLint errors rose above the baseline: ${errors} > ${BASELINE}.\n` +
      `New errors were introduced. Files with errors:\n${offenders}\n`
  );
  process.exit(1);
}

if (errors < BASELINE) {
  console.log(
    `Nice — the count dropped below the baseline. Lower BASELINE to ${errors} in ` +
      `scripts/check-lint-baseline.mjs so the improvement is locked in.`
  );
}
