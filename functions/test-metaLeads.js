/**
 * Offline checks for the Meta lead intake helpers — run with `node test-metaLeads.js`.
 * No Firebase, no network: pins the phone normalizer, field_data parsing, the webhook
 * signature check, and the stub→heal lifecycle that keeps failed fetches from losing leads.
 */
const assert = require("node:assert");
const crypto = require("node:crypto");
const { normalizeMetaPhone, parseFieldData, verifyMetaSignature, writeLeadToClinic } = require("./metaLeads");

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

// --------------------------------------------------------------- stub → heal lifecycle
/**
 * Minimal in-memory stand-in for the pieces of Firestore writeLeadToClinic touches:
 * a doc store, refs, and a transaction that reads then applies set/update.
 */
function fakeDb() {
  const store = new Map();
  const makeRef = (path) => ({
    path,
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
  });
  return {
    store,
    collection: (base) => ({ doc: (id) => makeRef(`${base}/${id}`) }),
    runTransaction: async (fn) =>
      fn({
        get: async (ref) => ({ exists: store.has(ref.path), data: () => store.get(ref.path) }),
        set: (ref, data) => store.set(ref.path, data),
        update: (ref, patch) => store.set(ref.path, { ...store.get(ref.path), ...patch }),
      }),
  };
}

(async () => {
  const db = fakeDb();
  const docPath = "clinics/c1/leads/meta_L1";
  const stub = {
    docId: "meta_L1",
    name: "Facebook lead (details pending)",
    phone: "",
    source: "Meta ads",
    notes: "pending",
    pending: true,
    meta: { leadgenId: "L1", fetchFailed: true },
  };
  const real = {
    docId: "meta_L1",
    name: "Ahmed Samir",
    phone: "+201001234567",
    source: "Meta ads",
    notes: "Campaign: Smile August",
    meta: { leadgenId: "L1", fetchFailed: false, campaignName: "Smile August" },
  };

  // A failed fetch still puts something in the inbox.
  assert.equal(await writeLeadToClinic(db, "c1", stub, "2026-08-17"), "stub");
  assert.equal(db.store.get(docPath).phone, "");
  assert.equal(db.store.get(docPath).stage, "new");

  // Reception starts working the stub before Meta releases the details.
  db.store.set(docPath, { ...db.store.get(docPath), stage: "contacted" });

  // The retry arrives: details fill in, and the human's stage survives.
  assert.equal(await writeLeadToClinic(db, "c1", real, "2026-08-17"), "healed");
  const healed = db.store.get(docPath);
  assert.equal(healed.name, "Ahmed Samir");
  assert.equal(healed.phone, "+201001234567");
  assert.equal(healed.meta.fetchFailed, false);
  assert.equal(healed.stage, "contacted", "healing must not drag a worked lead back to new");

  // Meta re-delivers the same lead (it does): no second card, no overwrite.
  assert.equal(await writeLeadToClinic(db, "c1", real, "2026-08-17"), "duplicate");
  assert.equal(db.store.get(docPath).stage, "contacted");

  // A fresh successful lead is just created.
  assert.equal(
    await writeLeadToClinic(db, "c1", { ...real, docId: "meta_L2" }, "2026-08-17"),
    "created"
  );

  console.log("metaLeads helpers: all checks passed");
})();
