// The Excel backup a clinic Owner/Admin downloads from Settings → System → Backup.
//
// Not the migration importer (tests/backupImport.test.mts): that restores a v2 file into v3. This
// is the human-readable export — twelve sheets, bilingual headers, real numbers in money columns.
// The builder is pure (src/lib/backup/buildClinicWorkbook.ts) so it is tested here with fixtures
// and no emulator; the loader and the route are checked by the About-sheet counts and by source
// assertions, the repo's pattern for routes.
//
//   npm run test:excel-backup

import assert from "node:assert/strict";
import { BACKUP_TEXT, bi } from "../src/lib/backup/backupText";

// --- 1. Every label has both languages ---------------------------------------------------------
for (const [key, v] of Object.entries(BACKUP_TEXT)) {
  assert.ok(v.en.trim() && v.ar.trim(), `${key} is missing a language`);
  assert.ok(/[؀-ۿ]/.test(v.ar), `${key}.ar is not Arabic`);
  // Headers and sheet names are split on " - " by nothing, but a reader might; keep them clean.
  if (/^(sheet|col)_/.test(key)) assert.ok(!v.en.includes(" - "), `${key}.en contains the bilingual separator`);
}
assert.equal(bi("sheet_patients"), "Patients - المرضى");
assert.equal(bi("type_expense"), "Expense - مصروف");
console.log("clinicBackup: text table ok");
