import type { Briefing } from "@/lib/automation/briefing/types";

/**
 * The briefing as something you can put on a desk.
 *
 * Built as HTML and handed to the browser's own print engine — the same route the receipts and
 * prescriptions take — rather than drawn with jsPDF like the Finance and Attendance exports. Those
 * two produce a wall of default-styled tables; this needs a header, a hierarchy and figures that
 * look like money, and that is a page-layout job, not a table-drawing one.
 *
 * White paper with one dark band across the top. A fully dark page reads well on a phone and
 * costs a cartridge to print, and this is a document people print.
 */

const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Left-to-right mark: keeps a number from being reordered inside an Arabic sentence. */
const LRM = "‎";

type Lang = "en" | "ar";

interface Copy {
  daily: string;
  weekly: string;
  generated: string;
  collected: string;
  patientsSeen: string;
  stillToCome: string;
  missed: string;
  onFloor: string;
  moneyTitle: string;
  expenses: string;
  netCash: string;
  discounts: string;
  labFees: string;
  commissions: string;
  clinicShare: string;
  billedUnpaid: string;
  byMethod: string;
  byCategory: string;
  vsPrevious: string;
  vsSameWeekday: string;
  productionTitle: string;
  doctor: string;
  seen: string;
  procedures: string;
  commission: string;
  labFee: string;
  clinicProfit: string;
  perPatient: string;
  chairUse: string;
  busiest: string;
  biggestGap: string;
  hrTitle: string;
  name: string;
  role: string;
  hours: string;
  late: string;
  absent: string;
  overtime: string;
  estimatedPay: string;
  labourCost: string;
  pendingOvertime: string;
  openShifts: string;
  actionsTitle: string;
  unresolved: string;
  seenNoNext: string;
  billedNoBooking: string;
  overdueFollowUps: string;
  quietBalances: string;
  unconfirmedAhead: string;
  growthTitle: string;
  newPatients: string;
  newLeads: string;
  converted: string;
  untouchedLeads: string;
  leadSource: string;
  stockTitle: string;
  outOfStock: string;
  lowStock: string;
  noThreshold: string;
  nextTitle: string;
  tomorrow: string;
  nextWeek: string;
  appointments: string;
  firstAt: string;
  doctorsOn: string;
  rostered: string;
  trendTitle: string;
  bestDay: string;
  quietestDay: string;
  topProcedures: string;
  collectionRate: string;
  payrollMtd: string;
  count: string;
  revenue: string;
  notes: string;
  nothing: string;
  days: string;
  hidden: string;
  minutes: string;
}

const COPY: Record<Lang, Copy> = {
  en: {
    daily: "Daily Brief",
    weekly: "Weekly Brief",
    generated: "Generated",
    collected: "Collected",
    patientsSeen: "Patients seen",
    stillToCome: "Still to come",
    missed: "Missed / cancelled",
    onFloor: "On the floor",
    moneyTitle: "Money",
    expenses: "Expenses",
    netCash: "Net cash",
    discounts: "Discounts given",
    labFees: "Lab fees",
    commissions: "Doctor commissions",
    clinicShare: "Clinic share",
    billedUnpaid: "Billed, not yet paid",
    byMethod: "How it was paid",
    byCategory: "Where it went",
    vsPrevious: "vs previous",
    vsSameWeekday: "vs same day last week",
    productionTitle: "Production",
    doctor: "Doctor",
    seen: "Seen",
    procedures: "Procedures",
    commission: "Commission",
    labFee: "Lab",
    clinicProfit: "Clinic",
    perPatient: "Revenue per patient seen",
    chairUse: "Chair time used",
    busiest: "Busiest hour",
    biggestGap: "Biggest gap",
    hrTitle: "The floor",
    name: "Name",
    role: "Role",
    hours: "Hours",
    late: "Late",
    absent: "Absent",
    overtime: "Overtime",
    estimatedPay: "Est. pay",
    labourCost: "Labour cost",
    pendingOvertime: "Overtime awaiting approval",
    openShifts: "Never clocked out",
    actionsTitle: "Needs someone to act",
    unresolved: "Past appointments never closed out",
    seenNoNext: "Seen, left with no next appointment",
    billedNoBooking: "Billed work, nothing booked",
    overdueFollowUps: "Lead follow-ups overdue",
    quietBalances: "Balances with no recent activity",
    unconfirmedAhead: "Unconfirmed ahead",
    growthTitle: "Growth",
    newPatients: "New patients",
    newLeads: "New leads",
    converted: "Converted",
    untouchedLeads: "Older leads still untouched",
    leadSource: "Where they came from",
    stockTitle: "Stock",
    outOfStock: "Out of stock",
    lowStock: "At or below reorder level",
    noThreshold: "No reorder level set",
    nextTitle: "Coming up",
    tomorrow: "Tomorrow",
    nextWeek: "Next week",
    appointments: "Appointments",
    firstAt: "First at",
    doctorsOn: "Doctors on",
    rostered: "Rostered",
    trendTitle: "This week against last",
    bestDay: "Best day",
    quietestDay: "Quietest day",
    topProcedures: "Most done",
    collectionRate: "Collected against billed",
    payrollMtd: "Payroll, month to date",
    count: "Count",
    revenue: "Value",
    notes: "Worth knowing",
    nothing: "Nothing to report.",
    days: "d",
    hidden: "Hidden by your permissions",
    minutes: "min",
  },
  ar: {
    daily: "ملخص اليوم",
    weekly: "ملخص الأسبوع",
    generated: "أُنشئ في",
    collected: "المحصّل",
    patientsSeen: "مرضى تم استقبالهم",
    stillToCome: "لم يحضروا بعد",
    missed: "ملغاة / لم يحضروا",
    onFloor: "داخل العيادة الآن",
    moneyTitle: "الحسابات",
    expenses: "المصروفات",
    netCash: "صافي النقد",
    discounts: "خصومات",
    labFees: "رسوم المعمل",
    commissions: "عمولات الأطباء",
    clinicShare: "نصيب العيادة",
    billedUnpaid: "محسوب ولم يُدفع",
    byMethod: "طريقة الدفع",
    byCategory: "أوجه الصرف",
    vsPrevious: "مقارنة بالسابق",
    vsSameWeekday: "مقارنة بنفس اليوم الأسبوع الماضي",
    productionTitle: "الإنتاج",
    doctor: "الطبيب",
    seen: "مرضى",
    procedures: "إجراءات",
    commission: "العمولة",
    labFee: "المعمل",
    clinicProfit: "العيادة",
    perPatient: "متوسط الإيراد لكل مريض",
    chairUse: "استغلال وقت الكرسي",
    busiest: "أكثر ساعة ازدحاماً",
    biggestGap: "أكبر فجوة",
    hrTitle: "فريق العمل",
    name: "الاسم",
    role: "الوظيفة",
    hours: "ساعات",
    late: "تأخير",
    absent: "غياب",
    overtime: "إضافي",
    estimatedPay: "الأجر التقديري",
    labourCost: "تكلفة العمالة",
    pendingOvertime: "وقت إضافي بانتظار الموافقة",
    openShifts: "لم يسجّل خروجاً",
    actionsTitle: "يحتاج تدخّلاً",
    unresolved: "مواعيد ماضية لم تُغلق",
    seenNoNext: "حضروا وخرجوا بلا موعد قادم",
    billedNoBooking: "عمل محسوب بلا حجز",
    overdueFollowUps: "متابعات عملاء متأخرة",
    quietBalances: "أرصدة بلا حركة حديثة",
    unconfirmedAhead: "غير مؤكدة قادمة",
    growthTitle: "النمو",
    newPatients: "مرضى جدد",
    newLeads: "عملاء محتملون جدد",
    converted: "تحوّلوا لمرضى",
    untouchedLeads: "عملاء أقدم لم يُتواصل معهم",
    leadSource: "مصدر العميل",
    stockTitle: "المخزون",
    outOfStock: "نفد تماماً",
    lowStock: "عند حد إعادة الطلب أو أقل",
    noThreshold: "بلا حد لإعادة الطلب",
    nextTitle: "القادم",
    tomorrow: "غداً",
    nextWeek: "الأسبوع القادم",
    appointments: "مواعيد",
    firstAt: "أول موعد",
    doctorsOn: "الأطباء",
    rostered: "المناوبة",
    trendTitle: "هذا الأسبوع مقابل الماضي",
    bestDay: "أفضل يوم",
    quietestDay: "أهدأ يوم",
    topProcedures: "الأكثر إجراءً",
    collectionRate: "المحصّل مقابل المحسوب",
    payrollMtd: "الأجور منذ بداية الشهر",
    count: "العدد",
    revenue: "القيمة",
    notes: "ملاحظات مهمة",
    nothing: "لا يوجد ما يُذكر.",
    days: " يوم",
    hidden: "مخفي حسب صلاحياتك",
    minutes: "د",
  },
};

const TREND_LABELS: Record<string, { en: string; ar: string }> = {
  collected: { en: "Collected", ar: "المحصّل" },
  patients_seen: { en: "Patients seen", ar: "مرضى تم استقبالهم" },
  new_patients: { en: "New patients", ar: "مرضى جدد" },
  missed: { en: "Missed / cancelled", ar: "ملغاة / لم يحضروا" },
};

const FLAG_LABELS: Record<string, { en: string; ar: string }> = {
  no_device_registered: { en: "no device registered", ar: "بلا جهاز مسجّل" },
  far_punch: { en: "punched from far away", ar: "تسجيل من مسافة بعيدة" },
  vague_gps: { en: "weak GPS fix", ar: "تحديد موقع ضعيف" },
};

const WEEKDAYS: Record<Lang, string[]> = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  ar: ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"],
};

export interface BriefingPdfPayload {
  briefing: Briefing;
  clinicName: string;
  clinicLogoUrl?: string;
  language: Lang;
  currency: string;
}

function money(n: number, lang: Lang, currency: string): string {
  const value = Math.round(n).toLocaleString(lang === "ar" ? "ar-EG" : "en-US");
  return `${LRM}${value} ${currency}`;
}

function plain(n: number, lang: Lang): string {
  return `${LRM}${Math.round(n).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}`;
}

function hoursLabel(minutes: number, lang: Lang): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${LRM}${h}h ${m.toString().padStart(2, "0")}${lang === "ar" ? "" : "m"}`;
}

function delta(percent: number | null, lang: Lang): string {
  if (percent === null) return `<span class="delta flat">—</span>`;
  const tone = percent > 0 ? "up" : percent < 0 ? "down" : "flat";
  const arrow = percent > 0 ? "▲" : percent < 0 ? "▼" : "—";
  return `<span class="delta ${tone}">${arrow} ${LRM}${Math.abs(percent).toLocaleString(
    lang === "ar" ? "ar-EG" : "en-US"
  )}%</span>`;
}

function statTile(label: string, value: string, sub?: string): string {
  return `<div class="tile">
    <div class="tile-label">${esc(label)}</div>
    <div class="tile-value">${value}</div>
    ${sub ? `<div class="tile-sub">${sub}</div>` : ""}
  </div>`;
}

function section(title: string, body: string, note?: string): string {
  if (!body.trim()) return "";
  return `<section class="block">
    <h2>${esc(title)}</h2>
    ${note ? `<p class="block-note">${esc(note)}</p>` : ""}
    ${body}
  </section>`;
}

function list(title: string, count: number, rows: string[]): string {
  if (count === 0) return "";
  const shown = rows.join("");
  const more = count > rows.length ? `<li class="more">+ ${count - rows.length}</li>` : "";
  return `<div class="listcard">
    <div class="listcard-head"><span>${esc(title)}</span><span class="pill">${count}</span></div>
    <ul>${shown}${more}</ul>
  </div>`;
}

export function buildBriefingSrcDoc(payload: BriefingPdfPayload): string {
  const { briefing: b, clinicName, clinicLogoUrl, language: lang, currency } = payload;
  const c = COPY[lang];
  const isAr = lang === "ar";
  const isWeek = b.period === "week";

  const m = (n: number) => money(n, lang, currency);
  const p = (n: number) => plain(n, lang);

  const rangeLabel = isWeek ? `${b.startDate} — ${b.endDate}` : b.startDate;

  // --- Headline ------------------------------------------------------------------------------
  const headline = [
    b.headline.collected !== null ? statTile(c.collected, m(b.headline.collected)) : "",
    statTile(c.patientsSeen, p(b.headline.patientsSeen)),
    statTile(c.stillToCome, p(b.headline.stillToCome)),
    statTile(c.missed, p(b.headline.missed)),
    b.headline.staffOnFloor !== null ? statTile(c.onFloor, p(b.headline.staffOnFloor)) : "",
  ]
    .filter(Boolean)
    .join("");

  // --- Money ---------------------------------------------------------------------------------
  let moneyBlock = "";
  if (b.money) {
    const mo = b.money;
    const cmp: string[] = [];
    if (mo.comparison.previousCollected !== null) {
      cmp.push(
        `<div class="cmp"><span>${esc(c.vsPrevious)}</span><b>${m(mo.comparison.previousCollected)}</b>${delta(
          mo.comparison.previousCollected > 0
            ? Math.round(((mo.collected - mo.comparison.previousCollected) / mo.comparison.previousCollected) * 100)
            : null,
          lang
        )}</div>`
      );
    }
    if (mo.comparison.sameWeekdayCollected !== null) {
      cmp.push(
        `<div class="cmp"><span>${esc(c.vsSameWeekday)}</span><b>${m(mo.comparison.sameWeekdayCollected)}</b>${delta(
          mo.comparison.sameWeekdayCollected > 0
            ? Math.round(
                ((mo.collected - mo.comparison.sameWeekdayCollected) / mo.comparison.sameWeekdayCollected) * 100
              )
            : null,
          lang
        )}</div>`
      );
    }

    const secondary = [
      [c.discounts, mo.discounts],
      [c.labFees, mo.labFees],
      [c.commissions, mo.doctorCommissions],
      [c.clinicShare, mo.clinicProfit],
      [c.billedUnpaid, mo.billedUnpaid],
    ]
      .filter(([, v]) => (v as number) !== 0)
      .map(([label, v]) => `<div class="kv"><span>${esc(label as string)}</span><b>${m(v as number)}</b></div>`)
      .join("");

    const methodRows = mo.byMethod
      .map((s) => `<tr><td>${esc(s.method)}</td><td class="n">${p(s.count)}</td><td class="n">${m(s.amount)}</td></tr>`)
      .join("");
    const categoryRows = mo.expensesByCategory
      .map((s) => `<tr><td>${esc(s.category)}</td><td class="n">${p(s.count)}</td><td class="n">${m(s.amount)}</td></tr>`)
      .join("");

    moneyBlock = section(
      c.moneyTitle,
      `<div class="grid3">
        ${statTile(c.collected, m(mo.collected))}
        ${statTile(c.expenses, m(mo.expenses))}
        ${statTile(c.netCash, m(mo.netCash))}
      </div>
      ${cmp.length ? `<div class="cmprow">${cmp.join("")}</div>` : ""}
      ${secondary ? `<div class="kvrow">${secondary}</div>` : ""}
      <div class="twocol">
        ${
          methodRows
            ? `<table><thead><tr><th>${esc(c.byMethod)}</th><th class="n">${esc(c.count)}</th><th class="n">${esc(
                c.revenue
              )}</th></tr></thead><tbody>${methodRows}</tbody></table>`
            : ""
        }
        ${
          categoryRows
            ? `<table><thead><tr><th>${esc(c.byCategory)}</th><th class="n">${esc(c.count)}</th><th class="n">${esc(
                c.revenue
              )}</th></tr></thead><tbody>${categoryRows}</tbody></table>`
            : ""
        }
      </div>`
    );
  }

  // --- Production ----------------------------------------------------------------------------
  let productionBlock = "";
  if (b.production && (b.production.doctors.length > 0 || b.production.chairUtilisation)) {
    const pr = b.production;
    const rows = pr.doctors
      .map(
        (d) =>
          `<tr><td>${esc(d.name)}</td><td class="n">${p(d.patientsSeen)}</td><td class="n">${p(
            d.procedures
          )}</td><td class="n">${m(d.collected)}</td><td class="n">${m(d.commission)}</td><td class="n">${m(
            d.labFee
          )}</td><td class="n">${m(d.clinicProfit)}</td></tr>`
      )
      .join("");

    const meta = [
      pr.revenuePerPatientSeen !== null ? [c.perPatient, m(pr.revenuePerPatientSeen)] : null,
      pr.chairUtilisation ? [c.chairUse, `${LRM}${pr.chairUtilisation.percent}%`] : null,
      pr.busiestHour ? [c.busiest, `${esc(pr.busiestHour.hour)} · ${p(pr.busiestHour.count)}`] : null,
      pr.biggestGap ? [c.biggestGap, `${esc(pr.biggestGap.startsAt)} · ${p(pr.biggestGap.minutes)}${c.minutes}`] : null,
    ]
      .filter(Boolean)
      .map((x) => `<div class="kv"><span>${esc((x as string[])[0])}</span><b>${(x as string[])[1]}</b></div>`)
      .join("");

    productionBlock = section(
      c.productionTitle,
      `${meta ? `<div class="kvrow">${meta}</div>` : ""}
      ${
        rows
          ? `<table><thead><tr><th>${esc(c.doctor)}</th><th class="n">${esc(c.seen)}</th><th class="n">${esc(
              c.procedures
            )}</th><th class="n">${esc(c.collected)}</th><th class="n">${esc(c.commission)}</th><th class="n">${esc(
              c.labFee
            )}</th><th class="n">${esc(c.clinicProfit)}</th></tr></thead><tbody>${rows}</tbody></table>`
          : ""
      }`
    );
  }

  // --- HR ------------------------------------------------------------------------------------
  let hrBlock = "";
  if (b.hr && b.hr.staff.length > 0) {
    const hr = b.hr;
    const rows = hr.staff
      .map((s) => {
        const flags = s.flags
          .map((f) => `<span class="flag">${esc(FLAG_LABELS[f]?.[lang] ?? f)}</span>`)
          .join(" ");
        return `<tr>
          <td>${esc(s.name)}${s.activeNow ? `<span class="dot"></span>` : ""}${flags ? `<div>${flags}</div>` : ""}</td>
          <td>${esc(s.role)}</td>
          <td class="n">${s.minutesWorked > 0 ? hoursLabel(s.minutesWorked, lang) : "—"}</td>
          <td class="n">${
            s.lateDays > 1
              ? `${p(s.lateDays)}× · ${p(s.lateMinutes)}${c.minutes}`
              : s.lateDays === 1
                ? `${p(s.lateMinutes)}${c.minutes}`
                : "—"
          }</td>
          <td class="n">${s.absentDays > 0 ? p(s.absentDays) : "—"}</td>
          <td class="n">${
            s.overtimeApprovedMinutes + s.overtimePendingMinutes > 0
              ? hoursLabel(s.overtimeApprovedMinutes + s.overtimePendingMinutes, lang)
              : "—"
          }</td>
          <td class="n">${s.estimatedPay > 0 ? m(s.estimatedPay) : "—"}</td>
        </tr>`;
      })
      .join("");

    const meta = [
      [c.labourCost, m(hr.labourCost)],
      hr.overtimePendingMinutes > 0
        ? [c.pendingOvertime, `${hoursLabel(hr.overtimePendingMinutes, lang)} · ${m(hr.overtimePendingCost)}`]
        : null,
      hr.openShifts > 0 ? [c.openShifts, p(hr.openShifts)] : null,
      hr.absentDays > 0 ? [c.absent, p(hr.absentDays)] : null,
    ]
      .filter(Boolean)
      .map((x) => `<div class="kv"><span>${esc((x as string[])[0])}</span><b>${(x as string[])[1]}</b></div>`)
      .join("");

    hrBlock = section(
      c.hrTitle,
      `<div class="kvrow">${meta}</div>
      <table><thead><tr><th>${esc(c.name)}</th><th>${esc(c.role)}</th><th class="n">${esc(
        c.hours
      )}</th><th class="n">${esc(c.late)}</th><th class="n">${esc(c.absent)}</th><th class="n">${esc(
        c.overtime
      )}</th><th class="n">${esc(c.estimatedPay)}</th></tr></thead><tbody>${rows}</tbody></table>`
    );
  }

  // --- Trend (weekly only) --------------------------------------------------------------------
  let trendBlock = "";
  if (b.trend) {
    const t = b.trend;
    const points = t.points
      .map((pt) => {
        const label = TREND_LABELS[pt.key]?.[lang] ?? pt.key;
        const value = pt.isMoney ? m(pt.current) : p(pt.current);
        return statTile(label, value, delta(pt.changePercent, lang));
      })
      .join("");

    const max = Math.max(1, ...t.daily.map((d) => (d.collected ?? d.patientsSeen) || 0));
    const bars = t.daily
      .map((d) => {
        const value = d.collected ?? d.patientsSeen;
        const height = Math.max(2, Math.round((value / max) * 46));
        return `<div class="bar">
          <div class="bar-fill" style="height:${height}px"></div>
          <div class="bar-label">${esc(WEEKDAYS[lang][d.weekday])}</div>
        </div>`;
      })
      .join("");

    const procRows = t.topProcedures
      .map(
        (proc) =>
          `<tr><td>${esc(proc.name)}</td><td class="n">${p(proc.count)}</td><td class="n">${
            proc.revenue === null ? "—" : m(proc.revenue)
          }</td></tr>`
      )
      .join("");

    const meta = [
      t.bestDay ? [c.bestDay, esc(t.bestDay)] : null,
      t.quietestDay ? [c.quietestDay, esc(t.quietestDay)] : null,
      t.collectionRate !== null ? [c.collectionRate, `${LRM}${t.collectionRate}%`] : null,
      t.payrollMonthToDate !== null ? [c.payrollMtd, m(t.payrollMonthToDate)] : null,
    ]
      .filter(Boolean)
      .map((x) => `<div class="kv"><span>${esc((x as string[])[0])}</span><b>${(x as string[])[1]}</b></div>`)
      .join("");

    trendBlock = section(
      c.trendTitle,
      `<div class="grid4">${points}</div>
      <div class="bars">${bars}</div>
      ${meta ? `<div class="kvrow">${meta}</div>` : ""}
      ${
        procRows
          ? `<table><thead><tr><th>${esc(c.topProcedures)}</th><th class="n">${esc(c.count)}</th><th class="n">${esc(
              c.revenue
            )}</th></tr></thead><tbody>${procRows}</tbody></table>`
          : ""
      }`
    );
  }

  // --- Actions -------------------------------------------------------------------------------
  const a = b.actions;
  const actionCards = [
    list(
      c.unresolved,
      a.unresolvedCount,
      a.unresolvedAppointments.map(
        (i) =>
          `<li><span>${esc(i.patientName)}</span><span class="meta">${p(i.daysAgo || 0)}${c.days}</span></li>`
      ),
    ),
    list(
      c.seenNoNext,
      a.seenWithoutNextVisitCount,
      a.seenWithoutNextVisit.map(
        (i) => `<li><span>${esc(i.patientName)}</span><span class="meta">${esc(i.detail)}</span></li>`
      ),
    ),
    list(
      c.billedNoBooking,
      a.billedWithoutBookingCount,
      a.billedWithoutBooking.map(
        (i) =>
          `<li><span>${esc(i.patientName)}</span><span class="meta">${
            i.amount !== undefined ? m(i.amount) : ""
          }</span></li>`
      ),
    ),
    list(
      c.overdueFollowUps,
      a.overdueFollowUpCount,
      a.overdueFollowUps.map(
        (i) => `<li><span>${esc(i.patientName)}</span><span class="meta">${p(i.daysAgo || 0)}${c.days}</span></li>`
      ),
    ),
    list(
      c.quietBalances,
      a.staleBalances.length,
      a.staleBalances.map(
        (i) =>
          `<li><span>${esc(i.patientName)}</span><span class="meta">${m(i.balance)} · ${p(
            i.daysSinceLastActivity
          )}${c.days}</span></li>`
      ),
    ),
  ]
    .filter(Boolean)
    .join("");

  // Rendered even when empty: a missing section reads as an omission, "nothing to report" reads
  // as a clean sheet, and on a brief those are very different messages.
  const actionsBlock = section(
    c.actionsTitle,
    actionCards ? `<div class="cards">${actionCards}</div>` : `<p class="block-note">${esc(c.nothing)}</p>`
  );

  // --- Growth, stock, coming up ---------------------------------------------------------------
  const growthTiles = [
    statTile(c.newPatients, p(b.growth.newPatients)),
    statTile(c.newLeads, p(b.growth.newLeads)),
    statTile(c.converted, p(b.growth.leadsConverted)),
    statTile(c.untouchedLeads, p(b.growth.leadsUntouched)),
  ].join("");

  const sourceRows = b.growth.leadsBySource
    .map((s) => `<tr><td>${esc(s.source)}</td><td class="n">${p(s.count)}</td></tr>`)
    .join("");

  const growthBlock = section(
    c.growthTitle,
    `<div class="grid4">${growthTiles}</div>
    ${sourceRows ? `<table><thead><tr><th>${esc(c.leadSource)}</th><th class="n">${esc(c.count)}</th></tr></thead><tbody>${sourceRows}</tbody></table>` : ""}`
  );

  const stockRows = b.stock.low
    .map(
      (i) =>
        `<tr><td>${esc(i.name)}${i.outOfStock ? ` <span class="flag">${esc(c.outOfStock)}</span>` : ""}</td><td class="n">${p(
          i.stock
        )} / ${p(i.minStock)} ${esc(i.unit)}</td></tr>`
    )
    .join("");

  const stockBlock = section(
    c.stockTitle,
    `<div class="kvrow">
      <div class="kv"><span>${esc(c.lowStock)}</span><b>${p(b.stock.lowCount)}</b></div>
      <div class="kv"><span>${esc(c.outOfStock)}</span><b>${p(b.stock.outOfStockCount)}</b></div>
      <div class="kv"><span>${esc(c.noThreshold)}</span><b>${p(b.stock.noThresholdCount)}</b></div>
    </div>
    ${stockRows ? `<table><tbody>${stockRows}</tbody></table>` : ""}`
  );

  const nextTiles = [
    statTile(c.appointments, p(b.nextUp.appointments)),
    b.nextUp.firstAppointmentTime ? statTile(c.firstAt, esc(b.nextUp.firstAppointmentTime)) : "",
    statTile(c.unconfirmedAhead, p(b.nextUp.unconfirmed)),
  ]
    .filter(Boolean)
    .join("");

  const nextLists = [
    b.nextUp.doctors.length
      ? `<div class="kv"><span>${esc(c.doctorsOn)}</span><b>${esc(b.nextUp.doctors.join(" · "))}</b></div>`
      : "",
    b.nextUp.staffRostered && b.nextUp.staffRostered.length
      ? `<div class="kv"><span>${esc(c.rostered)}</span><b>${esc(b.nextUp.staffRostered.join(" · "))}</b></div>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const nextBlock = section(
    `${c.nextTitle} — ${b.nextUp.key === "tomorrow" ? c.tomorrow : c.nextWeek}`,
    `<div class="grid3">${nextTiles}</div>${nextLists ? `<div class="kvrow">${nextLists}</div>` : ""}`
  );

  const notesBlock = b.notes.length
    ? `<section class="block notes"><h2>${esc(c.notes)}</h2><ul>${b.notes
        .map((n) => `<li>${esc(n)}</li>`)
        .join("")}</ul></section>`
    : "";

  const redactedNote = b.redacted.length
    ? `<p class="redacted">${esc(c.hidden)}: ${b.redacted
        .map((r) => esc(r === "money" ? c.moneyTitle : c.hrTitle))
        .join(" · ")}</p>`
    : "";

  const generated = new Date(b.generatedAt).toLocaleString(isAr ? "ar-EG" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const inner = `
  <header class="slab">
    <div class="slab-left">
      ${clinicLogoUrl ? `<img class="logo" src="${esc(clinicLogoUrl)}" alt=""/>` : ""}
      <div>
        <div class="clinic">${esc(clinicName)}</div>
        <div class="kicker">${esc(isWeek ? c.weekly : c.daily)}</div>
      </div>
    </div>
    <div class="slab-right">
      <div class="range">${esc(rangeLabel)}</div>
      <div class="stamp">${esc(c.generated)} ${esc(generated)}</div>
    </div>
  </header>

  <div class="grid5 headline">${headline}</div>
  ${redactedNote}
  ${trendBlock}
  ${moneyBlock}
  ${productionBlock}
  ${hrBlock}
  ${actionsBlock}
  ${growthBlock}
  ${stockBlock}
  ${nextBlock}
  ${notesBlock}
  `;

  return `<!DOCTYPE html>
<html lang="${isAr ? "ar" : "en"}" dir="${isAr ? "rtl" : "ltr"}">
<head>
  <meta charset="utf-8"/>
  <title>${esc(clinicName)} — ${esc(isWeek ? c.weekly : c.daily)} ${esc(rangeLabel)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet"/>
  <style>
    /* The page margin lives on the body, not on @page, so the header slab can bleed to the paper
       edge with a plain negative margin — and so the same file previews correctly in a browser
       window, where @page margins do not apply at all. */
    @page { size: A4 portrait; margin: 0; }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      width: 210mm;
      max-width: 100%;
      margin: 0 auto;
      padding: 0 12mm 14mm;
      font-family: ${isAr ? `'Tajawal', Tahoma, sans-serif` : `-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`};
      color: #1e293b;
      background: #ffffff;
      font-size: 9.5px;
      line-height: 1.45;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* Figures carry the page. A serif at this size reads as considered rather than dashed off,
       and tabular numerals keep columns of money aligned.

       Arabic keeps Tajawal instead: the Latin serifs carry no Arabic-Indic digits, so ١٨٬٤٥٠ would
       fall through to whatever the system happens to substitute, glyph by glyph. */
    .tile-value, table td.n, .kv b, .cmp b, .delta, .pill, .range, .listcard .meta {
      font-family: ${isAr ? `'Tajawal', Tahoma, sans-serif` : `'Newsreader', Georgia, 'Times New Roman', serif`};
      font-variant-numeric: tabular-nums;
    }

    /* --- Header slab: the one dark band on an otherwise white page --- */
    .slab {
      background: #1A2130;
      color: #ffffff;
      margin: 0 -12mm 6mm;
      padding: 9mm 12mm 7mm;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 10mm;
      border-bottom: 2px solid #C8A24A;
    }
    .slab-left { display: flex; align-items: center; gap: 8px; }
    .logo { width: 34px; height: 34px; object-fit: contain; border-radius: 6px; background: #ffffff14; }
    .clinic { font-size: 15px; font-weight: 800; letter-spacing: -0.01em; }
    .kicker {
      font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.22em;
      color: #C8A24A; margin-top: 2px;
    }
    .slab-right { text-align: ${isAr ? "left" : "right"}; }
    .range { font-size: 13px; color: #ffffff; }
    .stamp { font-size: 7.5px; color: #94a3b8; margin-top: 2px; letter-spacing: 0.04em; }

    /* --- Sections --- */
    .block { margin-bottom: 6mm; break-inside: avoid; }
    .block h2 {
      font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.2em;
      color: #64748b; padding-bottom: 3px; margin-bottom: 5px;
      border-bottom: 1px solid #e2e8f0;
    }
    .block-note { font-size: 8px; color: #94a3b8; margin-bottom: 5px; }
    .redacted {
      font-size: 8px; color: #94a3b8; margin: -3mm 0 5mm;
      border-${isAr ? "right" : "left"}: 2px solid #e2e8f0; padding-${isAr ? "right" : "left"}: 6px;
    }

    /* --- Tiles --- */
    .grid3, .grid4, .grid5 { display: grid; gap: 5px; margin-bottom: 5px; }
    .grid3 { grid-template-columns: repeat(3, 1fr); }
    .grid4 { grid-template-columns: repeat(4, 1fr); }
    .grid5 { grid-template-columns: repeat(5, 1fr); }
    .headline { margin-bottom: 6mm; }

    .tile { border: 1px solid #e2e8f0; border-radius: 6px; padding: 7px 8px; background: #fff; }
    .tile-label {
      font-size: 6.8px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.14em;
      color: #94a3b8; margin-bottom: 3px;
    }
    .tile-value { font-size: 17px; font-weight: 500; color: #1A2130; line-height: 1.1; }
    .tile-sub { font-size: 8px; margin-top: 2px; }

    /* --- Key/value strips --- */
    .kvrow, .cmprow { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-bottom: 5px; }
    .kv, .cmp { font-size: 8.5px; color: #64748b; display: flex; align-items: baseline; gap: 5px; }
    .kv b, .cmp b { color: #1A2130; font-size: 10.5px; font-weight: 500; }
    .cmp { gap: 5px; }

    .delta { font-size: 8.5px; font-weight: 500; }
    .delta.up { color: #047857; }
    .delta.down { color: #b91c1c; }
    .delta.flat { color: #94a3b8; }

    /* --- Tables --- */
    .twocol { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; break-inside: auto; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th {
      font-size: 6.8px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.12em;
      color: #94a3b8; text-align: ${isAr ? "right" : "left"};
      padding: 3px 5px; border-bottom: 1px solid #e2e8f0;
    }
    td { padding: 3.5px 5px; border-bottom: 1px solid #f1f5f9; font-size: 9px; color: #334155; }
    td.n, th.n { text-align: ${isAr ? "left" : "right"}; white-space: nowrap; }
    td.n { color: #1A2130; font-size: 10px; }

    /* --- Action cards --- */
    .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .listcard { border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; break-inside: avoid; }
    .listcard-head {
      display: flex; justify-content: space-between; align-items: center;
      background: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 4px 7px;
      font-size: 7px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.12em; color: #475569;
    }
    .pill {
      font-size: 10px; color: #1A2130;
      background: #fff; border: 1px solid #e2e8f0; border-radius: 20px; padding: 0 6px; letter-spacing: 0;
    }
    .listcard ul { list-style: none; }
    .listcard li {
      display: flex; justify-content: space-between; gap: 8px;
      padding: 3px 7px; border-bottom: 1px solid #f1f5f9; font-size: 8.5px;
    }
    .listcard li:last-child { border-bottom: none; }
    .listcard .meta { color: #94a3b8; white-space: nowrap; }
    .listcard .more { color: #94a3b8; font-style: italic; }

    /* --- Week bars --- */
    .bars {
      display: flex; align-items: flex-end; gap: 5px; height: 62px;
      padding: 4px 0 0; margin-bottom: 6px;
    }
    .bar { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
    .bar-fill { width: 100%; background: #1A2130; border-radius: 2px 2px 0 0; }
    .bar-label {
      font-size: 6.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;
      color: #94a3b8; margin-top: 3px;
    }

    /* --- Small marks --- */
    .dot {
      display: inline-block; width: 5px; height: 5px; border-radius: 50%;
      background: #059669; margin-${isAr ? "right" : "left"}: 5px; vertical-align: middle;
    }
    .flag {
      display: inline-block; font-size: 6.5px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.1em; color: #b45309; background: #fffbeb;
      border: 1px solid #fde68a; border-radius: 3px; padding: 0 3px; margin-top: 2px;
    }

    .notes ul { list-style: none; }
    .notes li {
      font-size: 8px; color: #64748b; padding: 2px 0 2px 8px;
      border-${isAr ? "right" : "left"}: 2px solid #e2e8f0; margin-bottom: 3px;
      padding-${isAr ? "right" : "left"}: 7px;
    }
  </style>
</head>
<body>${inner}</body>
</html>`;
}

/**
 * Opens the print dialog on a detached iframe, exactly as the receipt printer does.
 *
 * The browser's own engine renders text as text rather than as a screenshot of text, which is
 * what keeps a table of figures crisp and selectable in the saved PDF.
 */
export function printBriefing(payload: BriefingPdfPayload): void {
  const srcDoc = buildBriefingSrcDoc(payload);

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:absolute;width:0;height:0;border:none;visibility:hidden;";
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) return;

  doc.open();
  doc.write(srcDoc);
  doc.close();

  iframe.contentWindow?.addEventListener("load", () => {
    // A beat for the webfonts to arrive; without it the figures print in the fallback serif.
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        if (iframe.parentNode) document.body.removeChild(iframe);
      }, 2000);
    }, 600);
  });
}
