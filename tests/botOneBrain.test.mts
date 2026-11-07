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

test("a plain brain answer mid-reschedule keeps the move; a fresh slot offer never inherits one", () => {
  // Both plain-answer branches (the sentence that already names times, and the ordinary answer)
  // carry the appointment being moved forward, so "the first one" next turn moves it instead of
  // adding a second booking.
  assert.equal((respond.match(/pending = keepMove\(/g) || []).length, 2, "both plain-answer branches keep the move");
  const keep = respond.indexOf("const keepMove = (p: PendingOptions | undefined): PendingOptions | undefined =>");
  assert.ok(keep > 0, "keepMove exists");
  assert.ok(respond.slice(keep, keep + 500).includes("reschedule: conversation.pendingReschedule"));
  // A spoken offer carries the move only when it IS the move (startReschedule, or a slot taken
  // mid-move); a fresh booking opened by the brain, or a registration, drops a stale id.
  const offer = respond.indexOf("const offerSlots = async (");
  const block = respond.slice(offer, respond.indexOf("    };", offer));
  assert.ok(block.includes('const moving = o.reason === "reschedule_days" || (o.reason === "slot_taken" && Boolean(rescheduleId));'), "offerSlots knows when it is the move");
  assert.ok(block.includes("reschedule: moving ? rescheduleId : undefined"), "and stores the id only then");
  assert.ok(block.includes("moving ? rescheduleId : null"), "and ignores the moved appointment's own slot only then");
});

test("the clinic's fixed replies survive as knowledge for the brain", () => {
  assert.ok(respond.includes("scriptsKnowledge"), "the scripts are folded into knowledge");
  assert.ok(!respond.includes("matchScript("), "and never matched by code");
});

test("a brain reply costs one credit and the Pro add-on is gone everywhere", () => {
  const ctx = read("src/lib/botPro/proContext.ts");
  assert.ok(ctx.includes("export const PRO_CREDITS_PER_REPLY = 1;"));
  assert.ok(!ctx.includes("plan_pro"), "no Pro plan verdict");
  for (const f of ["src/lib/featureCatalog.ts", "src/lib/subscriptions.ts", "src/types/saas.ts", "src/components/settings/WhatsAppSettings.tsx", "src/app/api/whatsapp/pro-onboarding/route.ts"]) {
    assert.ok(!read(f).includes("whatsappPro"), `${f} no longer knows the Pro add-on`);
  }
});

test("the nightly bot jobs run for every clinic with auto-reply on", () => {
  const coach = read("src/app/api/automation/bot-coach/route.ts");
  const memory = read("src/app/api/automation/bot-memory/route.ts");
  for (const src of [coach, memory]) {
    assert.ok(src.includes('settings.botEnabled !== true'), "gated on the auto-reply switch");
    assert.ok(!src.includes("botMode") && !src.includes("botAiEnabled"), "and on nothing the menu bot stored");
  }
});

test("the playground rehearses the one brain", () => {
  const route = read("src/app/api/admin/bot-playground/route.ts");
  assert.ok(!route.includes("whatsappPro") && !route.includes("brainOverride") && !route.includes("playgroundOutcome"));
  const ui = read("src/components/settings/BotPlayground.tsx");
  assert.ok(!ui.includes("tryPro") && !ui.includes("proUnlocked"));
});

console.log("botOneBrain: all checks passed");
