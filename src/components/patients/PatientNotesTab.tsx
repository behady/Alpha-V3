"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onSnapshot, query, where } from "firebase/firestore";
import {
  Activity,
  CalendarDays,
  Camera,
  ExternalLink,
  Loader2,
  Pencil,
  PenLine,
  Pill,
  Search,
  ShieldAlert,
  Stethoscope,
  StickyNote,
  UserPlus,
  ArrowDownUp,
} from "lucide-react";
import { getClinicCollection } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { findOption, getStatusesFromTooth } from "@/lib/diagnosisCatalog";
import { normalizeRxItemsFromRecord } from "@/lib/prescriptionRecord";

/**
 * Every place in this system where a human types free text about a patient. Notes were scattered
 * across six screens with no way to read them in order, so a doctor opening a chart had to visit
 * each tab to find out what had already been said. This tab is read-only on purpose: each note is
 * still owned and edited by the screen that created it, and duplicating the write path here would
 * mean two sources of truth for the same sentence.
 */
type SourceId =
  | "clinical"
  | "diagnosis"
  | "appointment"
  | "prescription"
  | "media"
  | "lead"
  | "profile";

interface NoteEntry {
  key: string;
  source: SourceId;
  title: string;
  /** The note itself — what a human actually typed. */
  body: string;
  /** Extra note lines that belong to the same record (e.g. one per prescribed drug). */
  lines?: string[];
  /** null means the record carries no date at all, not that the date is unknown-but-recent. */
  dateMs: number | null;
  /** Who typed it. Undefined means the record predates author tracking — say so, don't guess. */
  writtenBy?: string;
  /** Who last changed it, when that is someone other than the author. */
  editedBy?: string;
  /**
   * The dentist the work is attributed to. Deliberately separate from `writtenBy`: an assistant
   * writing up Dr. Hana's session must not appear as the clinician, and Dr. Hana must not appear
   * as the person who typed it.
   */
  doctorOfRecord?: string;
  chips: string[];
}

const SOURCE_STYLES: Record<
  SourceId,
  { icon: any; dot: string; badge: string; iconColor: string; labelEn: string; labelAr: string }
> = {
  clinical: {
    icon: Stethoscope,
    dot: "bg-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    iconColor: "text-emerald-600",
    labelEn: "Clinical note",
    labelAr: "ملاحظة سريرية",
  },
  diagnosis: {
    icon: Activity,
    dot: "bg-rose-500",
    badge: "bg-rose-50 text-rose-700 border-rose-200",
    iconColor: "text-rose-600",
    labelEn: "Diagnosis chart",
    labelAr: "مخطط التشخيص",
  },
  appointment: {
    icon: CalendarDays,
    dot: "bg-blue-500",
    badge: "bg-blue-50 text-blue-700 border-blue-200",
    iconColor: "text-blue-600",
    labelEn: "Appointment",
    labelAr: "موعد",
  },
  prescription: {
    icon: Pill,
    dot: "bg-violet-500",
    badge: "bg-violet-50 text-violet-700 border-violet-200",
    iconColor: "text-violet-600",
    labelEn: "Prescription",
    labelAr: "روشتة",
  },
  media: {
    icon: Camera,
    dot: "bg-cyan-500",
    badge: "bg-cyan-50 text-cyan-700 border-cyan-200",
    iconColor: "text-cyan-600",
    labelEn: "X-Ray / Photo",
    labelAr: "أشعة / صورة",
  },
  lead: {
    icon: UserPlus,
    dot: "bg-amber-500",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    iconColor: "text-amber-600",
    labelEn: "Lead",
    labelAr: "عميل محتمل",
  },
  profile: {
    icon: ShieldAlert,
    dot: "bg-slate-500",
    badge: "bg-surface-muted text-slate-700 border-line",
    iconColor: "text-ink-body",
    labelEn: "Patient file",
    labelAr: "ملف المريض",
  },
};

const SOURCE_ORDER: SourceId[] = [
  "clinical",
  "diagnosis",
  "appointment",
  "prescription",
  "media",
  "lead",
  "profile",
];

function toMs(value: any): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value?.toMillis === "function") {
    const ms = value.toMillis();
    return typeof ms === "number" && !Number.isNaN(ms) ? ms : null;
  }
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/**
 * Appointments and clinical notes store the day as "YYYY-MM-DD" and the clock time as a separate
 * string, so they have to be recombined before anything can be sorted against a real timestamp.
 * A bare "YYYY-MM-DD" is parsed as local midnight rather than UTC — otherwise a morning note in
 * Cairo lands on the previous day.
 */
function parseDayTime(dateStr?: unknown, timeStr?: unknown): number | null {
  if (typeof dateStr !== "string" || !dateStr.trim()) return null;
  const raw = dateStr.trim();
  const base = Date.parse(raw.length <= 10 ? `${raw}T00:00:00` : raw);
  if (Number.isNaN(base)) return null;
  if (typeof timeStr !== "string" || !timeStr.trim()) return base;

  const m = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM|ص|م)?$/i);
  if (!m) return base;
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  const meridiem = (m[3] || "").toUpperCase();
  if (meridiem === "PM" || m[3] === "م") {
    if (hours < 12) hours += 12;
  } else if (meridiem === "AM" || m[3] === "ص") {
    if (hours === 12) hours = 0;
  }
  const d = new Date(base);
  d.setHours(hours, minutes, 0, 0);
  return d.getTime();
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Module-level so the aggregation memo below depends only on data, not on a fresh closure. */
function pick(isAr: boolean, en: string, ar: string): string {
  return isAr ? ar : en;
}

export default function PatientNotesTab({
  patientId,
  patient,
  appointments,
  media,
  prescriptions,
  onJumpToTab,
}: {
  patientId: string;
  patient: any;
  appointments: any[];
  media: any[];
  prescriptions: any[];
  onJumpToTab?: (tab: "clinical" | "xrays" | "prescriptions") => void;
}) {
  const { language, isRTL } = useLanguage();
  const router = useRouter();
  const isAr = language === "ar";
  const L = (en: string, ar: string) => (isAr ? ar : en);

  const [clinicalNotes, setClinicalNotes] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);

  const [sourceFilter, setSourceFilter] = useState<SourceId | "all">("all");
  const [search, setSearch] = useState("");
  const [newestFirst, setNewestFirst] = useState(true);

  useEffect(() => {
    if (!patientId) return;
    const idVariants: any[] = [String(patientId)];
    if (!Number.isNaN(Number(patientId)) && String(patientId).trim() !== "") {
      idVariants.push(Number(patientId));
    }
    const q = query(getClinicCollection("clinical_notes"), where("patientId", "in", idVariants));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setClinicalNotes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoadingNotes(false);
      },
      (err) => {
        console.error("Notes tab — clinical notes:", err);
        setLoadingNotes(false);
      }
    );
    return () => unsub();
  }, [patientId]);

  useEffect(() => {
    if (!patientId) return;
    // A lead only carries a patientId once it has been converted, so this is empty for walk-ins.
    const q = query(getClinicCollection("leads"), where("patientId", "==", String(patientId)));
    const unsub = onSnapshot(
      q,
      (snap) => setLeads(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => {
        // Reception-only roles may not be able to read leads; the rest of the tab still works.
        console.warn("Notes tab — leads unavailable:", err);
        setLeads([]);
      }
    );
    return () => unsub();
  }, [patientId]);

  const entries = useMemo<NoteEntry[]>(() => {
    const out: NoteEntry[] = [];

    // --- Clinical notes (the doctor's own note on a procedure) ---
    clinicalNotes.forEach((n: any) => {
      const body = cleanText(n.note);
      if (!body) return;
      const chips: string[] = [];
      const tooth = cleanText(n.tooth);
      if (tooth && tooth !== "Gen") chips.push(`${pick(isAr, "Tooth", "سن")} ${tooth}`);
      if (cleanText(n.status)) chips.push(cleanText(n.status));
      if (Number(n.cost) > 0) chips.push(`${Number(n.cost).toLocaleString()} EGP`);
      out.push({
        key: `clinical_${n.id}`,
        source: "clinical",
        title: cleanText(n.procedure) || cleanText(n.title) || pick(isAr, "Clinical note", "ملاحظة سريرية"),
        body,
        dateMs: parseDayTime(n.date) ?? toMs(n.createdAt),
        writtenBy: cleanText(n.createdByName) || cleanText(n.continuedFromName) || undefined,
        editedBy: cleanText(n.updatedByName) || undefined,
        doctorOfRecord: cleanText(n.doctor) || undefined,
        chips,
      });
    });

    // --- Appointment / visit notes ---
    appointments.forEach((a: any) => {
      const body = cleanText(a.notes);
      if (!body) return;
      const chips: string[] = [];
      if (cleanText(a.status)) chips.push(cleanText(a.status));
      if (cleanText(a.time)) chips.push(cleanText(a.time));
      if (cleanText(a.branchName)) chips.push(cleanText(a.branchName));
      out.push({
        key: `appt_${a.id}`,
        source: "appointment",
        title: cleanText(a.treatment) || pick(isAr, "Appointment", "موعد"),
        body,
        dateMs: parseDayTime(a.date, a.time) ?? toMs(a.createdAt),
        writtenBy: cleanText(a.addedBy) || cleanText(a.createdByName) || undefined,
        editedBy: cleanText(a.modifiedBy) || undefined,
        doctorOfRecord: cleanText(a.doctor) || undefined,
        chips,
      });
    });

    // --- Tooth notes written on the diagnosis chart ---
    const teethData = patient?.teethData && typeof patient.teethData === "object" ? patient.teethData : {};
    Object.entries(teethData).forEach(([toothId, data]: [string, any]) => {
      const body = cleanText(data?.notes);
      if (!body) return;
      const statusLabels = getStatusesFromTooth(data)
        .filter((s: string) => s !== "healthy")
        .map((s: string) => {
          const opt = findOption(s);
          return opt ? (isAr ? opt.labelAr : opt.labelEn) : s;
        });
      out.push({
        key: `tooth_${toothId}`,
        source: "diagnosis",
        title: `${pick(isAr, "Tooth", "السن")} ${toothId}`,
        body,
        // Only notes saved since authorship was added carry a date; older ones stay undated.
        dateMs: toMs(data?.notesAt),
        writtenBy: cleanText(data?.notesBy) || undefined,
        chips: statusLabels,
      });
    });

    // --- Prescriptions: the diagnosis line plus any per-drug instructions ---
    prescriptions.forEach((p: any) => {
      const diagnosis = cleanText(p.diagnosis);
      const items = normalizeRxItemsFromRecord(p.drugs);
      const drugLines = items
        .filter((it) => cleanText(it.note))
        .map((it) => `${it.name}${it.dose ? ` (${it.dose})` : ""} — ${cleanText(it.note)}`);
      if (!diagnosis && drugLines.length === 0) return;
      out.push({
        key: `rx_${p.id}`,
        source: "prescription",
        title: diagnosis ? pick(isAr, "Diagnosis on prescription", "تشخيص على الروشتة") : pick(isAr, "Medication instructions", "تعليمات الدواء"),
        body: diagnosis,
        lines: drugLines,
        dateMs: toMs(p.createdAt) ?? parseDayTime(p.date),
        writtenBy: cleanText(p.createdByName) || undefined,
        doctorOfRecord: cleanText(p.doctor) || undefined,
        chips: items.slice(0, 4).map((it) => it.name),
      });
    });

    // --- Notes attached to an X-ray or clinical photo ---
    media.forEach((m: any) => {
      const body = cleanText(m.notes);
      if (!body) return;
      const chips: string[] = [];
      if (cleanText(m.category)) chips.push(cleanText(m.category));
      if (cleanText(m.filename)) chips.push(cleanText(m.filename));
      out.push({
        key: `media_${m.id}`,
        source: "media",
        title: cleanText(m.category) || pick(isAr, "Image", "صورة"),
        body,
        dateMs: toMs(m.createdAt),
        writtenBy: cleanText(m.uploadedBy) || undefined,
        chips,
      });
    });

    // --- Whatever reception wrote while this was still a lead ---
    leads.forEach((l: any) => {
      const body = cleanText(l.notes);
      if (!body) return;
      const chips: string[] = [];
      if (cleanText(l.source)) chips.push(cleanText(l.source));
      if (cleanText(l.stage)) chips.push(cleanText(l.stage));
      if (cleanText(l.interest)) chips.push(cleanText(l.interest));
      if (cleanText(l.followUpDate)) chips.push(`${pick(isAr, "Follow-up", "متابعة")}: ${cleanText(l.followUpDate)}`);
      out.push({
        key: `lead_${l.id}`,
        source: "lead",
        title: pick(isAr, "Lead note", "ملاحظة عميل محتمل"),
        body,
        dateMs: toMs(l.createdAt) ?? toMs(l.updatedAt),
        writtenBy: cleanText(l.createdBy) || undefined,
        chips,
      });
    });

    // --- Standing facts from the patient file (no date — they are always true until edited) ---
    const medicalNotesBy = cleanText(patient?.medicalNotesBy) || undefined;
    const medicalNotesAt = toMs(patient?.medicalNotesAt);
    const allergies = cleanText(patient?.allergies);
    if (allergies) {
      out.push({
        key: "profile_allergies",
        source: "profile",
        title: pick(isAr, "Allergies", "الحساسية"),
        body: allergies,
        dateMs: medicalNotesAt,
        writtenBy: medicalNotesBy,
        chips: [],
      });
    }
    const history = cleanText(patient?.medicalHistory);
    if (history && history !== "None (Healthy)") {
      out.push({
        key: "profile_history",
        source: "profile",
        title: pick(isAr, "Medical history", "التاريخ المرضي"),
        body: history,
        dateMs: medicalNotesAt,
        writtenBy: medicalNotesBy,
        chips: [],
      });
    }

    return out;
  }, [clinicalNotes, appointments, patient, prescriptions, media, leads, isAr]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: entries.length };
    SOURCE_ORDER.forEach((s) => {
      map[s] = entries.filter((e) => e.source === s).length;
    });
    return map;
  }, [entries]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = entries.filter((e) => {
      if (sourceFilter !== "all" && e.source !== sourceFilter) return false;
      if (!term) return true;
      // Searching by author is the point of recording one, so the byline is part of the haystack.
      const haystack = [
        e.title,
        e.body,
        e.writtenBy || "",
        e.doctorOfRecord || "",
        e.editedBy || "",
        ...(e.lines || []),
        ...e.chips,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });

    // Undated notes (tooth chart, allergies, history) always sit at the end: they are standing
    // facts, not events, and slotting them into "today" would read as something just written.
    const dated = filtered.filter((e) => e.dateMs !== null);
    const undated = filtered.filter((e) => e.dateMs === null);
    dated.sort((a, b) => (newestFirst ? b.dateMs! - a.dateMs! : a.dateMs! - b.dateMs!));
    return { dated, undated };
  }, [entries, sourceFilter, search, newestFirst]);

  const groups = useMemo(() => {
    const byDay: Array<{ dayKey: string; dayMs: number; items: NoteEntry[] }> = [];
    visible.dated.forEach((e) => {
      const d = new Date(e.dateMs!);
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const last = byDay[byDay.length - 1];
      if (last && last.dayKey === dayKey) last.items.push(e);
      else byDay.push({ dayKey, dayMs: e.dateMs!, items: [e] });
    });
    return byDay;
  }, [visible.dated]);

  const openSource = (source: SourceId) => {
    if (source === "clinical") onJumpToTab?.("clinical");
    else if (source === "media") onJumpToTab?.("xrays");
    else if (source === "prescription") onJumpToTab?.("prescriptions");
    else if (source === "diagnosis") router.push(`/patients/${encodeURIComponent(patientId)}/diagnosis`);
    else if (source === "appointment") router.push("/appointments");
    else if (source === "lead") router.push("/leads");
  };

  const renderCard = (entry: NoteEntry) => {
    const style = SOURCE_STYLES[entry.source];
    const Icon = style.icon;
    const timeLabel =
      entry.dateMs !== null
        ? new Date(entry.dateMs).toLocaleTimeString(isAr ? "ar-EG" : "en-US", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : null;

    return (
      <div
        key={entry.key}
        className="bg-surface rounded-2xl border border-line shadow-sm hover:shadow-md hover:border-line-strong transition-all p-4 md:p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${style.badge}`}
              >
                <Icon size={12} className={style.iconColor} />
                {isAr ? style.labelAr : style.labelEn}
              </span>
              {timeLabel && (
                <span className="text-[11px] font-bold text-slate-400 tabular-nums">{timeLabel}</span>
              )}
            </div>
            <h4 className="text-base font-bold text-slate-800 leading-snug break-words">{entry.title}</h4>
          </div>

          <button
            type="button"
            onClick={() => openSource(entry.source)}
            className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 px-2.5 py-1.5 rounded-lg transition-colors"
            title={L("Open the source record", "افتح مصدر الملاحظة")}
          >
            <ExternalLink size={13} />
            {L("Open source", "المصدر")}
          </button>
        </div>

        {entry.body && (
          <div className="bg-surface-subtle border border-slate-100 rounded-xl p-3.5">
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
              {entry.body}
            </p>
          </div>
        )}

        {entry.lines && entry.lines.length > 0 && (
          <div className="mt-2 space-y-2">
            {entry.lines.map((line, i) => (
              <div key={i} className="bg-violet-50/60 border border-violet-100 rounded-xl p-3">
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
                  {line}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Byline. Always rendered — "we don't know" is information a chart has to state. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3 pt-3 border-t border-slate-100">
          {entry.writtenBy ? (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-700">
              <PenLine size={13} className="text-slate-400" />
              {L("Written by", "كتبها")} <span className="text-ink">{entry.writtenBy}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-400 italic">
              <PenLine size={13} />
              {L("Author not recorded", "لم يُسجّل كاتب الملاحظة")}
            </span>
          )}

          {entry.doctorOfRecord && (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-ink-muted">
              <Stethoscope size={13} className="text-slate-400" />
              {L("Doctor", "الطبيب")}: <span className="text-slate-700">{entry.doctorOfRecord}</span>
            </span>
          )}

          {entry.editedBy && entry.editedBy !== entry.writtenBy && (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-400">
              <Pencil size={12} />
              {L("Last edited by", "آخر تعديل بواسطة")} {entry.editedBy}
            </span>
          )}
        </div>

        {entry.chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {entry.chips.map((chip, i) => (
              <span
                key={i}
                className="px-2.5 py-1 rounded-lg bg-surface border border-line text-ink-muted text-[11px] font-bold max-w-[220px] truncate"
                title={chip}
              >
                {chip}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  if (loadingNotes) {
    return (
      <div className="flex justify-center items-center py-20 text-emerald-600">
        <Loader2 className="animate-spin" size={40} />
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${isRTL ? "text-right" : ""}`}>
      {/* Header + controls */}
      <div className="bg-surface p-5 md:p-6 rounded-2xl border border-slate-100 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-black text-ink flex items-center gap-2">
              <StickyNote className="text-amber-500" size={22} />
              {L("All Notes", "كل الملاحظات")}
            </h3>
            <p className="text-xs text-ink-muted font-medium mt-1">
              {L(
                "Every note written about this patient — clinical, appointments, diagnosis chart, prescriptions, images and leads — in one timeline.",
                "كل ملاحظة اتكتبت عن المريض — سريرية، مواعيد، مخطط التشخيص، روشتات، صور، وعملاء محتملين — في سجل واحد."
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="px-3 py-2 rounded-xl bg-surface-subtle border border-line text-slate-700 text-xs font-black tabular-nums">
              {entries.length} {L("notes", "ملاحظة")}
            </span>
            <button
              type="button"
              onClick={() => setNewestFirst((v) => !v)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-subtle hover:bg-surface-muted border border-line text-ink-body text-xs font-bold transition-colors"
            >
              <ArrowDownUp size={14} />
              {newestFirst ? L("Newest first", "الأحدث أولاً") : L("Oldest first", "الأقدم أولاً")}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search
            size={16}
            className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? "right-4" : "left-4"}`}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={L("Search inside notes…", "ابحث داخل الملاحظات…")}
            className={`w-full rounded-xl border border-line bg-slate-50/60 py-2.5 text-sm font-semibold text-slate-700 outline-none transition-all focus:border-emerald-500 focus:bg-surface focus:ring-4 focus:ring-emerald-500/10 ${
              isRTL ? "pr-11 pl-4" : "pl-11 pr-4"
            }`}
          />
        </div>

        {/* Source filters */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSourceFilter("all")}
            className={`px-3.5 py-2 rounded-full text-xs font-bold border transition-all ${
              sourceFilter === "all"
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
            }`}
          >
            {L("All sources", "كل المصادر")} ({counts.all})
          </button>
          {SOURCE_ORDER.filter((s) => counts[s] > 0).map((s) => {
            const style = SOURCE_STYLES[s];
            const Icon = style.icon;
            const active = sourceFilter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSourceFilter(active ? "all" : s)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border transition-all ${
                  active ? style.badge : "bg-surface text-ink-muted border-line hover:border-line-strong"
                }`}
              >
                <Icon size={13} className={active ? style.iconColor : "text-slate-400"} />
                {isAr ? style.labelAr : style.labelEn} ({counts[s]})
              </button>
            );
          })}
        </div>
      </div>

      {/* Timeline */}
      {visible.dated.length === 0 && visible.undated.length === 0 ? (
        <div className="text-center py-16 px-4 bg-surface rounded-3xl border border-dashed border-line">
          <StickyNote size={56} className="mx-auto text-slate-200 mb-4" />
          <p className="text-ink-muted font-bold text-base">
            {entries.length === 0
              ? L("No notes recorded for this patient yet", "لا توجد ملاحظات مسجلة لهذا المريض")
              : L("No notes match this filter", "لا توجد ملاحظات مطابقة للبحث")}
          </p>
          <p className="text-slate-400 text-sm mt-1">
            {entries.length === 0
              ? L(
                  "Notes written on procedures, appointments, teeth, prescriptions and images will show up here.",
                  "الملاحظات المكتوبة على الإجراءات والمواعيد والأسنان والروشتات والصور هتظهر هنا."
                )
              : L("Try a different source or search term.", "جرّب مصدر تاني أو كلمة بحث مختلفة.")}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => {
            const dayLabel = new Date(group.dayMs).toLocaleDateString(isAr ? "ar-EG" : "en-US", {
              weekday: "short",
              year: "numeric",
              month: "short",
              day: "numeric",
            });
            return (
              <div key={group.dayKey} className="grid grid-cols-1 md:grid-cols-[170px_1fr] gap-4 md:gap-6">
                <div className="md:pt-2">
                  <div className="inline-flex md:flex md:flex-col items-center md:items-start gap-2 md:gap-1">
                    <span className="text-sm font-black text-slate-800">{dayLabel}</span>
                    <span className="text-[11px] font-bold text-slate-400">
                      {group.items.length} {L("note(s)", "ملاحظة")}
                    </span>
                  </div>
                </div>

                <div
                  className={`relative space-y-4 ${
                    isRTL ? "md:pr-8 md:border-r-2" : "md:pl-8 md:border-l-2"
                  } md:border-slate-100`}
                >
                  {group.items.map((entry) => (
                    <div key={entry.key} className="relative">
                      <span
                        className={`hidden md:block absolute top-6 w-3.5 h-3.5 rounded-full border-4 border-white shadow-sm ${
                          SOURCE_STYLES[entry.source].dot
                        } ${isRTL ? "-right-[41px]" : "-left-[41px]"}`}
                      />
                      {renderCard(entry)}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {visible.undated.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-[170px_1fr] gap-4 md:gap-6">
              <div className="md:pt-2">
                <span className="text-sm font-black text-ink-muted">{L("Always on file", "ثابت في الملف")}</span>
                <p className="text-[11px] font-bold text-slate-400 mt-1">
                  {L("No date recorded", "بدون تاريخ مسجل")}
                </p>
              </div>
              <div
                className={`relative space-y-4 ${
                  isRTL ? "md:pr-8 md:border-r-2 md:border-dashed" : "md:pl-8 md:border-l-2 md:border-dashed"
                } md:border-line`}
              >
                {visible.undated.map((entry) => (
                  <div key={entry.key} className="relative">
                    <span
                      className={`hidden md:block absolute top-6 w-3.5 h-3.5 rounded-full border-4 border-white shadow-sm ${
                        SOURCE_STYLES[entry.source].dot
                      } ${isRTL ? "-right-[41px]" : "-left-[41px]"}`}
                    />
                    {renderCard(entry)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
