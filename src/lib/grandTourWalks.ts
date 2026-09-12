// src/lib/grandTourWalks.ts
/**
 * Where Sara's hand goes on each stop, element by element.
 *
 * After the stop's opening line she shrinks to a caption and works through this list: the hand
 * rests on a control, the spotlight frames it (or its card), she says one line, next. A `click`
 * here opens the menu she is about to describe and closes it after. Nothing is written — a walk
 * needs no consent and runs on every stop that has one.
 *
 * Targets are `data-tour` anchors where one exists and the words on screen otherwise, in the
 * tour's language. Pointing is optional by default: a card that this clinic's plan or this
 * person's role does not render is passed over silently, so one script serves every viewer.
 *
 * Every label below was read from the page's source. When a label changes, the point is skipped
 * rather than misplaced — but keep this file in step when you rename something on a screen.
 */

import type { Localized } from "@/lib/grandTour";
import type { DemoAction } from "@/lib/tourDemo";

type L = Localized;
const l = (en: string, ar: string): L => ({ en, ar });

/** Point at an anchor. */
const pa = (anchor: string, en: string, ar: string, container: "self" | "card" | "row" = "self"): DemoAction => ({
  kind: "point",
  anchor,
  container,
  say: l(en, ar),
});
/** Point at the words on screen. */
const pt = (text: L, en: string, ar: string, container: "self" | "card" | "row" = "card"): DemoAction => ({
  kind: "point",
  text,
  container,
  say: l(en, ar),
});
/** Open or close something on the way. Optional: a phone has no dropdowns. */
const ck = (anchor: string, en?: string, ar?: string): DemoAction => ({
  kind: "click",
  anchor,
  optional: true,
  timeoutMs: 2500,
  ...(en && ar ? { say: l(en, ar) } : {}),
});
const sy = (en: string, ar: string): DemoAction => ({ kind: "say", text: l(en, ar) });

export const TOUR_WALKS: Record<string, DemoAction[]> = {
  /* ---------------------------------------------------------------- finding your way */
  topbar: [
    pa("nav-dashboard", "Dashboard is a direct link — home, one click, always.", "لوحة التحكم لينك مباشر — البيت، ضغطة واحدة، دايماً."),
    ck("nav-group-front-desk", "Front Desk opens like this. Everything reception touches all day lives here.", "مكتب الاستقبال بيفتح كده. كل اللي الاستقبال بيلمسه طول اليوم هنا."),
    pa("nav-chats", "WhatsApp — the clinic's inbox, and the assistant that answers patients.", "واتساب — صندوق العيادة، والمساعد اللي بيرد على المرضى."),
    pa("nav-patients", "Patients — the directory, and every file.", "المرضى — الدليل، وكل ملف."),
    pa("nav-appointments", "Appointments — the calendar.", "المواعيد — التقويم."),
    pa("nav-leads", "Leads — people who asked but haven't booked yet.", "العملاء المحتملين — ناس سألت ولسه محجزتش."),
    ck("nav-group-front-desk"),
    ck("nav-group-operations", "Operations: money, stock, the lab and the time clock.", "العمليات: الفلوس والمخزون والمعمل والحضور."),
    pa("nav-finance", "Finance — the clinic's ledger.", "الحسابات — دفتر العيادة."),
    pa("nav-inventory", "Inventory — what's in the cupboard.", "المخزون — اللي في الدولاب."),
    pa("nav-store", "Supply Store — reorder from the partner supplier.", "متجر المستلزمات — اطلب من المورّد الشريك."),
    pa("nav-lab", "Lab Tracking — every case out at a lab.", "متابعة المعمل — كل حالة برّه في المعمل."),
    pa("nav-attendance", "Time Clock — staff clock in and out.", "الحضور والانصراف — الموظفين بيسجلوا حضور وانصراف."),
    ck("nav-group-operations"),
    ck("nav-group-insights-growth", "Insights & Growth: the numbers, and the marketing.", "الرؤى والنمو: الأرقام، والتسويق."),
    pa("nav-ai", "Intelligence — the daily brief, messages to send, no-shows, and what the bot couldn't answer.", "ذكاء ألفا — الملخص اليومي، رسايل للإرسال، الغياب، واللي البوت معرفش يرد عليه."),
    pa("nav-marketing", "Marketing — the studio.", "التسويق — الاستوديو."),
    pa("nav-reports", "Reports — five reports, any period, exportable.", "التقارير — خمس تقارير، أي فترة، بتتصدّر."),
    ck("nav-group-insights-growth"),
    pa("nav-settings", "The gear is Settings. We'll go through every section near the end.", "الترس هو الإعدادات. هنمشي على كل قسم قرب الآخر."),
    pa("notification-bell", "The bell: what needs a human.", "الجرس: اللي محتاج بني آدم."),
    pa("account-menu", "And your name: language, help, this tour, and logout. Next stop opens it.", "واسمك: اللغة، المساعدة، الجولة دي، والخروج. المحطة الجاية بتفتحه."),
  ],

  "account-menu": [
    ck("account-menu", "Your name opens it.", "اسمك بيفتحها."),
    pa("menu-welcome", "Getting started — your setup checklist, and me.", "البداية — قايمة خطواتك، وأنا."),
    pa("menu-help", "The Help Center — the written guides, with screenshots.", "مركز المساعدة — الأدلة المكتوبة، بالصور."),
    pt(l("Tour with", "جولة مع"), "This restarts or resumes the tour any time.", "ده بيعيد الجولة أو بيكمّلها في أي وقت.", "self"),
    pt(l("العربية", "English"), "One tap switches the whole system between English and Arabic.", "ضغطة واحدة بتحوّل النظام كله بين العربي والإنجليزي.", "self"),
    pt(l("Logout", "تسجيل الخروج"), "And logout.", "وتسجيل الخروج.", "self"),
    ck("account-menu"),
  ],

  /* ---------------------------------------------------------------- dashboard */
  dashboard: [
    // Owner's view
    pt(l("Cash today", "كاش النهارده"), "Cash today, live — every payment taken at the desk so far.", "كاش النهارده، مباشر — كل دفعة اتاخدت على المكتب لحد دلوقتي."),
    pt(l("On the floor", "على الأرض"), "Who's in: on time, late, or absent.", "مين موجود: في معاده، متأخر، ولا غايب."),
    pt(l("Waiting room", "صالة الانتظار"), "The waiting room — how many, and the longest wait.", "صالة الانتظار — كام واحد، وأطول انتظار."),
    pt(l("What slips if nobody acts", "اللي هيضيع لو محدش اتحرك"), "What slips if nobody acts: past visits never closed, late lab cases, empty stock, tomorrow's unconfirmed.", "اللي هيضيع لو محدش اتحرك: زيارات فاتت محدش قفلها، حالات معمل متأخرة، صنف خلص، بكرة مش مؤكد."),
    pt(l("Money", "الفلوس"), "The Money tab: cash this period, what's still owed, and what each dentist collected.", "تاب الفلوس: الكاش في الفترة، اللي لسه مستحق، واللي كل دكتور حصّله.", "self"),
    pt(l("Team", "الفريق"), "Team: who's in now, pay owed, hours worked, and what's waiting on you.", "الفريق: مين موجود، المستحقات، ساعات الشغل، واللي مستني قرارك.", "self"),
    pt(l("The floor", "الصالة"), "The floor: the waiting room and no-shows, with a button for each thing to chase.", "الصالة: صالة الانتظار والغياب، وزرار لكل حاجة تتطارد.", "self"),
    pt(l("Growth", "النمو"), "Growth: new patients and where from, the leads funnel, patients slipping away, WhatsApp at a glance.", "النمو: مرضى جدد ومن فين، قمع العملاء، مرضى بيتسحبوا، وواتساب في نظرة.", "self"),
    pt(l("This month", "الشهر ده"), "Today, this week, this month — the whole screen follows this.", "النهارده، الأسبوع ده، الشهر ده — الشاشة كلها بتمشي وراه.", "self"),
    // Desk view
    pt(l("Income", "دخل اليوم"), "Income today, and how many appointments.", "دخل النهارده، وكام موعد."),
    pt(l("Schedule", "جدول المواعيد"), "The day's schedule — each card is a patient; the colour is their status.", "جدول اليوم — كل كارت مريض؛ اللون هو حالته."),
    pt(l("Day", "يومي"), "Day or week.", "يوم أو أسبوع.", "self"),
    pt(l("New Patient", "مريض جديد"), "New patient and Quick Pay are one click from here, all day.", "مريض جديد ودفع سريع على بُعد ضغطة من هنا، طول اليوم.", "self"),
    // Dentist home
    pt(l("In the chair now", "على الكرسي دلوقتي"), "For a dentist: who's in the chair now, and who's next.", "للدكتور: مين على الكرسي دلوقتي، ومين التالي."),
    pt(l("My day", "يومي"), "Their day, with a Seat button on each row.", "يومه، وزرار دخّل على كل صف."),
    pt(l("Back from the lab", "رجع من المعمل"), "Cases back from the lab that need a fitting booked.", "الحالات اللي رجعت من المعمل ومحتاجة حجز تركيب."),
  ],

  /* ---------------------------------------------------------------- front desk */
  chats: [
    pt(l("New chat", "محادثة جديدة"), "Start a conversation with any patient from here.", "ابدأ محادثة مع أي مريض من هنا.", "self"),
    pt(l("Needs reply", "محتاج رد"), "Filters: all, unread, needs a reply, mine, archived.", "فلاتر: الكل، غير مقروء، محتاج رد، بتاعتي، الأرشيف.", "self"),
    pt(l("Clinic WhatsApp", "واتساب العيادة"), "Open a thread and the conversation shows here, with a composer to reply and a link to the patient's file.", "افتح خيط والمحادثة بتظهر هنا، ومعاها خانة للرد ولينك لملف المريض."),
    sy("On each thread you can take over from the bot, or hand it back. And the bell up top chimes when a new message lands.", "في كل محادثة تقدر تاخد الرد من البوت، أو ترجّعله. والجرس اللي فوق بيرن لما رسالة جديدة توصل."),
  ],

  patients: [
    pa("patients-search", "The search box: part of a name, or a few digits of a phone.", "خانة البحث: جزء من الاسم، أو كام رقم من التليفون."),
    pt(l("Patient", "المريض"), "The directory: name and source…", "الدليل: الاسم والمصدر…", "self"),
    pt(l("Phone", "رقم الهاتف"), "…phone…", "…التليفون…", "self"),
    pt(l("Address", "العنوان"), "…and address.", "…والعنوان.", "self"),
    pa("patient-row", "Every row is a person. Click it and the whole file opens.", "كل صف بني آدم. اضغط عليه والملف كله يفتح.", "row"),
    pa("patients-add", "And new patients start here.", "والمريض الجديد بيبدأ من هنا."),
  ],

  "patient-file": [
    pa("patient-edit", "The pencil edits the profile — name, phone, birthday, and the delete button.", "القلم بيعدّل الملف — الاسم والتليفون وتاريخ الميلاد، وزرار الحذف."),
    pt(l("Visits", "الزيارات"), "Visits and completed treatments, at a glance.", "الزيارات والعلاجات المكتملة، في نظرة."),
    pa("rx-open", "Quick actions: write a prescription…", "الإجراءات السريعة: اكتب روشتة…"),
    pt(l("Diagnosis", "تشخيص"), "…chart a diagnosis on the teeth…", "…سجّل تشخيص على الأسنان…", "self"),
    pt(l("Ortho", "تقويم"), "…or open the ortho record.", "…أو افتح ملف التقويم.", "self"),
    pt(l("Request Review", "طلب تقييم"), "Request a Google review from this patient after a good visit.", "اطلب تقييم على جوجل من المريض ده بعد زيارة كويسة.", "self"),
    pt(l("Medical history not recorded", "لم يتم تسجيل التاريخ الطبي"), "This banner stays until someone records allergies and history — blank means not asked, never 'none'.", "البانر ده بيفضل لحد ما حد يسجّل الحساسية والتاريخ — الفاضي معناه ماتسألش، مش «مفيش»."),
    pa("patient-tab-clinical", "The tabs. Clinical: every procedure, in order, with the teeth chart.", "التابات. السجل السريري: كل إجراء بالترتيب، مع رسم الأسنان."),
    pa("patient-tab-plan", "Treatment Plan: what's proposed and priced.", "خطة العلاج: المقترح وسعره."),
    pa("patient-tab-finance", "Finance: charges, payments, balance, receipts.", "الحسابات: الرسوم والمدفوعات والرصيد والإيصالات."),
    pa("patient-tab-timeline", "Timeline: every visit and event.", "الخط الزمني: كل زيارة وحدث."),
    pa("patient-tab-overview", "Overview: details, and the WhatsApp automation switch for this patient.", "نظرة عامة: البيانات، ومفتاح رسايل الواتساب التلقائية للمريض ده."),
    pa("patient-tab-xrays", "X-rays & photos.", "الأشعة والصور."),
    pa("patient-tab-prescriptions", "Prescriptions — print, or send on WhatsApp.", "الروشتات — اطبع، أو ابعت على واتساب."),
    pa("patient-tab-notes", "And notes.", "والملاحظات."),
  ],

  "patient-payment": [
    ck("patient-tab-finance", "The Finance tab.", "تاب الحسابات."),
    pt(l("Total Treatment", "إجمالي العلاج"), "Total treatment: everything charged.", "إجمالي العلاج: كل اللي اتحسب."),
    pt(l("Total Paid", "إجمالي المدفوع"), "Total paid.", "إجمالي المدفوع."),
    pt(l("Balance Due", "المبلغ المستحق"), "And the balance — charges minus payments, exactly.", "والرصيد — الرسوم ناقص المدفوعات، بالظبط."),
    pt(l("Transaction History", "سجل المعاملات"), "Every charge and payment, as rows: date, description, type, cost, paid.", "كل رسم ودفعة، كصفوف: التاريخ، الوصف، النوع، التكلفة، المدفوع.", "self"),
    pa("finance-add-payment", "Add payment is what I'll press now.", "إضافة دفعة هو اللي هضغطه دلوقتي."),
  ],

  appointments: [
    pt(l("Week", "أسبوع"), "Views: week…", "العرض: أسبوع…", "self"),
    pt(l("Day", "يوم"), "…day…", "…يوم…", "self"),
    pt(l("Doctors", "الدكاترة"), "…one column per doctor…", "…عمود لكل دكتور…", "self"),
    pt(l("List", "قائمة"), "…or a plain list.", "…أو قايمة عادية.", "self"),
    pt(l("Today", "اليوم"), "Arrows move the days; Today brings you back.", "الأسهم بتنقل الأيام؛ اليوم بيرجّعك.", "self"),
    pt(l("Filters", "تصفية"), "Filters: by status, doctor, room, or service.", "تصفية: بالحالة، الدكتور، الغرفة، أو الخدمة.", "self"),
    pa("appointment-add", "Add appointment — next stop.", "إضافة موعد — المحطة الجاية."),
    sy("Every appointment carries a colour: yellow unconfirmed, then confirmed, checked in, in chair, completed. Late and no-show have their own.", "كل موعد ليه لون: أصفر غير مؤكد، وبعدين مؤكد، وصل، على الكرسي، مكتمل. المتأخر واللي مجاش ليهم لون لوحدهم."),
  ],

  leads: [
    pt(l("This month", "هذا الشهر"), "How many asked this month…", "كام واحد سأل الشهر ده…"),
    pt(l("In the chair", "وصلوا للكرسي"), "…how many made it to the chair…", "…كام واحد وصل للكرسي…"),
    pt(l("Due today", "متابعة اليوم"), "…and who needs a reply today.", "…ومين محتاج رد النهارده."),
    pt(l("Active", "النشطة"), "Stages: new, contacted, booked, in the chair, lost.", "المراحل: جديد، تم التواصل، محجوز، أصبح مريض، مفقود.", "self"),
    pt(l("All sources", "كل المصادر"), "Filter by source, by who's handling it, by branch.", "فلتر بالمصدر، بالمسؤول، بالفرع.", "self"),
    pa("leads-add", "And add a lead the moment the phone rings.", "وضيف عميل محتمل أول ما التليفون يرن."),
    pa("leads-stage", "On each card, the stage is a dropdown — move them along as you chase.", "على كل كارت، المرحلة قايمة — نقّلهم وانت بتطارد.", "self"),
  ],

  /* ---------------------------------------------------------------- operations */
  finance: [
    pt(l("True net", "صافي العيادة"), "True net — the one number that matters: cash in, minus deductions, minus expenses.", "صافي العيادة — الرقم الوحيد اللي يهم: الكاش الداخل، ناقص الاستقطاعات، ناقص المصاريف."),
    pt(l("Cash in", "المتحصل"), "Cash in: payments actually received.", "المتحصل: الدفعات اللي اتقبضت فعلاً.", "self"),
    pt(l("Discounts", "الخصومات"), "Discounts given.", "الخصومات اللي اتدت.", "self"),
    pt(l("Commissions + lab", "عمولات + مختبر"), "Commissions and lab fees — taken out of the cash before it's yours.", "العمولات ومصاريف المعمل — بتتخصم من الكاش قبل ما يبقى بتاعك.", "self"),
    pt(l("Deductions", "استقطاعات"), "Deductions on their own card…", "الاستقطاعات في كارت لوحدها…"),
    pt(l("Expenses", "مصروفات"), "…and expenses you recorded by hand.", "…والمصاريف اللي سجلتها بإيدك."),
    pt(l("Daily", "يومي"), "Daily, monthly, or any range.", "يومي، شهري، أو أي فترة.", "self"),
    pa("finance-expense-btn", "Manual entry — an expense or other income.", "إدخال يدوي — مصروف أو دخل تاني."),
    pt(l("All doctors", "كل الأطباء"), "Filter the ledger to one doctor.", "فلتر الدفتر على دكتور واحد.", "self"),
    pt(l("PDF Report", "تقرير PDF"), "And export the period as a PDF.", "وصدّر الفترة PDF.", "self"),
    pt(l("Date", "التاريخ"), "The ledger itself. Date…", "الدفتر نفسه. التاريخ…", "self"),
    pt(l("Details", "التفاصيل"), "…details: the treatment, the doctor's name, and the doctor's percentage live in here…", "…التفاصيل: العلاج، اسم الدكتور، ونسبة الدكتور هنا…", "self"),
    pt(l("Patient", "المريض"), "…the patient…", "…المريض…", "self"),
    pt(l("Allocations", "إضافي"), "…allocations: the doctor's cut, the lab fee, and what the clinic keeps…", "…التوزيع: نصيب الدكتور، مصاريف المعمل، واللي العيادة بتاخده…", "self"),
    pt(l("Amount", "المبلغ"), "…and the amount.", "…والمبلغ.", "self"),
  ],

  inventory: [
    pt(l("Total Value", "إجمالي القيمة"), "What the stock is worth, and what was bought and used this period.", "المخزون يساوي كام، واتشرى واتستهلك كام في الفترة."),
    pt(l("Low stock", "أصناف منخفضة"), "Low stock: anything at or under its minimum.", "أصناف منخفضة: أي حاجة عند الحد الأدنى أو تحته."),
    pa("inventory-add", "Add an item — name, quantity, unit cost, minimum.", "ضيف صنف — الاسم، الكمية، تكلفة الوحدة، الحد الأدنى."),
    pt(l("Item", "الصنف"), "The list: item, category, stock, minimum, cost, value, status.", "القايمة: الصنف، التصنيف، المخزون، الحد الأدنى، التكلفة، القيمة، الحالة.", "self"),
    pt(l("Status", "حالة"), "Status turns amber when it's time to reorder.", "الحالة بتبقى برتقاني لما ييجي وقت الطلب.", "self"),
  ],

  store: [
    pt(l("Catalogue", "الكتالوج"), "The catalogue: search, filter by category, add to the basket.", "الكتالوج: دوّر، فلتر بالقسم، ضيف للسلة.", "self"),
    pt(l("Our orders", "طلباتنا"), "Our orders: everything you've ordered and its status.", "طلباتنا: كل اللي طلبته وحالته.", "self"),
    pt(l("Basket", "السلة"), "The basket — then send the order. You pay the driver in cash.", "السلة — وبعدين ابعت الطلب. بتدفع للمندوب كاش.", "self"),
  ],

  lab: [
    pt(l("Cases", "الحالات"), "Cases, or Money — what each lab is owed.", "الحالات، أو الحسابات — كل معمل ليه كام.", "self"),
    pt(l("Out at labs", "برّه في المعامل"), "Out at labs right now.", "برّه في المعامل دلوقتي."),
    pt(l("Past the promised date", "عدّى ميعادها"), "Overdue — past the promised date.", "متأخرة — عدّى ميعادها."),
    pt(l("Within seven days", "خلال ٧ أيام"), "Due this week.", "قرب ميعادها."),
    pt(l("Back — waiting for the patient", "وصلت ومستنية المريض"), "Back — needs a call and a fitting booked.", "وصلت — محتاجة مكالمة وحجز تركيب."),
    pt(l("Labs on file", "معامل مسجلة"), "Your labs come from Settings → Dental Labs.", "معاملك بتيجي من الإعدادات ← المعامل."),
    pt(l("Open cases", "الشغّالة"), "Filter by status or by lab.", "فلتر بالحالة أو بالمعمل.", "self"),
    pa("lab-new-order", "New lab order: patient, lab, work type, due date.", "أمر معمل جديد: المريض، المعمل، نوع الشغل، ميعاد التسليم."),
  ],

  attendance: [
    pt(l("My Tracker", "تعقبي"), "Your own sheet…", "ورقتك…", "self"),
    pt(l("Team Overview", "نظرة الفريق"), "…or the whole team, for admins.", "…أو الفريق كله، للمدير.", "self"),
    pt(l("Clock in", "تسجيل حضور"), "Clock in, clock out. From a phone it only counts inside the clinic's geofence.", "تسجيل حضور، تسجيل انصراف. من الموبايل بيتحسب بس جوّه نطاق العيادة.", "self"),
    pt(l("This month's earnings", "أرباح الشهر ده"), "Earnings: base pay plus commissions.", "الأرباح: الأساسي زائد العمولات."),
    pt(l("My time logs", "سجل حضوري"), "Every shift: in, out, total, status.", "كل شيفت: حضور، انصراف، الإجمالي، الحالة."),
    pt(l("Payroll", "المرتبات"), "Payroll: hours, overtime, base, commissions, net — per person.", "المرتبات: الساعات، الإضافي، الأساسي، العمولات، الصافي — لكل شخص."),
    pt(l("Where each commission came from", "كل عمولة جت منين"), "And where each commission came from: patient, treatment, paid, lab fee, doctor's cut, clinic keeps.", "وكل عمولة جت منين: المريض، العلاج، المدفوع، المعمل، نصيب الدكتور، نصيب العيادة."),
  ],

  /* ---------------------------------------------------------------- insights */
  intelligence: [
    pt(l("The Brief", "الملخص"), "The Brief: today's or this week's numbers written out.", "الملخص: أرقام النهارده أو الأسبوع مكتوبة.", "self"),
    pt(l("Messages", "الرسايل"), "Messages: what the system wrote and is waiting for you to send.", "الرسايل: اللي النظام كتبه ومستني تبعته.", "self"),
    pt(l("No-Shows", "غياب المرضى"), "No-shows: close out yesterday's unanswered appointments.", "الغياب: اقفل مواعيد امبارح اللي محدش جاوب عليها.", "self"),
    pt(l("The Bot", "البوت"), "The Bot: questions the WhatsApp assistant couldn't answer — teach it.", "البوت: أسئلة مساعد الواتساب معرفش يرد عليها — علّمه.", "self"),
    pt(l("Collected", "المحصّل"), "Collected, patients seen, still to come, missed, on the floor.", "المحصّل، مرضى اتشافوا، لسه جايين، فاتوا، في العيادة."),
    pt(l("Money", "الحسابات"), "Money: collected, expenses, net, how it was paid, where it went.", "الحسابات: المحصّل، المصاريف، الصافي، طريقة الدفع، راح فين."),
    pt(l("Production", "الإنتاج"), "Production: revenue per patient, chair time, busiest hour — and a table per doctor.", "الإنتاج: الإيراد لكل مريض، وقت الكرسي، أزحم ساعة — وجدول لكل دكتور."),
    pt(l("Needs someone to act", "يحتاج تدخّلاً"), "Needs someone to act: the list to work through before you leave.", "محتاج تدخّل: القايمة اللي تخلصها قبل ما تمشي."),
    pt(l("Growth", "النمو"), "Growth, stock, and what's coming up.", "النمو، المخزون، والجاي."),
    pt(l("Print PDF", "طباعة PDF"), "Print it as a PDF for the owner.", "اطبعه PDF لصاحب العيادة.", "self"),
  ],

  marketing: [
    pt(l("Marketing health", "صحة التسويق"), "Marketing health, and how many generations you've used this month.", "صحة التسويق، وكام توليد استخدمت الشهر ده.", "self"),
    pt(l("Create", "إنشاء"), "Create: posts and messages in your clinic's voice.", "إنشاء: بوستات ورسايل بصوت عيادتك.", "self"),
    pt(l("Campaigns", "الحملات"), "Campaigns: WhatsApp broadcasts to patient segments.", "الحملات: رسايل جماعية لشرائح مرضى.", "self"),
    pt(l("Cases", "الحالات"), "Cases: before-and-after into content, with consent.", "الحالات: قبل وبعد لمحتوى، بموافقة.", "self"),
    pt(l("Reviews", "التقييمات"), "Reviews: happy patients go to Google; unhappy ones get a call first.", "التقييمات: المبسوط يروح جوجل؛ الزعلان بياخد مكالمة الأول.", "self"),
    pt(l("Results", "النتائج"), "Results, Calendar, Library, Playbooks.", "النتائج، التقويم، المكتبة، خطط جاهزة.", "self"),
    pt(l("Content type", "نوع المحتوى"), "Pick a type, a language, a tone and a goal…", "اختار نوع، ولغة، وأسلوب، وهدف…"),
    pt(l("Generate 3 options", "توليد ٣ اختيارات"), "…and you get three options to choose from.", "…وبتاخد تلات اختيارات تختار منهم.", "self"),
  ],

  reports: [
    pa("reports-date-start", "Pick the period.", "اختار الفترة."),
    pt(l("Service Analysis", "تحليل الخدمات"), "Service Analysis — what you actually sell.", "تحليل الخدمات — انت بتبيع إيه فعلاً."),
    pt(l("Dentist Performance", "أداء الأطباء"), "Dentist Performance — patients, procedures, revenue, commission per dentist.", "أداء الأطباء — مرضى، إجراءات، إيراد، عمولة لكل دكتور."),
    pt(l("Patient Sources", "مصادر المرضى"), "Patient Sources — where they come from.", "مصادر المرضى — جايين منين."),
    pt(l("Marketing Funnel", "قمع التسويق"), "Marketing Funnel — from lead to chair.", "قمع التسويق — من العميل للكرسي."),
    pt(l("Clinic Overview", "نظرة عامة"), "Clinic Overview — income, deductions, expenses, net, new vs returning.", "نظرة عامة — الدخل، الاستقطاعات، المصاريف، الصافي، جديد ولا راجع."),
    pa("reports-export-pdf", "Every report exports to PDF.", "كل تقرير بيتصدّر PDF."),
  ],

  /* ---------------------------------------------------------------- settings */
  settings: [
    pa("settings-group-personal", "Personal: you.", "شخصي: انت."),
    pa("settings-group-clinic", "Clinic: hours, prices, labs, booking.", "العيادة: المواعيد، الأسعار، المعامل، الحجز."),
    pa("settings-group-people", "People: users, join requests, dentists.", "الفريق: المستخدمين، طلبات الانضمام، الأطباء."),
    pa("settings-group-system", "System & Automation: alerts, WhatsApp, SMS, logs, credits, the bin.", "النظام والأتمتة: التنبيهات، واتساب، SMS، السجل، الرصيد، المحذوفات."),
  ],
  "settings-general": [
    pt(l("You", "بياناتك"), "Your name, what people call you, your photo.", "اسمك، الناس بتناديك إيه، صورتك."),
    pt(l("How the clinic reaches you", "طرق التواصل معاك"), "Your phone and email.", "تليفونك وإيميلك."),
    pt(l("Set by your clinic", "العيادة هي اللي بتحددهم"), "Your role — set by an admin, not here.", "دورك — بيحدده المدير، مش من هنا."),
  ],
  "settings-appearance": [
    pt(l("Clinic Appearance", "مظهر العيادة"), "The clinic's colours.", "ألوان العيادة."),
    pt(l("Language Settings", "إعدادات اللغة"), "And the default language.", "واللغة الافتراضية."),
  ],
  "settings-interface": [
    pt(l("Where things open", "الحاجات بتفتح فين"), "Where things open: the booking form, and what sits beside the schedule.", "الحاجات بتفتح فين: فورم الحجز، واللي بيقعد جنب الجدول."),
    pt(l("The clinical note", "الملف السريري"), "How the clinical note is sorted and grouped.", "الملف السريري بيترتب ويتجمع إزاي."),
    pt(l("The appointments page", "صفحة المواعيد"), "Whether the calendar shows on phones, and the late-patient alert.", "التقويم يظهر على الموبايل ولا لأ، وتنبيه المريض المتأخر."),
    pt(l("Your home screen", "شاشتك الرئيسية"), "Your home screen: the desk, the owner's view, or the chair.", "شاشتك الرئيسية: المكتب، شاشة المالك، أو الكرسي."),
  ],
  "settings-clinic_profile": [
    pa("clinic-name", "The name, as it prints.", "الاسم، زي ما بيتطبع."),
    pa("clinic-logo", "The logo — top bar and every document.", "الشعار — الشريط اللي فوق وكل مستند."),
    pt(l("How patients reach you", "طرق التواصل"), "Phone, address, and the Google links the assistant uses.", "التليفون، العنوان، ولينكات جوجل اللي المساعد بيستخدمها."),
    pt(l("On printed documents", "في المستندات المطبوعة"), "What goes on printed documents.", "اللي بيتطبع على المستندات."),
    pa("clinic-save", "Save appears the moment you change anything.", "حفظ بيظهر أول ما تغيّر أي حاجة."),
  ],
  "settings-clinical": [
    pa("schedule-open-time", "Opening time…", "وقت الفتح…"),
    pt(l("Closing Time", "وقت الإغلاق"), "…closing time…", "…وقت الإغلاق…"),
    pa("schedule-slot-duration", "…and how long one appointment slot is.", "…ومدة الموعد الواحد."),
    pa("schedule-days-off", "The days you're closed — nothing can be booked on them.", "أيام القفل — مفيش حجز فيها."),
    pa("schedule-save", "Save. The calendar and the WhatsApp assistant follow this instantly.", "حفظ. التقويم ومساعد الواتساب بيمشوا عليه فوراً."),
  ],
  "settings-locations": [
    pt(l("Add branch", "إضافة فرع"), "Add a branch, then its rooms or chairs.", "ضيف فرع، وبعدين غرفه أو كراسيه.", "self"),
  ],
  "settings-labs": [
    pt(l("Add lab", "إضافة معمل"), "Add a lab: phone, WhatsApp, driver, usual turnaround, price list.", "ضيف معمل: التليفون، واتساب، المندوب، مدة الشغل المعتادة، قايمة الأسعار.", "self"),
  ],
  "settings-services": [
    pt(l("Treatments", "العلاجات"), "Treatments: the catalogue.", "العلاجات: الكتالوج.", "self"),
    pa("price-lists-tab", "Price lists: insurance, offers, a family rate.", "قوائم الأسعار: تأمين، عروض، سعر عائلة."),
    pt(l("Discounts", "الخصومات"), "Discounts: the reasons you require, and the ceiling for non-admins.", "الخصومات: الأسباب اللي بتطلبها، والحد الأقصى لغير المدير.", "self"),
    pt(l("All", "الكل"), "Categories filter the list.", "الفئات بتفلتر القايمة.", "self"),
    pa("price-add-service", "Add treatment — name, price, category.", "إضافة علاج — الاسم، السعر، الفئة."),
  ],
  "settings-prescriptions": [
    pt(l("Drug Database", "قاعدة بيانات الأدوية"), "The drug list prescriptions pick from.", "قايمة الأدوية اللي الروشتة بتختار منها."),
    pt(l("Add Drug", "إضافة دواء"), "Add your own.", "ضيف بتاعك.", "self"),
  ],
  "settings-visit_reasons": [pt(l("Reasons for visit", "أسباب الزيارة"), "Type a reason, add it, save.", "اكتب سبب، ضيفه، احفظ.")],
  "settings-sources": [pt(l("Patient sources", "مصادر المرضى"), "The channels a new patient can come from.", "القنوات اللي المريض الجديد ممكن ييجي منها.")],
  "settings-attendance": [
    pt(l("Attendance Geofencing", "نطاق الحضور الجغرافي"), "Pin the clinic, set the radius, save.", "ثبّت العيادة، حدد النطاق، احفظ."),
  ],
  "settings-online_booking": [
    pt(l("One link per channel", "لينك لكل قناة"), "One link per channel, so you know where each booking came from.", "لينك لكل قناة، عشان تعرف كل حجز جه منين."),
    pt(l("Cover image", "صورة الغلاف"), "A cover image for the public page.", "صورة غلاف للصفحة العامة."),
    pt(l("What the patient chooses", "المريض بيختار إيه"), "What the patient can pick: services, a doctor.", "المريض يقدر يختار إيه: الخدمات، الدكتور."),
  ],
  "settings-recall": [
    pt(l("Recall & Reactivation", "المتابعة وإعادة التفعيل"), "Months after a visit to recall, and when a patient counts as lapsed.", "بعد كام شهر من الزيارة نتابع، وإمتى المريض يتحسب بعيد."),
  ],
  "settings-users": [
    pt(l("Clinic ID", "معرّف العيادة"), "The clinic ID — staff use it to ask to join.", "معرّف العيادة — الموظف بيستخدمه عشان يطلب الانضمام.", "self"),
    pa("users-add", "Add a team member: name, email, first password, role.", "ضيف عضو: الاسم، الإيميل، باسورد أولي، الدور."),
    pa("invite-link", "Or make an invite link and send it on WhatsApp.", "أو اعمل لينك دعوة وابعته على واتساب."),
    pt(l("Manage Access", "إدارة الصلاحيات"), "Manage access on each person: the individual switches under their role.", "إدارة الصلاحيات لكل شخص: المفاتيح الفردية تحت دوره.", "self"),
  ],
  "settings-join_requests": [pt(l("Join Requests", "طلبات الانضمام"), "Approve with a role, or turn down.", "وافق بدور، أو ارفض.")],
  "settings-dentists": [pt(l("Their home screen", "الشاشة الرئيسية بتاعتهم"), "Whether dentists see their share of what their patients paid.", "الدكاترة يشوفوا نصيبهم من اللي مرضاهم دفعوه ولا لأ.")],
  "settings-notifications": [pt(l("In-App Clinical Alerts", "تنبيهات النظام الداخلي"), "Patient arrived, lab case received — who gets told.", "مريض وصل، حالة معمل وصلت — مين يتبلغ.")],
  "settings-whatsapp": [
    pt(l("Connection", "الاتصال"), "Connection: the number.", "الاتصال: الرقم.", "self"),
    pt(l("Assistant", "المساعد"), "Assistant: its name and persona.", "المساعد: اسمه وشخصيته.", "self"),
    pt(l("Ready answers", "الردود الجاهزة"), "Ready answers it uses first.", "الردود الجاهزة اللي بيستخدمها الأول.", "self"),
    pt(l("Try it", "جرّب البوت"), "Try it — a sandbox, no real patient.", "جرّب البوت — ملعب، من غير مريض حقيقي.", "self"),
    pt(l("Automations", "الرسائل التلقائية"), "Automations, wording, and owner alerts.", "الرسائل التلقائية، الصياغة، وتنبيهات المالك.", "self"),
  ],
  "settings-sms": [
    pt(l("Read this before turning it on", "اقرأ هذا قبل التفعيل"), "Read the cost warning first.", "اقرا تحذير التكلفة الأول."),
    pt(l("Opt-out line", "سطر إيقاف الرسائل"), "The opt-out line every SMS carries.", "سطر إيقاف الرسايل اللي كل SMS بيشيله."),
    pt(l("Sending phones", "الهواتف المُرسِلة"), "The phones that send.", "التليفونات اللي بتبعت."),
  ],
  "settings-logs": [
    pt(l("All Modules", "كل الوحدات"), "Filter by module, by who, by severity.", "فلتر بالوحدة، بمين، بالخطورة.", "self"),
    pt(l("Load older", "حمّل أقدم"), "And load older.", "وحمّل الأقدم.", "self"),
  ],
  "settings-ai_credits": [
    pt(l("Monthly limit", "الحد الشهري"), "Used, monthly limit, remaining.", "المستخدم، الحد الشهري، الباقي."),
    pt(l("Breakdown by feature", "حسب الميزة"), "What used them.", "إيه اللي استخدمهم."),
    pt(l("Usage log", "سجل الاستخدام"), "And every action, with who and for whom.", "وكل إجراء، بمين ولمين."),
  ],
  "settings-recently_deleted": [
    pt(l("All types", "كل الأنواع"), "Filter by type.", "فلتر بالنوع.", "self"),
    pt(l("Restore", "استعادة"), "Restore puts it back exactly as it was.", "الاستعادة بترجّعه زي ما كان بالظبط.", "self"),
  ],

  /* ---------------------------------------------------------------- wrap-up */
  help: [
    pt(l("Setting up your clinic", "تجهيز العيادة"), "Setting up — everything you do once.", "التجهيز — كل حاجة بتعملها مرة."),
    pt(l("Front desk", "الاستقبال"), "Front desk.", "الاستقبال."),
    pt(l("Money", "الحسابات"), "Money.", "الحسابات."),
    pt(l("Clinical", "السجل السريري"), "Clinical.", "السجل السريري."),
    pt(l("AI features", "مزايا الذكاء الاصطناعي"), "What the assistant does — and won't.", "المساعد بيعمل إيه — وإيه اللي مش هيعمله."),
    pt(l("When something looks wrong", "لما حاجة تبان غلط"), "And the questions people actually ask.", "والأسئلة اللي بتتسأل فعلاً."),
  ],
  "getting-started": [
    pa("tour-hero", "That's me — resume or restart from here.", "ده أنا — كمّل أو ابدأ من هنا."),
    pt(l("Open for business", "افتح العيادة"), "Four stages. Open for business…", "أربع مراحل. افتح العيادة…"),
    pt(l("Run a real day", "شغّل يوم حقيقي"), "…run a real day…", "…شغّل يوم حقيقي…"),
    pt(l("Get the money right", "ظبّط الفلوس"), "…get the money right…", "…ظبّط الفلوس…"),
    pt(l("Get more out of it", "استفيد أكتر"), "…get more out of it.", "…استفيد أكتر."),
    pt(l("Show me how", "وريني إزاي"), "Each step ticks itself when you actually do it. Show me how rings the real button.", "كل خطوة بتتشطب لما تعملها فعلاً. وريني إزاي بيحوّط الزرار الحقيقي.", "self"),
  ],
};
