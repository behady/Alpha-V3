"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronDown, ListChecks, Loader2, Plus, Trash2, X } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useUI } from "@/context/UIContext";
import { useSuperAdminText } from "@/components/superadmin/i18n";
import {
  compareTasks,
  datesInOrder,
  isDueSoon,
  isOverdue,
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

type Draft = Required<TaskInput>;
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
          <button
            type="button"
            onClick={openNew}
            className="ms-auto md:ms-0 inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl bg-ink-slab text-white font-semibold text-sm hover:opacity-90"
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

      {tasks.length > 0 && groups.map(({ status, items }) => {
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
        </span>
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
