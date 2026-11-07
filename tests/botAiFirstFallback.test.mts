/**
 * Salesperson mode when the model is unavailable (quota, outage, timeout): ask once to resend, then
 * a person — never the numbered-menu re-prompt, which names buttons that are not on the screen.
 * Also: the engine is told whether a menu is on the screen, so a bare digit is read right.
 *
 * Source assertions — respond.ts has no unit harness. Run: npm run test:bot-fallback
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/lib/bot/respond.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

test("second failure in a row in salesperson mode hands over, with no menu", () => {
  const ask = src.indexOf('} else if (sales && conversation.lastReason !== "ai_unavailable") {');
  const human = src.indexOf("} else if (sales) {", ask);
  const reprompt = src.indexOf('} else if (conversation.state === "awaiting_choice" || conversation.state === "new") {', ask);
  assert.ok(ask > 0 && human > ask && reprompt > human, "ask again → a person → (classic bot only) the menu re-prompt");
  const block = src.slice(human, reprompt);
  assert.ok(block.includes('reason = "gave_up";') && block.includes("handoff = true;") && block.includes("structure = undefined;"));
  assert.ok(!block.includes("menuButtons("), "no buttons");
  assert.ok(block.includes("حد من الاستقبال هيرد على حضرتك"));
});

test("the engine learns whether a menu is on the screen from the previous reply's reason", () => {
  assert.ok(src.includes('const MENU_ON_SCREEN_REASONS = new Set(["greeted", "reprompt", "back_to_menu", "hours", "booked"]);'));
  assert.ok(src.includes('ctx.menuShown = MENU_ON_SCREEN_REASONS.has(String(conversation.lastReason || ""));'));
  // Those are exactly the reasons the menu buttons are attached to (plus "booked", whose text says send *3*).
  assert.ok(src.includes('["greeted", "reprompt", "back_to_menu", "hours"].includes(reason)'), "the button-attaching list still exists");
});
