/**
 * Every server file that writes the ledger keeps a paid-daily dentist's day's share in step.
 *
 * A paid-daily dentist's automatic line is re-worked whenever a money change is audited
 * (`lib/server/ledgerAudit.ts` → `dailyPaySync.ts`). A new place that writes ledger rows without
 * auditing them would leave the line wrong until the nightly check. This test lists every source
 * file that both names the "ledger" collection and calls a write, and fails unless it audits through
 * `ledgerAudit`, calls `dailyPaySync` itself, or is listed below with the reason it cannot move a
 * dentist's share.
 *
 *   npm run test:daily-pay-coverage
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/** Files that write ledger rows but can never change a dentist's private payments, and why. */
const CANNOT_MOVE_A_SHARE: Record<string, string> = {
  "src/lib/server/dailyPaySync.ts": "writes the day's share itself (expense rows, no dentist on them)",
  "src/lib/server/staffSettlementSync.ts": "stamps paid/deducted on payment rows; never changes a share",
  "src/lib/server/ledgerAuditWrite.ts": "writes the audit collection, not the ledger",
  "src/lib/server/ledgerSync.ts": "re-spreads a treatment's lab fee and paid total; only called from routes that audit that treatment, and its dentist is re-worked whole",
  // Named "ledger" only to READ it; the write calls the scan saw are on other collections or Sets/Maps.
  "src/app/api/admin/find-misplaced-records/route.ts": "reads ledger to report misplaced rows; writes nothing",
  "src/app/api/whatsapp/send-patient-message/route.ts": "reads ledger for a receipt; writes whatsapp_logs",
  "src/lib/automation/briefing/data.ts": "reads ledger for the owner's briefing",
  "src/lib/bot/patientDossier.ts": "reads ledger for the bot's patient summary",
  "src/lib/deletePolicy.ts": "decides what a delete cascades to; the delete routes that act on it audit",
  "src/lib/mcp/tools.ts": "the connector may never write ledger (MCP_SERVER_ONLY_COLLECTIONS)",
  "src/lib/metaConversionsServer.ts": "reads ledger for ad conversions; writes its own queue",
  "src/lib/migration/verify.ts": "reads ledger to verify a migration",
  "src/lib/patientNotifications.ts": "reads ledger for receipts; writes whatsapp_logs",
  "src/lib/paymentRecovery.ts": "reads ledger to find misallocated payments",
  "src/lib/reports/loadReportData.server.ts": "reads ledger for reports",
  "src/lib/revenueRecovery.ts": "reads ledger to find missed charges",
  "src/lib/server/companySheetData.ts": "reads ledger for the insurance company sheet",
  "src/lib/serverLogger.ts": "writes system_logs",
};

/** Client-side files: Firestore rules refuse every client write to `ledger` (memory: money writes go through the API). */
function isClientFile(src: string): boolean {
  return /from ["']firebase\/firestore["']/.test(src) && !/from ["']firebase-admin/.test(src);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const offenders: string[] = [];
const covered: string[] = [];
for (const file of walk(path.join(ROOT, "src"))) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const src = fs.readFileSync(file, "utf8");
  if (!/["']ledger["']/.test(src)) continue;
  if (!/\.(set|update|delete|add)\(|batch\.(set|update|delete)|\b(tx|txn|transaction)\.(set|update|delete)/.test(src)) continue;
  if (isClientFile(src)) continue;
  const audits = /from ["']@\/lib\/server\/ledgerAudit["']/.test(src);
  const syncs = /from ["']@\/lib\/server\/dailyPaySync["']/.test(src);
  if (audits || syncs || CANNOT_MOVE_A_SHARE[rel]) {
    covered.push(rel);
    continue;
  }
  offenders.push(rel);
}

assert.deepEqual(
  offenders,
  [],
  `These files write the ledger but neither audit through lib/server/ledgerAudit nor call lib/server/dailyPaySync:\n  ${offenders.join("\n  ")}\n` +
    "A payment they change would leave a paid-daily dentist's day's share wrong until the nightly check.",
);
for (const rel of Object.keys(CANNOT_MOVE_A_SHARE)) assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} is listed but no longer exists`);
assert.ok(covered.includes("src/app/api/finance/ledger/route.ts"), "the scan must see the main money route");

console.log(`daily pay coverage: ${covered.length} ledger writers checked`);
