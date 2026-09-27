import assert from "node:assert/strict";
import { claimKey, normaliseForClaim, textFingerprint } from "../src/lib/bot/replyClaims";

// The same reply with and without the footer, or with the after-hours note, is the same reply.
const base = "وصلتنا الصورة 📷 حد من العيادة هيشوفها ويرد عليك حالاً.\n\nلو الموضوع طارئ كلمنا على طول على +201066666124";
assert.equal(normaliseForClaim(base + "\n— لإيقاف الرسائل أرسل: إيقاف"), normaliseForClaim(base));
assert.equal(normaliseForClaim(base + "\n\nالعيادة مقفولة دلوقتي — بنفتح بكره الساعة 3:00 م، وهنرد عليك أول ما نفتح"), normaliseForClaim(base));
assert.equal(textFingerprint("تمام،   مستنينكي 🦷"), textFingerprint("تمام، مستنينكي 🦷 "));

// Different words, different key; same words, same key; the phone is part of the key.
assert.notEqual(textFingerprint("تأكيد الحضور"), textFingerprint("تعديل الميعاد"));
assert.equal(claimKey("in", "123988563", "تأكيد الحضور"), claimKey("in", "123988563", "تأكيد الحضور"));
assert.notEqual(claimKey("in", "123988563", "تأكيد الحضور"), claimKey("in", "599902968", "تأكيد الحضور"));
assert.notEqual(claimKey("in", "1", "x"), claimKey("out", "1", "x"));
assert.match(claimKey("out", "+20 100 (1)", "x"), /^out_201001_[0-9a-f]{8}$/);

console.log("replyClaims: ok");
