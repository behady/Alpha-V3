// The address is said once. Run with tsx.
//
// A clinic pasted its street address AND its two map links into the "map link" answer, and the
// same address was already saved on its profile. Every booking confirmation therefore printed the
// address twice, one line under the other, with a blank line between the two links.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mapLinesBesideAddress } from "../src/lib/bot/careNote";

const address = "العنوان ٣٠٠أ - شارع الثروة المعدنيه - حدائق الاهرام - البوابة الاولي - بجوار بافلو برجر - الدور الارضي";
const pasted = `${address}\nhttps://maps.app.goo.gl/oE2Wjch6x9BxjGf38?g_st=ac\n\nhttps://maps.app.goo.gl/ih3r2y1EyehrEUHv8?g_st=ic`;

// The real case: the address line goes, both links stay, no blank line between them.
assert.equal(
  mapLinesBesideAddress(address, pasted),
  "https://maps.app.goo.gl/oE2Wjch6x9BxjGf38?g_st=ac\nhttps://maps.app.goo.gl/ih3r2y1EyehrEUHv8?g_st=ic"
);
// A plain link, the ordinary case, is untouched.
assert.equal(mapLinesBesideAddress(address, "  https://maps.app.goo.gl/abc  "), "https://maps.app.goo.gl/abc");
// The same address written a little differently — a label, extra spaces — is still the same address.
assert.equal(mapLinesBesideAddress("٣٠٠أ - شارع الثروة المعدنيه - حدائق الاهرام", "📍 العنوان:  ٣٠٠أ - شارع الثروة   المعدنيه - حدائق الاهرام\nhttps://x.y/z"), "https://x.y/z");
// The profile holds the short form and the fact the long one (or the reverse): one contains the other.
assert.equal(mapLinesBesideAddress("شارع الثروة المعدنيه - حدائق الاهرام", `${address}\nhttps://x.y/z`), "https://x.y/z");
// Words that are NOT the address are the clinic's own note and stay.
assert.equal(mapLinesBesideAddress(address, "بجوار محطة المترو\nhttps://x.y/z"), "بجوار محطة المترو\nhttps://x.y/z");
// A short line is never judged a repeat on containment alone: "الدور الارضي" is a real extra hint.
assert.equal(mapLinesBesideAddress(address, "الدور الارضي\nhttps://x.y/z"), "الدور الارضي\nhttps://x.y/z");
// No address on the profile: everything the clinic wrote goes out.
assert.equal(mapLinesBesideAddress("", pasted), `${address}\nhttps://maps.app.goo.gl/oE2Wjch6x9BxjGf38?g_st=ac\nhttps://maps.app.goo.gl/ih3r2y1EyehrEUHv8?g_st=ic`);
// Nothing saved, nothing printed.
assert.equal(mapLinesBesideAddress(address, ""), "");
assert.equal(mapLinesBesideAddress(address, undefined), "");
// Only the address was pasted there: nothing is left, and the caller prints no empty line.
assert.equal(mapLinesBesideAddress(address, address), "");

// Both places that print the address beside the map link use it.
for (const file of ["src/lib/bot/respond.ts", "src/lib/bot/engine.ts"]) {
  const src = fs.readFileSync(path.join(process.cwd(), file), "utf8");
  assert.match(src, /mapLinesBesideAddress\(/, `${file} prints the map link through the helper`);
  assert.doesNotMatch(src, /ctx\.facts\.mapsUrl\.trim\(\)/, `${file} no longer prints the raw field`);
}

console.log("careNote: ok");
