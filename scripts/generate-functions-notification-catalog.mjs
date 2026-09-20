#!/usr/bin/env node
/**
 * Copies the notification catalogue from the web app into the Cloud Functions package.
 *
 *   node scripts/generate-functions-notification-catalog.mjs   (or: npm run gen:notify-catalog)
 *
 * Both sides have to agree about every alert, because both sides send them: the Next app raises
 * the ones that happen while somebody is using it, and the Cloud Functions raise the scheduled and
 * trigger-driven ones. They cannot share the module — `functions/` is a separate CommonJS package
 * with its own node_modules and no TypeScript step — so the module is copied rather than imported.
 *
 * Unlike the Android drug catalogue, which is re-authored into Kotlin, this copy is the *same*
 * code with its type annotations removed: the resolver is the part that must not drift, and a
 * re-implementation of `resolveNotify` in a second language is exactly how the arrival switch came
 * to read one document while the settings page wrote another. So the transpile is done by the
 * TypeScript compiler already in this repo, which means the two files cannot disagree about logic
 * — only about being regenerated, and `npm run test:notify` fails if they are.
 *
 * Written as UTF-8 with CRLF endings to match the rest of the repo, so re-running it on an
 * unchanged catalogue produces an empty diff.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "src", "lib", "notificationCatalog.ts");
const TARGET = join(ROOT, "functions", "notificationCatalog.js");

const HEADER = `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Compiled from src/lib/notificationCatalog.ts by
 * scripts/generate-functions-notification-catalog.mjs (npm run gen:notify-catalog).
 *
 * Edit the TypeScript module and re-run the generator. npm run test:notify fails if this file is
 * not the current output, so an edit here is reverted by the next person who runs the tests — and
 * a catalogue that disagrees with the app's is how an alert gets sent to the wrong people.
 */

`;

export function buildCatalogModule(source) {
  const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      // Node 20 runs the functions; nothing here needs downlevelling beyond module format.
      removeComments: false,
      newLine: ts.NewLineKind.LineFeed,
    },
    reportDiagnostics: true,
  });
  if (diagnostics && diagnostics.length > 0) {
    const first = ts.flattenDiagnosticMessageText(diagnostics[0].messageText, " ");
    throw new Error(`notificationCatalog.ts did not transpile cleanly: ${first}`);
  }
  return (HEADER + outputText).replace(/\r?\n/g, "\r\n");
}

/** Exported so the test can ask "is the file on disk the current output?" without shelling out. */
export function expectedCatalogModule() {
  return buildCatalogModule(readFileSync(SOURCE, "utf8"));
}

export const CATALOG_SOURCE_PATH = SOURCE;
export const CATALOG_TARGET_PATH = TARGET;

function main() {
  const next = expectedCatalogModule();
  let current = "";
  try {
    current = readFileSync(TARGET, "utf8");
  } catch {
    /* First run. */
  }
  if (current === next) {
    console.log("functions/notificationCatalog.js is already up to date.");
    return;
  }
  writeFileSync(TARGET, next, "utf8");
  console.log(`Wrote functions/notificationCatalog.js (${next.length} bytes).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
