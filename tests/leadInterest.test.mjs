// Reading the service out of a Facebook campaign name. Run with node.
//
// This is the code that decides what a lead "asked about", and the answer is quoted back to the
// person on WhatsApp, so both directions of being wrong are expensive: a missed match leaves the
// clinic with an unlabelled lead, and a false match tells a patient they enquired about a
// treatment they never mentioned.
//
// Most of the assertions below are about Arabic, because that is where this silently breaks.
// The definite article ال glues onto the noun, so substring matching re-creates other words
// wholesale — hence whole-token comparison, an article-strip list, and the rule that a stem of
// fewer than four characters must match a whole token rather than the start of one. The other
// half is that both sides go through the same normaliser: a keyword written with ة or أ can
// never match text folded to ه and ا, and sits in the list looking like coverage it never gave.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { detectInterest, matchesKeyword } = require("../functions/metaLeads.js");

const from = (campaignName, clinicServices = []) =>
  detectInterest({ fieldData: [], campaignName, adName: "", clinicServices });

// --- the plain cases: a campaign named after what it sells ---
assert.equal(from("Veneers – Sep 2026 | Cairo | Lead Gen"), "Veneers");
assert.equal(from("Ortho campaign 2026"), "Orthodontics");
assert.equal(from("Dental Implants — Nasr City"), "Dental implants");
assert.equal(from("Teeth Whitening Offer"), "Teeth whitening");

// --- the same in Arabic, which is how these campaigns are actually named ---
assert.equal(from("فينير سبتمبر ٢٠٢٦"), "فينير");
assert.equal(from("عرض تبييض الاسنان"), "تبييض الأسنان");
assert.equal(from("ابتسامة هوليوود"), "ابتسامة هوليوود");

// --- TRAP 1: the definite article must not decide whether a keyword is found ---
// "التقويم" is ال + تقويم. Stripping the article is what makes these the same campaign.
assert.equal(from("تقويم الاسنان"), "تقويم الأسنان");
assert.equal(from("عروض التقويم"), "تقويم الأسنان", "ال + the noun must still match the noun");
assert.equal(from("علاج اللثة"), "علاج اللثة", "اللثة is ال + لثة and must reach the لثه keyword");
assert.equal(matchesKeyword("عروض الزراعة الفورية", "زراعه"), true);

// --- TRAP 1, the other direction: a short stem must not match inside a longer word ---
// The rule that prevents it is "stems under four characters match a whole token only". A gummy
// smile campaign sells cosmetic work, not periodontal treatment, and must not be labelled as gum
// treatment just because "gum" is three letters of "gummy".
assert.equal(from("Gummy smile makeover"), "", "gum must not match inside gummy");
assert.equal(matchesKeyword("gummy smile", "gum"), false);
assert.equal(matchesKeyword("gum treatment", "gum"), true, "but the whole word still matches");

// --- TRAP 2: keyword and text must go through the same normaliser ---
// The normaliser folds ة→ه and أ/إ→ا. A campaign written the correct way round has to match a
// keyword written the other way round, or the keyword is dead on arrival.
assert.equal(from("زراعة الأسنان"), "زراعة الأسنان", "ة and أ in the ad must fold to the keyword");
assert.equal(matchesKeyword("حشوات تجميلية", "حشوات"), true);
assert.equal(matchesKeyword("عــرض التقويــم", "تقويم"), true, "tatweel must not hide a keyword");

// --- when nothing is recognised, the answer is deliberately nothing ---
// Not the campaign name: this value is read back out into the patient's WhatsApp greeting, and
// "you asked about Ramadan-Offer-v2-Broad" is worse than the generic sentence it replaces. The
// campaign is still on the lead, in its notes and in meta.campaignName where the funnel reads it.
assert.equal(from("Ramadan Offer 2026"), "");
assert.equal(from("Campaign 3 - copy"), "");
assert.equal(from(""), "");
assert.equal(from(null), "");

// --- the clinic's own words win, so the funnel does not split one service across two rows ---
const services = ["Crown", "Zirconia Crown", "Veneers"];
assert.equal(
  from("Zirconia Crown offer", services),
  "Zirconia Crown",
  "the longest matching service name wins over the shorter one inside it"
);
assert.equal(
  from("عرض الفينير", ["فينير"]),
  "فينير",
  "a clinic service written in Arabic is matched the same way"
);

// --- what the person picked on the form outranks what the campaign was called ---
const withForm = (fieldData, campaignName) =>
  detectInterest({ fieldData, campaignName, adName: "", clinicServices: [] });

assert.equal(
  withForm(
    [{ name: "which_service_are_you_interested_in?", values: ["Orthodontics"] }],
    "Veneers Sep 2026"
  ),
  "Orthodontics",
  "their own answer beats the campaign it arrived through"
);
assert.equal(
  withForm([{ name: "ما هي الخدمة التي تهتم بها؟", values: ["تقويم"] }], "Veneers Sep 2026"),
  "تقويم الأسنان",
  "an Arabic service question is recognised and its answer canonicalised"
);
assert.equal(
  withForm([{ name: "full_name", values: ["Ahmed"] }], "Veneers Sep 2026"),
  "Veneers",
  "an ordinary form field is not mistaken for a service question"
);
assert.equal(
  withForm(
    [{ name: "what_are_you_interested_in", values: ["I broke a tooth last night and it hurts a lot, please call me"] }],
    "Veneers Sep 2026"
  ),
  "Veneers",
  "an essay in the answer box is not a service label; fall back to the campaign"
);

// --- the ad name is consulted when the campaign is generic ---
assert.equal(
  detectInterest({ fieldData: [], campaignName: "Leads Q3", adName: "Veneer before and after", clinicServices: [] }),
  "Veneers",
  "a campaign that says nothing still has an ad that might"
);

// --- shapes Meta actually sends when a field is empty or missing ---
assert.equal(detectInterest({}), "");
assert.equal(withForm([{ name: "which_service", values: [] }], "Ortho 2026"), "Orthodontics");
assert.equal(withForm(null, "Ortho 2026"), "Orthodontics");

console.log("✓ leadInterest: campaign names read as services, and the Arabic article does not decide it");
