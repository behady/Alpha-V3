"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';

type Language = 'en' | 'ar';

const translations = {
  en: {
    // --- NAVIGATION ---
    dashboard: "Dashboard",
    patients: "Patients",
    appointments: "Appointments",
    lab: "Lab Tracking",
    inventory: "Inventory",
    finance: "Finance",
    reports: "Reports",
    settings: "Settings",
    admin: "Admin Account",
    logout: "Logout",
    changeLang: "Change Language",
    
    // --- COMMON ---
    From: "From",
    To: "To",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    edit: "Edit",
    search: "Search",
    syncing: "Syncing...",
    loading: "Loading...",
    noData: "No data found",
    all: "All",
    
    // --- DASHBOARD ---
    goodMorning: "Good Morning",
    dailyBriefing: "Here is what’s happening in your clinic today.",
    patientsScheduled: "Appointments Scheduled",
    revenueCollected: "EGP Revenue Collected",
    lowStockItems: "Low Stock Items",
    today: "Today",
    thisMonth: "This Month",
    actionNeeded: "Action Needed",
    todaysSchedule: "Today's Schedule",
    viewCalendar: "View Calendar",
    noApptsToday: "No appointments today",
    enjoyTime: "Enjoy your free time!",
    timeLabel: "Time",
    consultation: "Consultation",
    inventoryWarnings: "Inventory Warnings",
    stockHealthy: "Stock levels are healthy!",
    onlyLeft: "Only",
    left: "left",
    order: "Order",
    viewMore: "View more items...",
    quickActions: "Quick Actions",
    addPatient: "Add Patient",
    bookVisit: "Book Visit",
    checkStock: "Check Stock",
    recordPay: "Record Pay",

    // --- APPOINTMENTS ---
    apptTitle: "Appointments",
    newAppt: "New Appt",
    noAppts: "No appointments",
    deleteApptConfirm: "Delete this appointment?",
    updateError: "Failed to update details.",
    moveError: "Failed to move appointment",
    statusScheduled: "Scheduled",
    statusConfirmed: "Confirmed",
    statusCheckedIn: "Checked In",
    statusInChair: "In Chair",
    statusCompleted: "Completed",
    statusCancelled: "Cancelled",

    // --- FINANCE ---
    newTransaction: "New Transaction",
    totalIncome: "Total Income",
    expenses: "Expenses",
    netProfit: "Net Profit",
    totalPay: "Total Pay",
    transactions: "Transactions",
    description: "Description",
    category: "Category",
    method: "Method",
    commValue: "Comm Value",
    saveFailed: "Save Failed: ",
    deleteConfirm: "Delete this record?",

    // --- SETTINGS ---
    settingsTitle: "Clinic Settings",
    settingsSubtitle: "Manage your team, pricing, and app appearance.",
    tabTeam: "Team",
    tabPrices: "Prices",
    tabTheme: "Theme",
    addMember: "Add Member",
    fullName: "Full Name",
    role: "Role",
    dentist: "Dentist",
    assistant: "Assistant",
    receptionist: "Receptionist",
    commission: "Commission %",
    salary: "Base Salary",
    saveMember: "Save Member",
    addTreatment: "Add Treatment",
    treatmentName: "Treatment Name",
    priceClient: "Price (Client)",
    labCost: "Lab Cost (Deduct)",
    addToList: "Add to List",
    appTheme: "App Theme",
    chooseTheme: "Choose a dominant color for your dashboard.",
    labFeeDeducted: "Lab Fee Deducted",

    // --- INVENTORY ---
    invTitle: "Inventory Manager",
    invSubtitle: "Track stock levels, set alerts, and export reports.",
    btnReports: "Reports",
    btnCategories: "Categories",
    exportHistory: "Export History (CSV)",
    printStock: "Print Stock List",
    downloadCsv: "Download CSV",
    print: "Print",
    manageCats: "Manage Categories",
    newCatPlace: "New Category Name...",
    addItem: "Add Material",
    editItem: "Edit Material",
    productName: "Product Name",
    stockCount: "Stock Count",
    lowAlert: "Low Alert",
    priceUnit: "Price (Unit)",
    unit: "Unit",
    updateMaterial: "Update Material",
    addMaterial: "Add to Inventory",
    totalValue: "Total Value",
    searchInv: "Search inventory...",
    invReportTitle: "INVENTORY REPORT",
    noItems: "Inventory is empty. Add categories and materials to get started.",
    status: "Status",

    // --- REPORTS ---
    reportsTitle: "Reports Center",
    reportsSubtitle: "Advanced analytics and printable tables.",
    reportType: "Report Type",
    repRevenue: "💰 Revenue Analysis",
    repPayroll: "💸 Staff Payroll",
    repReferrals: "📣 Referral Sources",
    repDoctors: "👨‍⚕️ Doctor Production",
    repTreatments: "🦷 Top Procedures",
    repStock: "📦 Inventory Value",
    repLab: "🧪 Lab Expenses",
    totalSalaries: "Total Salaries Due",
    newPatients: "New Patients",
    totalProduction: "Total Production",
    proceduresDone: "Procedures Done",
    estLabExp: "Est. Lab Expenses",
    printTable: "Print Table",
    staffMember: "Staff Member",
    grandTotal: "Grand Total",
    percentage: "Percentage",

    // --- PATIENT PROFILE ---
    tabInfo: "Patient Info",
    tabFinance: "Finance",
    clinicalChart: "Clinical Chart", // Added
    medicalAlert: "Medical Alert",
    writeRx: "Write Rx",
    patientProfile: "Patient Profile",
    teethChart: "Teeth Chart",
    saveChart: "Save Chart",
    chartSaved: "Chart saved successfully",
    noneReported: "None reported",
    none: "None",
    systemicDiseases: "Systemic Diseases",
    medicalHistory: "Medical History",
    allergies: "Allergies",
    editProfile: "Edit Profile",
    updateProfile: "Update Profile",
    updateSuccess: "Profile updated!",
    referralSource: "Referral Source",
    walkIn: "Walk-in",
    friendFamily: "Friend / Family",
    otherDoctor: "Other Doctor",
    male: "Male",
    female: "Female",
    age: "Age",
    yearSymbol: "Years",
    gender: "Gender",
    referral: "Referral",
    phone: "Phone",
    address: "Address",
    saveError: "Error saving chart",
    patientNotFound: "Patient record not found",

    // --- NEW PATIENT MODAL ---
    newPatientAutoFile: "Auto-generating File ID",
    patientName: "Name",
    patientBirthDate: "Birth date",
    patientNamePlaceholder: "Patient name",
    patientPhonePlaceholder: "e.g. 1001234567",
    patientAddressPlaceholder: "City, area",
    selectReferralSource: "Select source…",
    socialMedia: "Social Media",
    createPatientFile: "Create profile",

    // --- CLINICAL ---
    statusPlanned: "Planned",
    statusStarted: "Started",
    statusFinished: "Finished",
    selectedTooth: "Selected Tooth",
    generalNote: "General Note",
    saving: "Saving...",
    allSaved: "All Saved"
  },
  ar: {
    // --- NAVIGATION ---
    dashboard: "لوحة التحكم",
    patients: "سجل المرضى",
    appointments: "المواعيد",
    lab: "متابعة المعمل",
    inventory: "المخزون",
    finance: "الحسابات",
    reports: "التقارير",
    settings: "الإعدادات",
    admin: "حساب المدير",
    logout: "تسجيل الخروج",
    changeLang: "تغيير اللغة",
    
    // --- COMMON ---
    From: "من",
    To: "إلى",
    save: "حفظ",
    cancel: "إلغاء",
    delete: "حذف",
    edit: "تعديل",
    search: "بحث",
    syncing: "جاري المزامنة...",
    loading: "جاري التحميل...",
    noData: "لا توجد بيانات",
    all: "الكل",

    // --- DASHBOARD ---
    goodMorning: "صباح الخير",
    dailyBriefing: "إليك ملخص ما يحدث في عيادتك اليوم.",
    patientsScheduled: "مواعيد محجوزة",
    revenueCollected: "إجمالي الدخل (ج.م)",
    lowStockItems: "نواقص المخزون",
    today: "اليوم",
    thisMonth: "هذا الشهر",
    actionNeeded: "تنبيه",
    todaysSchedule: "جدول اليوم",
    viewCalendar: "عرض التقويم",
    noApptsToday: "لا توجد مواعيد اليوم",
    enjoyTime: "استمتع بوقتك!",
    timeLabel: "الوقت",
    consultation: "كشف / استشارة",
    inventoryWarnings: "تنبيهات المخزون",
    stockHealthy: "مستويات المخزون ممتازة!",
    onlyLeft: "متبقي",
    left: "فقط",
    order: "طلب",
    viewMore: "عرض المزيد...",
    quickActions: "روابط سريعة",
    addPatient: "إضافة مريض",
    bookVisit: "حجز موعد",
    checkStock: "فحص المخزون",
    recordPay: "تسجيل دفع",

    // --- APPOINTMENTS ---
    apptTitle: "المواعيد",
    newAppt: "ميعاد جديد",
    noAppts: "لا توجد مواعيد",
    deleteApptConfirm: "هل أنت متأكد من حذف هذا الموعد؟",
    updateError: "فشل تحديث البيانات",
    moveError: "فشل نقل الموعد",
    statusScheduled: "مجدول",
    statusConfirmed: "مؤكد",
    statusCheckedIn: "بالعيادة",
    statusInChair: "بالكرسي",
    statusCompleted: "مكتمل",
    statusCancelled: "ملغي",

    // --- FINANCE ---
    newTransaction: "معاملة جديدة",
    totalIncome: "الدخل",
    expenses: "المصروفات",
    netProfit: "صافي الربح",
    totalPay: "الصافي",
    transactions: "المعاملات",
    description: "الوصف",
    category: "التصنيف",
    method: "الطريقة",
    commValue: "العمولة",
    saveFailed: "فشل الحفظ: ",
    deleteConfirm: "حذف هذا السجل؟",

    // --- SETTINGS ---
    settingsTitle: "إعدادات العيادة",
    settingsSubtitle: "إدارة الفريق، الأسعار، والمظهر العام للبرنامج.",
    tabTeam: "الفريق",
    tabPrices: "الأسعار",
    tabTheme: "المظهر",
    addMember: "إضافة عضو",
    fullName: "الاسم بالكامل",
    role: "الوظيفة",
    dentist: "طبيب أسنان",
    assistant: "مساعد",
    receptionist: "استقبال",
    commission: "نسبة العمولة %",
    salary: "الراتب الأساسي",
    saveMember: "حفظ البيانات",
    addTreatment: "إضافة خدمة علاجية",
    treatmentName: "اسم الخدمة",
    priceClient: "السعر (للمريض)",
    labCost: "تكلفة المعمل (تخصم)",
    addToList: "إضافة للقائمة",
    appTheme: "لون البرنامج",
    chooseTheme: "اختر اللون المفضل لواجهة الاستخدام.",
    labFeeDeducted: "يخصم منه المعمل",

    // --- INVENTORY ---
    invTitle: "إدارة المخزون",
    invSubtitle: "تتبع الكميات، التنبيهات، والتقارير.",
    btnReports: "تقارير",
    btnCategories: "فئات",
    exportHistory: "تصدير سجل (CSV)",
    printStock: "طباعة الجرد",
    downloadCsv: "تحميل CSV",
    print: "طباعة",
    manageCats: "إدارة الفئات",
    newCatPlace: "اسم الفئة...",
    addItem: "إضافة صنف",
    editItem: "تعديل صنف",
    productName: "اسم المنتج",
    stockCount: "الكمية الحالية",
    lowAlert: "تنبيه عند وصول",
    priceUnit: "سعر الوحدة",
    unit: "الوحدة (علبة/قطعة)",
    updateMaterial: "تحديث البيانات",
    addMaterial: "إضافة للمخزون",
    totalValue: "إجمالي القيمة",
    searchInv: "بحث في المخزون...",
    invReportTitle: "تقرير المخزون",
    noItems: "المخزون فارغ. ابدأ بإضافة الفئات والمنتجات.",
    status: "الحالة",

    // --- REPORTS ---
    reportsTitle: "مركز التقارير",
    reportsSubtitle: "تحليلات متقدمة وجداول للطباعة.",
    reportType: "نوع التقرير",
    repRevenue: "💰 تحليل الدخل",
    repPayroll: "💸 رواتب الفريق",
    repReferrals: "📣 مصادر المرضى",
    repDoctors: "👨‍⚕️ إنتاجية الأطباء",
    repTreatments: "🦷 أكثر العلاجات",
    repStock: "📦 قيمة المخزون",
    repLab: "🧪 تكاليف المعمل",
    totalSalaries: "إجمالي الرواتب المستحقة",
    newPatients: "مرضى جدد",
    totalProduction: "إجمالي الشغل",
    proceduresDone: "إجراء تم",
    estLabExp: "تكلفة المعمل التقديرية",
    printTable: "طباعة الجدول",
    staffMember: "عضو الفريق",
    grandTotal: "الإجمالي الكلي",
    percentage: "النسبة",

    // --- PATIENT PROFILE ---
    tabInfo: "بيانات المريض",
    tabFinance: "الحسابات",
    clinicalChart: "السجل الطبي", // Added
    medicalAlert: "تنبيه طبي",
    writeRx: "كتابة روشتة",
    patientProfile: "ملف المريض",
    teethChart: "مخطط الأسنان",
    saveChart: "حفظ المخطط",
    chartSaved: "تم حفظ المخطط",
    noneReported: "لا يوجد",
    none: "لا يوجد",
    systemicDiseases: "أمراض مزمنة",
    medicalHistory: "التاريخ المرضي",
    allergies: "حساسية",
    editProfile: "تعديل البيانات",
    updateProfile: "حفظ التعديلات",
    updateSuccess: "تم التحديث بنجاح!",
    referralSource: "مصدر المعرفة",
    walkIn: "مرور عابر",
    friendFamily: "صديق / عائلة",
    otherDoctor: "طبيب آخر",
    male: "ذكر",
    female: "أنثى",
    age: "السن",
    yearSymbol: "سنة",
    gender: "النوع",
    referral: "مصدر المعرفة",
    phone: "الهاتف",
    address: "العنوان",
    saveError: "فشل حفظ المخطط",
    patientNotFound: "لم يتم العثور على المريض",

    // --- NEW PATIENT MODAL ---
    newPatientAutoFile: "توليد تلقائي لرقم الملف",
    patientName: "الاسم",
    patientBirthDate: "تاريخ الميلاد",
    patientNamePlaceholder: "اسم المريض",
    patientPhonePlaceholder: "مثال: 1001234567",
    patientAddressPlaceholder: "المدينة، المنطقة",
    selectReferralSource: "اختر المصدر…",
    socialMedia: "وسائل التواصل",
    createPatientFile: "إنشاء ملف المريض",

    // --- CLINICAL ---
    statusPlanned: "مخطط",
    statusStarted: "بدأ",
    statusFinished: "انتهى",
    selectedTooth: "السن المحدد",
    generalNote: "ملاحظة عامة",
    saving: "جاري الحفظ...",
    allSaved: "تم الحفظ"
  }
};

type TranslationKeys = keyof typeof translations.en;

interface LanguageContextType {
  language: Language;
  toggleLanguage: () => void;
  t: (key: TranslationKeys | string) => string; 
  isRTL: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>('en');

  useEffect(() => {
    const savedLang = localStorage.getItem('alpha-lang') as Language;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (savedLang) setLanguage(savedLang);
  }, []);

  const toggleLanguage = () => {
    setLanguage(prev => {
      const newLang = prev === 'en' ? 'ar' : 'en';
      localStorage.setItem('alpha-lang', newLang);
      return newLang;
    });
  };

  const t = (key: TranslationKeys | string) => {
    // @ts-expect-error dynamic access of translation keys
    return translations[language][key] || key;
  };

  const isRTL = language === 'ar';

  return (
    <LanguageContext.Provider value={{ language, toggleLanguage, t, isRTL }}>
      <div dir={isRTL ? 'rtl' : 'ltr'} className={isRTL ? 'font-arabic' : 'font-sans'}>
        {children}
      </div>
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within a LanguageProvider");
  return context;
};