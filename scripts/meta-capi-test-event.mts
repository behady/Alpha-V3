/**
 * Send one TEST conversion event to Meta for a clinic, from the command line.
 *
 * The settings card has a "Send test event" button that does the same thing; this exists for the
 * developer who is wiring a new clinic, or chasing why Meta says nothing arrived, and wants to see
 * the exact body and Meta's exact answer without clicking through the app.
 *
 * Usage:
 *   npx tsx scripts/meta-capi-test-event.mts --clinic <clinicId> [--code TEST123] [--ctwa <ctwa_clid>]
 *                                            [--event LeadSubmitted|QualifiedLead|Purchase] [--dry]
 *
 *   --clinic  the clinic whose settings (clinic_secrets/{id}.metaCapi) are used. Required.
 *   --code    the Test Events code from Events Manager. Falls back to the one saved in the card.
 *             The script REFUSES to run without one: an event without a test code is a real event,
 *             and Meta trains the ad set on real events — a test must never be one.
 *   --ctwa    the click id to credit. Falls back to the newest ad click recorded on any of the
 *             clinic's WhatsApp conversations. Meta checks the click id is real, so a made-up one
 *             is usually rejected.
 *   --event   which event to send. Default LeadSubmitted.
 *   --dry     print the body and the endpoint it WOULD post to, and stop. Nothing is sent.
 *
 * It reads .env.local, which points at the PRODUCTION Firestore. It only reads settings there
 * (and, when not --dry, the server module logs the test send like any other event). The access
 * token is never printed, never accepted on the command line (a token in a shell argument lands
 * in shell history and process listings) and never leaves clinic_secrets except in the
 * Authorization header of the one request.
 *
 * Arguments are checked before anything else is loaded, so a wrong command line touches nothing.
 */

const EVENTS = ["LeadSubmitted", "QualifiedLead", "Purchase"] as const;
type EventName = (typeof EVENTS)[number];

const USAGE =
  "usage: npx tsx scripts/meta-capi-test-event.mts --clinic <clinicId> [--code TEST123] [--ctwa <ctwa_clid>] [--event LeadSubmitted|QualifiedLead|Purchase] [--dry]";

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

/** `--name value` pairs and bare `--flag`s. A value that starts with "--" is a missing value. */
function parseArgs(argv: string[]): { values: Record<string, string>; flags: Set<string> } {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  const withValue = new Set(["clinic", "code", "ctwa", "event"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) fail(`unexpected argument: ${a}\n${USAGE}`);
    const name = a.slice(2);
    if (withValue.has(name)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--") || !v.trim()) fail(`--${name} needs a value\n${USAGE}`);
      values[name] = v.trim();
      i++;
    } else if (name === "dry" || name === "help") {
      flags.add(name);
    } else {
      fail(`unknown option: ${a}\n${USAGE}`);
    }
  }
  return { values, flags };
}

const { values, flags } = parseArgs(process.argv.slice(2));
if (flags.has("help")) {
  console.log(USAGE);
  process.exit(0);
}
const clinicId = values.clinic || "";
if (!clinicId) fail(`--clinic is required\n${USAGE}`);
const eventName = (values.event || "LeadSubmitted") as EventName;
if (!EVENTS.includes(eventName)) fail(`--event must be one of ${EVENTS.join(", ")}\n${USAGE}`);
const dry = flags.has("dry");

// ── Only now: environment, then the modules that read it (the Graph version, the admin SDK). ──
const nextEnv = (await import("@next/env")).default;
(nextEnv as any).loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const { buildConversionPayload, eventsEndpoint, redactPayload, META_CAPI_GRAPH_VERSION } = await import("../src/lib/metaConversions");
const { loadCapiConfig, latestClinicClick, sendTestConversion } = await import("../src/lib/metaConversionsServer");

const config = await loadCapiConfig(clinicId);

const tokenLine = !config.token ? "missing" : config.tokenFromWhatsapp ? "set (from WhatsApp card)" : "set (own)";
const wabaLine = !config.wabaId ? "missing" : `${config.wabaId}${config.wabaFromWhatsapp ? " (from WhatsApp card)" : ""}`;
console.log(`clinic:        ${clinicId}`);
console.log(`switched on:   ${config.enabled ? "yes" : "no (a test event does not need it on)"}`);
console.log(`dataset id:    ${config.datasetId || "missing"}`);
console.log(`WABA id:       ${wabaLine}`);
console.log(`token:         ${tokenLine}`);
console.log(`graph version: ${META_CAPI_GRAPH_VERSION}`);

const testEventCode = (values.code || config.testEventCode || "").trim();
if (!testEventCode) {
  fail(
    [
      "",
      "Refusing to send: no test event code.",
      "Without one this would be a REAL conversion, and Meta would train the clinic's ads on it.",
      "Get one: Events Manager -> the clinic's dataset -> Test events -> copy the code (looks like TEST12345).",
      "Then pass --code TEST12345, or paste it into Settings -> WhatsApp -> Meta ad results.",
    ].join("\n"),
    2,
  );
}
console.log(`test code:     ${testEventCode}${values.code ? " (from --code)" : " (saved in the card)"}`);

let ctwaClid = values.ctwa || "";
let ctwaSource = "from --ctwa";
if (!ctwaClid) {
  const latest = await latestClinicClick(clinicId);
  if (latest?.ctwaClid) {
    ctwaClid = latest.ctwaClid;
    ctwaSource = `newest ad click on this clinic, ${new Date(latest.clickedAt).toISOString()}${latest.headline ? ` — "${latest.headline}"` : ""}`;
  }
}
console.log(`click id:      ${ctwaClid ? `${ctwaClid.slice(0, 24)}${ctwaClid.length > 24 ? "…" : ""} (${ctwaSource})` : "none"}`);
console.log(`event:         ${eventName}`);

if (dry) {
  const nowMs = Date.now();
  const body = buildConversionPayload({
    eventName,
    eventTimeMs: nowMs,
    eventId: `test_${nowMs}`, // the same id shape sendTestConversion uses

    wabaId: config.wabaId || "<WABA id missing>",
    match: { kind: "ctwa", ctwaClid: ctwaClid || "<no click id: pass --ctwa>" },
    value: eventName === "Purchase" ? 1 : 0,
    testEventCode,
  });
  console.log("");
  console.log(`--dry: nothing sent. Would POST to ${config.datasetId ? eventsEndpoint(config.datasetId) : `https://graph.facebook.com/${META_CAPI_GRAPH_VERSION}/<dataset id missing>/events`}`);
  console.log("with header Authorization: Bearer [token, not shown] and this body:");
  console.log(JSON.stringify(redactPayload(body), null, 2));
  if (config.missing.length) console.log(`\nStill missing before a real send: ${config.missing.join(", ")}`);
  process.exit(0);
}

const notReady = [!config.datasetId && "dataset id", !config.wabaId && "WABA id", !config.token && "access token"].filter(Boolean);
if (notReady.length) fail(`\nRefusing to send: ${notReady.join(", ")} not set. Fill them in Settings -> WhatsApp -> Meta ad results (or the WhatsApp card).`, 2);
if (!ctwaClid) {
  fail(
    "\nRefusing to send: no click id. No ad conversation has been recorded on this clinic yet.\n" +
      "Open the clinic's WhatsApp from one of its ads (or pass --ctwa <ctwa_clid> from a real ad chat) and try again.",
    2,
  );
}

console.log("\nSending…");
const result = await sendTestConversion(clinicId, { eventName, ctwaClid, testEventCode });
const o = result.outcome;
console.log(`result:          ${result.ok ? "ACCEPTED" : "NOT accepted"}`);
console.log(`event id:        ${result.eventId}`);
if (o) {
  console.log(`http status:     ${o.httpStatus || "no answer (network error or timeout)"}`);
  console.log(`events_received: ${o.eventsReceived ?? "-"}`);
  console.log(`fbtrace_id:      ${o.fbtraceId ?? "-"}`);
  if (o.error) console.log(`error:           ${o.error}${o.errorCode !== undefined ? ` (code ${o.errorCode})` : ""}`);
}
if (result.error) console.log(`error:           ${result.error}`);
console.log("\nNow look in Events Manager → your dataset → Test events. It shows up within a minute or so.");
console.log("When you are done testing, CLEAR the test code in the card — while it is saved, live reporting is paused:");
console.log("real bookings and visits wait in the queue (up to Meta's seven days) and nothing is sent for them.");
process.exit(result.ok ? 0 : 1);
