"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, LayoutList, ListChecks, Loader2, MessageCircle, Plus, Send, Trash2, X } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useUI } from "@/context/UIContext";
import { useSuperAdminText } from "@/components/superadmin/i18n";
import {
  compareTasks,
  datesInOrder,
  isDueSoon,
  isOverdue,
  monthCells,
  TASK_STATUSES,
  type PlatformTask,
  type TaskInput,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/platformTasks";

/**
 * The platform owner's own to-do list: what clinics asked for, and how far each one got.
 *
 * Four columns of work, read top to bottom: To do, In progress, Built (waiting to go live), Live.
 * Every row has a start day and a deadline; a passed deadline turns the row red until it is Live.
 * Everything goes through /api/admin/tasks — the browser never touches `platform_tasks`.
 */

const WORDS = {
  en: {
    newTask: "New task",
    all: "All",
    status: { todo: "To do", doing: "In progress", built: "Built — waiting to go live", live: "Live" } as Record<TaskStatus, string>,
    statusShort: { todo: "To do", doing: "In progress", built: "Built", live: "Live" } as Record<TaskStatus, string>,
    priority: { high: "High", normal: "Normal", low: "Low" } as Record<TaskPriority, string>,
    late: "Late",
    dueSoon: "Due soon",
    lateCount: "{n} late",
    soonCount: "{n} due in 3 days",
    start: "Start",
    deadline: "Deadline",
    noDates: "No dates",
    title: "Task",
    titlePh: "What needs doing?",
    clinic: "Clinic",
    clinicPh: "e.g. DENT INN (empty = everyone)",
    priorityLabel: "Priority",
    statusLabel: "Status",
    notes: "Notes",
    notesPh: "Details, who asked, what done looks like",
    save: "Save",
    cancel: "Cancel",
    del: "Delete",
    delQ: "Delete \"{t}\"? This cannot be undone.",
    empty: "No tasks yet.",
    seed: "Fill in the starter list",
    seedSub: "Adds the 12 items from 21 Nov with where each one stands.",
    nothingHere: "Nothing here.",
    showLive: "Show {n} live",
    hideLive: "Hide live",
    saved: "Saved.",
    deleted: "Deleted.",
    failed: "Could not save.",
    loadFailed: "Could not load the tasks.",
    datesWrong: "The deadline is before the start date.",
    wentLive: "Live since {d}",
    clear: "Clear",
    list: "List",
    calendar: "Calendar",
    noDeadline: "{n} without a deadline are not on the calendar.",
    weekdays: ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"],
    newReq: "New request",
    fromClinic: "Request from {who}",
    waTitle: "Morning WhatsApp",
    waOn: "On — every morning at {h}",
    waOff: "Off",
    waSub: "Late tasks, tasks due in the next 3 days and new clinic requests, sent from the platform alerts line. A quiet day sends nothing.",
    waPhone: "Send to",
    waHour: "At (Cairo time)",
    waEnable: "Send every morning",
    waSave: "Save",
    waSendNow: "Send now",
    waSentNow: "Sent. Check WhatsApp.",
    waLast: "Last: {r} · {d}",
    waOk: "sent",
    waFail: "failed",
  },
  ar: {
    newTask: "مهمة جديدة",
    all: "الكل",
    status: { todo: "مطلوب", doing: "جاري العمل", built: "جاهز — في انتظار النشر", live: "شغّال" } as Record<TaskStatus, string>,
    statusShort: { todo: "مطلوب", doing: "جاري", built: "جاهز", live: "شغّال" } as Record<TaskStatus, string>,
    priority: { high: "عاجل", normal: "عادي", low: "منخفض" } as Record<TaskPriority, string>,
    late: "متأخر",
    dueSoon: "قرّب",
    lateCount: "{n} متأخر",
    soonCount: "{n} خلال ٣ أيام",
    start: "البداية",
    deadline: "آخر موعد",
    noDates: "بدون تواريخ",
    title: "المهمة",
    titlePh: "المطلوب إيه؟",
    clinic: "العيادة",
    clinicPh: "مثلاً DENT INN (فاضي = للكل)",
    priorityLabel: "الأولوية",
    statusLabel: "الحالة",
    notes: "ملاحظات",
    notesPh: "التفاصيل، مين طلب، إمتى تبقى خلصت",
    save: "حفظ",
    cancel: "إلغاء",
    del: "حذف",
    delQ: "حذف \"{t}\"؟ مفيش رجوع.",
    empty: "مفيش مهام لسه.",
    seed: "املأ القائمة الأولى",
    seedSub: "يضيف الـ ١٢ بند بتوع ٢١ نوفمبر وحالة كل واحد.",
    nothingHere: "مفيش حاجة هنا.",
    showLive: "اعرض {n} شغّال",
    hideLive: "اخفي الشغّال",
    saved: "تم الحفظ.",
    deleted: "اتحذفت.",
    failed: "تعذّر الحفظ.",
    loadFailed: "تعذّر تحميل المهام.",
    datesWrong: "آخر موعد قبل تاريخ البداية.",
    wentLive: "شغّال من {d}",
    clear: "مسح",
    list: "قائمة",
    calendar: "تقويم",
    noDeadline: "{n} من غير آخر موعد مش ظاهرين في التقويم.",
    weekdays: ["سبت", "أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة"],
    newReq: "طلب جديد",
    fromClinic: "طلب من {who}",
    waTitle: "رسالة واتساب الصبح",
    waOn: "شغّالة — كل يوم الساعة {h}",
    waOff: "مقفولة",
    waSub: "المهام المتأخرة واللي موعدها خلال ٣ أيام وطلبات العيادات الجديدة، من خط تنبيهات المنصة. اليوم الهادي مفيش رسالة.",
    waPhone: "ابعت على",
    waHour: "الساعة (بتوقيت القاهرة)",
    waEnable: "ابعت كل يوم الصبح",
    waSave: "حفظ",
    waSendNow: "ابعت دلوقتي",
    waSentNow: "اتبعتت. شوف الواتساب.",
    waLast: "آخر مرة: {r} · {d}",
    waOk: "اتبعتت",
    waFail: "فشلت",
  },
};

/** The dot beside each status: the console's only colour, so it means something. */
const STATUS_DOT: Record<TaskStatus, string> = {
  todo: "bg-ink-muted/40",
  doing: "bg-accent",
  built: "bg-indigo-500",
  live: "bg-emerald-500",
};

const INPUT =
  "w-full bg-surface border border-line text-ink text-sm rounded-xl px-3 min-h-[44px] outline-none focus:border-ink";
const LABEL = "text-xs font-semibold text-ink-muted block mb-1.5";

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** YYYY-MM-DD as a local date, so "21 Nov" never shows as the 20th west of Greenwich. */
function dayToDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

async function callTasks(body?: Record<string, unknown>): Promise<{ ok: boolean; error?: string; items?: PlatformTask[]; item?: PlatformTask; added?: number }> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) return { ok: false, error: "Session expired. Sign in again." };
  const res = await fetch("/api/admin/tasks", {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ...data, ok: res.ok && data?.ok === true };
}

type Draft = Required<Omit<TaskInput, "seen">>;
const EMPTY_DRAFT: Draft = { title: "", notes: "", clinic: "", status: "todo", priority: "normal", startDate: "", deadline: "" };

export function TasksTab() {
  const { isAr, num, date } = useSuperAdminText();
  const w = isAr ? WORDS.ar : WORDS.en;
  const fill = (s: string, vars: Record<string, string | number>) =>
    Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s);
  const { showToast, confirm } = useUI();

  const [tasks, setTasks] = useState<PlatformTask[] | null>(null);
  const [filter, setFilter] = useState<TaskStatus | "all">("all");
  const [showLive, setShowLive] = useState(false);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [month, setMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  /** null: no form open; "new": adding; otherwise the id being edited. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const today = todayKey();

  const load = useCallback(async () => {
    const res = await callTasks();
    if (res.ok && res.items) setTasks(res.items);
    else {
      setTasks((prev) => prev ?? []);
      showToast(res.error || w.loadFailed, "error");
    }
  }, [showToast, w.loadFailed]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<TaskStatus, number> = { todo: 0, doing: 0, built: 0, live: 0 };
    for (const t of tasks || []) c[t.status]++;
    return c;
  }, [tasks]);
  const late = (tasks || []).filter((t) => isOverdue(t, today)).length;
  const soon = (tasks || []).filter((t) => isDueSoon(t, today)).length;

  const groups = useMemo(() => {
    const shown = filter === "all" ? TASK_STATUSES : [filter];
    return shown.map((s) => ({
      status: s,
      items: (tasks || []).filter((t) => t.status === s).sort((a, b) => compareTasks(a, b, today)),
    }));
  }, [tasks, filter, today]);

  const openNew = () => {
    setDraft({ ...EMPTY_DRAFT, status: filter === "all" ? "todo" : filter, startDate: today });
    setEditing("new");
  };
  const openEdit = (t: PlatformTask) => {
    setDraft({ title: t.title, notes: t.notes, clinic: t.clinic, status: t.status, priority: t.priority, startDate: t.startDate, deadline: t.deadline });
    setEditing(t.id);
    // Opening a clinic's request is reading it: it stops being New, here and in the morning message.
    if (!t.seen) {
      replace({ ...t, seen: true });
      void callTasks({ action: "update", id: t.id, task: { seen: true } });
    }
  };
  const close = () => { setEditing(null); setDraft(EMPTY_DRAFT); };

  const replace = (item: PlatformTask) =>
    setTasks((prev) => (prev || []).some((t) => t.id === item.id) ? (prev || []).map((t) => (t.id === item.id ? item : t)) : [...(prev || []), item]);

  const save = async () => {
    if (!draft.title.trim()) return;
    if (!datesInOrder(draft.startDate, draft.deadline)) { showToast(w.datesWrong, "error"); return; }
    setBusy(true);
    const res = editing === "new"
      ? await callTasks({ action: "create", task: draft })
      : await callTasks({ action: "update", id: editing, task: draft });
    setBusy(false);
    if (!res.ok || !res.item) { showToast(res.error || w.failed, "error"); return; }
    replace(res.item);
    showToast(w.saved, "success");
    close();
  };

  /** The quick status change on the row itself — no form needed for the commonest edit. */
  const setStatus = async (t: PlatformTask, status: TaskStatus) => {
    if (status === t.status) return;
    replace({ ...t, status });
    const res = await callTasks({ action: "update", id: t.id, task: { status } });
    if (res.ok && res.item) replace(res.item);
    else { replace(t); showToast(res.error || w.failed, "error"); }
  };

  const remove = async (t: PlatformTask) => {
    if (!(await confirm(fill(w.delQ, { t: t.title }), { title: w.del, confirmLabel: w.del }))) return;
    setBusy(true);
    const res = await callTasks({ action: "delete", id: t.id });
    setBusy(false);
    if (!res.ok) { showToast(res.error || w.failed, "error"); return; }
    setTasks((prev) => (prev || []).filter((x) => x.id !== t.id));
    showToast(w.deleted, "success");
    close();
  };

  const seed = async () => {
    setBusy(true);
    const res = await callTasks({ action: "seed" });
    setBusy(false);
    if (!res.ok) { showToast(res.error || w.failed, "error"); return; }
    await load();
  };

  if (tasks === null) {
    return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-ink-muted" size={28} /></div>;
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Filters, the late/soon count, and the one button that matters. */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 pb-1 md:pb-0">
          {(["all", ...TASK_STATUSES] as const).map((s) => {
            const on = filter === s;
            const n = s === "all" ? tasks.length : counts[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(s)}
                className={`shrink-0 inline-flex items-center gap-2 min-h-[40px] px-3.5 rounded-full border text-sm font-semibold transition-colors ${on ? "bg-ink-slab text-white border-ink-slab" : "bg-surface text-ink border-line hover:bg-surface-subtle"}`}
              >
                {s !== "all" && <span className={`w-2 h-2 rounded-full ${STATUS_DOT[s]}`} aria-hidden />}
                {s === "all" ? w.all : w.statusShort[s]}
                <span className={on ? "text-white/60" : "text-ink-muted"}>{num(n)}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3 md:ms-auto">
          {late > 0 && <span className="text-sm font-semibold text-danger">{fill(w.lateCount, { n: num(late) })}</span>}
          {soon > 0 && <span className="text-sm font-semibold text-warn">{fill(w.soonCount, { n: num(soon) })}</span>}
          <div className="ms-auto md:ms-0 inline-flex rounded-xl border border-line bg-surface p-0.5">
            {(["list", "calendar"] as const).map((v) => {
              const Icon = v === "list" ? LayoutList : CalendarDays;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={`inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-[10px] text-sm font-semibold ${view === v ? "bg-ink-slab text-white" : "text-ink-muted hover:text-ink"}`}
                >
                  <Icon size={15} aria-hidden /> {v === "list" ? w.list : w.calendar}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl bg-ink-slab text-white font-semibold text-sm hover:opacity-90"
          >
            <Plus size={16} aria-hidden /> {w.newTask}
          </button>
        </div>
      </div>

      {tasks.length === 0 && (
        <section className="bg-surface rounded-3xl border border-line p-8 flex flex-col items-center text-center gap-3">
          <ListChecks size={28} className="text-ink-muted" aria-hidden />
          <p className="text-ink font-semibold">{w.empty}</p>
          <button
            type="button"
            disabled={busy}
            onClick={seed}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl border border-line-strong bg-surface text-ink font-semibold text-sm hover:bg-surface-subtle disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Plus size={15} aria-hidden />} {w.seed}
          </button>
          <p className="text-xs text-ink-muted">{w.seedSub}</p>
        </section>
      )}

      {tasks.length > 0 && view === "calendar" && (
        <TaskCalendar
          tasks={filter === "all" ? tasks : tasks.filter((t) => t.status === filter)}
          month={month}
          setMonth={setMonth}
          today={today}
          w={w}
          isAr={isAr}
          fill={fill}
          num={num}
          onOpen={openEdit}
        />
      )}

      {tasks.length > 0 && view === "list" && groups.map(({ status, items }) => {
        const folded = status === "live" && filter === "all" && !showLive;
        return (
          <section key={status} className="bg-surface rounded-3xl border border-line overflow-hidden">
            <header className="px-5 py-3.5 border-b border-line flex items-center gap-2.5">
              <span className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
              <h2 className="font-display text-base font-bold text-ink">{w.status[status]}</h2>
              <span className="text-sm text-ink-muted">{num(items.length)}</span>
              {status === "live" && filter === "all" && items.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowLive((v) => !v)}
                  className="ms-auto inline-flex items-center gap-1 min-h-[36px] px-2 text-sm font-semibold text-ink-muted hover:text-ink"
                >
                  {showLive ? w.hideLive : fill(w.showLive, { n: num(items.length) })}
                  <ChevronDown size={15} className={`transition-transform ${showLive ? "rotate-180" : ""}`} aria-hidden />
                </button>
              )}
            </header>
            {!folded && (items.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-muted">{w.nothingHere}</p>
            ) : (
              <ul className="divide-y divide-line">
                {items.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    today={today}
                    w={w}
                    fmt={(day) => date(dayToDate(day))}
                    onOpen={() => openEdit(t)}
                    onStatus={(s) => setStatus(t, s)}
                    fill={fill}
                    dateOf={(iso) => date(new Date(iso))}
                  />
                ))}
              </ul>
            ))}
          </section>
        );
      })}

      <DigestCard w={w} fill={fill} dateOf={(iso) => date(new Date(iso))} />

      {editing && (
        <TaskForm
          isNew={editing === "new"}
          draft={draft}
          setDraft={setDraft}
          busy={busy}
          w={w}
          onSave={save}
          onClose={close}
          onDelete={editing !== "new" ? () => { const t = tasks.find((x) => x.id === editing); if (t) void remove(t); } : undefined}
        />
      )}
    </div>
  );
}

type Words = typeof WORDS.en;

function TaskRow({ task, today, w, fmt, onOpen, onStatus, fill, dateOf }: {
  task: PlatformTask;
  today: string;
  w: Words;
  fmt: (day: string) => string;
  onOpen: () => void;
  onStatus: (s: TaskStatus) => void;
  fill: (s: string, vars: Record<string, string | number>) => string;
  dateOf: (iso: string) => string;
}) {
  const late = isOverdue(task, today);
  const soon = !late && isDueSoon(task, today);
  return (
    <li className={`px-5 py-4 flex flex-col md:flex-row md:items-center gap-3 md:gap-5 ${late ? "bg-danger/[0.04]" : ""}`}>
      <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-start flex flex-col gap-1.5 rounded-lg -m-1 p-1 hover:bg-surface-subtle">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink" dir="auto">{task.title}</span>
          {task.priority === "high" && <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-danger/10 text-danger">{w.priority.high}</span>}
          {task.priority === "low" && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-surface-subtle text-ink-muted">{w.priority.low}</span>}
          {task.clinic && <span className="text-xs font-semibold px-2 py-0.5 rounded-full border border-line text-ink-muted" dir="auto">{task.clinic}</span>}
          {task.source === "clinic" && !task.seen && <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-accent text-ink-on-accent">{w.newReq}</span>}
        </span>
        {task.source === "clinic" && task.requestedBy && (
          <span className="text-xs font-semibold text-ink-muted" dir="auto">{fill(w.fromClinic, { who: task.requestedBy })}</span>
        )}
        {task.notes && <span className="text-sm text-ink-muted line-clamp-2" dir="auto">{task.notes}</span>}
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          <CalendarDays size={13} aria-hidden />
          {!task.startDate && !task.deadline && <span>{w.noDates}</span>}
          {task.startDate && <span>{w.start}: <b className="font-semibold text-ink">{fmt(task.startDate)}</b></span>}
          {task.deadline && (
            <span className={late ? "text-danger" : soon ? "text-warn" : ""}>
              {w.deadline}: <b className="font-semibold">{fmt(task.deadline)}</b>
              {late && <span className="ms-1.5 font-bold">· {w.late}</span>}
              {soon && <span className="ms-1.5 font-bold">· {w.dueSoon}</span>}
            </span>
          )}
          {task.status === "live" && task.liveAt && <span>· {fill(w.wentLive, { d: dateOf(task.liveAt) })}</span>}
        </span>
      </button>
      <label className="md:w-52 shrink-0">
        <span className="sr-only">{w.statusLabel}</span>
        <select
          value={task.status}
          onChange={(e) => onStatus(e.target.value as TaskStatus)}
          className={`${INPUT} font-semibold`}
        >
          {TASK_STATUSES.map((s) => <option key={s} value={s}>{w.statusShort[s]}</option>)}
        </select>
      </label>
    </li>
  );
}

function TaskForm({ isNew, draft, setDraft, busy, w, onSave, onClose, onDelete }: {
  isNew: boolean;
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  busy: boolean;
  w: Words;
  onSave: () => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const datesBad = !datesInOrder(draft.startDate, draft.deadline);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 bg-ink-slab/30 backdrop-blur-sm z-40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? w.newTask : draft.title}
        className="fixed z-50 inset-x-0 bottom-0 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[560px] max-h-[92dvh] overflow-y-auto bg-surface rounded-t-3xl md:rounded-3xl border border-line shadow-xl"
      >
        <form
          onSubmit={(e) => { e.preventDefault(); onSave(); }}
          className="p-5 md:p-6 flex flex-col gap-4"
        >
          <div className="flex items-center gap-3">
            <h2 className="font-display text-xl font-bold text-ink">{isNew ? w.newTask : w.title}</h2>
            <button type="button" onClick={onClose} aria-label={w.cancel} className="ms-auto w-10 h-10 rounded-xl flex items-center justify-center text-ink-muted hover:bg-surface-subtle">
              <X size={18} />
            </button>
          </div>

          <label>
            <span className={LABEL}>{w.title}</span>
            <input autoFocus required value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder={w.titlePh} maxLength={200} className={INPUT} dir="auto" />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className={LABEL}>{w.start}</span>
              <div className="flex gap-1">
                <input type="date" value={draft.startDate} onChange={(e) => set("startDate", e.target.value)} className={INPUT} />
                {draft.startDate && <ClearButton label={w.clear} onClick={() => set("startDate", "")} />}
              </div>
            </label>
            <label>
              <span className={LABEL}>{w.deadline}</span>
              <div className="flex gap-1">
                <input type="date" value={draft.deadline} min={draft.startDate || undefined} onChange={(e) => set("deadline", e.target.value)} className={`${INPUT} ${datesBad ? "border-danger" : ""}`} />
                {draft.deadline && <ClearButton label={w.clear} onClick={() => set("deadline", "")} />}
              </div>
            </label>
          </div>
          {datesBad && <p className="text-sm text-danger -mt-2">{w.datesWrong}</p>}

          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className={LABEL}>{w.statusLabel}</span>
              <select value={draft.status} onChange={(e) => set("status", e.target.value as TaskStatus)} className={INPUT}>
                {TASK_STATUSES.map((s) => <option key={s} value={s}>{w.statusShort[s]}</option>)}
              </select>
            </label>
            <label>
              <span className={LABEL}>{w.priorityLabel}</span>
              <select value={draft.priority} onChange={(e) => set("priority", e.target.value as TaskPriority)} className={INPUT}>
                {(["high", "normal", "low"] as const).map((p) => <option key={p} value={p}>{w.priority[p]}</option>)}
              </select>
            </label>
          </div>

          <label>
            <span className={LABEL}>{w.clinic}</span>
            <input value={draft.clinic} onChange={(e) => set("clinic", e.target.value)} placeholder={w.clinicPh} maxLength={80} className={INPUT} dir="auto" />
          </label>

          <label>
            <span className={LABEL}>{w.notes}</span>
            <textarea value={draft.notes} onChange={(e) => set("notes", e.target.value)} placeholder={w.notesPh} maxLength={2000} rows={4} className={`${INPUT} py-2.5 resize-y`} dir="auto" />
          </label>

          <div className="flex items-center gap-2 pt-1">
            {onDelete && (
              <button type="button" disabled={busy} onClick={onDelete} className="inline-flex items-center gap-2 min-h-[44px] px-3 rounded-xl text-danger font-semibold text-sm hover:bg-danger/10 disabled:opacity-50">
                <Trash2 size={15} aria-hidden /> {w.del}
              </button>
            )}
            <button type="button" onClick={onClose} className="ms-auto min-h-[44px] px-4 rounded-xl border border-line text-ink font-semibold text-sm hover:bg-surface-subtle">{w.cancel}</button>
            <button type="submit" disabled={busy || !draft.title.trim() || datesBad} className="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-xl bg-ink-slab text-white font-semibold text-sm hover:opacity-90 disabled:opacity-40">
              {busy && <Loader2 size={15} className="animate-spin" aria-hidden />} {w.save}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function ClearButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="shrink-0 w-11 min-h-[44px] rounded-xl border border-line flex items-center justify-center text-ink-muted hover:bg-surface-subtle">
      <X size={15} />
    </button>
  );
}

/** A month of deadlines. Phones get the same month as a list of days, since seven columns do not fit. */
function TaskCalendar({ tasks, month, setMonth, today, w, isAr, fill, num, onOpen }: {
  tasks: PlatformTask[];
  month: { y: number; m: number };
  setMonth: React.Dispatch<React.SetStateAction<{ y: number; m: number }>>;
  today: string;
  w: Words;
  isAr: boolean;
  fill: (s: string, vars: Record<string, string | number>) => string;
  num: (n: number) => string;
  onOpen: (t: PlatformTask) => void;
}) {
  const cells = monthCells(month.y, month.m);
  const byDay = new Map<string, PlatformTask[]>();
  for (const t of tasks) if (t.deadline) byDay.set(t.deadline, [...(byDay.get(t.deadline) || []), t]);
  const undated = tasks.filter((t) => !t.deadline).length;
  const locale = isAr ? "ar-EG" : "en-US";
  const title = new Date(month.y, month.m, 1).toLocaleDateString(locale, { month: "long", year: "numeric" });
  const step = (n: number) => setMonth(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const Prev = isAr ? ChevronRight : ChevronLeft;
  const Next = isAr ? ChevronLeft : ChevronRight;

  const chip = (t: PlatformTask) => {
    const late = isOverdue(t, today);
    const tone = late
      ? "border-danger/30 bg-danger/10 text-danger"
      : t.status === "live" ? "border-line text-ink-muted line-through" : "border-line bg-surface-subtle text-ink";
    return (
      <button
        key={t.id}
        type="button"
        onClick={() => onOpen(t)}
        title={t.title}
        className={`w-full text-start truncate text-xs font-semibold rounded-md px-1.5 py-1 border hover:border-ink ${tone}`}
        dir="auto"
      >
        <span className={`inline-block w-1.5 h-1.5 rounded-full me-1 align-middle ${STATUS_DOT[t.status]}`} aria-hidden />
        {t.title}
      </button>
    );
  };

  const daysWithTasks = cells.filter((c) => c.inMonth && byDay.has(c.day));

  return (
    <section className="bg-surface rounded-3xl border border-line overflow-hidden">
      <header className="px-4 py-3 border-b border-line flex items-center gap-2">
        <button type="button" onClick={() => step(-1)} aria-label="Previous month" className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-surface-subtle"><Prev size={18} /></button>
        <h2 className="font-display text-base font-bold text-ink flex-1 text-center">{title}</h2>
        <button type="button" onClick={() => step(1)} aria-label="Next month" className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-surface-subtle"><Next size={18} /></button>
      </header>

      {/* Desktop: the month grid, Saturday first. */}
      <div className="hidden md:grid grid-cols-7">
        {w.weekdays.map((d) => (
          <div key={d} className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted border-b border-line">{d}</div>
        ))}
        {cells.map((c, i) => (
          <div key={c.day} className={`min-h-[104px] min-w-0 p-1.5 flex flex-col gap-1 border-line ${i % 7 ? "border-s" : ""} ${i >= 7 ? "border-t" : ""} ${c.inMonth ? "" : "bg-surface-subtle/60"}`}>
            <span className={`text-xs font-semibold self-start px-1.5 rounded-full ${c.day === today ? "bg-ink-slab text-white" : c.inMonth ? "text-ink" : "text-ink-muted/60"}`}>
              {num(Number(c.day.slice(8)))}
            </span>
            {(byDay.get(c.day) || []).map(chip)}
          </div>
        ))}
      </div>

      {/* Phone: only the days that have something. */}
      <ul className="md:hidden divide-y divide-line">
        {daysWithTasks.length === 0 && <li className="px-4 py-4 text-sm text-ink-muted">{w.nothingHere}</li>}
        {daysWithTasks.map((c) => (
          <li key={c.day} className="px-4 py-3 flex gap-3">
            <span className={`shrink-0 w-14 text-center text-sm font-bold rounded-lg py-1 h-fit ${c.day === today ? "bg-ink-slab text-white" : "bg-surface-subtle text-ink"}`}>
              {dayToDate(c.day).toLocaleDateString(locale, { day: "numeric", month: "short" })}
            </span>
            <div className="flex-1 min-w-0 flex flex-col gap-1">{(byDay.get(c.day) || []).map(chip)}</div>
          </li>
        ))}
      </ul>

      {undated > 0 && <p className="px-4 py-3 border-t border-line text-xs text-ink-muted">{fill(w.noDeadline, { n: num(undated) })}</p>}
    </section>
  );
}

type DigestView = { enabled: boolean; phone: string; hour: number; lastResult: { ok: boolean; error: string; at: string } | null };

async function callDigest(body?: Record<string, unknown>): Promise<{ ok: boolean; error?: string } & Partial<DigestView>> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) return { ok: false, error: "Session expired. Sign in again." };
  const res = await fetch("/api/admin/tasks/digest", {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ...data, ok: res.ok && data?.ok === true };
}

/** 9 → "9:00 AM" / "٩:٠٠ ص". */
function hourLabel(h: number, isAr: boolean): string {
  return new Date(2026, 0, 1, h).toLocaleTimeString(isAr ? "ar-EG" : "en-US", { hour: "numeric", minute: "2-digit" });
}

/** The morning WhatsApp: where it goes, when, and a button to see it now. */
function DigestCard({ w, fill, dateOf }: {
  w: Words;
  fill: (s: string, vars: Record<string, string | number>) => string;
  dateOf: (iso: string) => string;
}) {
  const { showToast } = useUI();
  const { isAr } = useSuperAdminText();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<DigestView | null>(null);
  const [phone, setPhone] = useState("");
  const [hour, setHour] = useState(9);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "send">("");

  const take = (r: Partial<DigestView>) => {
    const v: DigestView = { enabled: !!r.enabled, phone: r.phone || "", hour: r.hour ?? 9, lastResult: r.lastResult ?? null };
    setSaved(v); setPhone(v.phone); setHour(v.hour); setEnabled(v.enabled);
  };

  useEffect(() => {
    void callDigest().then((r) => { if (r.ok) take(r); });
  }, []);

  const save = async () => {
    setBusy("save");
    const r = await callDigest({ action: "save", phone, hour, enabled });
    setBusy("");
    if (!r.ok) { showToast(r.error || w.failed, "error"); return; }
    take(r);
    showToast(w.saved, "success");
  };
  const sendNow = async () => {
    setBusy("send");
    const r = await callDigest({ action: "send" });
    setBusy("");
    if (!r.ok) { showToast(r.error || w.failed, "error"); return; }
    showToast(w.waSentNow, "success");
    const fresh = await callDigest();
    if (fresh.ok) take(fresh);
  };

  const dirty = !!saved && (phone !== saved.phone || hour !== saved.hour || enabled !== saved.enabled);

  return (
    <section className="bg-surface rounded-3xl border border-line overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full px-5 py-4 flex items-center gap-3 text-start hover:bg-surface-subtle">
        <MessageCircle size={18} className="text-ink-muted shrink-0" aria-hidden />
        <span className="flex-1 min-w-0">
          <span className="block font-display text-base font-bold text-ink">{w.waTitle}</span>
          <span className="block text-sm text-ink-muted">{saved?.enabled ? fill(w.waOn, { h: hourLabel(saved.hour, isAr) }) : w.waOff}</span>
        </span>
        <ChevronDown size={16} className={`text-ink-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="px-5 pb-5 flex flex-col gap-4 border-t border-line">
          <p className="text-sm text-ink-muted pt-4">{w.waSub}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label>
              <span className={LABEL}>{w.waPhone}</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="01xxxxxxxxx" className={INPUT} dir="ltr" />
            </label>
            <label>
              <span className={LABEL}>{w.waHour}</span>
              <select value={hour} onChange={(e) => setHour(Number(e.target.value))} className={INPUT}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h, isAr)}</option>)}
              </select>
            </label>
          </div>
          <label className="inline-flex items-center gap-3 min-h-[44px] cursor-pointer select-none">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-5 h-5 accent-black" />
            <span className="text-sm font-semibold text-ink">{w.waEnable}</span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {saved?.lastResult && (
              <span className={`text-xs ${saved.lastResult.ok ? "text-ink-muted" : "text-danger"}`} title={saved.lastResult.error || undefined}>
                {fill(w.waLast, { r: saved.lastResult.ok ? w.waOk : w.waFail, d: dateOf(saved.lastResult.at) })}
              </span>
            )}
            <button type="button" disabled={!!busy || !saved?.phone || dirty} onClick={sendNow} className="ms-auto inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl border border-line text-ink font-semibold text-sm hover:bg-surface-subtle disabled:opacity-40">
              {busy === "send" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Send size={15} aria-hidden />} {w.waSendNow}
            </button>
            <button type="button" disabled={!!busy || !dirty} onClick={save} className="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-xl bg-ink-slab text-white font-semibold text-sm hover:opacity-90 disabled:opacity-40">
              {busy === "save" && <Loader2 size={15} className="animate-spin" aria-hidden />} {w.waSave}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
