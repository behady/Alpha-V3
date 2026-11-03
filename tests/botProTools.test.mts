/**
 * The Pro brain's tools: calendar window, evening filter, patient-file guard, price lookup.
 *
 * Run: npm run test:pro-tools
 */
import assert from "node:assert/strict";
import { PRO_REPLY_ACTIONS, PRO_TOOL_DECLARATIONS, runTool, type ToolEnv } from "../src/lib/botPro/tools";

async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  console.log(`ok - ${name}`);
}

const TODAY = "2026-11-02";

function addDays(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function makeEnv(over: Partial<ToolEnv> = {}): ToolEnv {
  return {
    todayKey: TODAY,
    // Every day open, 30 days out, so the tool itself must do the clamping.
    openDays: (from, to) => {
      const out: string[] = [];
      for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
      return out;
    },
    freeTimes: async () => ["09:00 AM", "10:00 AM", "11:00 AM", "01:00 PM", "03:00 PM", "05:00 PM", "06:00 PM", "07:00 PM"],
    dayLabel: (d, t, doc) => `${d} ${t}${doc ? ` ${doc}` : ""}`,
    person: { patientId: "p1", family: [{ id: "p1", name: "Mona" }, { id: "p2", name: "Omar" }], upcoming: [], past: [], degraded: false, writerKnown: true },
    patientFile: async (id) => `file of ${id}`,
    prices: [{ name: "تقويم معدني", price: 15000 }],
    shown: new Map(),
    ...over,
  };
}

const slotsOf = (r: Record<string, unknown>) => r.slots as Array<{ id: string; label: string }>;

await test("find_slots over 30 days stays within today+14 and 8 slots, ids s1..s8", async () => {
  const env = makeEnv();
  const r = await runTool("find_slots", { from: TODAY, to: addDays(TODAY, 30) }, env);
  const slots = slotsOf(r);
  assert.equal(slots.length, 8);
  assert.deepEqual(slots.map((s) => s.id), ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]);
  const max = addDays(TODAY, 14);
  for (const { key } of env.shown.values()) assert.ok(key.split("|")[0] <= max);
  assert.equal(env.shown.get("s1")?.key.split("|").length, 3);
});

await test("a second find_slots call continues at s9", async () => {
  const env = makeEnv();
  await runTool("find_slots", { from: TODAY, to: addDays(TODAY, 30) }, env);
  const r = await runTool("find_slots", { from: TODAY }, env);
  assert.equal(slotsOf(r)[0].id, "s9");
  assert.equal(env.shown.size, 16);
});

await test("a day shows at most 3 times, spread earliest/middle/latest", async () => {
  const env = makeEnv();
  await runTool("find_slots", { from: TODAY, to: TODAY }, env);
  const times = [...env.shown.values()].map((v) => v.key.split("|")[1]);
  assert.deepEqual(times, ["09:00 AM", "01:00 PM", "07:00 PM"]);
});

await test("evening returns only times from 17:00", async () => {
  const env = makeEnv();
  await runTool("find_slots", { from: TODAY, partOfDay: "evening" }, env);
  const times = [...env.shown.values()].map((v) => v.key.split("|")[1]);
  assert.ok(times.length > 0);
  for (const t of times) assert.ok(["05:00 PM", "06:00 PM", "07:00 PM"].includes(t), t);
});

await test("morning < 12:00 and afternoon 12:00-16:59", async () => {
  const env = makeEnv();
  await runTool("find_slots", { from: TODAY, to: TODAY, partOfDay: "morning" }, env);
  assert.deepEqual([...env.shown.values()].map((v) => v.key.split("|")[1]), ["09:00 AM", "10:00 AM", "11:00 AM"]);
  const env2 = makeEnv();
  await runTool("find_slots", { from: TODAY, to: TODAY, partOfDay: "afternoon" }, env2);
  assert.deepEqual([...env2.shown.values()].map((v) => v.key.split("|")[1]), ["01:00 PM", "03:00 PM"]);
});

await test("a past from is clamped to today; a missing to is from+6", async () => {
  const env = makeEnv();
  await runTool("find_slots", { from: "2020-01-01" }, env);
  const days = new Set([...env.shown.values()].map((v) => v.key.split("|")[0]));
  assert.ok(days.has(TODAY));
  assert.ok([...days].every((d) => d >= TODAY));
  const env2 = makeEnv();
  await runTool("find_slots", { from: addDays(TODAY, 3) }, env2);
  const days2 = [...new Set([...env2.shown.values()].map((v) => v.key.split("|")[0]))];
  assert.ok(days2.every((d) => d <= addDays(TODAY, 9)));
});

await test("a window entirely beyond today+14 finds nothing", async () => {
  const r = await runTool("find_slots", { from: addDays(TODAY, 20), to: addDays(TODAY, 25) }, makeEnv());
  assert.deepEqual(r, { slots: [], note: "no free time in that window" });
});

await test("invalid dates are 'bad date'", async () => {
  const env = makeEnv();
  assert.deepEqual(await runTool("find_slots", { from: "tomorrow" }, env), { slots: [], note: "bad date" });
  assert.deepEqual(await runTool("find_slots", { from: TODAY, to: "2026-13-45" }, env), { slots: [], note: "bad date" });
  assert.deepEqual(await runTool("find_slots", {}, env), { slots: [], note: "bad date" });
  assert.equal(env.shown.size, 0);
});

await test("a fully booked window says so", async () => {
  const r = await runTool("find_slots", { from: TODAY }, makeEnv({ freeTimes: async () => [] }));
  assert.deepEqual(r, { slots: [], note: "no free time in that window" });
});

await test("doctor is passed through and ends up in the key", async () => {
  const env = makeEnv();
  await runTool("find_slots", { from: TODAY, to: TODAY, doctor: "Dr Sara" }, env);
  assert.equal(env.shown.get("s1")?.key, `${TODAY}|09:00 AM|Dr Sara`);
});

await test("get_patient_file refuses an id that is not on the number", async () => {
  const env = makeEnv();
  assert.deepEqual(await runTool("get_patient_file", { patientId: "p9" }, env), { error: "not_on_this_number" });
  assert.deepEqual(await runTool("get_patient_file", {}, env), { error: "not_on_this_number" });
  assert.deepEqual(await runTool("get_patient_file", { patientId: "p2" }, env), { file: "file of p2" });
});

await test("get_patient_file allows person.patientId even when family is empty (lid chats)", async () => {
  const env = makeEnv({ person: { patientId: "px", family: [], upcoming: [], past: [], degraded: false, writerKnown: true } });
  assert.deepEqual(await runTool("get_patient_file", { patientId: "px" }, env), { file: "file of px" });
});

await test("get_price matches Arabic through the definite article and alef/ya/ta-marbuta forms", async () => {
  const env = makeEnv();
  assert.deepEqual(await runTool("get_price", { service: "تقويم" }, env), { matches: [{ name: "تقويم معدني", price: 15000 }] });
  assert.deepEqual(await runTool("get_price", { service: "زراعة" }, env), { matches: [] });
  assert.equal(((await runTool("get_price", { service: "التقويم" }, env)).matches as unknown[]).length, 1);
  const env2 = makeEnv({ prices: [{ name: "الزراعة الفورية", price: 9000 }, { name: "Whitening", price: 2000 }] });
  assert.equal(((await runTool("get_price", { service: "زراعه" }, env2)).matches as unknown[]).length, 1);
  assert.equal(((await runTool("get_price", { service: "فوريه" }, env2)).matches as unknown[]).length, 1);
  assert.equal(((await runTool("get_price", { service: "WHITEN" }, env2)).matches as unknown[]).length, 1);
});

await test("get_price caps at 5 and never invents", async () => {
  const prices = Array.from({ length: 9 }, (_, i) => ({ name: `Filling ${i}`, price: 100 + i }));
  const r = await runTool("get_price", { service: "filling" }, makeEnv({ prices }));
  assert.equal((r.matches as unknown[]).length, 5);
  assert.deepEqual(await runTool("get_price", { service: "" }, makeEnv({ prices })), { matches: [] });
});

await test("unknown tool and reply are not executed", async () => {
  const env = makeEnv();
  assert.deepEqual(await runTool("drop_tables", {}, env), { error: "unknown_tool" });
  assert.deepEqual(await runTool("reply", { action: "answer", reply: "hi" }, env), { error: "reply_is_final" });
});

await test("declarations: four tools, reply action enum has the 11 actions", () => {
  assert.deepEqual(PRO_TOOL_DECLARATIONS.map((d) => d.name), ["find_slots", "get_patient_file", "get_price", "reply"]);
  assert.equal(PRO_REPLY_ACTIONS.length, 11);
  const reply = PRO_TOOL_DECLARATIONS.find((d) => d.name === "reply")!;
  const action = (reply.parameters as unknown as { properties: { action: { enum: string[] } } }).properties.action;
  assert.deepEqual(action.enum, [...PRO_REPLY_ACTIONS]);
});
