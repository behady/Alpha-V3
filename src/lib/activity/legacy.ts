/*
 * The pre-v2 activity-log vocabulary: Arabic labels for what the system wrote into a log row
 * before events were structured, and the id-stripping applied to old free-text details.
 * Moved out of ActivityLogs.tsx unchanged; v2 rows are described by catalogue.ts instead.
 */

export const MODULE_AR: Record<string, string> = {
  auth: "الدخول",
  settings: "الإعدادات",
  users: "المستخدمين",
  patients: "المرضى",
  appointments: "المواعيد",
  clinical: "العلاج",
  finance: "الحسابات",
  inventory: "المخزون",
  attendance: "الحضور",
  system: "النظام",
};

export const ROLE_AR: Record<string, string> = {
  owner: "المالك",
  admin: "مدير",
  dentist: "طبيب",
  receptionist: "استقبال",
  assistant: "مساعد",
  superadmin: "مدير المنصة",
};

/** Keyed in lower case: the same action has been written in Title Case and in sentence case. */
export const ACTION_AR: Record<string, string> = {
  "appointment created": "إنشاء موعد",
  "appointment updated": "تعديل موعد",
  "appointment deleted": "حذف موعد",
  "patient created": "إضافة مريض",
  "patient updated": "تعديل بيانات مريض",
  "payment received": "استلام دفعة",
  "procedure logged": "تسجيل إجراء",
  "procedure updated": "تعديل إجراء",
  "procedure deleted": "حذف إجراء",
  "procedure moved": "نقل إجراء",
  "procedure continued": "استكمال إجراء",
  "finance entry created": "إضافة قيد مالي",
  "finance entry updated": "تعديل قيد مالي",
  "finance entry deleted": "حذف قيد مالي",
  "finance report exported": "تصدير تقرير مالي",
  "commission split updated": "تعديل نسبة العمولة",
  "lab fee corrected": "تصحيح رسوم المعمل",
  "record restored": "استرجاع سجل",
  "record permanently deleted": "حذف سجل نهائيًا",
  "records deleted": "حذف سجلات",
  "staff deduction recorded": "تسجيل خصم على موظف",
  "staff deduction removed": "إلغاء خصم على موظف",
  "staff paid": "صرف مستحقات موظف",
  "staff payment deleted": "حذف دفعة موظف",
  "staff payment edited": "تعديل دفعة موظف",
  "staff updated": "تعديل بيانات موظف",
  "staff device unlinked": "فك ربط جهاز موظف",
  "staff attendance settings updated": "تعديل إعدادات حضور موظف",
  "attendance log updated": "تعديل سجل حضور",
  "attendance log deleted": "حذف سجل حضور",
  "overtime decision": "قرار الوقت الإضافي",
  "price lists updated": "تحديث قوائم الأسعار",
  "settings updated": "تحديث الإعدادات",
  "discount policy updated": "تعديل سياسة الخصم",
  "clinic profile updated": "تحديث بيانات العيادة",
  "whatsapp settings updated": "تحديث إعدادات الواتساب",
  "wapilot connection updated": "تحديث ربط الواتساب",
  "user created": "إضافة مستخدم",
  "user deleted": "حذف مستخدم",
  "role updated": "تعديل الدور",
  "permissions updated": "تعديل الصلاحيات",
  "permissions reset": "إعادة ضبط الصلاحيات",
  "password overridden": "تغيير كلمة المرور",
  "ownership transferred": "نقل ملكية العيادة",
  "dentist flag updated": "تعديل صفة الطبيب",
  "media uploaded": "رفع ملف",
  "treatment plan created": "إنشاء خطة علاج",
  "treatment plan updated": "تعديل خطة علاج",
  "treatment plan deleted": "حذف خطة علاج",
  "diagnosis chat deleted": "حذف محادثة تشخيص",
  "inventory item created": "إضافة صنف للمخزون",
  "inventory item updated": "تعديل صنف في المخزون",
  "lead added": "إضافة عميل محتمل",
  "lead converted": "تحويل عميل محتمل لمريض",
  "list emptied": "تفريغ قائمة",
  "marketing content created": "إنشاء محتوى تسويقي",
  "marketing post published": "نشر منشور تسويقي",
  "marketing campaign launched": "إطلاق حملة تسويقية",
  "marketing voice profile updated": "تحديث أسلوب الكتابة التسويقي",
  "odontogram updated from ai x-ray report": "تحديث خريطة الأسنان من تقرير الأشعة بالذكاء الاصطناعي",
};

/** lib/serverLogger writes "Alpha AI <verb> <collection> record" for the assistant's own changes. */
export const AI_VERB_AR: Record<string, string> = { created: "أضاف", updated: "عدّل", deleted: "حذف" };
export const AI_RECORD_AR: Record<string, string> = {
  patients: "مريض",
  appointments: "موعد",
  clinical_notes: "ملاحظة علاجية",
  ledger: "قيد مالي",
  expenses: "مصروف",
  inventory: "صنف مخزون",
  inventory_transactions: "حركة مخزون",
  staff: "موظف",
};

export function actionLabel(action: string, isAr: boolean): string {
  if (!isAr) return action;
  // String(): an old row can hold a non-string here, and a throw would blank the whole table.
  const key = String(action).trim().toLowerCase();
  const hit = ACTION_AR[key];
  if (hit) return hit;
  const ai = /^alpha ai (created|updated|deleted) ([a-z_]+) record$/.exec(key);
  if (ai) return `المساعد الذكي ${AI_VERB_AR[ai[1]]} ${AI_RECORD_AR[ai[2]] ? `سجل ${AI_RECORD_AR[ai[2]]}` : "سجل"}`;
  if (/^ai ortho .* report signed$/.test(key)) return "اعتماد تقرير تقويم من الذكاء الاصطناعي";
  return action;
}

/**
 * The details line as the phone card shows it: raw record ids (Firestore's 20-character mix of
 * letters and digits) say nothing to a person on a small screen, so they are dropped, along with
 * an "ID:" or brackets left empty around them. The desktop table still shows the stored text.
 */
// Exactly 20 (Firestore auto-id) or 28 (Firebase uid) letters/digits, standing alone, that mix in
// a digit or mix upper and lower case — an id, not a word.
export const RAW_ID =
  /(?:\b(?:id|ID|Id)\s*[:#]?\s*)?(?<![A-Za-z0-9_])(?:(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])|(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*[A-Z][A-Za-z0-9]*[A-Z]))(?:[A-Za-z0-9]{28}|[A-Za-z0-9]{20})(?![A-Za-z0-9_])/g;
export function readableDetails(details: string): string {
  const text = String(details);
  const stripped = text.replace(RAW_ID, "");
  // Nothing was an id: show the text exactly as stored, no tidying.
  if (stripped === text) return text;
  return stripped
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/\s+([.,:;)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim()
    // "… toward <id>" reads as a dangling "toward" once the id is gone.
    .replace(/\s+(?:toward|towards|for|on|to|of|in)$/i, "")
    .trim();
}
