/**
 * Activity log v2: the event catalogue turns a structured event into one sentence (Arabic or
 * English), decides which categories it belongs to and whether it is flagged, and the diff helper
 * reports only what really changed. These cases pin the sentence shapes, the below-list discount
 * rule, the legacy fallback and the undefined-stripping that Firestore needs.
 *
 * Run: npx tsx tests/activityCatalogue.test.mts
 */

import assert from "node:assert/strict";
import {
  ALL_EVENT_KEYS,
  categoriesOf,
  categoriesOfLog,
  describeLog,
  fieldLabel,
  isFlagged,
  money,
  sentence,
  storedFields,
  stripUndefined,
} from "../src/lib/activity/catalogue";
import { branchListChanges, diffChanges, discountEvent, labelOnlyChange, namedItemChanges } from "../src/lib/activity/diff";

let checks = 0;
const ok = (cond: boolean, msg: string) => {
  checks++;
  assert.ok(cond, msg);
};
const eq = <T,>(a: T, b: T, msg?: string) => {
  checks++;
  assert.equal(a, b, msg);
};
const deep = (a: unknown, b: unknown, msg?: string) => {
  checks++;
  assert.deepEqual(a, b, msg);
};

/** An Arabic "from → to": each value isolated, the arrow pointing left (old on the right, new on the left). */
const rtl = (a: string, b: string) => `\u2068${a}\u2069 ← \u2068${b}\u2069`;

// --- 1. discount + payment sentences ---
const disc = { event: "discount.given", amount: 200, patientName: "عمر حسام علي",
  refs: { procedure: "حشو كومبوزيت" }, changes: [{ field: "price", from: 1500, to: 1300 }], reason: "قريب الدكتور" } as const;
eq(sentence(disc, "ar"), `خصم 200 ج لـ عمر حسام علي على حشو كومبوزيت (${rtl("1,500", "1,300")}) · السبب: قريب الدكتور`);
eq(sentence(disc, "en"), "Discount 200 EGP for عمر حسام علي on حشو كومبوزيت (1,500 → 1,300) · Reason: قريب الدكتور");
eq(isFlagged(disc), true);
deep(categoriesOf(disc), ["discount", "money"]);
const pay = { event: "payment.received", amount: 800, patientName: "عمر حسام علي",
  refs: { method: "Cash", procedure: "حشو اطفال", receiptNumber: "R-2026-0035" } } as const;
eq(sentence(pay, "ar"), "استلام 800 ج كاش من عمر حسام علي · حشو اطفال · إيصال R-2026-0035");
eq(isFlagged(pay), false);

// --- 2. missing fields never leak ---
const bare = { event: "payment.deleted" } as const;
for (const lang of ["ar", "en"] as const) ok(!/undefined|NaN|null/.test(sentence(bare, lang)), `bare ${lang}`);

// --- 3. below-list rule ---
const added = (list: number | null, cost: number, claimId?: string) => ({ event: "procedure.added", amount: cost,
  changes: [{ field: "listPrice", from: null, to: list }, { field: "price", from: null, to: cost }],
  refs: claimId ? { claimId } : {} }) as const;
eq(isFlagged(added(1500, 1300)), true);
ok(categoriesOf(added(1500, 1300)).includes("discount"), "below list is a discount");
eq(isFlagged(added(0, 1300)), false);
eq(isFlagged(added(null, 1300)), false);
eq(isFlagged(added(1500, 900, "claim1")), false);
ok(categoriesOf(added(1500, 900, "claim1")).includes("insurance"), "claim procedure is insurance");
ok(!categoriesOf(added(1500, 900, "claim1")).includes("discount"), "claim procedure is never a discount");
eq(isFlagged({ event: "insurance.status", changes: [{ field: "status", from: "approved", to: "cancelled" }] }), true);
eq(isFlagged({ event: "insurance.status", changes: [{ field: "status", from: "approved", to: "treated" }] }), false);
// procedure.edited carries the current list price in refs
eq(isFlagged({ event: "procedure.edited", refs: { listPrice: 1500 }, changes: [{ field: "price", from: 1500, to: 1200 }] }), true);
eq(isFlagged({ event: "procedure.edited", refs: { listPrice: 1500 }, changes: [{ field: "notes", from: null, to: null }] }), false);
ok(categoriesOf({ event: "procedure.edited", changes: [{ field: "discount", from: 0, to: 100 }] }).includes("discount"), "discount change");

// --- 4. every key renders in both languages without leaks ---
for (const key of ALL_EVENT_KEYS) for (const lang of ["ar", "en"] as const) {
  const s = sentence({ event: key }, lang);
  ok(s.length > 0 && !/undefined|NaN|null/.test(s), `${key} ${lang}: ${s}`);
  const full = sentence({ event: key, amount: 1200, patientName: "Sara", reason: "r", refs: { procedure: "Filling", staffName: "Dr X", payerName: "MetLife", labName: "L", status: "approved", count: 3, method: "InstaPay", date: "2026-10-01", time: "05:00 PM", doctor: "Dr Y" },
    changes: [{ field: "price", from: 1, to: 2 }, { field: "notes", from: null, to: null }] }, lang);
  ok(!/undefined|NaN|\bnull\b/.test(full), `${key} ${lang} full: ${full}`);
}
// every key has a category and a real sentence (the switch's fallback would print the key itself)
eq(new Set(ALL_EVENT_KEYS).size, ALL_EVENT_KEYS.length, "keys are unique");
eq(ALL_EVENT_KEYS.length, 58, "the brief's union has 58 keys");
for (const key of ALL_EVENT_KEYS) {
  ok(categoriesOf({ event: key }).length > 0, `${key} has a category`);
  for (const lang of ["ar", "en"] as const) ok(sentence({ event: key }, lang) !== key, `${key} ${lang} has its own sentence`);
}

// --- 5. category and flag table ---
deep(categoriesOf({ event: "staff.deduction.added" }), ["money", "team"]);
deep(categoriesOf({ event: "staff.edited" }), ["team"]);
deep(categoriesOf({ event: "insurer.collected" }), ["insurance", "money"]);
deep(categoriesOf({ event: "lab.paid" }), ["lab", "money"]);
deep(categoriesOf({ event: "plan.created" }), ["clinical"]);
deep(categoriesOf({ event: "record.purged" }), ["patient"]);
deep(categoriesOf({ event: "settings.labs" }), ["settings"]);
for (const k of ["payment.edited", "payment.deleted", "procedure.deleted", "commission.changed", "labfee.corrected", "appointment.deleted",
  "patient.deleted", "record.deleted", "record.purged", "lab.deleted", "lab.payment.deleted", "staff.payout.edited", "staff.deduction.removed",
  "expense.deleted", "income.edited", "discount.removed", "discount.changed"] as const) eq(isFlagged({ event: k }), true, k);
for (const k of ["payment.received", "procedure.moved", "appointment.created", "patient.restored", "lab.paid", "staff.paid", "plan.deleted"] as const)
  eq(isFlagged({ event: k }), false, k);

// --- 6. storedFields ---
const sf = storedFields(disc);
eq(sf.v, 2); eq(sf.severity, "HIGH"); eq(sf.module, "finance");
ok(!/[A-Za-z0-9]{20}/.test(sf.details), "no raw ids in details");
eq(sf.details, sentence(disc, "en"));
eq(sf.action, "Discount Given");
eq(storedFields(pay).severity, "MEDIUM");
eq(storedFields({ event: "appointment.created" }).module, "appointments");
eq(storedFields({ event: "staff.edited" }).module, "users");
eq(storedFields({ event: "lab.created" }).module, "system");
eq(storedFields({ event: "insurance.created" }).module, "finance");

// --- 7. legacy fallback ---
eq(describeLog({ id: "x", action: "Payment Received", details: "800 EGP from عمر toward n7EuTEtedn3m3QDHjpi8" }, "en"),
  "Payment Received · 800 EGP from عمر");
eq(describeLog({ id: "x", action: "Payment Received" }, "en"), "Payment Received");
eq(describeLog({ id: "x", action: "Payment Received", details: "" }, "ar"), "استلام دفعة");
eq(describeLog({ id: "x", v: 2, event: "payment.received", amount: 5 }, "en"), sentence({ event: "payment.received", amount: 5 }, "en"));
deep(categoriesOfLog({ id: "x", module: "appointments" }), ["appointment"]);
deep(categoriesOfLog({ id: "x", module: "finance" }), ["money"]);
deep(categoriesOfLog({ id: "x" }), ["system"]);
deep(categoriesOfLog({ id: "x", v: 2, categories: ["lab", "money"] }), ["lab", "money"]);

// --- 8. stripUndefined ---
deep(stripUndefined({ a: 1, b: undefined, c: { d: undefined, e: [1, undefined] } }), { a: 1, c: { e: [1] } });
deep(stripUndefined({ a: null, b: 0, c: "" }), { a: null, b: 0, c: "" });
const d = new Date(0);
eq(stripUndefined({ d }).d, d, "Date instances pass through");

// --- 9. diffChanges ---
deep(diffChanges({ time: "05:00 PM", notes: "x", cost: "1500" }, { time: "06:30 PM", notes: "y", cost: 1500 }, ["time", "cost"]),
  [{ field: "time", from: "05:00 PM", to: "06:30 PM" }]);
deep(diffChanges({ a: "" }, { a: null }, ["a"]), []);
deep(diffChanges({ a: " x " }, { a: "x" }, ["a"]), []);
deep(diffChanges({ a: undefined }, { a: "" }, ["a"]), []);
deep(diffChanges({ a: 1, b: 2 }, { a: 5, b: 6 }, ["b", "a"]), [{ field: "b", from: 2, to: 6 }, { field: "a", from: 1, to: 5 }]);
deep(diffChanges({ tags: [1, 2] }, { tags: [1, 3] }, ["tags"]), [{ field: "tags", from: null, to: null }]);
deep(diffChanges({ tags: [1, 2] }, { tags: [1, 2] }, ["tags"]), []);
deep(diffChanges({ at: { toDate: () => new Date("2026-10-01T10:00:00Z") } }, { at: "2026-10-02" }, ["at"]), [{ field: "at", from: "2026-10-01", to: "2026-10-02" }]);
deep(diffChanges({ at: new Date("2026-10-01T10:00:00Z") }, { at: "2026-10-01" }, ["at"]), []);
deep(diffChanges({ a: null }, { a: "new" }, ["a"]), [{ field: "a", from: null, to: "new" }]);

// --- 9a. branchListChanges: a list of {id, name} compared by id (branches, labs, insurers) ---
deep(branchListChanges([{ id: "a", name: "مصر الجديدة" }], [{ id: "a", name: "مصر الجديدة" }, { id: "b", name: "التجمع" }]),
  [{ field: "branch", from: null, to: "التجمع" }]);
deep(branchListChanges([{ id: "a", name: "A" }], [{ id: "a", name: "B" }]), [{ field: "branch", from: "A", to: "B" }]);
deep(branchListChanges([{ id: "a", name: "A" }], []), [{ field: "branch", from: "A", to: null }]);
deep(branchListChanges([{ id: "a", name: " A " }], [{ id: "a", name: "A" }]), [], "a re-typed name is no change");
deep(branchListChanges([{ id: "a", name: "A" }], [{ id: "b", name: "B" }], "lab"),
  [{ field: "lab", from: "A", to: null }, { field: "lab", from: null, to: "B" }], "removed before added; the field is the caller's");
eq(sentence({ event: "settings.labs", changes: branchListChanges([], [{ id: "x", name: "معمل النور" }], "lab") }, "ar"),
  `تعديل المعامل · المعمل ${rtl("—", "معمل النور")}`);

// --- 9a2. labelOnlyChange / namedItemChanges (settings details, medical text, maps) ---
deep(labelOnlyChange("allergies", "Penicillin", "Penicillin, latex"), [{ field: "allergies", from: null, to: null }], "medical text by label only");
deep(labelOnlyChange("allergies", " x ", "x"), []);
deep(labelOnlyChange("labPrices", { a: 1, b: 2 }, { b: 2, a: 1 }), [], "key order is not a change");
deep(labelOnlyChange("labPrices", undefined, {}), [], "absent and empty are the same");
deep(labelOnlyChange("insurance", { p1: { memberNumber: "" } }, {}), [], "blank entries are nothing");
deep(labelOnlyChange("labPrices", { a: 1 }, { a: 2 }), [{ field: "labPrices", from: null, to: null }]);
deep(namedItemChanges(
  [{ id: "a", name: "مصر الجديدة", phone: "0100", prices: { z: 1 } }, { id: "b", name: "التجمع", phone: "" }],
  [{ id: "a", name: "مصر الجديدة", phone: "0111", prices: { z: 1 } }, { id: "b", name: "التجمع", phone: "" }, { id: "c", name: "جديد", phone: "9" }],
  ["phone"], ["prices"]),
  { changes: [{ field: "phone", from: "0100", to: "0111" }], names: ["مصر الجديدة"] }, "only items on both sides, named");
deep(namedItemChanges([{ id: "a", name: "A", prices: { z: 1 } }], [{ id: "a", name: "A", prices: { z: 2 } }], [], ["prices"]),
  { changes: [{ field: "prices", from: null, to: null }], names: ["A"] });
deep(namedItemChanges([{ id: "a", name: "A", phone: "1" }], [{ id: "a", name: "A", phone: "1" }], ["phone"]), { changes: [], names: [] });
eq(sentence({ event: "settings.branches", refs: { branchName: "مصر الجديدة" }, changes: [{ field: "receiptPrefix", from: "HEL", to: "MAD" }] }, "ar"),
  `تعديل الفروع (مصر الجديدة) · بادئة الإيصالات ${rtl("HEL", "MAD")}`);
eq(sentence({ event: "settings.labs", refs: { labName: "النور" }, changes: [{ field: "paper", from: "a4_two_up", to: "a5" }] }, "en").startsWith("Labs updated (النور) · Order paper size "), true);
eq(sentence({ event: "settings.services", refs: { procedure: "Crown" }, changes: [{ field: "pricingMode", from: "per_tooth", to: "flat" }] }, "en"),
  "Services updated (Crown) · Billing Per tooth → Flat fee");
eq(sentence({ event: "settings.insurers", refs: { payerName: "X" }, changes: [{ field: "format", from: null, to: "metlife" }] }, "ar"),
  `تعديل شركات التأمين (X) · نموذج الموافقة ${rtl("—", "متلايف")}`);
eq(sentence({ event: "lab.status", refs: { labName: "النور" }, changes: [{ field: "status", from: "at_lab", to: "back" }] }, "ar"),
  `تغيير حالة طلب معمل لدى النور · الحالة ${rtl("في المعمل", "وصلت العيادة")}`, "lab stage codes are said in words");
eq(sentence({ event: "lab.created", refs: { labName: "Nour", status: "at_lab" } }, "en"), "Lab case created at Nour (At lab)");
eq(sentence({ event: "staff.edited", refs: { staffName: "Mona" }, changes: [{ field: "baseSalary", from: 5000, to: 6000 }] }, "en"),
  "Staff details edited: Mona · Base salary 5,000 → 6,000");
eq(sentence({ event: "staff.edited", refs: { staffName: "منى", payerName: "GASCO" }, changes: [{ field: "commission", from: 30, to: 40 }] }, "ar"),
  `تعديل بيانات منى (GASCO) · العمولة ${rtl("30", "40")}`, "a per-insurer rate names the insurer");
eq(sentence({ event: "settings.services", refs: { procedure: "حشو" }, changes: [{ field: "price", from: 500, to: 600 }] }, "ar"),
  `تعديل قائمة الخدمات (حشو) · السعر ${rtl("500", "600")}`, "a price-only edit names the treatment");
eq(sentence({ event: "settings.insurers", refs: { payerName: "GASCO" }, changes: [{ field: "listPrices", from: null, to: null }] }, "en"),
  "Insurers updated (GASCO) · List prices");
eq(sentence({ event: "plan.status", patientName: "سارة", changes: [{ field: "status", from: "draft", to: "accepted" }] }, "ar"),
  `تغيير حالة خطة علاج لـ سارة · الحالة ${rtl("مسودة", "مقبولة")}`);
for (const f of ["address", "dob", "gender", "referral", "baseSalary", "commissionPercentage", "overtimeMultiplier", "speciality",
  "lab", "labName", "agreedPrice", "dueDate", "title", "total", "steps", "schedule", "listPrices", "room", "payer", "service",
  "whatsapp", "driverName", "turnaroundDays", "labPrices", "paper", "code", "receiptPrefix", "etaBranchCode", "taxRegistration",
  "format", "providerCode", "nameAr", "requiresLab", "pricingMode", "icon", "category", "allergies", "medicalHistory", "insurance",
  "xrayCode", "workType", "teeth", "shade", "details", "patient", "doctor", "notes"]) {
  ok(fieldLabel(f, "en") !== f && fieldLabel(f, "ar") !== f, `label for ${f}`);
}

// --- 9b. review fixes: identifiers stay text, clinic-clock dates, money-only grouping ---
deep(diffChanges({ phone: "01012345678" }, { phone: "01022223333" }, ["phone"]), [{ field: "phone", from: "01012345678", to: "01022223333" }]);
deep(diffChanges({ code: "1234567890" }, { code: "1234567891" }, ["code"]), [{ field: "code", from: "1234567890", to: "1234567891" }]);
deep(diffChanges({ cost: "1500" }, { cost: "1800" }, ["cost"]), [{ field: "cost", from: 1500, to: 1800 }]);
eq(sentence({ event: "patient.edited", patientName: "Sara", changes: [{ field: "phone", from: "01012345678", to: "01022223333" }] }, "en"),
  "Patient edited: Sara · Phone 01012345678 → 01022223333");
eq(sentence({ event: "patient.edited", patientName: "سارة", changes: [{ field: "phone", from: 1012345678, to: 1022223333 }] }, "ar"),
  `تعديل بيانات مريض سارة · الهاتف ${rtl("1012345678", "1022223333")}`);
eq(sentence({ event: "procedure.edited", patientName: "Sara", refs: { procedure: "Filling" }, changes: [{ field: "price", from: 1500, to: 1300 }, { field: "commission", from: 30, to: 40 }] }, "en"),
  "Procedure edited: Filling for Sara · Price 1,500 → 1,300, Commission 30 → 40");
// 22:00 UTC on 13 Oct is 01:00 on 14 Oct in Cairo (UTC+3 in October 2026)
deep(diffChanges({ d: new Date("2026-10-13T22:00:00Z") }, { d: "2026-10-15" }, ["d"]), [{ field: "d", from: "2026-10-14", to: "2026-10-15" }]);
deep(diffChanges({ d: { toDate: () => new Date("2026-10-13T22:00:00Z") } }, { d: "2026-10-14" }, ["d"]), []);
eq(sentence({ event: "expense.added", amount: 350, refs: { procedure: "إيجار" } }, "ar"), "إضافة مصروف إيجار 350 ج");
eq(sentence({ event: "income.deleted", amount: 90, refs: { procedure: "Rent share" } }, "en"), "Income deleted Rent share 90 EGP");
eq(sentence({ event: "insurance.status", patientName: "سارة", refs: { payerName: "MetLife", approvalNumber: "A-77" },
  changes: [{ field: "status", from: "approved", to: "cancelled" }] }, "ar"),
  `تغيير حالة موافقة التأمين لـ سارة عند MetLife رقم A-77 · الحالة ${rtl("معتمدة", "ملغاة")}`);
ok(sentence({ event: "insurance.edited", patientName: "Sara", refs: { payerName: "AXA", approvalNumber: "9" } }, "en").includes("at AXA no. 9"), "insurance.edited shows payer and approval");
ok(sentence({ event: "lab.status", refs: { status: "ready" } }, "en").includes("(ready)"), "lab.status shows refs.status");
ok(sentence({ event: "lab.created", refs: { status: "approved" } }, "ar").includes("(معتمدة)"), "lab.created shows refs.status");

// --- 9b. discountEvent: which discount event a before/after pair is ---
eq(discountEvent(200, 200), null, "an unchanged discount is no event");
eq(discountEvent(0, 0), null, "no discount either side is no event");
deep(discountEvent(0, 200), { event: "discount.given", amount: 200 });
deep(discountEvent(300, 0), { event: "discount.removed", amount: 300 });
deep(discountEvent(200, 300), { event: "discount.changed", amount: 100 });
deep(discountEvent(300, 100), { event: "discount.changed", amount: -200 });
deep(discountEvent(0.1, 0.3), { event: "discount.changed", amount: 0.2 }, "no floating-point tail");

// --- 9b. Task 4 review: purged patient file, appointment money, reason codes in words ---
const purgedPatient = { event: "record.purged", patientId: "P9", patientName: "سارة علي" } as const;
eq(sentence(purgedPatient, "ar"), "حذف نهائي لملف المريض سارة علي");
eq(sentence(purgedPatient, "en"), "Permanently deleted patient file سارة علي");
eq(sentence({ event: "record.purged", patientName: "Sara", refs: { count: 8 } }, "en"), "Permanently deleted patient file Sara", "a purged patient with linked records is still the patient file");
eq(sentence({ event: "record.purged", patientName: "Sara", refs: { procedure: "Crown" } }, "en"), "Permanently deleted a record from Sara's file Crown", "a record from a file keeps its own sentence");
eq(sentence({ event: "record.purged", refs: { procedure: "Amoxicillin" } }, "ar"), "حذف نهائي لـ سجل Amoxicillin");

const apptGone = { event: "appointment.deleted", patientName: "سارة", amount: 1500, reason: "with treatments", refs: { date: "2026-10-20", time: "18:00", count: 3 } } as const;
eq(sentence(apptGone, "ar"), "حذف موعد سارة 2026-10-20 18:00 · مع حذف 3 خدمات و 1,500 ج");
eq(sentence(apptGone, "en"), "Appointment deleted: سارة 2026-10-20 18:00 · with 3 treatments and 1,500 EGP removed");
eq(sentence({ ...apptGone, refs: { ...apptGone.refs, count: 1 } }, "ar"), "حذف موعد سارة 2026-10-20 18:00 · مع حذف خدمة واحدة و 1,500 ج");
eq(sentence({ ...apptGone, refs: { ...apptGone.refs, count: 2 } }, "ar"), "حذف موعد سارة 2026-10-20 18:00 · مع حذف خدمتين و 1,500 ج");
eq(sentence({ ...apptGone, refs: { ...apptGone.refs, count: 1 } }, "en"), "Appointment deleted: سارة 2026-10-20 18:00 · with 1 treatment and 1,500 EGP removed");
const apptKept = { event: "appointment.deleted", patientName: "سارة", reason: "kept treatments", refs: { date: "2026-10-20", time: "18:00", count: 2 } } as const;
eq(sentence(apptKept, "ar"), "حذف موعد سارة 2026-10-20 18:00 · مع الإبقاء على الخدمات");
eq(sentence(apptKept, "en"), "Appointment deleted: سارة 2026-10-20 18:00 · treatments kept");

const notTreated = { event: "procedure.deleted", patientName: "سارة", amount: 600, reason: "not treated", refs: { procedure: "Inlay" } } as const;
eq(sentence(notTreated, "ar"), "حذف إجراء Inlay لـ سارة (600 ج) · السبب: لم يتم العلاج");
eq(sentence(notTreated, "en"), "Procedure deleted: Inlay for سارة (600 EGP) · Reason: not treated");
eq(sentence({ ...notTreated, reason: "replaced" }, "ar"), "حذف إجراء Inlay لـ سارة (600 ج) · السبب: استبدال بعد تعديل الموافقة");
eq(sentence({ ...notTreated, reason: "replaced" }, "en"), "Procedure deleted: Inlay for سارة (600 EGP) · Reason: replaced by the edited approval");
eq(sentence({ event: "record.deleted", reason: "with treatments" }, "ar"), "حذف سجل · السبب: مع حذف الخدمات", "a known code is translated wherever it appears");
eq(sentence({ ...notTreated, reason: "دخل بالغلط" }, "ar"), "حذف إجراء Inlay لـ سارة (600 ج) · السبب: دخل بالغلط", "a typed reason prints as typed");
ok(!/[A-Za-z]{3,}/.test(sentence(apptKept, "ar") + sentence(apptGone, "ar") + sentence({ ...notTreated, refs: {} }, "ar") + sentence({ ...notTreated, reason: "replaced", refs: {} }, "ar")),
  "no English words left in the Arabic sentences");

// --- 10. helpers ---
eq(money(1200, "ar"), "1,200 ج");
eq(money(1200, "en"), "1,200 EGP");
ok(fieldLabel("price", "ar").length > 0 && fieldLabel("price", "en") === "Price", "field labels");
eq(fieldLabel("someUnknownField", "en"), "someUnknownField");

// --- 11. final review fixes ---
// Arabic arrows point from the old value to the new one in a right-to-left line.
{
  const priceEdit = { event: "procedure.edited", patientName: "سارة", refs: { procedure: "حشو" }, changes: [{ field: "price", from: 1300, to: 1500 }] } as const;
  const ar = sentence(priceEdit, "ar");
  ok(ar.includes("⁨1,300⁩ ← ⁨1,500⁩"), `Arabic: each value isolated, "←" between, old first: ${ar}`);
  ok(!ar.includes("→"), "no right-pointing arrow in Arabic");
  ok(sentence(priceEdit, "en").includes("1,300 → 1,500"), "English keeps its arrow");
  ok(sentence(disc, "ar").includes(`(${rtl("1,500", "1,300")})`), "the discount's price arrow too");
}
// A visit deleted with its charges is money; one that kept them is not.
deep(categoriesOf({ event: "appointment.deleted", amount: 1500, reason: "with treatments" }), ["appointment", "money"]);
deep(categoriesOf({ event: "appointment.deleted", reason: "kept treatments" }), ["appointment"]);
deep(categoriesOf({ event: "appointment.deleted", amount: 0 }), ["appointment"]);
// An approval deleted from the bin is filed under Insurance, and Money when its charges went too.
deep(categoriesOf({ event: "record.deleted", refs: { claimId: "metlife_1", count: 3 }, amount: 1200 }), ["patient", "insurance", "money"]);
deep(categoriesOf({ event: "record.deleted", refs: { claimId: "metlife_1", count: 1 } }), ["patient", "insurance"]);
deep(categoriesOf({ event: "record.deleted", refs: { count: 1 }, amount: 50 }), ["patient"], "no claim: still a plain record");
// Charges an approval edit replaces are book-keeping: not flagged. A charge taken off as not treated still is.
eq(isFlagged({ event: "procedure.deleted", reason: "replaced", amount: 600 }), false);
eq(isFlagged({ event: "procedure.deleted", reason: "not treated", amount: 600 }), true);
eq(isFlagged({ event: "procedure.deleted", amount: 600 }), true);
eq(storedFields({ event: "procedure.deleted", reason: "replaced", amount: 600 }).severity, "MEDIUM");

console.log(`activityCatalogue: ${checks} checks passed`);
