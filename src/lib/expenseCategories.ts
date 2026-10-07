/**
 * The categories a manual ledger entry can be filed under.
 *
 * The stored value is the English id ("Rent", "Salary"…), because that is what every existing
 * row carries and what the reports group by. The Arabic is for the screen only: a clinic that
 * filed "Rent" last year and "إيجار" this year would be two categories in every report.
 *
 * A category that is not in this list (older rows, or a value typed through the API) still shows,
 * as its stored text.
 */

export type LedgerCategory = { id: string; en: string; ar: string };

export const EXPENSE_CATEGORY_LIST: readonly LedgerCategory[] = [
  { id: "General", en: "General", ar: "عام" },
  { id: "Rent", en: "Rent", ar: "إيجار" },
  { id: "Salary", en: "Salary", ar: "مرتبات" },
  { id: "Supplies", en: "Supplies", ar: "مستلزمات" },
  { id: "Lab", en: "Lab", ar: "معمل" },
  { id: "Utilities", en: "Electricity, water & gas", ar: "كهرباء ومياه وغاز" },
  { id: "Internet & phone", en: "Internet & phone", ar: "إنترنت وتليفون" },
  { id: "Marketing", en: "Marketing & ads", ar: "تسويق وإعلانات" },
  { id: "Equipment", en: "Equipment", ar: "أجهزة ومعدات" },
  { id: "Maintenance", en: "Maintenance & repairs", ar: "صيانة وإصلاحات" },
  { id: "Cleaning", en: "Cleaning & sterilization", ar: "نظافة وتعقيم" },
  { id: "Government fees", en: "Government fees & taxes", ar: "رسوم حكومية وضرائب" },
  { id: "Insurance", en: "Insurance premiums", ar: "تأمين" },
  { id: "Transport", en: "Transport & delivery", ar: "مواصلات وتوصيل" },
  { id: "Software", en: "Software & subscriptions", ar: "برامج واشتراكات" },
  { id: "Training", en: "Training & courses", ar: "تدريب وكورسات" },
  { id: "Bank fees", en: "Bank & card fees", ar: "رسوم بنك وكروت" },
  { id: "Other", en: "Other", ar: "أخرى" },
];

export const INCOME_CATEGORY_LIST: readonly LedgerCategory[] = [
  { id: "General", en: "General", ar: "عام" },
  { id: "Product sale", en: "Product sale", ar: "بيع منتجات" },
  { id: "Rental income", en: "Rental income", ar: "إيراد إيجار" },
  { id: "Refund received", en: "Refund received", ar: "مبلغ مسترد" },
  { id: "Other income", en: "Other income", ar: "إيراد آخر" },
];

/** The ids the P&L always lists, even when a month has nothing under them. */
export const EXPENSE_CATEGORY_IDS: readonly string[] = EXPENSE_CATEGORY_LIST.map((c) => c.id);

/** The category as the screen says it; an id not in the lists is shown as stored. */
export function categoryLabel(id: string | null | undefined, isAr: boolean): string {
  const key = String(id ?? "").trim();
  if (!key) return "";
  const hit = EXPENSE_CATEGORY_LIST.find((c) => c.id === key) ?? INCOME_CATEGORY_LIST.find((c) => c.id === key);
  if (!hit) return key;
  return isAr ? hit.ar : hit.en;
}
