// "Showed up" means the patient reached the clinic, not that somebody pressed Completed.
//
// The WhatsApp funnel counted only status "Completed" as a show. One clinic ends every visit at
// "Checking Out" (169 of its appointments, against 25 Completed), so its funnel read almost zero
// shows while patients were sitting in the chair. Run with tsx.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hasAttended } from "../src/lib/appointmentStages";

for (const s of ["Checked In", "In Chair", "Checking Out", "Completed"]) assert.equal(hasAttended(s), true, `${s} is a show`);
// Older records wrote these spellings; they read as their canonical stage.
for (const s of ["Arrived", "Seated", "In Progress"]) assert.equal(hasAttended(s), true, `${s} (legacy) is a show`);
for (const s of ["Scheduled", "Pending", "Confirmed", "Delayed", "Cancelled", "No Show", "", undefined, null]) {
  assert.equal(hasAttended(s as string | undefined | null), false, `${String(s)} is not a show`);
}

// The funnel card uses the rule instead of its own comparison.
const card = fs.readFileSync(path.join(process.cwd(), "src/components/ai/BotFunnelCard.tsx"), "utf8");
assert.match(card, /hasAttended\(/, "the funnel counts shows with hasAttended");
assert.doesNotMatch(card, /=== "Completed"/, "no Completed-only comparison left in the funnel");

console.log("appointmentAttended: ok");
