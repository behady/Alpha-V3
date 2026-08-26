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
];

/** Quick lookup used by the widget menu and the server's id validation. */
export const TUTORIAL_IDS = TUTORIALS.map((t) => t.id);
