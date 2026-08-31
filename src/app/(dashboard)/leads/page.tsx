"use client";

import { deleteRecord, RecycleBinError } from "@/lib/recycleBinApi";
import { useClinic } from "@/context/ClinicContext";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Plus, Phone, MessageCircle, Search, ChevronDown, X, Loader2,
  UserPlus, Building2, CalendarClock, Trash2, Inbox, Check, UserCheck, Copy, Hourglass, Timer,
} from "lucide-react";
import { onSnapshot, orderBy, query, addDoc, updateDoc, deleteDoc, serverTimestamp, getDoc } from "firebase/firestore";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useUI } from "@/context/UIContext";
import PermissionGuard from "@/components/PermissionGuard";
import { logActivity } from "@/lib/logger";
import { LOCATIONS_DOC, parseClinicBranches, type ClinicBranch } from "@/lib/clinicLocations";
import {
  DEFAULT_LEAD_SOURCES, LEAD_STAGES, findOrCreatePatientForLead, findLeadMatches,
  isLeadStale, STALE_AFTER_DAYS, leadStageLabel, leadStageStyles, type Lead, type LeadStage,
} from "@/lib/leads";
import {
  DEFAULT_COUNTRY_CODE, COUNTRY_CODE_OPTIONS, buildE164FromCountryCode,
} from "@/lib/phoneNumber";
import { SourceIcon } from "@/components/SourceIcon";

/**
 * The Leads inbox — the CRM's front door.
 *
 * Built list-first rather than as a kanban board: the person using it most is reception, on a
 * phone, between patients. Due follow-ups float to the top; everything else is newest first.
 */
export default function LeadsPage() {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { user } = useAuth();
  const { clinicId, isAdmin } = useClinic();
  const { showToast, confirm, prompt } = useUI();
  const router = useRouter();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * Speed-to-lead clock. Ads leads answered within minutes convert several times better than
   * ones answered hours later, so every untouched lead wears its waiting time — amber while
   * fresh, red once it crosses the mark where conversion measurably drops.
   */
  const [nowSec, setNowSec] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNowSec(Date.now() / 1000), 30_000);
    return () => clearInterval(t);
  }, []);
  const SPEED_TO_LEAD_RED_MINUTES = 15;
  const waitingLabel = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    if (m < 60) return isAr ? `${m} د` : `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return isAr ? `${h} س` : `${h}h`;
    return isAr ? `${Math.floor(h / 24)} يوم` : `${Math.floor(h / 24)}d`;
  };
  const [branches, setBranches] = useState<ClinicBranch[]>([]);
  const [sources, setSources] = useState<string[]>(DEFAULT_LEAD_SOURCES);
  const [servicesList, setServicesList] = useState<string[]>([]);

  const [stageFilter, setStageFilter] = useState<"active" | LeadStage>("active");
  const [sourceFilter, setSourceFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [searchText, setSearchText] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [saving, setSaving] = useState(false);
  const [convertingId, setConvertingId] = useState("");

  // Quick-add form
  const emptyForm = {
    name: "", phone: "", countryCode: DEFAULT_COUNTRY_CODE, interest: "",
    source: "", branchId: "", followUpDate: "", notes: "",
  };
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(getClinicCollection("leads"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setLeads(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Lead)));
      setLoading(false);
    });
    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    getDoc(getClinicDoc("settings", LOCATIONS_DOC)).then((snap) => {
      setBranches(parseClinicBranches(snap.exists() ? snap.data() : null));
    });
    getDoc(getClinicDoc("settings", "patient_sources")).then((snap) => {
      const own = snap.exists() && Array.isArray(snap.data().sources) ? snap.data().sources : [];
      // The clinic's own sources first, then the CRM defaults they haven't defined themselves.
      const merged = [...own, ...DEFAULT_LEAD_SOURCES.filter((s) => !own.includes(s))];
      setSources(merged);
    });
    const unsubServices = onSnapshot(getClinicCollection("services"), (snap) => {
      setServicesList(snap.docs.map((d) => String(d.data().name || "")).filter(Boolean));
    });
    return () => unsubServices();
  }, [user]);

  const todayStr = useMemo(() => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split("T")[0];
  }, []);

  const isDue = (l: Lead) => Boolean(l.followUpDate && l.followUpDate <= todayStr && l.stage !== "won" && l.stage !== "lost");

  const filtered = useMemo(() => {
    const base = leads.filter((l) => {
      if (stageFilter === "active") {
        if (l.stage === "won" || l.stage === "lost") return false;
      } else if (l.stage !== stageFilter) return false;
      if (sourceFilter && l.source !== sourceFilter) return false;
      if (branchFilter && l.branchId && l.branchId !== branchFilter) return false;
      if (branchFilter && !l.branchId) return false;
      if (searchText) {
        const q = searchText.toLowerCase().trim();
        // Interest and notes carry the Facebook campaign and ad name, so typing "veneer"
        // pulls up that campaign's leads without needing a filter of its own.
        const haystack = [l.name, l.phone, l.interest, l.notes].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    // Due follow-ups first (oldest due first), then newest leads.
    return base.sort((a, b) => {
      const dueA = isDue(a) ? 0 : 1;
      const dueB = isDue(b) ? 0 : 1;
      if (dueA !== dueB) return dueA - dueB;
      if (dueA === 0) return (a.followUpDate || "").localeCompare(b.followUpDate || "");
      return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
    });
  }, [leads, stageFilter, sourceFilter, branchFilter, searchText, todayStr]);

  // This month's numbers — the "is the marketing working" strip.
  const stats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
    const monthLeads = leads.filter((l) => (l.createdAt?.seconds || 0) >= monthStart);
    const won = monthLeads.filter((l) => l.stage === "won").length;
    const bySource = new Map<string, { total: number; won: number }>();
    monthLeads.forEach((l) => {
      const key = l.source || "—";
      const row = bySource.get(key) || { total: 0, won: 0 };
      row.total++;
      if (l.stage === "won") row.won++;
      bySource.set(key, row);
    });
    const top = Array.from(bySource.entries()).sort((a, b) => b[1].total - a[1].total);
    return { total: monthLeads.length, won, dueToday: leads.filter(isDue).length, bySource: top };
  }, [leads, todayStr]);

  const openAdd = () => {
    setEditingLead(null);
    setForm({ ...emptyForm, branchId: branches.length === 1 ? branches[0].id : "" });
    setShowAdd(true);
  };

  const openEdit = (lead: Lead) => {
    setEditingLead(lead);
    setForm({
      name: lead.name || "", phone: lead.phone || "", countryCode: DEFAULT_COUNTRY_CODE,
      interest: lead.interest || "", source: lead.source || "",
      branchId: lead.branchId || "", followUpDate: lead.followUpDate || "", notes: lead.notes || "",
    });
    setShowAdd(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.phone.trim()) {
      showToast(isAr ? "الاسم ورقم الموبايل مطلوبين" : "Name and phone are required", "error");
      return;
    }
    setSaving(true);
    try {
      // Already-E.164 input (editing an existing lead) passes through untouched.
      const phone = form.phone.trim().startsWith("+")
        ? form.phone.trim()
        : buildE164FromCountryCode(form.countryCode, form.phone);
      const branch = branches.find((b) => b.id === form.branchId) || null;
      const payload = {
        name: form.name.trim(),
        phone,
        interest: form.interest.trim(),
        source: form.source || (isAr ? "غير محدد" : "Unspecified"),
        branchId: branch?.id || null,
        branchName: branch?.name || null,
        followUpDate: form.followUpDate || null,
        notes: form.notes.trim(),
        updatedAt: serverTimestamp(),
      };
      if (editingLead) {
        await updateDoc(getClinicDoc("leads", editingLead.id), payload);
      } else {
        // What does the clinic already know about this number? Reception should see it on
        // the card, not discover it halfway through a call.
        const matches = await findLeadMatches(phone);
        await addDoc(getClinicCollection("leads"), {
          ...payload,
          stage: "new",
          patientId: null,
          lostReason: null,
          ...matches,
          createdBy: user?.name || "",
          createdAt: serverTimestamp(),
          stageChangedAt: serverTimestamp(),
        });
        await logActivity(
          { uid: user?.uid, name: user?.name, role: user?.role },
          "Lead added",
          `${payload.name} (${payload.source})`
        );
      }
      setShowAdd(false);
      showToast(isAr ? "تم الحفظ" : "Saved", "success");
    } catch (e) {
      console.error("Lead save error:", e);
      showToast(isAr ? "حصل خطأ" : "Error saving lead", "error");
    } finally {
      setSaving(false);
    }
  };

  const setStage = async (lead: Lead, stage: LeadStage) => {
    try {
      let lostReason: string | null = lead.lostReason || null;
      if (stage === "lost") {
        const reason = await prompt(
          isAr ? "ليه العميل ده ضاع؟ ده بيوضح فين الفلوس بتضيع." : "Why did this lead not convert? This is what shows you where leads leak.",
          {
            title: isAr ? "سبب الخسارة" : "Reason for losing",
            placeholder: isAr ? "اكتب السبب…" : "Type the reason…",
            defaultValue: lead.lostReason || "",
            suggestions: isAr
              ? ["السعر غالي", "المسافة بعيدة", "مفيش رد", "راح لعيادة تانية", "مجرد استفسار"]
              : ["Price too high", "Too far", "No reply", "Went elsewhere", "Just asking"],
            confirmLabel: isAr ? "علّمه كمفقود" : "Mark as lost",
          }
        );
        // Dismissing the question must not quietly mark the lead lost — leave it as it was.
        if (reason === null) return;
        lostReason = reason.trim() || null;
      }
      const patch: Record<string, unknown> = {
        stage,
        lostReason,
        updatedAt: serverTimestamp(),
        stageChangedAt: serverTimestamp(),
      };
      // The moment a lead stops being untouched, recorded once. Everything the funnel says
      // about speed of reply is measured from here, so a later stage change must not move it.
      if (stage !== "new" && !lead.firstContactedAt) patch.firstContactedAt = serverTimestamp();
      await updateDoc(getClinicDoc("leads", lead.id), patch);
    } catch (e) {
      console.error("Stage change error:", e);
      showToast(isAr ? "حصل خطأ" : "Error", "error");
    }
  };

  /** Lead → patient. Links to an existing record when the phone already exists. */
  const handleConvert = async (lead: Lead) => {
    setConvertingId(lead.id);
    try {
      const { patientId, existed } = await findOrCreatePatientForLead({
        name: lead.name, phone: lead.phone, source: lead.source,
      });
      await updateDoc(getClinicDoc("leads", lead.id), {
        stage: "won",
        patientId,
        // `existed` is the authoritative answer to "did this channel bring a new patient?" —
        // the funnel counts a returning patient's money in its own column.
        isReturningPatient: existed,
        updatedAt: serverTimestamp(),
        stageChangedAt: serverTimestamp(),
        ...(lead.firstContactedAt ? {} : { firstContactedAt: serverTimestamp() }),
      });
      await logActivity(
        { uid: user?.uid, name: user?.name, role: user?.role },
        "Lead converted",
        `${lead.name} → patient ${patientId}`
      );
      showToast(
        existed
          ? (isAr ? "الرقم ده مسجل بالفعل — تم الربط بالمريض الموجود" : "Phone already registered — linked to the existing patient")
          : (isAr ? "تم إنشاء ملف المريض" : "Patient file created"),
        "success"
      );
      const book = await confirm(isAr ? "تحب تحجز له موعد دلوقتي؟" : "Book an appointment now?", {
        title: isAr ? "تم التحويل لمريض" : "Converted to patient",
        confirmLabel: isAr ? "احجز موعد" : "Book appointment",
        cancelLabel: isAr ? "لاحقاً" : "Later",
      });
      if (book) router.push(`/appointments?book=${patientId}`);
    } catch (e) {
      console.error("Convert error:", e);
      showToast(isAr ? "حصل خطأ في التحويل" : "Error converting lead", "error");
    } finally {
      setConvertingId("");
    }
  };

  const handleDelete = async (lead: Lead) => {
    if (!(await confirm(isAr ? "حذف هذا العميل المحتمل؟" : "Delete this lead?"))) return;
    try {
      await deleteRecord(clinicId || "", "leads", lead.id);
      showToast(isAr ? "تم النقل إلى المحذوفات" : "Moved to Recently Deleted", "success");
    } catch (err) {
      showToast(err instanceof RecycleBinError ? err.message : isAr ? "حصل خطأ" : "Error", "error");
    }
  };

  const waLink = (lead: Lead) => {
    const digits = lead.phone.replace(/\D/g, "");
    const text = encodeURIComponent(
      isAr
        ? `أهلاً ${lead.name}، معاك العيادة. حضرتك كنت سألت عن ${lead.interest || "موعد"} — نحب نساعدك تحجز.`
        : `Hello ${lead.name}, this is the clinic. You asked about ${lead.interest || "an appointment"} — happy to help you book.`
    );
    return `https://wa.me/${digits}?text=${text}`;
  };

  const stageTabs: Array<{ id: "active" | LeadStage; label: string }> = [
    { id: "active", label: isAr ? "النشطة" : "Active" },
    ...LEAD_STAGES.map((s) => ({ id: s, label: leadStageLabel(s, isAr ? "ar" : "en") })),
  ];

  return (
    <PermissionGuard permission="access.patients">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 xl:px-10 py-5 sm:py-8">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-600 text-white shadow-md shrink-0">
              <Inbox size={20} />
            </span>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                {isAr ? "العملاء المحتملين" : "Leads"}
              </h1>
              <p className="text-xs text-ink-muted font-medium">
                {isAr ? "كل اللي سألوا ولسه محجزوش" : "Everyone who asked but hasn't booked yet"}
              </p>
            </div>
          </div>
          <button
            data-tour="leads-add" onClick={openAdd}
            className="bg-[#FACC15] hover:bg-[#EAB308] text-ink font-black px-4 sm:px-5 py-2.5 rounded-xl shadow-sm flex items-center gap-2 transition-all active:scale-95"
          >
            <Plus size={18} strokeWidth={3} /> {isAr ? "إضافة" : "Add lead"}
          </button>
        </div>

        {/* Month stats */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
          <div className="bg-surface rounded-2xl border border-slate-100 shadow-sm p-3 sm:p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{isAr ? "هذا الشهر" : "This month"}</p>
            <p className="text-2xl font-black text-ink mt-1">{stats.total}</p>
            <p className="text-[11px] font-bold text-ink-muted">{isAr ? "عميل محتمل" : "leads"}</p>
          </div>
          <div className="bg-surface rounded-2xl border border-slate-100 shadow-sm p-3 sm:p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{isAr ? "وصلوا للكرسي" : "In the chair"}</p>
            <p className="text-2xl font-black text-emerald-600 mt-1">{stats.won}</p>
            <p className="text-[11px] font-bold text-ink-muted">
              {stats.total > 0 ? `${Math.round((stats.won / stats.total) * 100)}%` : "—"}
            </p>
          </div>
          <div className="bg-surface rounded-2xl border border-slate-100 shadow-sm p-3 sm:p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{isAr ? "متابعة اليوم" : "Due today"}</p>
            <p className={`text-2xl font-black mt-1 ${stats.dueToday > 0 ? "text-amber-600" : "text-ink"}`}>{stats.dueToday}</p>
            <p className="text-[11px] font-bold text-ink-muted">{isAr ? "محتاجين رد" : "need a reply"}</p>
          </div>
        </div>

        {/* Source breakdown */}
        {stats.bySource.length > 0 && (
          <details className="bg-surface rounded-2xl border border-slate-100 shadow-sm mb-4 group">
            <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between text-sm font-black text-slate-700 [&::-webkit-details-marker]:hidden">
              {isAr ? "حسب المصدر (هذا الشهر)" : "By source (this month)"}
              <ChevronDown size={16} className="text-slate-400 group-open:rotate-180 transition-transform" />
            </summary>
            <div className="px-4 pb-3 divide-y divide-slate-50">
              {stats.bySource.map(([source, row]) => (
                <div key={source} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-bold text-slate-700 flex items-center gap-2">
                    <SourceIcon source={source} size={16} /> {source}
                  </span>
                  <span className="font-bold text-ink-muted tabular-nums">
                    {row.total} {isAr ? "→ كرسي" : "→ chair"} <span className="text-emerald-600">{row.won}</span>
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Filters */}
        <div className="flex flex-col gap-2 mb-4">
          <div className="flex bg-surface-muted p-1 rounded-xl gap-1 overflow-x-auto no-scrollbar">
            {stageTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStageFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${stageFilter === tab.id ? "bg-surface text-slate-800 shadow-sm" : "text-ink-muted hover:text-slate-800"}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[160px]">
              <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder={isAr ? "دور بالاسم أو الرقم أو الحملة…" : "Search name, phone or campaign…"}
                className="w-full ps-9 pe-3 py-2 bg-surface border border-line rounded-xl text-sm font-bold text-slate-700 outline-none focus:border-teal-500"
              />
            </div>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="bg-surface border border-line rounded-xl px-3 py-2 text-xs font-bold text-ink-body outline-none focus:border-teal-500"
            >
              <option value="">{isAr ? "كل المصادر" : "All sources"}</option>
              {sources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {branches.length > 0 && (
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="bg-surface border border-line rounded-xl px-3 py-2 text-xs font-bold text-ink-body outline-none focus:border-teal-500"
              >
                <option value="">{isAr ? "كل الفروع" : "All branches"}</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 bg-surface rounded-2xl border border-dashed border-line">
            <p className="text-slate-400 font-bold text-sm">
              {leads.length === 0
                ? (isAr ? "مفيش عملاء محتملين لسه. أول حد يسأل — سجّله هنا بزر الإضافة." : "No leads yet. The next person who asks — add them with the button above.")
                : (isAr ? "مفيش نتائج للفلتر ده." : "Nothing matches this filter.")}
            </p>
          </div>
        ) : (
          <div className="space-y-2 pb-24">
            {filtered.map((lead) => {
              const styles = leadStageStyles(lead.stage);
              const due = isDue(lead);
              const stale = isLeadStale(lead);
              return (
                <div key={lead.id} className={`bg-surface rounded-2xl border shadow-sm p-3 sm:p-4 ${due ? "border-amber-300 ring-1 ring-amber-200" : "border-slate-100"}`}>
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-extrabold text-ink text-sm sm:text-base truncate">{lead.name}</h3>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${styles.pill}`}>
                          {leadStageLabel(lead.stage, isAr ? "ar" : "en")}
                        </span>
                        {lead.stage === "new" && lead.createdAt?.seconds ? (() => {
                          const waited = Math.max(0, nowSec - lead.createdAt.seconds);
                          const late = waited >= SPEED_TO_LEAD_RED_MINUTES * 60;
                          return (
                            <span
                              className={`text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-1 ${
                                late ? "bg-rose-100 text-rose-600 animate-pulse" : "bg-amber-50 text-amber-700"
                              }`}
                              title={isAr ? "من غير رد من ساعة ما وصل — الرد في أول دقايق بيكسب العميل" : "Unanswered since it arrived — the first minutes win the lead"}
                            >
                              <Timer size={10} /> {isAr ? `مستني ${waitingLabel(waited)}` : `waiting ${waitingLabel(waited)}`}
                            </span>
                          );
                        })() : null}
                        {due && (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 flex items-center gap-1">
                            <CalendarClock size={10} /> {lead.followUpDate === todayStr ? (isAr ? "متابعة اليوم" : "due today") : (isAr ? "متأخرة" : "overdue")}
                          </span>
                        )}
                        {/* What the clinic already knows about this number — before the call, not during it. */}
                        {lead.existingPatientId && (
                          <button
                            onClick={() => router.push(`/patients/${lead.existingPatientId}`)}
                            className="text-[10px] font-black px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 flex items-center gap-1 hover:bg-violet-200 transition-colors"
                            title={lead.existingPatientName || ""}
                          >
                            <UserCheck size={10} /> {isAr ? "مريض عندنا" : "already a patient"}
                          </button>
                        )}
                        {lead.duplicateOfLeadId && (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 flex items-center gap-1">
                            <Copy size={10} /> {isAr ? "سأل قبل كده" : "asked before"}
                          </span>
                        )}
                        {lead.welcomeMessage?.status === "sent" && (
                          <span
                            className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-1"
                            title={lead.welcomeMessage.text || ""}
                          >
                            <MessageCircle size={10} /> {isAr ? "اتبعتله رد" : "auto-replied"}
                          </span>
                        )}
                        {lead.welcomeMessage?.status === "queued" && (
                          <span
                            className="text-[10px] font-black px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 flex items-center gap-1"
                            title={lead.welcomeMessage.text || ""}
                          >
                            <MessageCircle size={10} /> {isAr ? "رد جاهز للإرسال" : "reply waiting to send"}
                          </span>
                        )}
                        {stale && (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-200 text-ink-body flex items-center gap-1">
                            <Hourglass size={10} /> {isAr ? `ساكن ${STALE_AFTER_DAYS}+ يوم` : `${STALE_AFTER_DAYS}+ days quiet`}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-ink-muted font-bold mt-1" dir="ltr">{lead.phone}</p>
                      <p className="text-xs text-ink-body font-medium mt-1 truncate flex items-center gap-1.5">
                        {lead.source && <SourceIcon source={lead.source} size={14} />}
                        <span className="truncate">{[lead.interest, lead.source, lead.branchName].filter(Boolean).join(" · ")}</span>
                      </p>
                      {lead.notes && <p className="text-[11px] text-slate-400 font-medium mt-1 line-clamp-2">{lead.notes}</p>}
                      {lead.stage === "lost" && lead.lostReason && (
                        <p className="text-[11px] text-rose-500 font-bold mt-1">{isAr ? "السبب:" : "Reason:"} {lead.lostReason}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <a
                        href={waLink(lead)} target="_blank" rel="noopener noreferrer"
                        onClick={() => { if (lead.stage === "new") void setStage(lead, "contacted"); }}
                        className="p-2 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
                        title="WhatsApp"
                      >
                        <MessageCircle size={16} />
                      </a>
                      <a href={`tel:${lead.phone}`} className="p-2 rounded-xl bg-surface-subtle text-ink-muted hover:bg-surface-muted transition-colors" title={isAr ? "اتصال" : "Call"}>
                        <Phone size={16} />
                      </a>
                      {lead.stage !== "won" && (
                        <button
                          onClick={() => void handleConvert(lead)}
                          disabled={convertingId === lead.id}
                          className="p-2 rounded-xl bg-teal-50 text-teal-700 hover:bg-teal-100 transition-colors disabled:opacity-50"
                          title={isAr ? "تحويل لمريض" : "Convert to patient"}
                        >
                          {convertingId === lead.id ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                        </button>
                      )}
                      {lead.stage === "won" && lead.patientId && (
                        <button
                          onClick={() => router.push(`/patients/${lead.patientId}`)}
                          className="p-2 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                          title={isAr ? "ملف المريض" : "Patient file"}
                        >
                          <Check size={16} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Stage + row actions */}
                  <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-slate-50 flex-wrap">
                    <select
                      value={lead.stage} data-tour="leads-stage"
                      onChange={(e) => void setStage(lead, e.target.value as LeadStage)}
                      className="bg-surface-subtle border border-line rounded-lg px-2 py-1.5 text-[11px] font-bold text-ink-body outline-none focus:border-teal-500"
                    >
                      {LEAD_STAGES.map((s) => (
                        <option key={s} value={s}>{leadStageLabel(s, isAr ? "ar" : "en")}</option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(lead)} className="text-[11px] font-bold text-ink-muted hover:text-slate-800 px-2 py-1 rounded-lg hover:bg-surface-subtle transition-colors">
                        {isAr ? "تعديل" : "Edit"}
                      </button>
                      {isAdmin && (
                        <button onClick={() => void handleDelete(lead)} className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Quick-add / edit sheet — portalled to <body> like BookingModal: the layout's
            content wrapper is its own stacking context, so a fixed overlay rendered inside
            it would paint under the mobile bottom nav. */}
        {showAdd && portalTarget && createPortal(
          <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-slate-900/55 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92vh] overflow-y-auto">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white">
                <h2 className="font-black text-slate-900">
                  {editingLead ? (isAr ? "تعديل" : "Edit lead") : (isAr ? "عميل محتمل جديد" : "New lead")}
                </h2>
                <button onClick={() => setShowAdd(false)} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-surface-muted rounded-full transition-colors"><X size={18} /></button>
              </div>
              <div className="p-5 space-y-3">
                <input
                  autoFocus
                  value={form.name} data-tour="leads-name"
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder={isAr ? "الاسم *" : "Name *"}
                  className="w-full px-4 py-3 bg-surface-subtle border border-line rounded-xl text-sm font-bold text-slate-800 outline-none focus:border-teal-500"
                />
                <div className="flex gap-2">
                  {!form.phone.startsWith("+") && (
                    <select
                      value={form.countryCode}
                      onChange={(e) => setForm((f) => ({ ...f, countryCode: e.target.value }))}
                      className="w-28 px-2 py-3 bg-surface-subtle border border-line rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-teal-500"
                    >
                      {COUNTRY_CODE_OPTIONS.map((opt) => (
                        <option key={opt.code} value={opt.code}>{opt.code} {opt.label.split(" ")[0]}</option>
                      ))}
                    </select>
                  )}
                  <input
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder={isAr ? "رقم الموبايل *" : "Phone *"}
                    dir="ltr"
                    className="flex-1 px-4 py-3 bg-surface-subtle border border-line rounded-xl text-sm font-bold text-slate-800 outline-none focus:border-teal-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={form.source}
                    onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                    className="px-3 py-3 bg-surface-subtle border border-line rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-teal-500"
                  >
                    <option value="">{isAr ? "المصدر…" : "Source…"}</option>
                    {sources.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <input
                    list="lead-interests"
                    value={form.interest}
                    onChange={(e) => setForm((f) => ({ ...f, interest: e.target.value }))}
                    placeholder={isAr ? "سأل عن…" : "Asked about…"}
                    className="px-3 py-3 bg-surface-subtle border border-line rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-teal-500 min-w-0"
                  />
                  <datalist id="lead-interests">
                    {servicesList.map((s) => <option key={s} value={s} />)}
                  </datalist>
                </div>
                {branches.length > 0 && (
                  <div className="relative">
                    <Building2 size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-teal-600 pointer-events-none" />
                    <select
                      value={form.branchId}
                      onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}
                      className="w-full ps-9 pe-3 py-3 bg-surface-subtle border border-line rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-teal-500 appearance-none"
                    >
                      <option value="">{isAr ? "الفرع (اختياري)" : "Branch (optional)"}</option>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">
                    {isAr ? "متابعة يوم" : "Follow up on"}
                  </label>
                  <input
                    type="date"
                    value={form.followUpDate}
                    min={todayStr}
                    onChange={(e) => setForm((f) => ({ ...f, followUpDate: e.target.value }))}
                    className="w-full px-4 py-3 bg-surface-subtle border border-line rounded-xl text-sm font-bold text-slate-700 outline-none focus:border-teal-500"
                  />
                </div>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder={isAr ? "ملاحظات…" : "Notes…"}
                  rows={2}
                  className="w-full px-4 py-3 bg-surface-subtle border border-line rounded-xl text-sm font-medium text-slate-700 outline-none focus:border-teal-500 resize-none"
                />
              </div>
              <div className="flex gap-2 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))]">
                <button onClick={() => setShowAdd(false)} className="flex-1 py-3 rounded-xl border border-line bg-surface text-xs font-black uppercase tracking-wide text-ink-body hover:bg-surface-subtle transition-colors">
                  {isAr ? "إلغاء" : "Cancel"}
                </button>
                <button
                  onClick={() => void handleSave()} data-tour="leads-save"
                  disabled={saving || !form.name.trim() || !form.phone.trim()}
                  className="flex-[2] py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-black uppercase tracking-widest shadow-md transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {isAr ? "حفظ" : "Save"}
                </button>
              </div>
            </div>
          </div>,
          portalTarget
        )}
      </div>
    </PermissionGuard>
  );
}
