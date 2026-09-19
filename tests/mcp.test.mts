import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mcpToolCatalogue, runMcpTool, type McpToolContext } from "../src/lib/mcp/tools.ts";
import { isGlobalCollection } from "../src/lib/adminClinicDb.ts";
import { resolveBriefingAccess } from "../src/lib/automation/briefing/build.ts";

/**
 * The MCP connector's boundaries.
 *
 * This endpoint hands a clinic's live records to a program we do not control, on the strength of
 * a key the clinic issued. Everything asserted here is a wall that the rest of the system relies
 * on and that no reviewer can see by reading one file:
 *
 *   - a collection name cannot walk out of the clinic,
 *   - a read-only key cannot write,
 *   - a staff member's own permissions still apply,
 *   - and a tool a key may not use is not even advertised to it.
 *
 * Every case below returns before Firestore is touched, so this runs with no emulator and no
 * credentials — which is the point: a guard that needs a database to prove is a guard nobody
 * runs in CI.
 */

const REPO = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function ctx(over: Partial<McpToolContext> = {}): McpToolContext {
  return {
    clinicId: "clinic-a",
    uid: "user-1",
    role: "Owner",
    permissions: [],
    scope: "read",
    ...over,
  };
}

let checks = 0;
const check = (cond: unknown, message: string) => {
  assert.ok(cond, message);
  checks++;
};

// --- 1. A collection name cannot leave the clinic ------------------------------------------------
//
// `adminClinicCollection` returns GLOBAL collections unprefixed — correct for the code that reads
// `users` on purpose, and a platform-wide leak here, because the name arrives from a language
// model that was asked to be resourceful. The guard must run before any reference is built.
for (const escape of ["users", "clinics", "clinic_secrets", "join_requests", "mcp_keys"]) {
  check(isGlobalCollection(escape), `${escape} must be registered as a global collection`);
  const res = await runMcpTool("query_collection", { collection: escape }, ctx());
  check(
    !res.ok && /platform-wide/.test(res.error),
    `query_collection must refuse the root collection "${escape}"`
  );
}

for (const bad of ["../users", "patients/x/notes", "pat ients", "", "patients;drop"]) {
  const res = await runMcpTool("query_collection", { collection: bad }, ctx());
  check(!res.ok, `query_collection must refuse the malformed name ${JSON.stringify(bad)}`);
}

// --- 2. A read-only key cannot write -------------------------------------------------------------
for (const tool of ["write_document", "delete_document"]) {
  const res = await runMcpTool(tool, { collection: "patients", id: "p1", data: {} }, ctx());
  check(!res.ok && /read-only/.test(res.error), `${tool} must refuse a read-scoped key`);
}

// A tool a key may not call must not be advertised to it either: a model shown a tool will try it,
// and an error it could have avoided is a wasted round trip and a confusing answer.
const readNames = mcpToolCatalogue("read").map((t) => t.name);
const fullNames = mcpToolCatalogue("full").map((t) => t.name);
check(!readNames.includes("write_document"), "a read key must not be shown write_document");
check(!readNames.includes("delete_document"), "a read key must not be shown delete_document");
check(fullNames.includes("write_document"), "a full key must be shown write_document");
check(fullNames.includes("delete_document"), "a full key must be shown delete_document");
check(
  readNames.every((n) => fullNames.includes(n)),
  "a full key must keep every read tool"
);

// Every advertised tool must have a schema a client can validate against, or the call arrives
// shaped however the model guessed.
for (const tool of mcpToolCatalogue("full")) {
  check(typeof tool.description === "string" && tool.description.length > 20, `${tool.name} needs a real description`);
  check(tool.inputSchema?.type === "object", `${tool.name} needs an object inputSchema`);
}

// --- 3. The staff member's own permissions still apply -------------------------------------------
//
// The whole point of a key naming a person: connecting an assistant must not become a way around
// a permission checkbox. A receptionist's key answers a receptionist's questions.
const receptionist = ctx({ role: "Receptionist", permissions: [] });
for (const money of ["ledger", "lab_payments"]) {
  const res = await runMcpTool("query_collection", { collection: money }, receptionist);
  check(!res.ok && /finance/.test(res.error), `"${money}" must be refused without finance access`);
}
for (const hr of ["attendance", "staff"]) {
  const res = await runMcpTool("query_collection", { collection: hr }, receptionist);
  check(!res.ok && /staff-records/.test(res.error), `"${hr}" must be refused without HR access`);
}

// Granting the permission opens exactly that door. Asserted against the shared resolver rather
// than by calling the tool, because past the gate the tool reaches Firestore — and a test that
// needs credentials to prove a permission check is a test that stops being run.
check(
  resolveBriefingAccess("Receptionist", ["access.finance"]).money,
  "access.finance must grant money access"
);
check(
  resolveBriefingAccess("Receptionist", ["attendance.admin"]).hr,
  "attendance.admin must grant staff-records access"
);
check(
  /resolveBriefingAccess/.test(readFileSync(join(REPO, "src/lib/mcp/tools.ts"), "utf8")),
  "the connector must gate reads with the same resolver the app and the weekly brief use"
);

// A full-access key is still bounded by the person: write scope is not a permission bypass.
const fullButUnprivileged = ctx({ role: "Receptionist", permissions: [], scope: "full" });
const writeDenied = await runMcpTool(
  "write_document",
  { collection: "ledger", data: { amount: 1 } },
  fullButUnprivileged
);
check(
  !writeDenied.ok && /cannot create/.test(writeDenied.error),
  "a full-scope key must still obey the writer's own permissions"
);

// --- 4. An unknown tool is refused, not guessed at ------------------------------------------------
const unknown = await runMcpTool("drop_everything", {}, ctx({ scope: "full" }));
check(!unknown.ok && /No such tool/.test(unknown.error), "an unknown tool must be refused by name");

// --- 5. The key store stays out of the browser ---------------------------------------------------
//
// Keys are hashed, but the record also says which ones carry write access — a shopping list for
// anyone who can read it, and the blanket clinic-member read grant inside clinics/{id}/ is exactly
// why this collection sits at the root instead.
const rules = readFileSync(join(REPO, "firestore.rules"), "utf8");
check(
  /match \/mcp_keys\/\{keyId\} \{\s*allow read, write: if false;/.test(rules),
  "mcp_keys must be denied to every client in firestore.rules"
);

// And the plaintext must exist in exactly one direction: minted, shown once, never read back.
const keysSource = readFileSync(join(REPO, "src/lib/mcp/keys.ts"), "utf8");
// `toRecord` is the only thing that shapes a key for the outside world — the API route and the
// settings screen both render what it returns. It must build the object field by field: a
// `...data` spread there would put the hash on screen the day somebody adds a field.
const toRecordSource = keysSource.slice(keysSource.indexOf("function toRecord"));
const toRecordBody = toRecordSource.slice(0, toRecordSource.indexOf("\n}"));
check(!toRecordBody.includes("secretHash"), "the stored hash must never leave the key store");
check(!toRecordBody.includes("...data"), "toRecord must name its fields, not spread the document");
check(
  /createHash\("sha256"\)/.test(keysSource) && /timingSafeEqual/.test(keysSource),
  "keys must be stored hashed and compared in constant time"
);

console.log(`✓ mcp: ${checks} checks passed`);
