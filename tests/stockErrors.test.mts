// A person working in Arabic must never be answered in English. The server speaks English and
// the browser's own "no internet" message is "Failed to fetch"; these tests pin what the stock
// page says instead, in the language on screen.
import assert from "node:assert/strict";
import { friendlyStockError } from "../src/lib/stock/errors";

const hasArabic = (s: string) => /[؀-ۿ]/.test(s);
const hasLatinWord = (s: string) => /[A-Za-z]{3,}/.test(s);

// no internet: jargon in neither language
for (const raw of ["Failed to fetch", "TypeError: Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"]) {
  assert.equal(friendlyStockError(raw, true), "مفيش اتصال بالنت. اتأكد من النت وجرّب تاني. مفيش حاجة اتغيرت.");
  assert.equal(friendlyStockError(raw, false), "No internet connection. Check it and try again. Nothing was changed.");
}

// English stays as the server wrote it
assert.equal(friendlyStockError("The item needs a name.", false), "The item needs a name.");
assert.equal(friendlyStockError("", false), "Something went wrong. Nothing was changed.");

// a message already in Arabic is left alone
assert.equal(friendlyStockError("الصنف محتاج اسم.", true), "الصنف محتاج اسم.");

// the numbers and codes inside a message survive the translation
assert.equal(friendlyStockError("This one still holds 4 items with stock. Move or delete them first.", true), "لسه فيه 4 صنف عليه كمية. انقلهم أو امسحهم الأول.");
assert.equal(friendlyStockError("This one still holds 1 item with stock. Move or delete them first.", true), "لسه فيه 1 صنف عليه كمية. انقلهم أو امسحهم الأول.");
assert.equal(friendlyStockError("There is already a drawer R1-A2.", true), "فيه درج بالكود R1-A2 قبل كده.");

// the ones a person can act on say what to do
assert.equal(friendlyStockError("The item needs a name.", true), "الصنف محتاج اسم.");
assert.equal(friendlyStockError("The brand needs a name.", true), "الماركة محتاجة اسم.");
assert.equal(friendlyStockError("A brand needs a name.", true), "الماركة محتاجة اسم.");
assert.equal(friendlyStockError("That drawer no longer exists.", true), "الدرج ده اتمسح. حدّث الصفحة.");
assert.equal(friendlyStockError("The drawer shows none left. Count it first if that is wrong.", true), "الدرج مسجّل إن مفيش منه. لو ده غلط، عدّه الأول.");
assert.equal(friendlyStockError("You are signed out. Sign in and try again.", true), "خرجت من الحساب. سجّل دخولك وجرّب تاني.");
assert.equal(friendlyStockError("Unauthorized", true), "خرجت من الحساب. سجّل دخولك وجرّب تاني.");
assert.equal(friendlyStockError("You do not have permission to do this (inventory.add).", true), "مش مسموح لك بالخطوة دي. اسأل الأدمن.");
assert.equal(friendlyStockError("Something went wrong. Nothing was changed.", true), "حصلت مشكلة. مفيش حاجة اتغيرت. جرّب تاني.");

// every message the stock route can send comes out in Arabic, with no English word left in it
// (a drawer code such as R1 is not a word)
const SERVER = [
  "Pick at least one item to stock.",
  "That is too much to set up in one go. Pick fewer items and come back for the rest.",
  "A drawer needs a room code, like C1 or SR.",
  "There is already a drawer C1-A2.",
  "A room needs a short code, like R1.",
  "Say how many drawers or shelves it has.",
  "That room already has 26 cabinets.",
  "A cabinet holds at most 60 drawers.",
  "A cabinet holds at most 20 shelves.",
  "Too many.",
  "Which drawer?",
  "That drawer no longer exists.",
  "Which room, and what is it called?",
  "This one still holds 3 items with stock. Move or delete them first.",
  "Which photo?",
  "That is not an uploaded photo.",
  "The item needs a name.",
  "Which drawer does it live in?",
  "Which item?",
  "Which item is this a brand of?",
  "The brand needs a name.",
  "That item no longer exists.",
  "Which brand, into which drawer?",
  "That brand no longer exists.",
  "Which line?",
  "This row still has stock. Confirm the delete to write it off.",
  "Which brand?",
  "A brand needs a name.",
  "Which row, to which drawer?",
  "That row no longer exists.",
  "No barcode.",
  "Nothing to receive.",
  "One of the lines points at a drawer that no longer exists.",
  "One of the brands no longer exists.",
  "A line needs a brand or a new product.",
  "A new product must say which item it is.",
  "Which item, from which drawer?",
  "Which patient?",
  "That brand is not in that drawer.",
  "The drawer shows none left. Count it first if that is wrong.",
  "Pick a count to look at.",
  "That count no longer exists.",
  "The count to compare with no longer exists.",
  "Compare with an earlier count, not a later one.",
  "Those two counts are too far apart to compare. Pick a closer one.",
  'Unknown action "frobnicate".',
  "Something went wrong. Nothing was changed.",
  "Unauthorized",
  "Invalid token",
  "Forbidden",
  "User profile not found",
  "You do not have permission to do this (inventory.edit).",
  "Could not load the cupboard.",
  "Could not load the counts.",
  "Could not compare those counts.",
  "Could not load the history.",
  "Could not make the Excel file.",
  "Firebase Storage: User does not have permission to access 'x'. (storage/unauthorized)",
  "some brand new message nobody has translated yet",
];
for (const raw of SERVER) {
  const said = friendlyStockError(raw, true);
  assert.ok(hasArabic(said), `no Arabic for: ${raw}`);
  assert.ok(!hasLatinWord(said), `English left in "${said}" for: ${raw}`);
}

// an unknown message does not claim that nothing was changed: nobody checked
assert.equal(friendlyStockError("some brand new message nobody has translated yet", true), "حصلت مشكلة. جرّب تاني.");

console.log("stockErrors: ok");
