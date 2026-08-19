/**
 * Single source of truth for assignable permission keys.
 * IDs must match exactly what PermissionGuard / Protect / layout checks expect.
 */

export type PermissionCatalogItem = {
  id: string;
  labelEn: string;
  labelAr: string;
  /** Short tooltip for admins */
  hintEn?: string;
  hintAr?: string;
};

export type PermissionCatalogGroup = {
  id: string;
  titleEn: string;
  titleAr: string;
  descriptionEn?: string;
  descriptionAr?: string;
  items: PermissionCatalogItem[];
};

export const PERMISSIONS_CATALOG: PermissionCatalogGroup[] = [
  {
    id: "nav_pages",
    titleEn: "Module access (pages)",
    titleAr: "الوصول للصفحات",
    descriptionEn: "Opens the main module. Usually pair with action permissions below.",
    descriptionAr: "يفتح الوحدة الرئيسية. غالباً مع صلاحيات الإجراءات أدناه.",
    items: [
      { id: "access.patients", labelEn: "Patients", labelAr: "المرضى" },
      { id: "access.appointments", labelEn: "Appointments / calendar", labelAr: "المواعيد / التقويم" },
      { id: "access.lab", labelEn: "Lab tracking", labelAr: "متابعة المعامل" },
      { id: "access.finance", labelEn: "Finance / ledger", labelAr: "المالية / السجل" },
      { id: "access.inventory", labelEn: "Inventory", labelAr: "المخزون" },
      { id: "access.reports", labelEn: "Reports", labelAr: "التقارير" },
      {
        id: "access.marketing",
        labelEn: "Marketing studio",
        labelAr: "استوديو التسويق",
        hintEn: "Only matters for clinics with the Marketing add-on. Admins always see it.",
        hintAr: "تعمل فقط للعيادات المشتركة في إضافة التسويق. المديرون يرونها دائماً.",
      },
      { id: "access.settings", labelEn: "Settings (full page)", labelAr: "الإعدادات (الصفحة)" },
      {
        id: "access.clinical",
        labelEn: "Clinical chart (inside patient)",
        labelAr: "السجل السريري (داخل المريض)",
        hintEn: "Dentists always see chart by role; this extends access to other roles.",
        hintAr: "أطباء الأسنان يرون السجل حسب الدور؛ هذه الصلاحية تمتد للأدوار الأخرى.",
      },
      {
        id: "access.ortho",
        labelEn: "Orthodontic module",
        labelAr: "وحدة التقويم",
        hintEn: "Dentists always see ortho by role; this extends access to other roles.",
        hintAr: "أطباء الأسنان يرون التقويم حسب الدور؛ هذه الصلاحية تمتد للأدوار الأخرى.",
      },
    ],
  },
  {
    id: "sidebar_misc",
    titleEn: "Navigation extras",
    titleAr: "إضافات القائمة",
    descriptionEn: "Keys used by the sidebar layout (not the same as access.settings).",
    descriptionAr: "مفاتيح تستخدم في شريط الجانب (ليست نفس access.settings).",
    items: [
      {
        id: "settings",
        labelEn: "Settings link (sidebar)",
        labelAr: "رابط الإعدادات (القائمة)",
        hintEn: "Shows the Settings item in the left menu. access.settings still gates the page.",
        hintAr: "يظهر عنصر الإعدادات في القائمة. access.settings ما زالت تتحكم بالصفحة.",
      },
    ],
  },
  {
    id: "patients",
    titleEn: "Patients — actions",
    titleAr: "المرضى — إجراءات",
    items: [
      { id: "patients.add", labelEn: "Add patients", labelAr: "إضافة مرضى" },
      { 
        id: "patients.edit", 
        labelEn: "Edit patients", 
        labelAr: "تعديل المرضى",
        hintEn: "Allows editing of existing patient profile details.",
        hintAr: "يسمح بتعديل بيانات المريض الحالية."
      },
      {
        id: "patients.delete",
        labelEn: "Delete patients",
        labelAr: "حذف مرضى",
        hintEn: "Reserved for delete flows; combine with care.",
        hintAr: "محجوزة لمسارات الحذف؛ استخدم بحذر.",
      },
    ],
  },
  {
    id: "appointments",
    titleEn: "Appointments — actions",
    titleAr: "المواعيد — إجراءات",
    items: [
      { id: "appointments.add", labelEn: "Book / create appointments", labelAr: "حجز / إنشاء مواعيد" },
      {
        id: "appointments.edit",
        labelEn: "Edit / reschedule appointments",
        labelAr: "تعديل / إعادة جدولة المواعيد",
        hintEn: "Allows modifying or rescheduling existing appointments.",
        hintAr: "يسمح بتعديل أو إعادة جدولة المواعيد الحالية."
      },
      {
        id: "appointments.delete",
        labelEn: "Delete appointments",
        labelAr: "حذف مواعيد",
        hintEn: "Reserved for delete flows where enforced.",
        hintAr: "محجوزة حيث يُطبَّق الحذف.",
      },
    ],
  },
  {
    id: "finance",
    titleEn: "Finance — actions",
    titleAr: "المالية — إجراءات",
    items: [
      { id: "finance.add", labelEn: "Add transactions / charges", labelAr: "إضافة معاملات / رسوم" },
      { id: "finance.edit", labelEn: "Edit transactions", labelAr: "تعديل المعاملات" },
      { id: "finance.delete", labelEn: "Delete transactions", labelAr: "حذف المعاملات" },
    ],
  },
  {
    id: "inventory",
    titleEn: "Inventory — actions",
    titleAr: "المخزون — إجراءات",
    items: [
      { id: "inventory.add", labelEn: "Add inventory items", labelAr: "إضافة أصناف" },
      { id: "inventory.edit", labelEn: "Edit inventory", labelAr: "تعديل المخزون" },
      { id: "inventory.delete", labelEn: "Delete inventory", labelAr: "حذف من المخزون" },
    ],
  },
  {
    id: "attendance",
    titleEn: "Attendance",
    titleAr: "الحضور والانصراف",
    items: [
      {
        id: "attendance.admin",
        labelEn: "Attendance admin (team view)",
        labelAr: "إدارة الحضور (عرض الفريق)",
        hintEn: "Same as access.settings in code path for admin tools on attendance page.",
        hintAr: "مسار الكود يسمح أيضاً بـ access.settings لأدوات الإدارة.",
      },
    ],
  },
  {
    id: "clinical",
    titleEn: "Clinical Chart — actions",
    titleAr: "السجل السريري — إجراءات",
    items: [
      {
        id: "clinical.edit",
        labelEn: "Edit clinical notes",
        labelAr: "تعديل السجلات السريرية",
        hintEn: "Allows editing existing clinical notes and procedures.",
        hintAr: "يسمح بتعديل السجلات والإجراءات السريرية الموجودة."
      },
      {
        id: "clinical.delete",
        labelEn: "Delete clinical notes",
        labelAr: "حذف السجلات السريرية",
        hintEn: "Allows deleting existing clinical notes and procedures.",
        hintAr: "يسمح بحذف السجلات والإجراءات السريرية الموجودة."
      }
    ],
  },

  {
    id: "reports_actions",
    titleEn: "Reports — actions",
    titleAr: "التقارير — إجراءات",
    items: [
      {
        id: "reports.export",
        labelEn: "Export / download reports",
        labelAr: "تصدير / تحميل التقارير",
        hintEn: "Allows exporting data to PDF or Excel files.",
        hintAr: "يسمح بتصدير البيانات إلى ملفات PDF أو Excel."
      }
    ],
  }
];

export function getAllPermissionIds(): string[] {
  return PERMISSIONS_CATALOG.flatMap((g) => g.items.map((i) => i.id));
}
