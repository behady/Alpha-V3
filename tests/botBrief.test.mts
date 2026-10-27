/**
 * The Auto-reply brief: the clinic's preferences for the AI, as pure helpers.
 *
 * Pinned: cleaning drops empties, defaults and unknown keys (so Firestore never sees an undefined
 * or a default-valued key), the prompt lines are empty for a default brief (so a clinic that never
 * touched the brief gets today's prompt byte-for-byte), the badge counts, which setup steps each
 * answer mode shows, and the interview draft: only known keys survive, replacements are listed
 * unticked with the old value, and only ticked rows are merged.
 *
 * Run: npm run test:brief
 */
import assert from "node:assert/strict";
import {
  cleanBrief,
  briefLines,
  briefFilled,
  factsFilled,
  stepsForMode,
  sanitizeDraft,
  isEmptyDraft,
  serviceNamesOnly,
  draftRows,
  mergeDraft,
  BOT_FACT_KEYS,
} from "../src/lib/bot/brief";
import { movedTabKey } from "../src/lib/movedTab";

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

test("cleanBrief drops empties and defaults", () => {
  assert.deepEqual(cleanBrief({ focus: "  ", tone: "friendly", prices: "ranges", x: 1 }), {});
  assert.deepEqual(cleanBrief({ tone: "loud" }), {});
  assert.ok(Object.values(cleanBrief({ focus: "زراعة", neverSay: undefined })).every((v) => v !== undefined));
  assert.deepEqual(cleanBrief("junk"), {});
  assert.deepEqual(cleanBrief({ focus: "  زراعة  ", tone: "formal" }), { focus: "زراعة", tone: "formal" });
  assert.equal(cleanBrief({ focus: "x".repeat(900) }).focus?.length, 500);
});

test("briefLines empty for defaults", () => {
  assert.equal(briefLines(undefined), "");
  assert.equal(briefLines({ tone: "friendly" }), "");
  assert.equal(briefLines({ prices: "ranges" }), "");
});

test("briefLines renders each field", () => {
  const out = briefLines({ focus: "زراعة", prices: "consult" });
  assert.ok(out.includes("تفضيلات صاحب العيادة"));
  assert.ok(out.includes("زراعة"));
  assert.ok(out.includes("مش بتقول أسعار"));
  assert.ok(out.startsWith("\nتفضيلات صاحب العيادة:\n"));
  assert.ok(briefLines({ tone: "formal" }).includes("رسمي"));
  assert.ok(briefLines({ tone: "short" }).includes("قصيرة"));
  assert.ok(briefLines({ neverSay: "التقويم" }).includes("ممنوع تتكلم في: التقويم."));
  assert.ok(briefLines({ handoffWhen: "الشكاوى" }).includes("حوّل للاستقبال دايماً لما: الشكاوى."));
});

test("counts", () => {
  assert.equal(factsFilled({ offers: "x", parking: "" }).filled, 1);
  assert.equal(factsFilled(undefined).total, 14);
  assert.equal(BOT_FACT_KEYS.length, 14);
  assert.equal(briefFilled({ focus: "x", tone: "short" }, "note").filled, 3);
  assert.equal(briefFilled(undefined, "  ").filled, 0);
  assert.equal(briefFilled(undefined, undefined).total, 6);
});

test("stepsForMode", () => {
  assert.equal(stepsForMode("off").length, 0);
  const ai = stepsForMode("ai");
  assert.deepEqual(ai.map((s) => s.id), ["clinic", "brief", "behaviour", "test", "replies"]);
  assert.deepEqual(ai.filter((s) => s.optional).map((s) => s.id), ["replies"]);
  assert.ok(!stepsForMode("bot").some((s) => s.id === "brief"));
  assert.deepEqual(stepsForMode("bot").map((s) => s.id), ["clinic", "replies", "behaviour", "test"]);
  assert.deepEqual(stepsForMode("both").map((s) => s.id), ["clinic", "replies", "brief", "behaviour", "test"]);
  assert.ok(stepsForMode("both").every((s) => !s.optional));
});

test("sanitizeDraft keeps known keys only", () => {
  assert.deepEqual(
    sanitizeDraft({ facts: { offers: " 10% ", evil: "x", parking: "" }, brief: { tone: "formal", hack: 1 } }),
    { facts: { offers: "10%" }, brief: { tone: "formal" } },
  );
  assert.deepEqual(sanitizeDraft("junk"), { facts: {}, brief: {} });
  assert.equal(sanitizeDraft({ facts: { offers: "x".repeat(2000) } }).facts.offers?.length, 1000);
  assert.deepEqual(sanitizeDraft({ facts: { offers: 5 } }), { facts: {}, brief: {} });
});

test("draftRows marks replacements unticked", () => {
  const rows = draftRows(
    { facts: { offers: "new", parking: "p", walkIn: "same" }, brief: {} },
    { offers: "old", walkIn: "same" },
    undefined,
  );
  assert.deepEqual(rows, [
    { key: "facts.offers", value: "new", old: "old" },
    { key: "facts.parking", value: "p" },
  ]);
  const withBrief = draftRows({ facts: {}, brief: { focus: "زراعة", tone: "formal" } }, undefined, { tone: "formal" });
  assert.deepEqual(withBrief, [{ key: "brief.focus", value: "زراعة" }]);
});

test("mergeDraft writes only ticked non-empty fields", () => {
  const draft = { facts: { offers: "new", parking: "p" }, brief: { focus: "زراعة" } };
  const out = mergeDraft({ offers: "old" }, undefined, draft, new Set(["facts.parking"]));
  assert.deepEqual(out, { botFacts: { offers: "old", parking: "p" }, botBrief: {} });
  const all = mergeDraft({ offers: "old" }, { tone: "short" }, draft, new Set(["facts.offers", "brief.focus"]));
  assert.deepEqual(all, { botFacts: { offers: "new" }, botBrief: { tone: "short", focus: "زراعة" } });
  for (const o of [out, all]) {
    for (const part of [o.botFacts, o.botBrief]) {
      assert.ok(Object.values(part).every((v) => v !== undefined && v !== ""));
    }
  }
});

test("isEmptyDraft: nothing usable means nothing to charge for", () => {
  assert.equal(isEmptyDraft(sanitizeDraft("junk")), true);
  assert.equal(isEmptyDraft(sanitizeDraft({ facts: { evil: "x", parking: "" }, brief: { hack: 1 } })), true);
  assert.equal(isEmptyDraft(sanitizeDraft({ facts: { offers: "10%" }, brief: {} })), false);
  assert.equal(isEmptyDraft(sanitizeDraft({ facts: {}, brief: { tone: "short" } })), false);
});

test("serviceNamesOnly keeps the names and drops every price figure", () => {
  const out = serviceNamesOnly("تقويم: يبدأ من 15,000 ج.م\nتبييض: يبدأ من 3,500 ج.م");
  assert.equal(out, "تقويم\nتبييض");
  assert.ok(!/\d/.test(out), "no digits");
  assert.equal(serviceNamesOnly(out), out, "idempotent on bare names");
  assert.equal(serviceNamesOnly(""), "");
});

test("tour anchor ignores the query string", () => {
  assert.equal(movedTabKey("/chats/bot?step=ai"), "bot");
  assert.equal(movedTabKey("/chats/settings"), "settings");
});
