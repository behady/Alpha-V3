"use client";

import { useMemo, useState } from "react";
import { Plus, Clock, CalendarDays, Inbox, ArrowDownWideNarrow, ArrowUpNarrowWide, MoveVertical } from "lucide-react";
import Protect from "@/components/Protect";
import { Note, RelatedAppointment } from "./types";
import ServiceItem from "./ServiceItem";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import {
  GENERAL_GROUP_KEY,
  NoteGroup,
  groupNotesByVisit,
  moveItem,
  reorderedIndexes,
  sortNotes,
} from "./ordering";

interface Props {
  services: Note[];
  appointments: RelatedAppointment[];
  onAddService: () => void;
  onEditService: (note: Note) => void;
  onDeleteService: (note: Note) => void;
  onMoveService: (note: Note) => void;
  onContinueService: (note: Note) => void;
  /** Persists a hand-arranged order. Only called while the timeline is in manual mode. */
  onReorder: (changes: { id: string; sortIndex: number }[]) => Promise<void> | void;
}

export default function TimelineCard({
  services,
  appointments,
  onAddService,
  onEditService,
  onDeleteService,
  onMoveService,
  onContinueService,
  onReorder,
}: Props) {
  const { language } = useLanguage();
  const { clinicalNoteSort, clinicalNoteGrouping, clinicalNoteDensity } = useUI();

  const isAr = language === "ar";
  const compact = clinicalNoteDensity === "compact";
  const manual = clinicalNoteSort === "manual";

  const [dragId, setDragId] = useState<string | null>(null);

  const txt = {
    title: isAr ? "التاريخ الطبي والإجراءات" : "Clinical History & Procedures",
    subtitle: isAr ? "سجل زمني لجميع الإجراءات التي تمت للمريض" : "Chronological timeline of all procedures",
    addProcedure: isAr ? "إضافة إجراء جديد" : "Add New Procedure",
    emptyList: isAr ? "لا توجد إجراءات مسجلة بعد." : "No procedures recorded yet.",
    generalGroup: isAr ? "إجراءات غير مرتبطة بموعد" : "Not linked to a visit",
    visit: isAr ? "زيارة" : "Visit",
    manualHint: isAr
      ? "الترتيب اليدوي مفعّل — اسحب الإجراء أو استخدم الأسهم لترتيبه. الترتيب يظهر لكل من يفتح ملف المريض."
      : "Manual order is on — drag a service, or use the arrows, to arrange it. The order is what everyone opening this patient sees.",
    sortNewest: isAr ? "الأحدث أولاً" : "Newest first",
    sortOldest: isAr ? "الأقدم أولاً" : "Oldest first",
    sortManual: isAr ? "ترتيب يدوي" : "Manual order",
    changeInSettings: isAr ? "غيّره من الإعدادات ← واجهة الاستخدام" : "Change in Settings → Interface",
  };

  /**
   * The flat, ordered list. Grouping is layered on top of this rather than replacing it, so a
   * drag computes positions against one continuous sequence — otherwise moving a service to the
   * top of its group would collide with the indexes of the group above it.
   */
  const orderedNotes = useMemo(() => sortNotes(services, clinicalNoteSort), [services, clinicalNoteSort]);

  const groups: NoteGroup[] = useMemo(() => {
    if (clinicalNoteGrouping === "visit") return groupNotesByVisit(services, appointments, clinicalNoteSort);
    return [{ key: "__all__", appointment: null, notes: orderedNotes, dateKey: 0 }];
  }, [services, appointments, clinicalNoteGrouping, clinicalNoteSort, orderedNotes]);

  const applyOrder = (next: Note[]) => {
    const changes = reorderedIndexes(next);
    if (changes.length > 0) void onReorder(changes);
  };

  const moveByOffset = (noteId: string, offset: number) => {
    const from = orderedNotes.findIndex((n) => n.id === noteId);
    if (from === -1) return;
    applyOrder(moveItem(orderedNotes, from, from + offset));
  };

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const from = orderedNotes.findIndex((n) => n.id === dragId);
    const to = orderedNotes.findIndex((n) => n.id === targetId);
    setDragId(null);
    if (from === -1 || to === -1) return;
    applyOrder(moveItem(orderedNotes, from, to));
  };

  const sortLabel =
    clinicalNoteSort === "manual" ? txt.sortManual : clinicalNoteSort === "oldest" ? txt.sortOldest : txt.sortNewest;
  const SortIcon = clinicalNoteSort === "manual" ? MoveVertical : clinicalNoteSort === "oldest" ? ArrowUpNarrowWide : ArrowDownWideNarrow;

  const formatDate = (raw?: string) => {
    if (!raw) return "";
    const d = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(isAr ? "ar-EG" : "en-US", { day: "numeric", month: "short", year: "numeric" });
  };

  /**
   * The date shown beside a service.
   *
   * The treatment date the user picked always wins — createdAt only fills in when a note has no
   * date at all. Showing createdAt whenever it existed silently replaced a backdated procedure's
   * real date with today's, the moment it was typed in.
   */
  const displayDates = (note: Note) => {
    let displayDate = formatDate(note.date);
    const createdAtDate = note.createdAt && typeof note.createdAt.toDate === "function" ? note.createdAt.toDate() : null;

    if (!displayDate && createdAtDate) {
      displayDate = createdAtDate.toLocaleDateString(isAr ? "ar-EG" : "en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    }

    // Only show a time when it belongs to the same calendar day as the displayed date — pairing
    // today's entry-time with a backdated date would suggest the treatment happened at that time.
    const displayTime =
      createdAtDate && createdAtDate.toISOString().slice(0, 10) === note.date
        ? createdAtDate.toLocaleTimeString(isAr ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" })
        : "";

    return { displayDate, displayTime };
  };

  const renderService = (note: Note) => {
    const index = orderedNotes.findIndex((n) => n.id === note.id);
    return (
      <ServiceItem
        note={note}
        onEdit={onEditService}
        onDelete={onDeleteService}
        onMove={onMoveService}
        onContinue={onContinueService}
        compact={compact}
        reorder={
          manual
            ? {
                onMoveUp: () => moveByOffset(note.id, -1),
                onMoveDown: () => moveByOffset(note.id, 1),
                canMoveUp: index > 0,
                canMoveDown: index > -1 && index < orderedNotes.length - 1,
              }
            : undefined
        }
      />
    );
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm hover:border-slate-300 transition-colors overflow-hidden">
      {/* Header */}
      <div className="p-5 flex items-center justify-between border-b border-slate-100 bg-slate-50/50 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 bg-white border border-slate-200 rounded-xl flex items-center justify-center text-teal-500 shadow-sm shrink-0">
            <Clock size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-slate-900 text-base truncate">{txt.title}</h3>
            <p className="text-[11px] font-medium text-slate-500 truncate">{txt.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* What arrangement is in force, so nobody wonders why the order changed. */}
          <span
            title={txt.changeInSettings}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-slate-500"
          >
            <SortIcon size={13} /> {sortLabel}
          </span>
          <Protect permission="clinical.edit">
            <button
              data-tour="clinical-add-procedure" onClick={onAddService}
              className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm rounded-xl transition-colors shadow-sm"
            >
              <Plus size={16} />
              <span className="hidden sm:inline">{txt.addProcedure}</span>
            </button>
          </Protect>
        </div>
      </div>

      {/* Timeline Content */}
      <div className={compact ? "p-4 sm:p-5" : "p-5 sm:p-8"}>
        {manual && services.length > 1 && (
          <p className="mb-4 text-[11px] font-bold text-teal-700 bg-teal-50 border border-teal-100 rounded-xl px-3 py-2 leading-relaxed">
            {txt.manualHint}
          </p>
        )}

        {orderedNotes.length === 0 ? (
          <div className="text-center py-10 bg-slate-50/50 rounded-xl border border-slate-200 border-dashed">
            <p className="text-sm font-medium text-slate-400">{txt.emptyList}</p>
          </div>
        ) : clinicalNoteGrouping === "visit" ? (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.key} className="rounded-2xl border border-slate-200 overflow-hidden">
                <header className="flex items-center gap-2.5 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                  {group.key === GENERAL_GROUP_KEY ? (
                    <Inbox size={15} className="text-slate-400 shrink-0" />
                  ) : (
                    <CalendarDays size={15} className="text-teal-500 shrink-0" />
                  )}
                  <span className="text-sm font-bold text-slate-800 truncate">
                    {group.key === GENERAL_GROUP_KEY
                      ? txt.generalGroup
                      : `${txt.visit} — ${formatDate(group.appointment?.date) || "—"}`}
                  </span>
                  {group.appointment?.time && (
                    <span className="text-[11px] font-bold text-slate-500 shrink-0">{group.appointment.time}</span>
                  )}
                  {(group.appointment?.doctorName || group.appointment?.doctor) && (
                    <span className="text-[11px] font-bold text-slate-400 truncate">
                      Dr. {group.appointment.doctorName || group.appointment.doctor}
                    </span>
                  )}
                  <span className="ms-auto text-[11px] font-black text-slate-400 shrink-0">{group.notes.length}</span>
                </header>

                <div className={`p-3 ${compact ? "space-y-1.5" : "space-y-3"}`}>
                  {group.notes.map((note) => (
                    <div
                      key={note.id}
                      draggable={manual}
                      onDragStart={() => setDragId(note.id)}
                      onDragOver={(e) => manual && e.preventDefault()}
                      onDrop={() => handleDrop(note.id)}
                      onDragEnd={() => setDragId(null)}
                      className={dragId === note.id ? "opacity-40" : ""}
                    >
                      {renderService(note)}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="relative">
            {/* The continuous vertical line */}
            {!compact && <div className="absolute top-2 bottom-2 left-6 md:left-[120px] w-px bg-slate-200" />}

            <div className={compact ? "space-y-2" : "space-y-6"}>
              {orderedNotes.map((note) => {
                const { displayDate, displayTime } = displayDates(note);

                if (compact) {
                  return (
                    <div
                      key={note.id}
                      draggable={manual}
                      onDragStart={() => setDragId(note.id)}
                      onDragOver={(e) => manual && e.preventDefault()}
                      onDrop={() => handleDrop(note.id)}
                      onDragEnd={() => setDragId(null)}
                      className={`flex items-center gap-3 ${dragId === note.id ? "opacity-40" : ""}`}
                    >
                      <span className="w-[86px] shrink-0 text-[11px] font-bold text-slate-500 text-end">
                        {displayDate}
                      </span>
                      <div className="flex-1 min-w-0">{renderService(note)}</div>
                    </div>
                  );
                }

                return (
                  <div
                    key={note.id}
                    draggable={manual}
                    onDragStart={() => setDragId(note.id)}
                    onDragOver={(e) => manual && e.preventDefault()}
                    onDrop={() => handleDrop(note.id)}
                    onDragEnd={() => setDragId(null)}
                    className={`relative flex flex-col md:flex-row gap-4 md:gap-8 group ${
                      dragId === note.id ? "opacity-40" : ""
                    }`}
                  >
                    {/* Timestamp Section (Left) */}
                    <div className="md:w-[100px] shrink-0 pt-2 pl-12 md:pl-0 md:text-right flex flex-col">
                      <span className="text-sm font-bold text-slate-800">{displayDate}</span>
                      {displayTime && <span className="text-xs font-semibold text-slate-500">{displayTime}</span>}
                    </div>

                    {/* Timeline Node (Center Dot) */}
                    <div className="absolute left-6 md:left-[120px] top-3 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-white bg-teal-500 shadow-[0_0_0_2px_rgba(20,184,166,0.2)] group-hover:bg-teal-600 group-hover:scale-125 transition-all duration-300" />

                    {/* Content Section (Right) */}
                    <div className="flex-1 ml-12 md:ml-0 bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md hover:border-slate-200 transition-all p-1">
                      {renderService(note)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
