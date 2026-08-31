/**
 * Re-create the clinic's approved WhatsApp templates on a WhatsApp Business Account.
 *
 * Templates belong to a WABA, not to a phone number. Connecting a real number usually means a new
 * production WABA — Meta's auto-provisioned developer account is a *test* account and cannot hold
 * a real SIM — and the templates approved on the old one do not travel with the number. Without
 * this step everything looks connected and then every reminder silently fails to deliver, because
 * outside the 24-hour window only an approved template is delivered at all. That failure mode has
 * already cost this project one live debugging session.
 *
 * The definitions come from scripts/meta-templates.json, captured verbatim from the templates Meta
 * approved, so what is re-submitted is byte-identical to what passed review rather than retyped.
 *
 * Usage:
 *   npx tsx scripts/register-meta-templates.mts <WABA_ID> [--clinic <id>] [--dry]
 *
 * The access token is read from clinic_secrets, never passed on the command line — a token in a
 * shell argument ends up in the shell history and in every process listing on the machine.
 */
import fs from "node:fs";
import path from "node:path";
import nextEnv from "@next/env";

(nextEnv as any).loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const args = process.argv.slice(2);
const wabaId = args.find((a) => !a.startsWith("--"));
const dry = args.includes("--dry");
const clinicId = args[args.indexOf("--clinic") + 1] && args.includes("--clinic")
  ? args[args.indexOf("--clinic") + 1]
  : "SmtW6r6jKaFhfRWYcxsG";

if (!wabaId) {
  console.error("usage: npx tsx scripts/register-meta-templates.mts <WABA_ID> [--clinic <id>] [--dry]");
  process.exit(1);
}

const { adminDb } = await import("../src/lib/firebaseAdmin");
const sec = await adminDb().collection("clinic_secrets").doc(clinicId).get();
const token = ((sec.data()?.metaWhatsapp || {}) as any).token as string | undefined;
if (!token) {
  console.error(`No Meta access token stored for clinic ${clinicId}. Save it in Settings first.`);
  process.exit(1);
}

const defs = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts", "meta-templates.json"), "utf8"));
const G = "https://graph.facebook.com/v21.0";

// What is already there, so a re-run is safe to repeat rather than a pile of duplicate errors.
const existingRes = await fetch(`${G}/${wabaId}/message_templates?fields=name,status&limit=100`, {
  headers: { Authorization: `Bearer ${token}` },
});
const existingBody: any = await existingRes.json().catch(() => ({}));
if (!existingRes.ok) {
  console.error("Could not read the WABA's templates:", String(existingBody?.error?.message).slice(0, 200));
  process.exit(1);
}
const already = new Map<string, string>((existingBody.data || []).map((t: any) => [t.name, t.status]));
console.log(`WABA ${wabaId} currently holds ${already.size} template(s).\n`);

for (const t of defs) {
  const seen = already.get(t.name);
  if (seen) {
    console.log(`= ${t.name.padEnd(24)} already present (${seen}) — skipped`);
    continue;
  }
  if (dry) {
    console.log(`+ ${t.name.padEnd(24)} would be created (${t.category}, ${t.language})`);
    continue;
  }
  const res = await fetch(`${G}/${wabaId}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: t.name, language: t.language, category: t.category, components: t.components }),
  });
  const body: any = await res.json().catch(() => ({}));
  console.log(
    res.ok
      ? `+ ${t.name.padEnd(24)} submitted — status ${body.status ?? "PENDING"}`
      : `! ${t.name.padEnd(24)} FAILED — ${String(body?.error?.error_user_msg || body?.error?.message).slice(0, 160)}`
  );
}

console.log(
  "\nSubmitted templates start PENDING. Approval has taken minutes to hours before; nothing" +
    "\nbusiness-initiated delivers on this WABA until they read APPROVED."
);
