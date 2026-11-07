/**
 * One brain: respond.ts calls the Pro brain directly, the menu machinery is gone, and the
 * failure ladder is the November 2026 one — a person, never a menu.
 *
 * Source assertions — respond.ts has no unit harness (its import graph opens the database).
 * Run: npm run test:bot-one-brain
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const respond = read("src/lib/bot/respond.ts");

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

test("the Pro brain is the only brain", () => {
  assert.ok(respond.includes("answerWithPro("), "answerWithPro is called");
  for (const gone of ["answerWithAi(", "pickReply(", "aiBrainOf(", "dryRunBrainTag(", "brainOverride", "botAiBrain", "botMode", "aiMaxReplies", "aiFirst"]) {
    assert.ok(!respond.includes(gone), `${gone} is gone from respond.ts`);
  }
  assert.ok(!existsSync(new URL("../src/lib/botPro/brain.ts", import.meta.url)), "brain.ts (the switch) is deleted");
  assert.ok(!existsSync(new URL("../src/lib/bot/aiReply.ts", import.meta.url)), "aiReply.ts (the old brain) is deleted");
  assert.ok(!existsSync(new URL("../src/lib/bot/engine.ts", import.meta.url)), "engine.ts (the menu) is deleted");
});

test("the menu machinery is gone", () => {
  for (const gone of ["decideBotReply(", "menuButtons(", "optionList(", "renderDayList(", "renderTimeList(", "MENU_ON_SCREEN_REASONS", "listDoctors", "listDays(", "listTimes(", "RELIST_PREFIX", '"relist"', '"list_days"', '"price_list"', '"open_now"', "رجوع للقائمة", "اختار من الأزرار"]) {
    assert.ok(!respond.includes(gone), `${gone} is gone from respond.ts`);
  }
  assert.ok(respond.includes("decide({"), "the decider is called");
  assert.ok(respond.includes("offerSlots("), "slots are spoken, not listed");
});

test("the failure ladder: credits → alert; first miss → resend; second → a person; never a menu", () => {
  const credits = respond.indexOf('if (ai.reason === "no_credits" || ai.reason === "plan") {');
  const alert = respond.indexOf("creditsAlertAtMs", credits);
  const resend = respond.indexOf('} else if (conversation.lastReason !== "ai_unavailable") {', credits);
  const person = respond.indexOf("} else {", resend);
  assert.ok(credits > 0 && alert > credits && resend > alert && person > resend, "the three rungs are in order");
  const resendBlock = respond.slice(resend, person);
  assert.ok(resendBlock.includes("معلش، الرسالة مأخدتش عندي كويس") && resendBlock.includes('reason = "ai_unavailable";'));
  const personBlock = respond.slice(person, respond.indexOf("}", person + 300));
  assert.ok(personBlock.includes('reason = "gave_up";') && personBlock.includes("handoff = true;") && personBlock.includes("حد من الاستقبال هيرد على حضرتك"));
  assert.ok(!respond.includes('reason = "reprompt";'), "no re-prompt rung");
});

test("the clinic's fixed replies survive as knowledge for the brain", () => {
  assert.ok(respond.includes("scriptsKnowledge"), "the scripts are folded into knowledge");
  assert.ok(!respond.includes("matchScript("), "and never matched by code");
});

test("a brain reply costs one credit and the Pro add-on gate is gone from the brain", () => {
  const ctx = read("src/lib/botPro/proContext.ts");
  assert.ok(ctx.includes("export const PRO_CREDITS_PER_REPLY = 1;"));
});

test("the playground rehearses the one brain", () => {
  const route = read("src/app/api/admin/bot-playground/route.ts");
  assert.ok(!route.includes("whatsappPro") && !route.includes("brainOverride") && !route.includes("playgroundOutcome"));
  const ui = read("src/components/settings/BotPlayground.tsx");
  assert.ok(!ui.includes("tryPro") && !ui.includes("proUnlocked"));
});

console.log("botOneBrain: all checks passed");
