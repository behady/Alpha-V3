/**
 * Activity log v2: everything a person reads about an event comes from here. One event key maps to
 * its categories, whether it is flagged, the English title and details that old readers still see,
 * and a one-line sentence in Arabic or English.
 *
 * Sentences never carry the actor (the page renders "**name** · sentence") and never conjugate a
 * verb to anyone's gender: Arabic uses noun forms (خصم، استلام، تعديل، حذف). Raw ids are not part
 * of any sentence; a missing field simply drops its phrase.
 */

import { actionLabel, readableDetails } from "./legacy";
import type { ActivityEvent, ActivityLogDoc, Category, Change, EventKey, Refs, Scalar } from "./types";

type Lang = "ar" | "en";

// ---------------------------------------------------------------- small helpers

const num = (n: number) => n.toLocaleString("en-US");
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** "1,200 ج" / "1,200 EGP". */
export function money(n: number, lang: Lang): string {
  return `${num(n)} ${lang === "ar" ? "ج" : "EGP"}`;
}

type Part = string | null | undefined | false | 0;
const j = (...parts: Part[]) => parts.filter(Boolean).join(" ");

const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

const FIELD_LABELS: Record<string, [string, string]> = {
  price: ["السعر", "Price"],
  listPrice: ["سعر القائمة", "List price"],
  amount: ["المبلغ", "Amount"],
  cost: ["التكلفة", "Cost"],
  discount: ["الخصم", "Discount"],
  method: ["طريقة الدفع", "Payment method"],
  date: ["التاريخ", "Date"],
  time: ["الميعاد", "Time"],
  status: ["الحالة", "Status"],
  notes: ["الملاحظات", "Notes"],
  doctor: ["الطبيب", "Doctor"],
  procedure: ["الإجراء", "Procedure"],
  name: ["الاسم", "Name"],
  phone: ["الهاتف", "Phone"],
  branch: ["الفرع", "Branch"],
  category: ["التصنيف", "Category"],
  description: ["الوصف", "Description"],
  salary: ["الراتب", "Salary"],
  role: ["الدور", "Role"],
  commission: ["العمولة", "Commission"],
  labFee: ["رسوم المعمل", "Lab fee"],
  payer: ["شركة التأمين", "Insurer"],
  approvalNumber: ["رقم الموافقة", "Approval number"],
  duration: ["المدة", "Duration"],
  tooth: ["السن", "Tooth"],
  quantity: ["الكمية", "Quantity"],
  reason: ["السبب", "Reason"],
  // An insurance approval's own parts, named by label alone (their values are maps, not figures).
  lineStatus: ["حالة الخدمات", "Service states"],
  dentists: ["الأطباء", "Dentists"],
  patient: ["المريض", "Patient"],
  lines: ["خدمات الموافقة", "Approval services"],
  metlife: ["بيانات الموافقة", "Approval details"],
};

export function fieldLabel(field: string, lang: Lang): string {
  const hit = FIELD_LABELS[field];
  return hit ? hit[lang === "ar" ? 0 : 1] : field;
}

const METHOD_AR: Record<string, string> = {
  cash: "كاش",
  card: "فيزا",
  visa: "فيزا",
  banktransfer: "تحويل بنكي",
  instapay: "انستاباي",
  vodafonecash: "فودافون كاش",
  insurance: "تأمين",
};
function methodLabel(method: unknown, lang: Lang): string | null {
  const raw = text(method);
  if (!raw) return null;
  if (lang === "en") return raw;
  return METHOD_AR[raw.toLowerCase().replace(/[\s_-]+/g, "")] ?? raw;
}

const STATUS_AR: Record<string, string> = {
  pending: "قيد الانتظار",
  approved: "معتمدة",
  treated: "تم العلاج",
  cancelled: "ملغاة",
  canceled: "ملغاة",
  rejected: "مرفوضة",
  claimed: "تم تقديم المطالبة",
  collected: "تم التحصيل",
};

const MONEY_FIELDS: ReadonlySet<string> = new Set([
  "price", "listPrice", "discount", "amount", "paid", "cost", "labFee", "baseSalary",
]);

function valueText(field: string, v: Scalar, lang: Lang): string {
  if (v === null || v === undefined || v === "") return "—";
  // Thousands grouping is for money only: a phone, an approval number or a percentage prints raw.
  if (typeof v === "number") return Number.isFinite(v) ? (MONEY_FIELDS.has(field) ? num(v) : String(v)) : "—";
  if (typeof v === "boolean") return lang === "ar" ? (v ? "نعم" : "لا") : v ? "Yes" : "No";
  if (field === "method") return methodLabel(v, lang) ?? "—";
  if (field === "status" && lang === "ar") return STATUS_AR[String(v).trim().toLowerCase()] ?? String(v);
  return String(v);
}

/** "label from → to"; a change with no values on either side (an array or object) is its label alone. */
function changeText(c: Change, lang: Lang): string {
  const label = fieldLabel(c.field, lang);
  if ((c.from === null || c.from === undefined) && (c.to === null || c.to === undefined)) return label;
  return `${label} ${valueText(c.field, c.from, lang)} → ${valueText(c.field, c.to, lang)}`;
}

const findChange = (e: ActivityEvent, field: string): Change | undefined => e.changes?.find((c) => c.field === field);

/** The price list's number for a procedure event, when one is known. */
function listPriceOf(e: ActivityEvent): number | null {
  const raw = findChange(e, "listPrice")?.to ?? e.refs?.listPrice ?? null;
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** A procedure charged under the price list's figure. Never for an insurance claim: the insurer sets that price. */
function belowList(e: ActivityEvent): boolean {
  if (e.event !== "procedure.added" && e.event !== "procedure.edited") return false;
  if (e.refs?.claimId) return false;
  const list = listPriceOf(e);
  const priceRaw = findChange(e, "price")?.to;
  const price = priceRaw === null || priceRaw === undefined ? NaN : Number(priceRaw);
  return list !== null && Number.isFinite(price) && list > 0 && price < list;
}

// ---------------------------------------------------------------- categories, flag, stored fields

function baseCategories(key: EventKey): Category[] {
  if (key === "staff.deduction.added" || key === "staff.deduction.edited" || key === "staff.deduction.removed") return ["money", "team"];
  if (key === "staff.edited") return ["team"];
  if (key === "staff.paid" || key.startsWith("staff.payout")) return ["money"];
  if (key === "insurer.collected") return ["insurance", "money"];
  if (key === "lab.paid") return ["lab", "money"];
  if (key === "lab.payment.deleted") return ["lab", "money"];
  const prefix = key.split(".")[0];
  switch (prefix) {
    case "procedure": case "payment": case "expense": case "income": case "commission": case "labfee":
      return ["money"];
    case "discount": return ["discount", "money"];
    case "insurance": return ["insurance"];
    case "appointment": return ["appointment"];
    case "patient": case "record": return ["patient"];
    case "plan": case "media": return ["clinical"];
    case "lab": return ["lab"];
    case "settings": return ["settings"];
    default: return ["system"];
  }
}

export function categoriesOf(e: ActivityEvent): Category[] {
  const cats = baseCategories(e.event);
  if (e.event === "procedure.added" || e.event === "procedure.edited") {
    if (belowList(e) || findChange(e, "discount")) cats.push("discount");
    if (e.refs?.claimId) cats.push("insurance");
  }
  return Array.from(new Set(cats));
}

const ALWAYS_FLAGGED: ReadonlySet<EventKey> = new Set<EventKey>([
  "discount.given", "discount.changed", "discount.removed",
  "procedure.deleted", "payment.edited", "payment.deleted",
  "expense.edited", "expense.deleted", "income.edited", "income.deleted",
  "commission.changed", "labfee.corrected",
  "staff.payout.edited", "staff.payout.deleted", "staff.deduction.edited", "staff.deduction.removed",
  "appointment.deleted", "patient.deleted", "record.deleted", "record.purged",
  "lab.deleted", "lab.payment.deleted",
]);

export function isFlagged(e: ActivityEvent): boolean {
  if (ALWAYS_FLAGGED.has(e.event)) return true;
  if (belowList(e)) return true;
  if (e.event === "insurance.status") {
    const to = findChange(e, "status")?.to;
    return typeof to === "string" && to.trim().toLowerCase() === "cancelled";
  }
  return false;
}

const TITLES: Record<EventKey, string> = {
  "procedure.added": "Procedure Added",
  "procedure.edited": "Procedure Edited",
  "procedure.deleted": "Procedure Deleted",
  "procedure.moved": "Procedure Moved",
  "procedure.continued": "Procedure Continued",
  "payment.received": "Payment Received",
  "payment.edited": "Payment Edited",
  "payment.deleted": "Payment Deleted",
  "expense.added": "Expense Added",
  "expense.edited": "Expense Edited",
  "expense.deleted": "Expense Deleted",
  "income.added": "Income Added",
  "income.edited": "Income Edited",
  "income.deleted": "Income Deleted",
  "commission.changed": "Commission Changed",
  "labfee.corrected": "Lab Fee Corrected",
  "staff.paid": "Staff Paid",
  "staff.payout.edited": "Staff Payout Edited",
  "staff.payout.deleted": "Staff Payout Deleted",
  "staff.deduction.added": "Staff Deduction Added",
  "staff.deduction.edited": "Staff Deduction Edited",
  "staff.deduction.removed": "Staff Deduction Removed",
  "staff.edited": "Staff Edited",
  "discount.given": "Discount Given",
  "discount.changed": "Discount Changed",
  "discount.removed": "Discount Removed",
  "insurance.created": "Insurance Approval Created",
  "insurance.status": "Insurance Status Changed",
  "insurance.edited": "Insurance Approval Edited",
  "insurer.collected": "Insurer Payment Collected",
  "appointment.created": "Appointment Created",
  "appointment.edited": "Appointment Edited",
  "appointment.status": "Appointment Status Changed",
  "appointment.moved": "Appointment Moved",
  "appointment.deleted": "Appointment Deleted",
  "patient.created": "Patient Created",
  "patient.edited": "Patient Edited",
  "patient.deleted": "Patient Deleted",
  "patient.restored": "Patient Restored",
  "record.deleted": "Record Deleted",
  "record.restored": "Record Restored",
  "record.purged": "Record Permanently Deleted",
  "plan.created": "Treatment Plan Created",
  "plan.edited": "Treatment Plan Edited",
  "plan.deleted": "Treatment Plan Deleted",
  "plan.status": "Treatment Plan Status Changed",
  "media.uploaded": "Media Uploaded",
  "lab.created": "Lab Case Created",
  "lab.edited": "Lab Case Edited",
  "lab.status": "Lab Case Status Changed",
  "lab.remake": "Lab Case Remake",
  "lab.deleted": "Lab Case Deleted",
  "lab.paid": "Lab Payment Made",
  "lab.payment.deleted": "Lab Payment Deleted",
  "settings.branches": "Branches Updated",
  "settings.services": "Services Updated",
  "settings.insurers": "Insurers Updated",
  "settings.labs": "Labs Updated",
};

/** Every key, derived from TITLES (a Record over the whole union) so a new key cannot be forgotten. */
export const ALL_EVENT_KEYS: readonly EventKey[] = Object.keys(TITLES) as EventKey[];

const MODULE_OF: Record<Category, string> = {
  money: "finance",
  discount: "finance",
  insurance: "finance",
  appointment: "appointments",
  patient: "patients",
  clinical: "clinical",
  team: "users",
  lab: "system",
  settings: "settings",
  system: "system",
};

export function storedFields(e: ActivityEvent): {
  v: 2; categories: Category[]; flag: boolean; action: string; details: string;
  severity: "HIGH" | "MEDIUM"; module: string;
} {
  const categories = categoriesOf(e);
  const flag = isFlagged(e);
  return {
    v: 2,
    categories,
    flag,
    action: TITLES[e.event] ?? String(e.event),
    details: sentence(e, "en"),
    severity: flag ? "HIGH" : "MEDIUM",
    module: MODULE_OF[categories[0] ?? "system"],
  };
}

// ---------------------------------------------------------------- sentences

/** `from → to` of one named change, numbers with thousands separators and no label. */
function arrow(c: Change | undefined, lang: Lang): string | null {
  if (!c) return null;
  return `${valueText(c.field, c.from, lang)} → ${valueText(c.field, c.to, lang)}`;
}

export function sentence(e: ActivityEvent, lang: Lang): string {
  const ar = lang === "ar";
  const t = (a: string, en: string) => (ar ? a : en);
  const r: Refs = e.refs ?? {};

  const Pn = text(e.patientName);
  const P = Pn ?? t("مريض", "a patient");
  const amt = isNum(e.amount) ? money(e.amount, lang) : null;
  const proc = text(r.procedure);
  const method = methodLabel(r.method, lang);
  const staff = text(r.staffName) ?? t("موظف", "a staff member");
  const payer = text(r.payerName);
  const lab = text(r.labName);
  const when = j(text(r.date), text(r.time));
  const doctor = text(r.doctor);
  const reason = text(e.reason);
  const count = isNum(Number(r.count)) && r.count !== undefined && r.count !== "" ? Number(r.count) : null;
  const receipt = text(r.receiptNumber);
  const labStatusRaw = text(r.status);
  const labStatus = labStatusRaw ? valueText("status", labStatusRaw, lang) : null;

  /** Every change except the list-price context, as "label from → to". */
  const others = (skip: string[] = []): string | null => {
    const parts = (e.changes ?? [])
      .filter((c) => c && c.field !== "listPrice" && !skip.includes(c.field))
      .map((c) => changeText(c, lang));
    return parts.length ? parts.join(ar ? "، " : ", ") : null;
  };

  let head = "";
  const extras: Array<string | null> = [];

  switch (e.event) {
    // ------------------------------------------------------------ procedures
    case "procedure.added": {
      const list = listPriceOf(e);
      head = j(t("إضافة إجراء", "Procedure added:"), proc, t("لـ", "for"), P, amt && `(${amt})`,
        belowList(e) && list !== null && `(${t("سعر القائمة", "list price")} ${num(list)})`);
      break;
    }
    case "procedure.edited":
      head = j(t("تعديل إجراء", "Procedure edited:"), proc, t("لـ", "for"), P);
      extras.push(others());
      break;
    case "procedure.deleted":
      head = j(t("حذف إجراء", "Procedure deleted:"), proc, t("لـ", "for"), P, amt && `(${amt})`);
      break;
    case "procedure.moved":
      head = j(t("نقل إجراء", "Procedure moved:"), proc, t("لـ", "for"), P, when && t(`إلى ${when}`, `to ${when}`));
      break;
    case "procedure.continued":
      head = j(t("استكمال إجراء", "Procedure continued:"), proc, t("لـ", "for"), P);
      break;

    // ------------------------------------------------------------ payments
    case "payment.received":
      head = j(t("استلام", "Payment received"), amt, method, t("من", "from"), P);
      extras.push(proc, receipt && t(`إيصال ${receipt}`, `Receipt ${receipt}`));
      break;
    case "payment.edited":
      head = j(t("تعديل دفعة", "Payment edited"), amt, method, t("من", "from"), P);
      extras.push(others(), receipt && t(`إيصال ${receipt}`, `Receipt ${receipt}`));
      break;
    case "payment.deleted":
      head = j(t("حذف دفعة", "Payment deleted"), amt, method, t("من", "from"), P);
      extras.push(proc, receipt && t(`إيصال ${receipt}`, `Receipt ${receipt}`));
      break;

    // ------------------------------------------------------------ expenses and income
    case "expense.added": head = j(t("إضافة مصروف", "Expense added"), proc, amt); extras.push(others()); break;
    case "expense.edited": head = j(t("تعديل مصروف", "Expense edited"), proc, amt); extras.push(others()); break;
    case "expense.deleted": head = j(t("حذف مصروف", "Expense deleted"), proc, amt); extras.push(others()); break;
    case "income.added": head = j(t("إضافة إيراد", "Income added"), proc, amt); extras.push(others()); break;
    case "income.edited": head = j(t("تعديل إيراد", "Income edited"), proc, amt); extras.push(others()); break;
    case "income.deleted": head = j(t("حذف إيراد", "Income deleted"), proc, amt); extras.push(others()); break;
    case "commission.changed":
      head = j(t("تعديل نسبة العمولة", "Commission split changed"), proc && t(`على ${proc}`, `on ${proc}`), Pn && t(`لـ ${Pn}`, `for ${Pn}`));
      extras.push(others());
      break;
    case "labfee.corrected":
      head = j(t("تصحيح رسوم المعمل", "Lab fee corrected"), proc && t(`على ${proc}`, `on ${proc}`), Pn && t(`لـ ${Pn}`, `for ${Pn}`), amt);
      extras.push(others());
      break;

    // ------------------------------------------------------------ staff
    case "staff.paid": head = j(t("صرف مستحقات", "Staff paid"), staff, amt); break;
    case "staff.payout.edited": head = j(t("تعديل دفعة موظف", "Staff payout edited"), staff, amt); extras.push(others()); break;
    case "staff.payout.deleted": head = j(t("حذف دفعة موظف", "Staff payout deleted"), staff, amt); break;
    case "staff.deduction.added": head = j(t("تسجيل خصم على", "Staff deduction added for"), staff, amt); break;
    case "staff.deduction.edited": head = j(t("تعديل خصم على", "Staff deduction edited for"), staff, amt); extras.push(others()); break;
    case "staff.deduction.removed": head = j(t("إلغاء خصم على", "Staff deduction removed for"), staff, amt); break;
    case "staff.edited": head = j(t("تعديل بيانات", "Staff details edited:"), staff); extras.push(others()); break;

    // ------------------------------------------------------------ discounts
    case "discount.given":
    case "discount.changed":
    case "discount.removed": {
      const label = e.event === "discount.given" ? t("خصم", "Discount")
        : e.event === "discount.changed" ? t("تعديل خصم", "Discount changed")
        : t("إلغاء خصم", "Discount removed");
      const price = arrow(findChange(e, "price"), lang);
      head = j(label, amt, t("لـ", "for"), P, proc && t(`على ${proc}`, `on ${proc}`), price && `(${price})`);
      extras.push(e.event === "discount.removed" ? null : others(["price"]));
      break;
    }

    // ------------------------------------------------------------ insurance
    case "insurance.created": {
      const approval = text(r.approvalNumber);
      head = j(t("إنشاء موافقة تأمين", "Insurance approval created"), t("لـ", "for"), P,
        payer && t(`عند ${payer}`, `at ${payer}`), approval && t(`رقم ${approval}`, `no. ${approval}`));
      break;
    }
    case "insurance.status":
      head = j(t("تغيير حالة موافقة التأمين", "Insurance approval status changed"), t("لـ", "for"), P,
        payer && t(`عند ${payer}`, `at ${payer}`), text(r.approvalNumber) && t(`رقم ${text(r.approvalNumber)}`, `no. ${text(r.approvalNumber)}`));
      extras.push(others());
      break;
    case "insurance.edited":
      head = j(t("تعديل موافقة التأمين", "Insurance approval edited"), t("لـ", "for"), P,
        payer && t(`عند ${payer}`, `at ${payer}`), text(r.approvalNumber) && t(`رقم ${text(r.approvalNumber)}`, `no. ${text(r.approvalNumber)}`));
      extras.push(others());
      break;
    case "insurer.collected":
      head = j(t("تحصيل", "Collected"), amt, t("من", "from"), payer ?? t("شركة التأمين", "the insurer"));
      extras.push(count !== null ? t(`${num(count)} إجراءات`, `${num(count)} procedures`) : null);
      break;

    // ------------------------------------------------------------ appointments
    case "appointment.created":
      head = j(t("حجز موعد", "Appointment booked"), t("لـ", "for"), P, when && t(`يوم ${when}`, `on ${when}`), doctor && t(`مع ${doctor}`, `with ${doctor}`));
      break;
    case "appointment.edited":
      head = j(t("تعديل موعد", "Appointment edited:"), P, when);
      extras.push(others());
      break;
    case "appointment.status":
      head = j(t("تغيير حالة موعد", "Appointment status changed:"), P, when);
      extras.push(others());
      break;
    case "appointment.moved":
      head = j(t("نقل موعد", "Appointment moved:"), P);
      extras.push(others());
      break;
    case "appointment.deleted":
      head = j(t("حذف موعد", "Appointment deleted:"), P, when);
      break;

    // ------------------------------------------------------------ patients and records
    case "patient.created": head = j(t("إضافة مريض", "Patient added:"), P); break;
    case "patient.edited": head = j(t("تعديل بيانات مريض", "Patient edited:"), P); extras.push(others()); break;
    case "patient.deleted": head = j(t("حذف مريض", "Patient deleted:"), P); break;
    case "patient.restored": head = j(t("استرجاع مريض", "Patient restored:"), P); break;
    case "record.deleted":
    case "record.restored":
    case "record.purged": {
      const verb = e.event === "record.deleted" ? t("حذف", "Deleted")
        : e.event === "record.restored" ? t("استرجاع", "Restored")
        : t("حذف نهائي لـ", "Permanently deleted");
      const what = count !== null && count !== 1 ? t(`سجلات (${num(count)})`, `${num(count)} records`) : t("سجل", "a record");
      head = j(verb, what, Pn && t(`من ملف ${Pn}`, `from ${Pn}'s file`), proc);
      break;
    }

    // ------------------------------------------------------------ clinical
    case "plan.created": head = j(t("إنشاء خطة علاج", "Treatment plan created"), t("لـ", "for"), P, amt); break;
    case "plan.edited": head = j(t("تعديل خطة علاج", "Treatment plan edited"), t("لـ", "for"), P); extras.push(others()); break;
    case "plan.deleted": head = j(t("حذف خطة علاج", "Treatment plan deleted"), t("لـ", "for"), P); break;
    case "plan.status": head = j(t("تغيير حالة خطة علاج", "Treatment plan status changed"), t("لـ", "for"), P); extras.push(others()); break;
    case "media.uploaded": head = j(t("رفع ملف", "File uploaded"), t("لـ", "for"), P, proc); break;

    // ------------------------------------------------------------ lab
    case "lab.created": head = j(t("إنشاء طلب معمل", "Lab case created"), lab && t(`لدى ${lab}`, `at ${lab}`), Pn && t(`لـ ${Pn}`, `for ${Pn}`), proc, labStatus && `(${labStatus})`); break;
    case "lab.edited": head = j(t("تعديل طلب معمل", "Lab case edited"), lab && t(`لدى ${lab}`, `at ${lab}`), Pn && t(`لـ ${Pn}`, `for ${Pn}`)); extras.push(others()); break;
    case "lab.status": head = j(t("تغيير حالة طلب معمل", "Lab case status changed"), lab && t(`لدى ${lab}`, `at ${lab}`), Pn && t(`لـ ${Pn}`, `for ${Pn}`), labStatus && `(${labStatus})`); extras.push(others()); break;
    case "lab.remake": head = j(t("إعادة تصنيع طلب معمل", "Lab case remake"), lab && t(`لدى ${lab}`, `at ${lab}`), Pn && t(`لـ ${Pn}`, `for ${Pn}`)); break;
    case "lab.deleted": head = j(t("حذف طلب معمل", "Lab case deleted"), lab && t(`لدى ${lab}`, `at ${lab}`), Pn && t(`لـ ${Pn}`, `for ${Pn}`)); break;
    case "lab.paid": head = j(t("دفع", "Paid"), amt, lab ? t(`لمعمل ${lab}`, `to ${lab}`) : t("للمعمل", "to the lab")); break;
    case "lab.payment.deleted": head = j(t("حذف دفعة معمل", "Lab payment deleted"), amt, lab && `(${lab})`); break;

    // ------------------------------------------------------------ settings
    case "settings.branches": head = t("تعديل الفروع", "Branches updated"); extras.push(others()); break;
    case "settings.services": head = t("تعديل قائمة الخدمات", "Services updated"); extras.push(others()); break;
    case "settings.insurers": head = t("تعديل شركات التأمين", "Insurers updated"); extras.push(others()); break;
    case "settings.labs": head = t("تعديل المعامل", "Labs updated"); extras.push(others()); break;

    default:
      head = String(e.event ?? "");
  }

  const tail = reason ? [t(`السبب: ${reason}`, `Reason: ${reason}`)] : [];
  return [head, ...extras, ...tail].filter((p): p is string => !!p && p.trim() !== "").join(" · ");
}

// ---------------------------------------------------------------- reading rows back

export function describeLog(log: ActivityLogDoc, lang: Lang): string {
  if (log.v === 2 && log.event) return sentence(log as ActivityEvent, lang);
  const action = log.action ? actionLabel(String(log.action), lang === "ar") : "";
  const details = log.details ? readableDetails(String(log.details)) : "";
  if (action && details) return `${action} · ${details}`;
  return action || details;
}

const LEGACY_MODULE_CATEGORY: Record<string, Category> = {
  finance: "money",
  appointments: "appointment",
  patients: "patient",
  clinical: "clinical",
  users: "team",
  attendance: "team",
  settings: "settings",
  system: "system",
  inventory: "system",
  auth: "system",
};

export function categoriesOfLog(log: ActivityLogDoc): Category[] {
  if (log.v === 2 && Array.isArray(log.categories) && log.categories.length) return log.categories;
  return [LEGACY_MODULE_CATEGORY[String(log.module ?? "").toLowerCase()] ?? "system"];
}

// ---------------------------------------------------------------- Firestore safety

/** Firestore rejects `undefined` anywhere in a write: drop it from objects and arrays, deeply. */
export function stripUndefined<T>(value: T): T {
  return strip(value) as T;
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((v) => v !== undefined).map(strip);
  if (value && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    // Dates, Timestamps, FieldValues and other class instances are left alone.
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = strip(v);
    }
    return out;
  }
  return value;
}
