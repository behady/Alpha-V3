// src/lib/tutorials.ts
/**
 * The lessons the assistant can teach by pointing at the real screen.
 *
 * Each tutorial is a sequence of steps; each step names a `[data-tour="…"]` anchor that exists in
 * the actual UI, and the overlay (components/TutorialOverlay.tsx) draws a pulsing ring on it. The
 * user advances by genuinely clicking the marked element — the tutorial never performs anything
 * itself, it only watches the user do it. Steps that point at a field to type into carry
 * `advanceOn: "next"`, because typing has no single click to observe.
 *
 * Kept as pure data with no client imports so the API route can read it too: the server builds
 * the `start_tutorial` tool's id list from this file, which is what keeps the model's menu and
 * the overlay's abilities from drifting apart.
 *
 * Realities of the DOM these steps point into, learned the hard way and worth keeping in mind:
 *  - The desktop rail and the mobile nav are BOTH always in the DOM (CSS hides one), so the same
 *    `nav-*` value appears on several elements. The overlay picks the visible match by rect.
 *  - Anchors inside modals/forms exist only after the opening click; the overlay polls for them.
 *  - Permission gates can remove an anchor entirely (e.g. patients.add). Navigation steps are
 *    `optional`, so a missing sidebar link skips to the next step, whose `route` navigates
 *    directly; in-page anchors that stay missing show an honest Skip instead of hanging.
 */

export interface TutorialStep {
  /** Route this step lives on. The overlay navigates there when the step begins, if needed. */
  route?: string;
  /** `[data-tour="…"]` value to ring. */
  anchor: string;
  text: { en: string; ar: string };
  /** "click" (default): advances when the anchored element is clicked. "next": shows a button. */
  advanceOn?: "click" | "next";
  /** Auto-skip (not fail) if the anchor cannot be found quickly — for permission-gated steps. */
  optional?: boolean;
  /** Skip this step outright when already on this route — for "open the page" nav steps. */
  skipIfRoute?: string;
}

export interface Tutorial {
  id: string;
  title: { en: string; ar: string };
  /** One line, shown on the widget's lesson menu and given to the model to pick by. */
  description: { en: string; ar: string };
  steps: TutorialStep[];
}

export const TUTORIALS: Tutorial[] = [
  {
    id: "add-patient",
    title: { en: "Add a new patient", ar: "إضافة مريض جديد" },
    description: {
      en: "Create a patient file: open Patients, press New Patient, fill the form, save.",
      ar: "إنشاء ملف مريض: افتح صفحة المرضى، اضغط مريض جديد، املأ البيانات، احفظ.",
    },
    steps: [
      {
        anchor: "nav-patients",
        skipIfRoute: "/patients",
        optional: true,
        text: {
          en: "This is the Patients page — click it to see everyone registered at the clinic.",
          ar: "دي صفحة المرضى — اضغط عليها عشان تشوف كل المسجلين في العيادة.",
        },
      },
      {
        route: "/patients",
        anchor: "patients-add",
        text: {
          en: "Click the New Patient button to open the registration form.",
          ar: "اضغط زرار مريض جديد عشان تفتح استمارة التسجيل.",
        },
      },
      {
        anchor: "new-patient-name",
        advanceOn: "next",
        text: {
          en: "Type the patient's full name here, and their phone number below it. Name and phone are the two required fields.",
          ar: "اكتب اسم المريض بالكامل هنا، ورقم تليفونه تحته. الاسم والتليفون هما المطلوبان.",
        },
      },
      {
        anchor: "new-patient-save",
        text: {
          en: "Press Create Patient File — and that's it, the patient is saved.",
          ar: "اضغط إنشاء ملف المريض — وخلاص، المريض اتسجل.",
        },
      },
    ],
  },
  {
    id: "book-appointment",
    title: { en: "Book an appointment", ar: "حجز موعد" },
    description: {
      en: "Book a visit: open Appointments, press Add Appointment, pick patient, dentist and time, confirm.",
      ar: "حجز زيارة: افتح المواعيد، اضغط إضافة موعد، اختار المريض والدكتور والوقت، أكّد.",
    },
    steps: [
      {
        anchor: "nav-appointments",
        skipIfRoute: "/appointments",
        optional: true,
        text: {
          en: "This is the Appointments page — the clinic's schedule lives here. Click it.",
          ar: "دي صفحة المواعيد — جدول العيادة كله هنا. اضغط عليها.",
        },
      },
      {
        route: "/appointments",
        anchor: "appointment-add",
        text: {
          en: "Click Add Appointment to start a new booking. (Tip: clicking any empty slot in the calendar books that exact time.)",
          ar: "اضغط إضافة موعد عشان تبدأ حجز جديد. (معلومة: لو ضغطت على أي خانة فاضية في الجدول بيتحجز الوقت ده على طول.)",
        },
      },
      {
        anchor: "booking-patient",
        advanceOn: "next",
        text: {
          en: "Search for the patient here by name or phone, then pick them from the list.",
          ar: "دوّر على المريض هنا بالاسم أو التليفون، وبعدين اختاره من القايمة.",
        },
      },
      {
        anchor: "booking-doctor",
        advanceOn: "next",
        text: {
          en: "Choose which dentist will see them, and set the date and time next to it.",
          ar: "اختار الدكتور اللي هيكشف، وظبط التاريخ والوقت اللي جنبه.",
        },
      },
      {
        anchor: "booking-confirm",
        text: {
          en: "Press Confirm booking. The button stays grey until patient, dentist, date and time are all set.",
          ar: "اضغط تأكيد الحجز. الزرار هيفضل رمادي لحد ما المريض والدكتور والتاريخ والوقت يتظبطوا كلهم.",
        },
      },
    ],
  },
  {
    id: "record-payment",
    title: { en: "Record a payment", ar: "تسجيل دفعة" },
    description: {
      en: "Take money from a patient: open their file, go to the Finance tab, press Add Payment, enter the amount, confirm.",
      ar: "استلام فلوس من مريض: افتح ملفه، ادخل على تبويب المالية، اضغط إضافة دفعة، اكتب المبلغ، أكّد.",
    },
    steps: [
      {
        anchor: "nav-patients",
        skipIfRoute: "/patients",
        optional: true,
        text: {
          en: "Payments live inside the patient's own file. Click Patients first.",
          ar: "الدفعات بتتسجل جوّه ملف المريض نفسه. اضغط المرضى الأول.",
        },
      },
      {
        route: "/patients",
        anchor: "patient-row",
        text: {
          en: "Click a patient's card to open their file. (For this lesson, any patient works.)",
          ar: "اضغط على كارت أي مريض عشان تفتح ملفه. (للدرس ده أي مريض ينفع.)",
        },
      },
      {
        anchor: "patient-tab-finance",
        text: {
          en: "This is the Finance tab — everything they owe and everything they've paid. Click it.",
          ar: "ده تبويب المالية — كل اللي عليه وكل اللي دفعه. اضغط عليه.",
        },
      },
      {
        anchor: "finance-add-payment",
        text: {
          en: "Click Add Payment to open the payment form.",
          ar: "اضغط إضافة دفعة عشان تفتح استمارة الدفع.",
        },
      },
      {
        anchor: "finance-pay-amount",
        advanceOn: "next",
        text: {
          en: "Type the amount received. Linking it to a procedure above fills the remaining balance for you.",
          ar: "اكتب المبلغ المستلم. لو ربطته بإجراء من فوق، المتبقي بيتكتب لوحده.",
        },
      },
      {
        anchor: "finance-pay-confirm",
        text: {
          en: "Press Confirm — the payment lands in the patient's ledger and the clinic's finance page together.",
          ar: "اضغط تأكيد — الدفعة بتتسجل في حساب المريض وفي مالية العيادة مع بعض.",
        },
      },
    ],
  },
  {
    id: "add-inventory-item",
    title: { en: "Add an inventory item", ar: "إضافة صنف للمخزون" },
    description: {
      en: "Stock a new material: open Inventory, press Add Item, name it, save.",
      ar: "تسجيل خامة جديدة: افتح المخزون، اضغط إضافة صنف، اكتب اسمه، احفظ.",
    },
    steps: [
      {
        route: "/inventory",
        anchor: "inventory-add",
        text: {
          en: "Click Add Item — it scrolls you down to the item form at the bottom of the page.",
          ar: "اضغط إضافة صنف — هينزلك على استمارة الصنف في آخر الصفحة.",
        },
      },
      {
        anchor: "inventory-item-name",
        advanceOn: "next",
        text: {
          en: "Type the item's name, and set its stock count and minimum level next to it — the minimum is what triggers the low-stock warning.",
          ar: "اكتب اسم الصنف، وظبط الكمية والحد الأدنى اللي جنبه — الحد الأدنى هو اللي بيطلع تنبيه النقص.",
        },
      },
      {
        anchor: "inventory-save",
        text: {
          en: "Press Save, and the item joins your stock list.",
          ar: "اضغط حفظ، والصنف هيتضاف لقايمة المخزون.",
        },
      },
    ],
  },
  {
    id: "find-patient",
    title: { en: "Find a patient fast", ar: "الوصول لمريض بسرعة" },
    description: {
      en: "Search the patient directory by name or phone number.",
      ar: "البحث في سجل المرضى بالاسم أو رقم التليفون.",
    },
    steps: [
      {
        anchor: "nav-patients",
        skipIfRoute: "/patients",
        optional: true,
        text: {
          en: "Click Patients to open the directory.",
          ar: "اضغط المرضى عشان تفتح السجل.",
        },
      },
      {
        route: "/patients",
        anchor: "patients-search",
        advanceOn: "next",
        text: {
          en: "Type a name or any part of a phone number here — the list filters as you type. Clicking a card opens that patient's full file.",
          ar: "اكتب اسم أو أي جزء من رقم تليفون هنا — القايمة بتتصفّى وأنت بتكتب. والضغط على أي كارت بيفتح ملف المريض كامل.",
        },
      },
    ],
  },
  {
    id: "record-treatment",
    title: { en: "Record a treatment", ar: "تسجيل علاج (إجراء)" },
    description: {
      en: "Log a procedure on a patient's clinical file — this also posts its charge to their balance.",
      ar: "تسجيل إجراء في الملف الإكلينيكي للمريض — وده كمان بيسجّل تكلفته على حسابه.",
    },
    steps: [
      {
        anchor: "nav-patients",
        skipIfRoute: "/patients",
        optional: true,
        text: {
          en: "Treatments are recorded inside the patient's file. Click Patients first.",
          ar: "العلاج بيتسجل جوّه ملف المريض. اضغط المرضى الأول.",
        },
      },
      {
        route: "/patients",
        anchor: "patient-row",
        text: {
          en: "Open the patient's file — click their card.",
          ar: "افتح ملف المريض — اضغط على الكارت بتاعه.",
        },
      },
      {
        anchor: "patient-tab-clinical",
        optional: true,
        text: {
          en: "This is the Clinical tab — the patient's dental history. It's usually already open; click it if not.",
          ar: "ده التبويب الإكلينيكي — تاريخ أسنان المريض. غالباً بيكون مفتوح؛ لو مش مفتوح اضغطه.",
        },
      },
      {
        anchor: "clinical-add-procedure",
        text: {
          en: "Click Add New Procedure. On a computer this brings you to the treatment form (you can tap teeth on the chart first); on a phone it opens the editor.",
          ar: "اضغط إضافة إجراء جديد. على الكمبيوتر هيوصلك لاستمارة العلاج (وممكن تختار الأسنان من الرسمة الأول)؛ على الموبايل هيفتح المحرر.",
        },
      },
      {
        anchor: "clinical-procedure-name",
        advanceOn: "next",
        text: {
          en: "Type or pick the treatment here. Choosing one from the price list fills the cost automatically — that's what keeps the balance right and the reports countable.",
          ar: "اكتب أو اختار العلاج هنا. لو اخترته من قايمة الأسعار التكلفة بتتكتب لوحدها — وده اللي بيخلي الحساب مظبوط والتقارير تعرف تعدّ.",
        },
      },
      {
        anchor: "clinical-save",
        text: {
          en: "Press Log Procedure — the note and its charge are saved together, and the entry appears in the timeline.",
          ar: "اضغط تسجيل الإجراء — الملاحظة وتكلفتها بيتسجلوا مع بعض، والإجراء بيظهر في السجل.",
        },
      },
    ],
  },
  {
    id: "write-prescription",
    title: { en: "Write a prescription", ar: "كتابة روشتة" },
    description: {
      en: "Open the prescription studio from a patient's file, add medicines, save and print.",
      ar: "فتح استوديو الروشتة من ملف المريض، إضافة الأدوية، الحفظ والطباعة.",
    },
    steps: [
      {
        anchor: "nav-patients",
        skipIfRoute: "/patients",
        optional: true,
        text: {
          en: "A prescription starts from the patient's file. Click Patients.",
          ar: "الروشتة بتبدأ من ملف المريض. اضغط المرضى.",
        },
      },
      {
        route: "/patients",
        anchor: "patient-row",
        text: {
          en: "Open the patient's file — click their card.",
          ar: "افتح ملف المريض — اضغط على الكارت بتاعه.",
        },
      },
      {
        anchor: "rx-open",
        text: {
          en: "Click Write Rx in the Quick Actions bar — it opens the Prescription Studio.",
          ar: "اضغط كتابة روشتة في شريط الإجراءات السريعة — هيفتح استوديو الروشتة.",
        },
      },
      {
        anchor: "rx-drug-name",
        advanceOn: "next",
        text: {
          en: "Type the medicine's name here (and the dose next to it). Or pick a saved one from the dropdown above — it fills these fields for you.",
          ar: "اكتب اسم الدوا هنا (والجرعة اللي جنبه). أو اختار دوا محفوظ من القايمة اللي فوق — بيملى الخانات لوحده.",
        },
      },
      {
        anchor: "rx-add-drug",
        text: {
          en: "Click Add to Prescription — the medicine lands on the printable preview. Repeat for each medicine.",
          ar: "اضغط أضِف للروشتة — الدوا هيظهر في المعاينة اللي بتتطبع. كرر لكل دوا.",
        },
      },
      {
        anchor: "rx-save",
        text: {
          en: "Press Save to keep it in the patient's history. Printing alone does NOT save — save first, then print.",
          ar: "اضغط حفظ عشان تتسجل في تاريخ المريض. الطباعة لوحدها مش بتحفظ — احفظ الأول وبعدين اطبع.",
        },
      },
    ],
  },
  {
    id: "add-expense",
    title: { en: "Record a clinic expense", ar: "تسجيل مصروف للعيادة" },
    description: {
      en: "Log money the clinic spent (rent, supplies, a bill) so the finance page shows true profit.",
      ar: "تسجيل فلوس صرفتها العيادة (إيجار، خامات، فاتورة) عشان صفحة المالية تطلع الربح الحقيقي.",
    },
    steps: [
      {
        route: "/finance",
        anchor: "finance-expense-btn",
        text: {
          en: "This is the Finance page. Click the green Manual entry button (just a + on phones) to record money in or out.",
          ar: "دي صفحة المالية. اضغط الزرار الأخضر إدخال يدوي (علامة + على الموبايل) عشان تسجل فلوس داخلة أو خارجة.",
        },
      },
      {
        anchor: "finance-type-expense",
        text: {
          en: "Make sure Expense is selected — this tab decides whether the money counts as spending or income.",
          ar: "اتأكد إن مصروف هي المختارة — التبويب ده بيحدد الفلوس دي تتحسب صرف ولا دخل.",
        },
      },
      {
        anchor: "finance-expense-desc",
        advanceOn: "next",
        text: {
          en: "Describe what the money was spent on, and type the amount next to it. The date is already today's.",
          ar: "اكتب الفلوس اتصرفت على إيه، والمبلغ في الخانة اللي جنبه. التاريخ متسجل النهارده تلقائياً.",
        },
      },
      {
        anchor: "finance-expense-save",
        text: {
          en: "Press Save — the expense joins the ledger and the profit figures update.",
          ar: "اضغط حفظ — المصروف هيتسجل في الدفتر وأرقام الربح هتتحدث.",
        },
      },
    ],
  },
  {
    id: "handle-lead",
    title: { en: "Handle a new inquiry (lead)", ar: "التعامل مع استفسار جديد (عميل محتمل)" },
    description: {
      en: "Save a person who asked about the clinic as a lead, and track them until they become a patient.",
      ar: "تسجيل حد سأل عن العيادة كعميل محتمل، ومتابعته لحد ما يبقى مريض.",
    },
    steps: [
      {
        route: "/leads",
        anchor: "leads-add",
        text: {
          en: "This is the Leads page — everyone who asked but hasn't booked yet. Click Add lead to save a new inquiry.",
          ar: "دي صفحة العملاء المحتملين — كل اللي سألوا ولسه محجزوش. اضغط إضافة عميل عشان تسجل استفسار جديد.",
        },
      },
      {
        anchor: "leads-name",
        advanceOn: "next",
        text: {
          en: "Type their name and phone number — that's all a lead needs to start.",
          ar: "اكتب الاسم ورقم التليفون — ده كل اللي العميل المحتمل محتاجه في الأول.",
        },
      },
      {
        anchor: "leads-save",
        text: {
          en: "Press Save — the lead appears as a card with a timer showing how long they've been waiting for a reply.",
          ar: "اضغط حفظ — العميل هيظهر ككارت وعليه عدّاد بيقول مستني رد بقاله قد إيه.",
        },
      },
      {
        anchor: "leads-stage",
        advanceOn: "next",
        text: {
          en: "This dropdown tracks the lead's stage — new, contacted, booked… When they decide to come, the teal person button on the card turns them into a real patient file in one tap.",
          ar: "القايمة دي بتتابع مرحلة العميل — جديد، تم التواصل، حجز… ولما يقرر ييجي، زرار الشخص التركوازي على الكارت بيحوّله لملف مريض حقيقي بضغطة واحدة.",
        },
      },
    ],
  },
  {
    id: "set-working-hours",
    title: { en: "Set the clinic's working hours", ar: "ضبط مواعيد عمل العيادة" },
    description: {
      en: "Tell the system when the clinic opens, closes and rests — the assistant's slot suggestions depend on this. Admins only.",
      ar: "عرّف النظام العيادة بتفتح وتقفل امتى وأجازتها امتى — اقتراحات المواعيد بتعتمد على ده. للمدير فقط.",
    },
    steps: [
      {
        route: "/settings",
        anchor: "settings-tab-schedule",
        text: {
          en: "In Settings, click Schedule (under Clinic Management). On a phone, open the sections menu at the top first — the ring will find it.",
          ar: "في الإعدادات، اضغط الجدول (تحت إدارة العيادة). على الموبايل افتح قايمة الأقسام اللي فوق الأول — الدايرة هتلاقيه.",
        },
      },
      {
        anchor: "schedule-open-time",
        advanceOn: "next",
        text: {
          en: "Set the opening time here, and the closing time next to it.",
          ar: "ظبط معاد الفتح هنا، ومعاد القفل في الخانة اللي جنبه.",
        },
      },
      {
        anchor: "schedule-slot-duration",
        advanceOn: "next",
        text: {
          en: "Pick the appointment slot length — this is the grid the calendar and the assistant's suggestions use.",
          ar: "اختار مدة الموعد — دي الشبكة اللي التقويم واقتراحات المساعد بيمشوا عليها.",
        },
      },
      {
        anchor: "schedule-days-off",
        advanceOn: "next",
        text: {
          en: "Tap the days the clinic is closed — they turn red. The assistant will never suggest times on these days.",
          ar: "اضغط على أيام الأجازة — بتتلون أحمر. المساعد عمره ما هيقترح مواعيد في الأيام دي.",
        },
      },
      {
        anchor: "schedule-save",
        text: {
          en: "Press Save Schedule. Until this is saved, availability answers are partly guessed — the assistant even says so.",
          ar: "اضغط حفظ الجدول. من غير الحفظ ده، إجابات المواعيد المتاحة بتبقى تخمين جزئي — والمساعد نفسه بيقول كده.",
        },
      },
    ],
  },
  {
    id: "explore-reports",
    title: { en: "Read the reports", ar: "قراءة التقارير" },
    description: {
      en: "Open the Reports Center, pick a report type and a date range, and export a PDF.",
      ar: "فتح مركز التقارير، اختيار نوع التقرير والفترة، وتصدير PDF.",
    },
    steps: [
      {
        anchor: "nav-reports",
        skipIfRoute: "/reports",
        optional: true,
        text: {
          en: "Click Reports to open the Reports Center.",
          ar: "اضغط التقارير عشان تفتح مركز التقارير.",
        },
      },
      {
        route: "/reports",
        anchor: "reports-tabs",
        advanceOn: "next",
        text: {
          en: "Five reports live here — services, dentist performance, patient sources, leads, and the clinic overview. Service Analysis is already open below.",
          ar: "هنا خمس تقارير — الخدمات، أداء الأطباء، مصادر المرضى، العملاء المحتملين، ونظرة عامة على العيادة. تحليل الخدمات مفتوح تحت أهو.",
        },
      },
      {
        anchor: "reports-date-start",
        advanceOn: "next",
        text: {
          en: "Set the From and To dates here — the numbers reload by themselves the moment you change either.",
          ar: "ظبط تاريخ البداية والنهاية هنا — الأرقام بتتحدث لوحدها أول ما تغيّر أي تاريخ.",
        },
      },
      {
        anchor: "reports-export-pdf",
        optional: true,
        text: {
          en: "Click PDF to export the report you're looking at — each report has its own export buttons.",
          ar: "اضغط PDF عشان تصدّر التقرير اللي قدامك — كل تقرير ليه أزرار تصدير خاصة بيه.",
        },
      },
    ],
  },
];

/** Quick lookup used by the widget menu and the server's id validation. */
export const TUTORIAL_IDS = TUTORIALS.map((t) => t.id);
