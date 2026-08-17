/**
 * Offline checks for the Meta lead intake helpers — run with `node test-metaLeads.js`.
 * No Firebase, no network: pins the phone normalizer, field_data parsing, and the
 * webhook signature check against known shapes.
 */
const assert = require("node:assert");
const crypto = require("node:crypto");
const { normalizeMetaPhone, parseFieldData, verifyMetaSignature } = require("./metaLeads");

// --- phone shapes Meta actually sends
assert.equal(normalizeMetaPhone("+201001234567"), "+201001234567");
assert.equal(normalizeMetaPhone("p:+201001234567"), "+201001234567");
assert.equal(normalizeMetaPhone("+20 100 123 4567"), "+201001234567");
assert.equal(normalizeMetaPhone("00201001234567"), "+201001234567");
assert.equal(normalizeMetaPhone("01001234567"), "+201001234567"); // local Egyptian
assert.equal(normalizeMetaPhone("201001234567"), "+201001234567"); // bare country code
assert.equal(normalizeMetaPhone(""), "");

// --- field_data: standard keys, split names, custom questions
const parsed = parseFieldData([
  { name: "full_name", values: ["Ahmed Samir"] },
  { name: "phone_number", values: ["+201001234567"] },
  { name: "email", values: ["a@example.com"] },
  { name: "which_service_do_you_want?", values: ["Hollywood Smile"] },
]);
assert.equal(parsed.name, "Ahmed Samir");
assert.equal(parsed.phone, "+201001234567");
assert.equal(parsed.email, "a@example.com");
assert.deepEqual(parsed.extra, ["which_service_do_you_want?: Hollywood Smile"]);

const split = parseFieldData([
  { name: "first_name", values: ["Mona"] },
  { name: "last_name", values: ["Adel"] },
]);
assert.equal(split.name, "Mona Adel");

// --- signature: valid passes, tampered body fails, missing secret fails
const secret = "test-secret";
const body = Buffer.from(JSON.stringify({ object: "page", entry: [] }));
const sig = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
assert.equal(verifyMetaSignature(body, sig, secret), true);
assert.equal(verifyMetaSignature(Buffer.from("tampered"), sig, secret), false);
assert.equal(verifyMetaSignature(body, sig, ""), false);
assert.equal(verifyMetaSignature(body, undefined, secret), false);

console.log("metaLeads helpers: all checks passed");
