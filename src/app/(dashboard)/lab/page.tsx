"use client";

/**
 * Lab Tracking — where every case is, right now.
 *
 * The page exists because the money half of lab work was already handled and the physical half was
 * not: a service flagged `requiresLab` has its fee deducted before commission, but nothing knew
 * which crown was at which lab or when it was promised back.
 *
 * Three counts sit at the top, and the third is the one worth having. Overdue and due-this-week
 * are obvious. "Back and waiting" is the pile nobody measures — finished work sitting in a drawer
 * because nobody called the patient — and it is money already spent.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { getDoc, onSnapshot, query, orderBy } from "firebase/firestore";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronRight,
  FlaskConical,
  Inbox,
  Loader2,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Truck,
  X,
} from "lucide-react";
import PermissionGuard from "@/components/PermissionGuard";
import LabCaseModal from "@/components/lab/LabCaseModal";
import LabAccountsPanel from "@/components/lab/LabAccountsPanel";
import LabRemakeModal from "@/components/lab/LabRemakeModal";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useUI } from "@/context/UIContext";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { useActiveBranch } from "@/lib/useActiveBranch";
import { localYmd } from "@/lib/clinicDate";
import { matchesTokenizedSubstring } from "@/lib/flexibleSearch";
import { LABS_SETTINGS_DOC, parseDentalLabs, parseLabPaper, type DentalLab } from "@/lib/dentalLabs";
import {
  DEFAULT_LAB_PAPER,
  LAB_CASES_COLLECTION,
  LAB_CASE_STATUSES,
  dueStateFor,
  matchesLabCode,
  nextStatuses,
  statusFor,
  statusLabel,
  summarise,
  toLabCase,
  workTypeLabel,
  type DueState,
  type LabCase,
  type LabCaseStatus,
  type LabOrderPaper,
} from "@/lib/labCases";
import { advanceLabCase, createRemake } from "@/lib/labCaseWrite";
import { LAB_PAYMENTS_COLLECTION, type LabPayment } from "@/lib/labAccounts";
import { loadLabOrderClinic, printLabOrder } from "@/lib/labOrderPrint";

/**
 * "out" is not a status, it is the two statuses that mean the case is physically at a lab.
 *
 * The overdue and due-this-week counts are computed over `statusFor(c.status).atLab`, which is
 * true for both `at_lab` and `returned_to_lab` — so a tile that filtered to the literal "at_lab"
 * hid part of what it had just counted. Clicking a number that says 3 and seeing 2 rows is the
 * kind of thing that makes people stop trusting the board.
 */
type StatusFilter = "open" | "all" | "out" | LabCaseStatus;



const DUE_STYLE: Record<DueState, { pill: string; en: (n: number) => string; ar: (n: number) => string }> = {
  overdue: {
    pill: "bg-rose-50 text-rose-700 border-rose-200",
    en: (n) => `Overdue ${n}d`,
    ar: (n) => `متأخرة ${n} يوم`,
  },
  due_today: { pill: "bg-amber-50 text-amber-700 border-amber-200", en: () => "Due today", ar: () => "النهارده" },
  due_soon: {
    pill: "bg-amber-50 text-amber-700 border-amber-200",
    en: (n) => `Due in ${n}d`,
    ar: (n) => `باقي ${n} يوم`,
  },
  on_time: { pill: "bg-surface-muted text-ink-muted border-line", en: () => "", ar: () => "" },
  none: { pill: "", en: () => "", ar: () => "" },
};

export default function LabTrackingPage() {
  const { language, isRTL } = useLanguage();
  const { user } = useAuth();
  const { showToast, confirm } = useUI();
  const { branches, matches, activeBranchId } = useActiveBranch();
  const isAr = language === "ar";

  const [cases, setCases] = useState<LabCase[]>([]);
  const [labs, setLabs] = useState<DentalLab[]>([]);
  const [paper, setPaper] = useState<LabOrderPaper>(DEFAULT_LAB_PAPER);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [labFilter, setLabFilter] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LabCase | null>(null);
  const [busyId, setBusyId] = useState("");
  /** Cases, or what the clinic owes. Two different questions, so two views rather than one page. */
  const [view, setView] = useState<"cases" | "money">("cases");
  const [payments, setPayments] = useState<LabPayment[]>([]);
  const [remaking, setRemaking] = useState<LabCase | null>(null);

  const today = localYmd();

  // Ordered newest-first by the code number, which is also the order cases were raised in — and,
  // unlike createdAt, is a plain number on every record including any written by hand.
  useEffect(() => {
    const unsub = onSnapshot(
      query(getClinicCollection(LAB_CASES_COLLECTION), orderBy("codeNumber", "desc")),
      (snap) => {
        setCases(snap.docs.map((d) => toLabCase(d.id, d.data() as Record<string, unknown>)));
        setLoading(false);
      },
      (err) => {
        console.error("Lab cases subscription failed", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    getDoc(getClinicDoc("settings", LABS_SETTINGS_DOC))
      .then((snap) => {
        const data = snap.exists() ? snap.data() : null;
        setLabs(parseDentalLabs(data));
        setPaper(parseLabPaper(data));
      })
      .catch(() => {
        /* An unreadable directory still lets the board render what already exists. */
      });
  }, []);

  const branchScoped = useMemo(() => cases.filter((c) => matches(c.branchId)), [cases, matches]);

  const summary = useMemo(() => summarise(branchScoped, today), [branchScoped, today]);

  const visible = useMemo(() => {
    const q = search.trim();
    return branchScoped.filter((c) => {
      if (labFilter && c.labId !== labFilter) return false;

      if (statusFilter === "open") {
        if (statusFor(c.status).closed) return false;
      } else if (statusFilter === "out") {
        if (!statusFor(c.status).atLab) return false;
      } else if (statusFilter !== "all" && c.status !== statusFilter) {
        return false;
      }

      if (!q) return true;
      // The code is the primary key people actually use — somebody reads "142" off a bag.
      if (matchesLabCode(c.code, q)) return true;
      return matchesTokenizedSubstring(
        [c.patientName, c.patientPhone, c.labName, c.doctorName, c.workDescription].filter(Boolean).join(" "),
        q
      );
    });
  }, [branchScoped, search, statusFilter, labFilter]);

  const openNew = useCallback(() => {
    setEditing(null);
    setModalOpen(true);
  }, []);

  const handlePrint = useCallback(
    async (labCase: LabCase) => {
      setBusyId(labCase.id);
      try {
        const clinic = await loadLabOrderClinic(labCase.branchName);
        await printLabOrder({ labCase, clinic, language, paper });
        showToast(isAr ? "بيفتح أمر المعمل للطباعة" : "Opening the lab order to print", "success");
      } catch (err) {
        console.error("Lab order print failed", err);
        showToast(isAr ? "فشلت الطباعة" : "Could not print the order", "error");
      } finally {
        setBusyId("");
      }
    },
    [language, paper, showToast, isAr]
  );

  const handleAdvance = useCallback(
    async (labCase: LabCase, next: LabCaseStatus) => {
      setBusyId(labCase.id);
      try {
        await advanceLabCase(labCase, next, { by: user?.name });
        if (next === "back") {
          showToast(
            isAr
              ? `${labCase.code} وصلت — كلّم المريض واحجزله التركيب`
              : `${labCase.code} is back — call the patient and book the fitting`,
            "success"
          );
        } else {
          showToast(`${labCase.code} · ${statusLabel(next, language)}`, "success");
        }
      } catch (err) {
        console.error("Lab case status change failed", err);
        showToast(isAr ? "فشل التحديث" : "Could not update the case", "error");
      } finally {
        setBusyId("");
      }
    },
    [user, showToast, isAr, language]
  );

  /** Opens the dialog. The work happens in `confirmRemake` once fault and price are answered. */
  const handleRemake = useCallback((labCase: LabCase) => {
    setRemaking(labCase);
  }, []);

  const confirmRemake = useCallback(
    async (args: { reason: string; fault: NonNullable<LabCase["remakeFault"]>; agreedPrice: number }) => {
      if (!remaking) return;
      try {
        const created = await createRemake(remaking, { ...args, by: user?.name });
        showToast(
          isAr ? `اتعمل أمر إعادة ${created.code}` : `Remake ${created.code} raised`,
          "success"
        );
        setRemaking(null);
      } catch (err) {
        console.error("Remake failed", err);
        showToast(isAr ? "فشل إنشاء الإعادة" : "Could not raise the remake", "error");
      }
    },
    [remaking, isAr, showToast, user]
  );

  return (
    <PermissionGuard permission="access.lab">
      <div
        className={`min-h-screen bg-gradient-to-br from-slate-100/80 via-white to-slate-50 pb-24 lg:pb-8 flex flex-col font-sans text-slate-800 ${
          isRTL ? "text-right" : "text-left"
        }`}
        dir={isRTL ? "rtl" : "ltr"}
      >
        <div className="w-full max-w-[1920px] mx-auto px-4 md:px-6 xl:px-10 2xl:px-12 pt-6 xl:pt-10 pb-8 space-y-6 xl:space-y-8 flex-1 flex flex-col min-h-0 animate-in fade-in">
          {/* Page header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between shrink-0">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-accent">Alpha</p>
              <h1 className="text-2xl xl:text-3xl font-black text-ink tracking-tight mt-1">
                {isAr ? "متابعة المعمل" : "Lab Tracking"}
              </h1>
              <p className="text-ink-muted font-semibold text-sm mt-1">
                {isAr
                  ? "كل حالة خرجت للمعمل: فين دلوقتي، ومتى المفروض ترجع"
                  : "Every case out at a lab: where it is, and when it is due back"}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Two questions, not one screen: "where is the crown" and "what do we owe them" are
                  asked by different people on different days. */}
              <div className="flex rounded-xl bg-slate-100 p-1">
                {([
                  ["cases", isAr ? "الحالات" : "Cases"],
                  ["money", isAr ? "الحسابات" : "Money"],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setView(id)}
                    className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wide transition-colors ${
                      view === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {view === "cases" && (
                <button
                  onClick={openNew}
                  data-tour="lab-new-order"
                  className="inline-flex justify-center items-center gap-2 bg-slate-900 text-white hover:bg-slate-700 px-5 py-3 rounded-xl font-black text-xs uppercase tracking-wide shadow-md transition-colors"
                >
                  <Plus size={16} /> {isAr ? "أمر معمل جديد" : "New lab order"}
                </button>
              )}
            </div>
          </div>

          {view === "money" && (
            <LabAccountsPanel
              labs={labs}
              cases={branchScoped}
              payments={payments}
              currentUserName={user?.name}
            />
          )}

          {view === "cases" && (
          <>


          {/* Hero + counts */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 xl:gap-6 shrink-0">
            <div className="xl:col-span-5 rounded-3xl bg-slate-900 text-white p-6 xl:p-8 shadow-xl shadow-slate-900/25 relative overflow-hidden border border-slate-800">
              <div className="absolute -top-24 -end-24 w-72 h-72 rounded-full bg-accent-soft/15 blur-3xl pointer-events-none" aria-hidden />
              <div className="absolute -bottom-16 -start-16 w-56 h-56 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" aria-hidden />
              <div className="relative">
                <div className="flex items-center gap-2 text-slate-400">
                  <Truck className="w-4 h-4 text-accent-soft" />
                  <p className="text-xs font-bold uppercase tracking-widest">
                    {isAr ? "برّه في المعامل" : "Out at labs"}
                  </p>
                </div>
                <p className="text-4xl xl:text-5xl font-black mt-3 tabular-nums tracking-tight text-white">
                  {summary.atLab}
                </p>
                <p className="text-slate-500 text-sm mt-2 font-medium leading-snug">
                  {isAr
                    ? "حالات مسلّمة للمعمل ولسه ما رجعتش"
                    : "Cases handed over and not yet back"}
                </p>
                <dl className="mt-8 pt-6 border-t border-white/10 space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400 font-semibold">{isAr ? "متأخرة" : "Overdue"}</dt>
                    <dd className={`font-black tabular-nums ${summary.overdue > 0 ? "text-rose-300" : "text-ink-muted"}`}>
                      {summary.overdue}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400 font-semibold">{isAr ? "مستحقة الأسبوع ده" : "Due this week"}</dt>
                    <dd className="font-black tabular-nums text-amber-300">{summary.dueThisWeek}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400 font-semibold">{isAr ? "إجمالي الحالات" : "Cases in total"}</dt>
                    <dd className="font-black tabular-nums text-slate-300">{summary.total}</dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="xl:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Tile
                label={isAr ? "متأخرة" : "Overdue"}
                sub={isAr ? "عدّى ميعادها" : "Past the promised date"}
                value={summary.overdue}
                tone={summary.overdue > 0 ? "rose" : "slate"}
                icon={<AlertTriangle size={22} />}
                onClick={() => setStatusFilter("out")}
              />
              <Tile
                label={isAr ? "قرب ميعادها" : "Due this week"}
                sub={isAr ? "خلال ٧ أيام" : "Within seven days"}
                value={summary.dueThisWeek}
                tone="amber"
                icon={<CalendarClock size={22} />}
                onClick={() => setStatusFilter("out")}
              />
              <Tile
                label={isAr ? "وصلت ومستنية المريض" : "Back — waiting for the patient"}
                sub={isAr ? "محتاجة مكالمة وحجز" : "Needs a call and a fitting booked"}
                value={summary.waitingForPatient}
                tone={summary.waitingForPatient > 0 ? "emerald" : "slate"}
                icon={<Inbox size={22} />}
                onClick={() => setStatusFilter("back")}
              />
              <Tile
                label={isAr ? "معامل مسجلة" : "Labs on file"}
                sub={isAr ? "الإعدادات ← المعامل" : "Settings → Dental Labs"}
                value={labs.length}
                tone="sky"
                icon={<FlaskConical size={22} />}
              />
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col lg:flex-row gap-3 shrink-0">
            <div className="relative flex-1 min-w-0">
              <Search size={16} className="absolute start-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  isAr ? "دور بالكود (142) أو اسم المريض أو المعمل…" : "Search the code (142), patient, or lab…"
                }
                className="w-full ps-11 pe-4 py-3 bg-surface border border-line rounded-2xl text-sm font-bold text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 transition-all"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute end-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 rounded-lg"
                  aria-label={isAr ? "مسح" : "Clear"}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="px-4 py-3 bg-surface border border-line rounded-2xl text-sm font-bold text-slate-700 focus:outline-none focus:border-sky-500 transition-all"
              >
                <option value="open">{isAr ? "الشغّالة" : "Open cases"}</option>
                <option value="all">{isAr ? "الكل" : "All"}</option>
                {LAB_CASE_STATUSES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {isAr ? s.ar : s.en}
                  </option>
                ))}
              </select>
              <select
                value={labFilter}
                onChange={(e) => setLabFilter(e.target.value)}
                className="px-4 py-3 bg-surface border border-line rounded-2xl text-sm font-bold text-slate-700 focus:outline-none focus:border-sky-500 transition-all"
              >
                <option value="">{isAr ? "كل المعامل" : "All labs"}</option>
                {labs.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* The board */}
          <div className="bg-surface border border-slate-200/80 rounded-2xl xl:rounded-3xl shadow-sm ring-1 ring-slate-100 overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
              </div>
            ) : visible.length === 0 ? (
              <div className="py-20 px-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-surface-subtle text-slate-300 flex items-center justify-center mx-auto mb-4">
                  <FlaskConical size={26} />
                </div>
                <p className="text-sm font-bold text-ink-muted">
                  {cases.length === 0
                    ? isAr
                      ? "مفيش حالات معمل لسه."
                      : "No lab cases yet."
                    : isAr
                      ? "مفيش حالات مطابقة للفلاتر."
                      : "No cases match these filters."}
                </p>
                {cases.length === 0 && (
                  <p className="text-xs font-semibold text-slate-400 mt-2 max-w-sm mx-auto leading-relaxed">
                    {isAr
                      ? "أول أمر معمل تعمله هياخد كود زي MAD-0001 — اطبعه، وحطه مع الشغل، واكتب الرقم على الكيس."
                      : "Your first order gets a code like MAD-0001 — print it, put it in the bag, and write the number on the bag itself."}
                  </p>
                )}
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {visible.map((c) => (
                  <CaseRow
                    key={c.id}
                    labCase={c}
                    today={today}
                    language={language}
                    busy={busyId === c.id}
                    onPrint={() => void handlePrint(c)}
                    onEdit={() => {
                      setEditing(c);
                      setModalOpen(true);
                    }}
                    onAdvance={(next) => void handleAdvance(c, next)}
                    onRemake={() => void handleRemake(c)}
                  />
                ))}
              </div>
            )}
          </div>
          </>
          )}
        </div>
      </div>

      <LabRemakeModal
        open={Boolean(remaking)}
        labCase={remaking}
        onClose={() => setRemaking(null)}
        onConfirm={confirmRemake}
      />

      <LabCaseModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        existing={editing}
        labs={labs}
        branches={branches}
        defaultBranchId={activeBranchId && activeBranchId !== "__all__" ? activeBranchId : ""}
        currentUserName={user?.name}
        onSaved={() => setModalOpen(false)}
      />
    </PermissionGuard>
  );
}

// ---------------------------------------------------------------------------

function Tile({
  label,
  sub,
  value,
  tone,
  icon,
  onClick,
}: {
  label: string;
  sub: string;
  value: number;
  tone: "rose" | "amber" | "emerald" | "sky" | "slate";
  icon: React.ReactNode;
  onClick?: () => void;
}) {
  const tones: Record<string, { chip: string; text: string }> = {
    rose: { chip: "bg-rose-50 text-rose-600", text: "text-rose-600" },
    amber: { chip: "bg-amber-50 text-amber-600", text: "text-amber-600" },
    emerald: { chip: "bg-emerald-50 text-emerald-600", text: "text-emerald-600" },
    sky: { chip: "bg-sky-50 text-sky-600", text: "text-sky-600" },
    slate: { chip: "bg-surface-muted text-slate-400", text: "text-slate-400" },
  };
  const t = tones[tone];
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      {...(onClick ? { onClick, type: "button" as const } : {})}
      className={`rounded-2xl xl:rounded-3xl bg-surface border border-slate-200/80 p-5 xl:p-6 shadow-sm flex flex-col justify-between min-h-[120px] ring-1 ring-slate-100 text-start ${
        onClick ? "hover:border-line-strong transition-colors" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-black text-slate-400 uppercase tracking-wider">{label}</p>
          <p className="text-xs text-ink-muted mt-1 font-medium">{sub}</p>
        </div>
        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${t.chip}`}>{icon}</div>
      </div>
      <p className={`text-2xl xl:text-3xl font-black tabular-nums mt-4 ${t.text}`}>{value}</p>
    </Wrapper>
  );
}

function CaseRow({
  labCase,
  today,
  language,
  busy,
  onPrint,
  onEdit,
  onAdvance,
  onRemake,
}: {
  labCase: LabCase;
  today: string;
  language: "en" | "ar";
  busy: boolean;
  onPrint: () => void;
  onEdit: () => void;
  onAdvance: (next: LabCaseStatus) => void;
  onRemake: () => void;
}) {
  const isAr = language === "ar";
  const status = statusFor(labCase.status);
  const due = dueStateFor(labCase, today);
  const dueDays = labCase.dueDate
    ? Math.abs(Math.round((Date.parse(`${labCase.dueDate}T00:00:00`) - Date.parse(`${today}T00:00:00`)) / 86_400_000))
    : 0;
  const moves = nextStatuses(labCase.status, labCase.needsTryIn);

  const workLine = [
    workTypeLabel(labCase.workType, language),
    labCase.workDescription,
    labCase.teeth.length ? `FDI ${labCase.teeth.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4 p-4 hover:bg-slate-50/60 transition-colors">
      {/* Code */}
      <div className="lg:w-32 shrink-0">
        <p className="text-sm font-black text-ink tabular-nums tracking-tight" dir="ltr">
          {labCase.code}
        </p>
        <p className="text-[11px] font-bold text-slate-400 mt-0.5">{labCase.labName || "—"}</p>
      </div>

      {/* Who and what */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-700 truncate">
          {labCase.patientName || (isAr ? "بدون مريض" : "No patient")}
        </p>
        <p className="text-xs font-semibold text-slate-400 truncate mt-0.5">{workLine}</p>
      </div>

      {/* State */}
      <div className="flex items-center gap-2 flex-wrap lg:w-64 shrink-0">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wide ${status.pill}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
          {isAr ? status.ar : status.en}
        </span>
        {due !== "none" && due !== "on_time" && (
          <span className={`px-2.5 py-1 rounded-lg text-[11px] font-black uppercase tracking-wide border ${DUE_STYLE[due].pill}`}>
            {isAr ? DUE_STYLE[due].ar(dueDays) : DUE_STYLE[due].en(dueDays)}
          </span>
        )}
        {due === "on_time" && labCase.dueDate && (
          <span className="text-[11px] font-bold text-slate-400 tabular-nums" dir="ltr">
            {labCase.dueDate}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0 flex-wrap">
        {busy ? (
          <Loader2 size={16} className="text-slate-400 animate-spin mx-3" />
        ) : (
          <>
            {moves.slice(0, 2).map((next) => (
              <button
                key={next}
                onClick={() => onAdvance(next)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-900 hover:text-white text-slate-700 text-[11px] font-black uppercase tracking-wide transition-colors"
              >
                {next === "back" ? <Check size={13} /> : <ChevronRight size={13} className={isAr ? "rotate-180" : ""} />}
                {statusLabel(next, language)}
              </button>
            ))}
            <button
              onClick={onPrint}
              className="p-2 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors"
              aria-label={isAr ? "طباعة الأمر" : "Print the order"}
              title={isAr ? "طباعة الأمر" : "Print the order"}
            >
              <Printer size={16} />
            </button>
            <button
              onClick={onEdit}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-surface-muted rounded-lg transition-colors"
              aria-label={isAr ? "تعديل" : "Edit"}
              title={isAr ? "تعديل" : "Edit"}
            >
              <Pencil size={16} />
            </button>
            {!statusFor(labCase.status).closed && labCase.status !== "draft" && (
              <button
                onClick={onRemake}
                className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                aria-label={isAr ? "إعادة عمل" : "Remake"}
                title={isAr ? "إعادة عمل" : "Remake"}
              >
                <RotateCcw size={16} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
