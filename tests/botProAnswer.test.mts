/**
 * The Pro brain's turn: the tool loop, the red-line checks, the already-booked rule, the re-check
 * before returning, credits, and the fall back to the standard brain on any failure.
 *
 * A scripted fake model and an injected context/sink: nothing here touches Firestore, the network
 * or the production key, and the deadline test runs on an injected clock.
 *
 * Run: npm run test:pro-answer
 */
import assert from "node:assert/strict";
import { answerWithPro, PRO_CREDITS_PER_REPLY, type ProArgs, type ProModel } from "../src/lib/botPro/answerWithPro";
import type { ProContext, ProSink } from "../src/lib/botPro/proContext";
import type { ProAppointment, ProPerson } from "../src/lib/botPro/person";
import { arabicDayLabel, arabicTimeLabel } from "../src/lib/arabicDateTime";

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

const label = (d: string, t: string, doc: string) => `${arabicDayLabel(d)} الساعة ${arabicTimeLabel(t)}${doc ? ` مع ${doc}` : ""}`;

function person(over: Partial<ProPerson> = {}): ProPerson {
  return { patientId: "p1", family: [{ id: "p1", name: "Mona" }], upcoming: [], past: [], degraded: false, writerKnown: true, ...over };
}

function appt(over: Partial<ProAppointment> = {}): ProAppointment {
  return { id: "a1", patientId: "p1", date: addDays(TODAY, 3), time: "11:00 AM", doctor: "", status: "Scheduled", ...over };
}

type Spy = { freeTimesDoctors: string[] };

function makeContext(over: Partial<ProContext> = {}, spy: Spy = { freeTimesDoctors: [] }): ProContext {
  const p = over.person ?? person();
  return {
    todayKey: TODAY,
    person: p,
    reloadPerson: async () => p,
    thread: [{ author: "patient", text: "عايز احجز تنضيف" }],
    prices: [{ name: "تنضيف", price: 500 }],
    priceLines: "تنضيف: يبدأ من 500 ج.م",
    doctors: ["Mohamed Ehab", "Sara Ali"],
    openDays: (from, to) => {
      const out: string[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
      return out;
    },
    freeTimes: async (_d, doctor) => {
      spy.freeTimesDoctors.push(doctor);
      return ["05:00 PM"];
    },
    dayLabel: label,
    patientFile: async (id) => `file of ${id}: الباقي 300 ج.م`,
    ...over,
  };
}

type Step = { functionCall?: { name: string; args: Record<string, unknown> }; text?: string } | "hang";

function fakeModel(script: Step[]): ProModel & { calls: unknown[][]; systems: string[] } {
  const calls: unknown[][] = [];
  const systems: string[] = [];
  let i = 0;
  return {
    calls,
    systems,
    async send(contents, system) {
      calls.push(JSON.parse(JSON.stringify(contents)));
      systems.push(system);
      const step = script[i++] ?? { text: "..." };
      if (step === "hang") return new Promise(() => {});
      return step;
    },
  };
}

function fakeSink(): ProSink & { charges: number[]; rows: Array<Record<string, unknown>> } {
  const charges: number[] = [];
  const rows: Array<Record<string, unknown>> = [];
  return {
    charges,
    rows,
    async charge(credits) {
      charges.push(credits);
    },
    async debug(row) {
      rows.push(row);
    },
  };
}

const call = (name: string, args: Record<string, unknown>): Step => ({ functionCall: { name, args } });
const reply = (args: Record<string, unknown>): Step => call("reply", args);

function args(over: Partial<ProArgs> = {}): ProArgs {
  return {
    clinicId: "c1",
    clinicName: "Alpha",
    question: "عايز احجز تنضيف",
    history: [],
    mode: "sales",
    canBook: true,
    chatId: "201000000000@c.us",
    phone: "+201000000000",
    ...over,
  };
}

const lastText = (contents: unknown[]) => JSON.stringify(contents[contents.length - 1]);
const slotKey = (day: string, time: string, doctor: string) => `${day}|${time}|${doctor}`;

await test("find_slots then book_slot s1 books the shown key and returns what was shown", async () => {
  const model = fakeModel([
    call("find_slots", { from: TODAY, to: TODAY }),
    reply({ action: "book_slot", reply: `تمام، ${label(TODAY, "05:00 PM", "")}`, slotId: "s1" }),
  ]);
  const sink = fakeSink();
  const r = await answerWithPro(args(), { model, context: makeContext(), sink });
  assert.equal(r.kind, "answer");
  if (r.kind !== "answer") return;
  assert.equal(r.bookSlot, slotKey(TODAY, "05:00 PM", ""));
  assert.ok(!r.openBooking);
  assert.deepEqual(r.slotsShown, [{ key: slotKey(TODAY, "05:00 PM", ""), label: label(TODAY, "05:00 PM", "") }]);
  assert.deepEqual(sink.charges, [PRO_CREDITS_PER_REPLY]);
  assert.equal(sink.rows.length, 1);
  assert.equal(sink.rows[0].brain, "pro");
  assert.equal(sink.rows[0].rounds, 2);
  assert.deepEqual(sink.rows[0].toolsCalled, ["find_slots", "reply"]);
  // The tool result went back to the model as a function response.
  assert.match(lastText(model.calls[1]), /functionResponse/);
  assert.match(lastText(model.calls[1]), /"s1"/);
});

await test("book_slot with a slotId that was never shown opens the lists instead", async () => {
  const model = fakeModel([reply({ action: "book_slot", reply: "تمام", slotId: "s9" })]);
  const r = await answerWithPro(args(), { model, context: makeContext(), sink: fakeSink() });
  assert.equal(r.kind, "answer");
  if (r.kind !== "answer") return;
  assert.equal(r.bookSlot, undefined);
  assert.equal(r.openBooking, true);
});

await test("a stray price twice is a handoff to the desk; the correction named the number", async () => {
  const model = fakeModel([
    reply({ action: "answer", reply: "التنضيف بـ 9000 جنيه" }),
    reply({ action: "answer", reply: "التنضيف بـ 9000 جنيه برضه" }),
  ]);
  const sink = fakeSink();
  const r = await answerWithPro(args(), { model, context: makeContext(), sink });
  assert.deepEqual(r, { kind: "handoff", topic: "other" });
  assert.equal(model.calls.length, 2);
  assert.match(lastText(model.calls[1]), /9000/);
  assert.deepEqual(sink.charges, []);
  assert.ok((sink.rows[0].violations as string[]).some((v) => v.startsWith("price")));
});

await test("a corrected price is delivered", async () => {
  const model = fakeModel([
    reply({ action: "answer", reply: "التنضيف بـ 9000 جنيه" }),
    reply({ action: "answer", reply: "التنضيف يبدأ من 500 ج.م" }),
  ]);
  const r = await answerWithPro(args(), { model, context: makeContext(), sink: fakeSink() });
  assert.equal(r.kind, "answer");
  if (r.kind === "answer") assert.match(r.text, /500/);
});

await test("a get_price result is an allowed number", async () => {
  const ctx = makeContext({ priceLines: "", prices: [{ name: "زرع", price: 12000 }] });
  const model = fakeModel([call("get_price", { service: "زرع" }), reply({ action: "answer", reply: "الزرع يبدأ من 12,000 ج.م" })]);
  const r = await answerWithPro(args({ question: "الزرع بكام" }), { model, context: ctx, sink: fakeSink() });
  assert.equal(r.kind, "answer");
});

await test("a drug name twice is a medical handoff", async () => {
  const model = fakeModel([
    reply({ action: "answer", reply: "خد بروفين لحد ما تيجي" }),
    reply({ action: "answer", reply: "ممكن بروفين" }),
  ]);
  const r = await answerWithPro(args({ question: "سناني بتوجعني" }), { model, context: makeContext(), sink: fakeSink() });
  assert.deepEqual(r, { kind: "handoff", topic: "medical" });
});

await test("a handoff whose text crosses a red line goes without the text", async () => {
  const model = fakeModel([reply({ action: "handoff_complaint", reply: "هنرجعلك 5000 جنيه" })]);
  const r = await answerWithPro(args(), { model, context: makeContext(), sink: fakeSink() });
  assert.deepEqual(r, { kind: "handoff", topic: "complaint" });
});

await test("already booked (a family member's visit) + book_slot twice without extraAppointment: no booking", async () => {
  const p = person({ family: [{ id: "p1", name: "Mona" }, { id: "p2", name: "Omar" }], upcoming: [appt({ patientId: "p2" })] });
  const model = fakeModel([
    call("find_slots", { from: TODAY, to: TODAY }),
    reply({ action: "book_slot", reply: "تمام", slotId: "s1" }),
    reply({ action: "book_slot", reply: "تمام برضه", slotId: "s1" }),
  ]);
  const r = await answerWithPro(args(), { model, context: makeContext({ person: p }), sink: fakeSink() });
  assert.equal(r.kind, "answer");
  if (r.kind !== "answer") return;
  assert.equal(r.bookSlot, undefined);
  assert.ok(!r.openBooking);
  assert.equal(r.text, "تمام برضه");
  assert.equal(model.calls.length, 3);
  assert.match(lastText(model.calls[2]), new RegExp(arabicDayLabel(addDays(TODAY, 3))));
});

await test("already booked by phone only (no patient id, nobody on file) still counts", async () => {
  const p = person({ patientId: null, family: [], writerKnown: false, upcoming: [appt({ patientId: undefined })] });
  const model = fakeModel([
    call("find_slots", { from: TODAY, to: TODAY }),
    reply({ action: "book_slot", reply: "تمام", slotId: "s1" }),
    reply({ action: "book_slot", reply: "تمام", slotId: "s1" }),
  ]);
  const r = await answerWithPro(args(), { model, context: makeContext({ person: p }), sink: fakeSink() });
  assert.equal(r.kind, "answer");
  if (r.kind === "answer") assert.equal(r.bookSlot, undefined);
  assert.equal(model.calls.length, 3);
});

await test("already booked + extraAppointment: true books", async () => {
  const p = person({ upcoming: [appt()] });
  const model = fakeModel([
    call("find_slots", { from: TODAY, to: TODAY }),
    reply({ action: "book_slot", reply: "تمام", slotId: "s1", extraAppointment: true }),
  ]);
  const r = await answerWithPro(args(), { model, context: makeContext({ person: p }), sink: fakeSink() });
  assert.equal(r.kind, "answer");
  if (r.kind === "answer") assert.equal(r.bookSlot, slotKey(TODAY, "05:00 PM", ""));
  assert.equal(model.calls.length, 2);
});

await test("re-check finds a new appointment: one more corrective round", async () => {
  const fresh = person({ upcoming: [appt({ id: "new1", date: addDays(TODAY, 1), time: "02:00 PM" })] });
  const ctx = makeContext({ reloadPerson: async () => fresh });
  const model = fakeModel([
    call("find_slots", { from: TODAY, to: TODAY }),
    reply({ action: "book_slot", reply: "تمام", slotId: "s1" }),
    reply({ action: "answer", reply: "حضرتك محجوز بالفعل" }),
  ]);
  const r = await answerWithPro(args(), { model, context: ctx, sink: fakeSink() });
  assert.equal(model.calls.length, 3);
  assert.match(lastText(model.calls[2]), new RegExp(arabicDayLabel(addDays(TODAY, 1))));
  assert.equal(r.kind, "answer");
  if (r.kind === "answer") assert.equal(r.bookSlot, undefined);
});

await test("re-check with the same appointments changes nothing", async () => {
  const p = person({ upcoming: [appt()] });
  const ctx = makeContext({ person: p, reloadPerson: async () => person({ upcoming: [appt()] }) });
  const model = fakeModel([reply({ action: "open_booking", reply: "تمام" })]);
  const r = await answerWithPro(args(), { model, context: ctx, sink: fakeSink() });
  assert.equal(model.calls.length, 1);
  assert.equal(r.kind, "answer");
});

await test("tools only, never reply: unavailable no_reply_tool after 4 rounds", async () => {
  const model = fakeModel(Array.from({ length: 5 }, () => call("find_slots", { from: TODAY })));
  const r = await answerWithPro(args(), { model, context: makeContext(), sink: fakeSink() });
  assert.deepEqual(r, { kind: "unavailable", reason: "no_reply_tool" });
  assert.equal(model.calls.length, 4);
});

await test("plain text instead of a tool call: unavailable no_reply_tool", async () => {
  const model = fakeModel([{ text: "أهلاً" }]);
  const r = await answerWithPro(args(), { model, context: makeContext(), sink: fakeSink() });
  assert.deepEqual(r, { kind: "unavailable", reason: "no_reply_tool" });
});

await test("a model that never answers hits the deadline: unavailable ai_timeout", async () => {
  let n = 0;
  // The first reading is the turn's start; every later one is 10 ms before the 25 s deadline.
  const now = () => (n++ === 0 ? 1_000 : 1_000 + 24_990);
  const t0 = Date.now();
  const sink = fakeSink();
  const r = await answerWithPro(args(), { model: fakeModel(["hang"]), context: makeContext(), sink, now });
  assert.deepEqual(r, { kind: "unavailable", reason: "ai_timeout" });
  assert.ok(Date.now() - t0 < 2000);
  assert.deepEqual(sink.charges, []);
});

await test("charge: false and record: false write nothing", async () => {
  const sink = fakeSink();
  const model = fakeModel([reply({ action: "answer", reply: "أهلاً بحضرتك" })]);
  const r = await answerWithPro(args(), { model, context: makeContext(), sink, charge: false, record: false });
  assert.equal(r.kind, "answer");
  assert.deepEqual(sink.charges, []);
  assert.deepEqual(sink.rows, []);
});

await test("previous offer: 'الأول' with slotId s1 books the earlier key; past keys dropped; numbering continues", async () => {
  const prev = slotKey(addDays(TODAY, 1), "06:00 PM", "");
  const stale = slotKey(addDays(TODAY, -2), "05:00 PM", "");
  const model = fakeModel([reply({ action: "book_slot", reply: "تمام", slotId: "s1" })]);
  const r = await answerWithPro(args({ question: "الأول", previousSlotKeys: [stale, prev] }), { model, context: makeContext(), sink: fakeSink() });
  assert.equal(r.kind, "answer");
  if (r.kind !== "answer") return;
  assert.equal(r.bookSlot, prev);
  // The turn layer listed it under the previous-offers heading, with its absolute day label.
  assert.ok(model.systems[0].includes(`s1 → ${label(addDays(TODAY, 1), "06:00 PM", "")}`));
  assert.ok(!model.systems[0].includes(arabicDayLabel(addDays(TODAY, -2)) + " الساعة"));

  const model2 = fakeModel([call("find_slots", { from: TODAY, to: TODAY }), reply({ action: "book_slot", reply: "تمام", slotId: "s2" })]);
  const r2 = await answerWithPro(args({ previousSlotKeys: [prev] }), { model: model2, context: makeContext(), sink: fakeSink() });
  if (r2.kind !== "answer") assert.fail("expected an answer");
  assert.equal(r2.bookSlot, slotKey(TODAY, "05:00 PM", ""));
  assert.equal(r2.slotsShown?.length, 2);
});

await test("doctor: a real name is matched loosely, an invented one searches any doctor", async () => {
  const spy: Spy = { freeTimesDoctors: [] };
  const model = fakeModel([
    call("find_slots", { from: TODAY, to: TODAY, doctor: "د. mohamed" }),
    call("find_slots", { from: TODAY, to: TODAY, doctor: "Dr. Ahmed Fathy" }),
    reply({ action: "answer", reply: "تمام" }),
  ]);
  const r = await answerWithPro(args(), { model, context: makeContext({}, spy), sink: fakeSink() });
  assert.deepEqual(spy.freeTimesDoctors, ["Mohamed Ehab", ""]);
  if (r.kind !== "answer") assert.fail("expected an answer");
  assert.ok(r.slotsShown?.every((s) => !s.key.includes("Ahmed")));
  assert.equal(r.slotsShown?.[0].key, slotKey(TODAY, "05:00 PM", "Mohamed Ehab"));
});

await test("a tool that throws becomes tool_failed and the turn still finishes", async () => {
  const ctx = makeContext({
    freeTimes: async () => {
      throw new Error("firestore down");
    },
  });
  const model = fakeModel([call("find_slots", { from: TODAY }), reply({ action: "answer", reply: "حد من زمايلي هيأكدلك الميعاد" })]);
  const r = await answerWithPro(args(), { model, context: ctx, sink: fakeSink() });
  assert.equal(r.kind, "answer");
  assert.match(lastText(model.calls[1]), /tool_failed/);
});

await test("no key and no model: unavailable; a blocked clinic: unavailable with its reason", async () => {
  const saved = process.env.GEMINI_PRO_API_KEY;
  delete process.env.GEMINI_PRO_API_KEY;
  try {
    assert.deepEqual(await answerWithPro(args(), { context: makeContext(), sink: fakeSink() }), { kind: "unavailable", reason: "no_api_key" });
  } finally {
    if (saved !== undefined) process.env.GEMINI_PRO_API_KEY = saved;
  }
  const model = fakeModel([reply({ action: "answer", reply: "x" })]);
  const r = await answerWithPro(args(), { model, context: makeContext({ blocked: "no_credits" }), sink: fakeSink() });
  assert.deepEqual(r, { kind: "unavailable", reason: "no_credits" });
  assert.equal(model.calls.length, 0);
});

await test("thread: patient lines are user, others model text, first turn is the patient's, question appended", async () => {
  const ctx = makeContext({
    thread: [
      { author: "bot", text: "تذكير بميعادك" },
      { author: "patient", text: "اهلا" },
      { author: "staff", text: "اهلا بيك" },
    ],
  });
  const model = fakeModel([reply({ action: "answer", reply: "تمام" })]);
  await answerWithPro(args({ question: "عايز احجز" }), { model, context: ctx, sink: fakeSink() });
  const c = model.calls[0] as Array<{ role: string; parts: Array<{ text?: string }> }>;
  assert.deepEqual(
    c.map((x) => [x.role, x.parts[0].text]),
    [
      ["user", "اهلا"],
      ["model", "اهلا بيك"],
      ["user", "عايز احجز"],
    ]
  );
});

await test("prices on consult: get_price finds nothing and the price list is not an allowed number", async () => {
  const model = fakeModel([
    call("get_price", { service: "تنضيف" }),
    reply({ action: "answer", reply: "التنضيف بـ 500 ج.م" }),
    reply({ action: "answer", reply: "التنضيف بـ 500 ج.م" }),
  ]);
  const r = await answerWithPro(args({ brief: { prices: "consult" } }), { model, context: makeContext(), sink: fakeSink() });
  assert.match(lastText(model.calls[1]), /"matches":\[\]/);
  assert.deepEqual(r, { kind: "handoff", topic: "other" });
});

await test("medicine and media ids must be ones the clinic gave", async () => {
  const model = fakeModel([reply({ action: "suggest_medicine", reply: "تمام", medicineId: "m9", sendMedia: "x9" })]);
  const r = await answerWithPro(args({ medicines: [{ id: "m1", label: "مسكن" }], media: [{ id: "x1", label: "صورة", when: "" }] }), {
    model,
    context: makeContext(),
    sink: fakeSink(),
  });
  if (r.kind !== "answer") assert.fail("expected an answer");
  assert.equal(r.medicineId, undefined);
  assert.equal(r.sendMedia, undefined);
});
