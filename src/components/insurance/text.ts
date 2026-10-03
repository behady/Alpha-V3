/**
 * Every word the Insurance page shows, in both languages, in one place.
 *
 * The page and its four components read from here only; no Arabic lives in the components
 * themselves. The check messages come with their own `en`/`ar` from `checkMetlife`; `checkFallback`
 * is shown only when a check arrives without one (an older server, a hand-edited claim).
 */

export type Lang = { en: string; ar: string };

export const TEXT = {
  // --- page ---------------------------------------------------------------------------------
  title: { en: "Insurance", ar: "التأمين" },
  subtitle: {
    en: "Drop the insurer's approval, check what was read, keep the claims, send the monthly sheet",
    ar: "ارفع موافقة التأمين، راجع اللي اتقرأ، احفظ المطالبات، وابعت الكشف الشهري",
  },
  insurer: { en: "Insurer", ar: "شركة التأمين" },
  noFormatPayers: {
    en: "No insurer has a document format yet. Open Settings → Insurance companies, edit the insurer and set its Document format to MetLife.",
    ar: "مفيش شركة تأمين ليها شكل مستند لسه. افتح الإعدادات ← شركات التأمين، عدّل الشركة واختار شكل المستند MetLife.",
  },
  openPayers: { en: "Open Insurance companies", ar: "افتح شركات التأمين" },
  unsavedTitle: { en: "Uploaded, not saved", ar: "اترفعت ولسه ما اتحفظتش" },
  unsavedHint: {
    en: "Read before but never saved. Press one to read it again and confirm it.",
    ar: "اتقرت قبل كده بس ما اتحفظتش. دوس عليها عشان تتقري تاني وتأكدها.",
  },
  rereading: { en: "Reading…", ar: "بتتقري…" },
  rereadFailed: { en: "Could not read it again", ar: "ما قدرناش نقراها تاني" },
  savedToast: { en: "Approval saved", ar: "الموافقة اتحفظت" },
  claimNotFound: { en: "That claim was not found", ar: "المطالبة دي مش موجودة" },

  // --- drop zone ----------------------------------------------------------------------------
  dropTitle: { en: "Drop approval papers here", ar: "حط ورق الموافقات هنا" },
  dropHint: {
    en: "PDF, JPG or PNG, up to 8 MB each. Many at once is fine.",
    ar: "PDF أو JPG أو PNG، لحد 8 ميجا للملف. ينفع كذا ملف مرة واحدة.",
  },
  dropPick: { en: "Choose files", ar: "اختار الملفات" },
  dropNoPayer: { en: "Choose an insurer first", ar: "اختار شركة التأمين الأول" },
  uploading: { en: "Uploading…", ar: "بيترفع…" },
  reading: { en: "Reading the paper…", ar: "بنقرا الورقة…" },
  failed: { en: "Could not be read", ar: "ما اتقراش" },
  tryAgain: { en: "Try again", ar: "جرّب تاني" },
  typeIt: { en: "Type it myself", ar: "هكتبها بنفسي" },
  dismiss: { en: "Dismiss", ar: "إخفاء" },
  tooBig: { en: "Larger than 8 MB", ar: "أكبر من 8 ميجا" },
  wrongType: { en: "Only PDF, JPG or PNG", ar: "PDF أو JPG أو PNG بس" },
  uploadFailed: { en: "The upload failed", ar: "الرفع فشل" },
  signedOut: { en: "You are signed out. Sign in and try again.", ar: "انت خارج الحساب. ادخل وجرّب تاني." },
  networkFailed: { en: "No connection. Try again.", ar: "مفيش اتصال. جرّب تاني." },

  // --- confirm card -------------------------------------------------------------------------
  cardTitle: { en: "Check the approval", ar: "راجع الموافقة" },
  typedTitle: { en: "Type the approval", ar: "اكتب الموافقة" },
  noPreview: { en: "The document cannot be shown here.", ar: "المستند مش هيظهر هنا." },
  openDoc: { en: "Open the document", ar: "افتح المستند" },
  sectionApproval: { en: "Approval", ar: "الموافقة" },
  sectionMember: { en: "Member", ar: "المؤمن عليه" },
  sectionProvider: { en: "Provider", ar: "مقدم الخدمة" },
  sectionTotals: { en: "Printed totals", ar: "الإجماليات المطبوعة" },
  sectionLines: { en: "Services", ar: "الخدمات" },
  approvalNumber: { en: "Approval number", ar: "رقم الموافقة" },
  approvalDate: { en: "Approval date", ar: "تاريخ الموافقة" },
  statusText: { en: "Status on the paper", ar: "الحالة في الورقة" },
  policyNumber: { en: "Policy number", ar: "رقم الوثيقة" },
  employer: { en: "Employer", ar: "جهة العمل" },
  certificateNumber: { en: "Certificate number", ar: "رقم الشهادة" },
  dependentCode: { en: "Dependent code", ar: "كود التابع" },
  paperPatientName: { en: "Name on the paper", ar: "الاسم في الورقة" },
  terminationDate: { en: "Termination date", ar: "تاريخ الانتهاء" },
  providerCode: { en: "Provider code", ar: "كود مقدم الخدمة" },
  physician: { en: "Physician", ar: "الطبيب" },
  diagnosisCode: { en: "Diagnosis code", ar: "كود التشخيص" },
  estimatedCost: { en: "Estimated cost", ar: "التكلفة التقديرية" },
  requestedTotal: { en: "Requested total", ar: "إجمالي المطلوب" },
  approvedTotal: { en: "Approved total", ar: "إجمالي الموافقة" },
  patientShareTotal: { en: "Patient share total", ar: "إجمالي حصة المريض" },
  collectNote: { en: "\"Kindly collect\" figure", ar: "مبلغ \"برجاء التحصيل\"" },
  comment: { en: "Comment", ar: "ملاحظة" },
  lineCode: { en: "Code", ar: "الكود" },
  lineDescription: { en: "Description", ar: "الوصف" },
  lineUnits: { en: "Units", ar: "العدد" },
  linePerUnit: { en: "Per unit", ar: "سعر الوحدة" },
  lineGross: { en: "Gross", ar: "الإجمالي" },
  lineUnitsApproved: { en: "Units approved", ar: "العدد الموافق عليه" },
  linePatientShare: { en: "Patient share", ar: "حصة المريض" },
  lineApproved: { en: "Approved", ar: "الموافق عليه" },
  addLine: { en: "Add a line", ar: "زوّد بند" },
  removeLine: { en: "Remove this line", ar: "شيل البند ده" },
  checksHard: { en: "Fix before saving", ar: "لازم يتصلح قبل الحفظ" },
  checksSoft: { en: "Worth a look", ar: "يستاهل نظرة" },
  checksClean: { en: "Everything adds up", ar: "كل حاجة مظبوطة" },
  checkFallback: { en: "This field needs a look", ar: "الخانة دي محتاجة مراجعة" },

  patient: { en: "Patient", ar: "المريض" },
  matchedExact: { en: "Matched by certificate and dependent code", ar: "اتعرف من رقم الشهادة وكود التابع" },
  change: { en: "Change", ar: "غيّر" },
  candidatesHint: { en: "Which patient is this?", ar: "مين المريض ده؟" },
  similarity: { en: "name match", ar: "تشابه الاسم" },
  searchPatients: { en: "Search patients by name or phone…", ar: "دوّر على مريض بالاسم أو التليفون…" },
  noPatientsFound: { en: "No patient matches", ar: "مفيش مريض بالاسم ده" },
  createPatient: { en: "Create a new patient", ar: "مريض جديد" },
  newPatientName: { en: "Name", ar: "الاسم" },
  newPatientPhone: { en: "Phone (optional)", ar: "التليفون (اختياري)" },
  pickPatient: { en: "Choose a patient or create a new one", ar: "اختار مريض أو اعمل مريض جديد" },

  notTreatedYet: { en: "Approved, not treated yet", ar: "متوافق عليها ولسه ما اتعالجتش" },
  notTreatedHint: {
    en: "Off: treated on the approval date and goes on the monthly sheet. On: kept off the sheet until marked treated.",
    ar: "مقفول: اتعالج يوم الموافقة ويدخل الكشف الشهري. مفتوح: مش هيدخل الكشف لحد ما تعلّمه اتعالج.",
  },
  wordingTitle: { en: "What do you call this on the sheet?", ar: "بتسموا الخدمة دي إيه في الكشف؟" },
  wordingHint: {
    en: "Typed once per code; the monthly sheet uses it from then on.",
    ar: "بتتكتب مرة واحدة لكل كود، والكشف الشهري بيستخدمها بعد كده.",
  },
  save: { en: "Save", ar: "احفظ" },
  saving: { en: "Saving…", ar: "بيتحفظ…" },
  cancel: { en: "Close", ar: "اقفل" },
  alreadySaved: { en: "Already saved on", ar: "اتحفظت قبل كده يوم" },
  alreadySavedNoDate: { en: "Already saved", ar: "اتحفظت قبل كده" },
  open: { en: "open", ar: "افتح" },
  docTaken: { en: "This document is already attached to another claim", ar: "المستند ده متربط بمطالبة تانية" },
  saveFailed: { en: "Saving failed. Try again.", ar: "الحفظ فشل. جرّب تاني." },

  // --- claims list --------------------------------------------------------------------------
  claimsTitle: { en: "Approvals", ar: "الموافقات" },
  noClaims: { en: "No approvals for this insurer in this range.", ar: "مفيش موافقات للشركة دي في الفترة دي." },
  claimsFailed: { en: "The approvals could not be loaded. Refresh the page.", ar: "الموافقات ما اتحملتش. اعمل تحديث للصفحة." },
  colApproval: { en: "Approval", ar: "الموافقة" },
  colPatient: { en: "Patient", ar: "المريض" },
  colApprovalDate: { en: "Approved on", ar: "تاريخ الموافقة" },
  colTreatedDate: { en: "Treated on", ar: "تاريخ العلاج" },
  colApproved: { en: "Approved", ar: "الموافق عليه" },
  colShare: { en: "Patient share", ar: "حصة المريض" },
  colStatus: { en: "Status", ar: "الحالة" },
  colActions: { en: "Actions", ar: "إجراءات" },
  statusApproved: { en: "Not treated yet", ar: "لسه ما اتعالجتش" },
  statusTreated: { en: "Treated", ar: "اتعالج" },
  statusSent: { en: "Sent", ar: "اتبعت" },
  statusCancelled: { en: "Cancelled", ar: "ملغية" },
  markTreated: { en: "Mark treated", ar: "علّم اتعالج" },
  markNotTreated: { en: "Mark not treated", ar: "علّم ما اتعالجش" },
  markSent: { en: "Mark sent", ar: "علّم اتبعت" },
  openPdf: { en: "Open the document", ar: "افتح المستند" },
  noDocument: { en: "No document is attached", ar: "مفيش مستند متربط" },
  delete: { en: "Delete", ar: "امسح" },
  deleteConfirm: {
    en: "Move this approval to the recycle bin? It can be restored from Settings → Recently deleted.",
    ar: "تنقل الموافقة دي لسلة المحذوفات؟ ممكن ترجعها من الإعدادات ← المحذوفات.",
  },
  sentWarning: { en: "This was already sent to MetLife — continue?", ar: "دي اتبعتت لميتلايف خلاص — تكمل؟" },
  continue: { en: "Continue", ar: "كمّل" },
  updated: { en: "Updated", ar: "اتحدّثت" },
  updateFailed: { en: "The change was not saved", ar: "التعديل ما اتحفظش" },
  deleted: { en: "Moved to the recycle bin", ar: "اتنقلت لسلة المحذوفات" },
  deleteFailed: { en: "Could not delete", ar: "ما قدرناش نمسح" },
  totalRow: { en: "Total", ar: "الإجمالي" },

  // --- export bar ---------------------------------------------------------------------------
  from: { en: "From", ar: "من" },
  to: { en: "To", ar: "إلى" },
  rangeInverted: { en: "\"From\" is after \"To\": fix the range to build the sheet.", ar: "\"من\" بعد \"إلى\": صلّح الفترة عشان الكشف يطلع." },
  header: { en: "Statement header", ar: "ترويسة الكشف" },
  headerHint: {
    en: "Printed at the top of the sheet, exactly as typed. Remembered on this computer.",
    ar: "تُطبع أعلى الكشف كما هي مكتوبة. تُحفظ على هذا الجهاز.",
  },
  line1: { en: "Clinic and doctor", ar: "العيادة والطبيب" },
  line2: { en: "Address", ar: "العنوان" },
  line3: { en: "Phones", ar: "الهواتف" },
  onSheet: { en: "on the sheet", ar: "في الكشف" },
  heldBack: {
    en: "approvals not yet marked treated — not on the sheet",
    ar: "موافقات لسه ما اتعلّمتش اتعالجت — مش في الكشف",
  },
  missingWording: {
    en: "No sheet wording yet for these codes; the paper's English is printed instead:",
    ar: "الأكواد دي لسه مالهاش اسم في الكشف، وهيتطبع الوصف الإنجليزي بدالها:",
  },
  excel: { en: "Excel", ar: "Excel" },
  preparing: { en: "Preparing…", ar: "جارٍ التجهيز…" },
  excelFailed: { en: "Could not build the file. Try again.", ar: "تعذّر إنشاء الملف. حاول مرة أخرى." },
  markAllSent: { en: "Mark all as sent", ar: "علّم الكل اتبعت" },
  markAllSentConfirm: {
    en: "Mark {n} treated approvals in this range as sent to MetLife?",
    ar: "تعلّم {n} موافقة متعالجة في الفترة دي إنها اتبعتت لميتلايف؟",
  },
  markingSent: { en: "Marking…", ar: "بنعلّم…" },
  markedSent: { en: "Marked as sent", ar: "اتعلّموا اتبعتوا" },
  markSentPartial: { en: "Some were not marked; try again", ar: "شوية ما اتعلّموش، جرّب تاني" },
  approvedSum: { en: "Approved", ar: "الموافق عليه" },
  cases: { en: "cases", ar: "حالة" },
} as const satisfies Record<string, Lang>;

export type TextKey = keyof typeof TEXT;

/** The translator for one language: `tr(isAr)("save")`. */
export function tr(isAr: boolean) {
  return (key: TextKey): string => (isAr ? TEXT[key].ar : TEXT[key].en);
}
