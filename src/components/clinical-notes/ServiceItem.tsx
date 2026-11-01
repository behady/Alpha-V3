import { Edit2, ArrowRightLeft, Copy, Trash2, RefreshCcw, GripVertical, ChevronUp, ChevronDown, PhoneForwarded } from "lucide-react";
import { Note } from "./types";
import { useLanguage } from "@/context/LanguageContext";
import Protect from "@/components/Protect";
import InsurerBadge from "@/components/shared/InsurerBadge";
import { PRIVATE_PAYER_ID } from "@/lib/payers";
import { NotePhotoButton, NotePhotoStrip } from "./NotePhotos";
import { STATUS_OPTIONS } from "@/components/chair/ChairNoteCard";
import { formatDoctorName } from "@/lib/generalDentist";

interface Props {
  note: Note;
  onEdit: (note: Note) => void;
  onDelete: (note: Note) => void;
  onMove: (note: Note) => void;
  onContinue: (note: Note) => void;
  /** "Call to check on them in three days" — opens the call reminder window for this treatment. */
  onCallReminder?: (note: Note) => void;
  /** One dense line instead of the full card. Set from the Interface setting. */
  compact?: boolean;
  /** Reorder affordances, shown only while the timeline is in manual order. */
  reorder?: {
    onMoveUp: () => void;
    onMoveDown: () => void;
    canMoveUp: boolean;
    canMoveDown: boolean;
  };
  /** Chair mode: a dentist never sees what a treatment costs. */
  hideMoney?: boolean;
  /** Chair mode: another dentist's (or the clinic's) treatment — shown, never editable here. */
  locked?: boolean;
  /** The time of day it was done, when known. The timeline prints the date once per day above. */
  time?: string;
}

export default function ServiceItem({ note, onEdit, onDelete, onMove, onContinue, onCallReminder, compact = false, reorder, hideMoney = false, locked = false, time }: Props) {
  const { language } = useLanguage();
  const isAr = language === "ar";
  /** Stored status ids are English; the pill shows the app's own word for them. */
  const statusValue = note.status || "Planned";
  const statusOpt = STATUS_OPTIONS.find((o) => o.value === statusValue);
  const statusText = isAr && statusOpt ? statusOpt.ar : statusValue;
  const costText = isAr
    ? `${Number(note.cost).toLocaleString()} ج.م`
    : `EGP ${Number(note.cost).toLocaleString()}`;
  /** The insurer this note is charged to; nothing for the clinic's own work or for older notes. */
  const insurer = note.payerId && note.payerId !== PRIVATE_PAYER_ID && note.payerName ? note.payerName : null;
  const doctorName = formatDoctorName(note.doctor, language);
  // "د." stays on the reading side of an English name: the name is isolated, so the dot cannot
  // drift to the far end of the run.
  const doctorLabel = doctorName.startsWith("د. ") ? <>د. <bdi>{doctorName.slice(3)}</bdi></> : doctorName;
  // One tooth is "سن", two or more "أسنان" — never "سنة", which reads as a year.
  const toothCount = String(note.tooth || "").split(/[,،\s]+/).filter(Boolean).length;
  const toothWord = language === "ar" ? (toothCount > 1 ? "أسنان" : "سن") : toothCount > 1 ? "Teeth" : "Tooth";
  const toothLabel = <>{toothWord} <bdi dir="ltr">{note.tooth}</bdi></>;

  const txt = {
    edit: language === "ar" ? "تعديل" : "Edit",
    move: language === "ar" ? "نقل إلى موعد آخر" : "Move to another appointment",
    continue: language === "ar" ? "استكمال في موعد آخر" : "Continue in another appointment",
    delete: language === "ar" ? "حذف" : "Delete",
    callReminder: language === "ar" ? "تذكير بمكالمة" : "Call reminder",
    dragHint: language === "ar" ? "اسحب لإعادة الترتيب" : "Drag to reorder",
    moveUp: language === "ar" ? "تحريك لأعلى" : "Move up",
    moveDown: language === "ar" ? "تحريك لأسفل" : "Move down",
  };

  const getStatusColor = (status: string | undefined) => {
    switch (status) {
      case "Completed":
        return "bg-emerald-100 text-emerald-700";
      case "Ongoing":
        return "bg-amber-100 text-amber-700";
      default:
        return "bg-surface-muted text-slate-700";
    }
  };

  const getContainerStyles = (status: string | undefined) => {
    switch (status) {
      case "Ongoing":
        return "bg-surface border-amber-200 shadow-sm ring-1 ring-amber-400/20";
      case "Completed":
        return "bg-surface border-line opacity-80";
      default:
        return "bg-surface border-line hover:border-line-strong shadow-sm";
    }
  };

  /**
   * Up/down buttons sit beside the drag handle rather than replacing it.
   *
   * The handle uses the browser's own drag-and-drop, which phones and tablets do not fire at all —
   * and this app is used on phones between patients. Without buttons, manual order would silently
   * be a desktop-only feature.
   */
  const reorderControls = reorder ? (
    <div className={`flex flex-col items-center justify-center shrink-0 -ml-1 mr-1 ${compact ? "" : "max-md:m-0 max-md:flex-row max-md:self-center max-md:gap-1"}`}>
      <button
        type="button"
        onClick={reorder.onMoveUp}
        disabled={!reorder.canMoveUp}
        title={txt.moveUp}
        aria-label={txt.moveUp}
        className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-surface-muted disabled:opacity-25 disabled:hover:bg-transparent transition-colors"
      >
        <ChevronUp size={14} />
      </button>
      <GripVertical size={14} className="text-slate-300 cursor-grab active:cursor-grabbing" aria-hidden="true" />
      <button
        type="button"
        onClick={reorder.onMoveDown}
        disabled={!reorder.canMoveDown}
        title={txt.moveDown}
        aria-label={txt.moveDown}
        className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-surface-muted disabled:opacity-25 disabled:hover:bg-transparent transition-colors"
      >
        <ChevronDown size={14} />
      </button>
    </div>
  ) : null;

  if (compact) {
    return (
      <div
        className={`flex items-center gap-2 px-3 py-2 border rounded-xl transition-all group relative ${getContainerStyles(note.status)}`}
      >
        {reorderControls}

        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            note.status === "Completed" ? "bg-emerald-500" : note.status === "Ongoing" ? "bg-amber-500" : "bg-slate-300"
          }`}
          title={statusText}
        />

        <p className="font-bold text-ink truncate text-sm min-w-0 flex-1">{note.procedure}</p>

        {note.tooth && note.tooth !== "Gen" && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-subtle text-ink-body border border-line shrink-0">
            {note.tooth}
          </span>
        )}

        {insurer && <InsurerBadge name={insurer} size={16} />}

        <NotePhotoStrip note={note} compact canEdit={!locked} />

        {!hideMoney && Number(note.cost) > 0 && (
          <span className="text-xs font-black text-ink-body shrink-0">{costText}</span>
        )}

        <div className={`flex items-center gap-1 shrink-0 ${locked ? "hidden" : ""}`}>
          <NotePhotoButton note={note} size={13} />
          {onCallReminder && (
            <button
              onClick={() => onCallReminder(note)}
              title={txt.callReminder}
              aria-label={txt.callReminder}
              className="p-1.5 rounded-lg text-ink-body bg-surface-subtle hover:bg-surface-muted transition-colors border border-line"
            >
              <PhoneForwarded size={13} />
            </button>
          )}
          {!note.isContinued && (
            <Protect permission="clinical.edit">
              <button
                onClick={() => onEdit(note)}
                title={txt.edit}
                className="p-1.5 rounded-lg text-violet-600 bg-violet-50 hover:bg-violet-100 transition-colors border border-violet-100"
              >
                <Edit2 size={13} />
              </button>
            </Protect>
          )}
          <Protect permission="clinical.delete">
            <button
              onClick={() => onDelete(note)}
              title={txt.delete}
              className="p-1.5 rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors border border-rose-100"
            >
              <Trash2 size={13} />
            </button>
          </Protect>
        </div>
      </div>
    );
  }

  const phoneIcon =
    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink-muted transition-colors hover:border-ink-muted hover:text-ink disabled:opacity-60";

  /*
   * Phones (below `md`): one dense, start-aligned card. Name and price on the first line, the
   * tags and the time on the second, the dentist and four small icon buttons on the third. The
   * four big pastel buttons that used to sit under every card added a whole row of height and
   * put Delete right under a scrolling thumb; here it is the last, quietest icon, set apart from
   * the others, and it still asks before anything is removed.
   */
  const phoneCard = (
    <div className={`flex flex-col gap-2 rounded-xl border p-3 transition-all md:hidden ${getContainerStyles(note.status)}`}>
      <div className="flex items-start justify-between gap-2">
        {reorderControls}
        <p dir="auto" className="min-w-0 flex-1 break-words text-start text-base font-bold leading-snug text-ink">{note.procedure}</p>
        {!hideMoney && Number(note.cost) > 0 && (
          <span className="shrink-0 rounded-lg bg-surface-muted px-2.5 py-1 font-figure text-sm font-semibold text-ink">
            <bdi dir={isAr ? "rtl" : "ltr"}>{costText}</bdi>
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-bold ${getStatusColor(note.status)}`}>
          {note.status === "Ongoing" && (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500"></span>
            </span>
          )}
          {statusText}
        </span>
        {note.tooth && note.tooth !== "Gen" && (
          <span className="rounded-md border border-line bg-surface-subtle px-2 py-0.5 text-[11px] font-bold text-ink">
            {toothLabel}
          </span>
        )}
        {note.isContinued && (
          <span className="flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
            <RefreshCcw size={10} /> {isAr ? "متابعة" : "Follow Up"}
          </span>
        )}
        {insurer && (
          <span className="flex items-center gap-1 rounded-md border border-line bg-surface-subtle px-2 py-0.5 text-[11px] font-bold text-ink">
            <InsurerBadge name={insurer} size={12} /> {insurer}
          </span>
        )}
        {time && <span className="font-figure text-[11px] font-bold text-ink-muted">{time}</span>}
      </div>

      {note.note && (
        <p dir="auto" className="line-clamp-2 break-words text-sm font-semibold text-ink-body">{note.note}</p>
      )}

      <NotePhotoStrip note={note} canEdit={!locked} />

      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-medium text-ink-muted">{doctorLabel}</p>
        {!locked && (
          <div className="flex shrink-0 items-center gap-1.5">
            {!note.isContinued && (
              <Protect permission="clinical.edit">
                <button type="button" onClick={() => onEdit(note)} title={txt.edit} aria-label={txt.edit} className={phoneIcon}>
                  <Edit2 size={14} />
                </button>
              </Protect>
            )}
            <NotePhotoButton note={note} size={14} className={phoneIcon} />
            {onCallReminder && (
              <button type="button" onClick={() => onCallReminder(note)} title={txt.callReminder} aria-label={txt.callReminder} className={phoneIcon}>
                <PhoneForwarded size={14} />
              </button>
            )}
            <Protect permission="clinical.delete">
              <button
                type="button"
                onClick={() => onDelete(note)}
                title={txt.delete}
                aria-label={txt.delete}
                className={`${phoneIcon} ms-1.5 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700`}
              >
                <Trash2 size={14} />
              </button>
            </Protect>
          </div>
        )}
      </div>
    </div>
  );

  /*
   * The owner's layout: the treatment's name is the one thing a dentist scans the file for, so
   * it sits big and centred with its tags under it; the edit and delete buttons stack at the
   * edge, edit on top. From `md` up only; phones get the card above.
   */
  return (
    <>
    {phoneCard}
    <div className={`flex items-center justify-between gap-3 p-4 border rounded-xl transition-all group relative max-md:hidden ${getContainerStyles(note.status)}`}>
      {reorderControls}
      <div className="flex flex-col items-center gap-2 min-w-0 flex-1 text-center">
        <p className="font-black text-ink text-xl leading-tight max-md:text-lg">{note.procedure}</p>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <span
            className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-md ${getStatusColor(note.status)}`}
          >
            {note.status === "Ongoing" && (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
            )}
            {statusText}
          </span>
          {note.tooth && note.tooth !== "Gen" && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-md bg-surface-subtle text-ink border border-line">
              {toothLabel}
            </span>
          )}
          {note.isContinued && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
              <RefreshCcw size={11} /> {language === 'ar' ? 'متابعة' : 'Follow Up'}
            </span>
          )}
          {insurer && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-md bg-surface-subtle text-ink border border-line flex items-center gap-1.5">
              <InsurerBadge name={insurer} size={14} /> {insurer}
            </span>
          )}
        </div>

        {note.note && (
          <p className="text-[15px] font-bold text-ink-body line-clamp-2">
            {note.note}
          </p>
        )}

        <NotePhotoStrip note={note} canEdit={!locked} />

        {(note.doctor || (!hideMoney && Number(note.cost) > 0)) && (
          <div className="flex items-center justify-center gap-3 flex-wrap">
            {note.doctor && (
              <p className="text-sm font-bold text-ink-muted">{doctorLabel}</p>
            )}
            {!hideMoney && Number(note.cost) > 0 && (
              <p className="text-sm font-black text-ink bg-surface-muted px-2.5 py-1 rounded-md font-figure">
                <bdi dir={isAr ? "rtl" : "ltr"}>{costText}</bdi>
              </p>
            )}
          </div>
        )}
      </div>

      {/* Edit above delete, at the edge of the card. Locked (another dentist's, in chair mode): nothing to press. */}
      <div className={`flex flex-col items-center gap-1.5 shrink-0 ${locked ? "hidden" : ""}`}>
        {!note.isContinued && (
          <Protect permission="clinical.edit">
            <button
              onClick={() => onEdit(note)}
              title={txt.edit}
              aria-label={txt.edit}
              className="p-2.5 max-md:p-3 rounded-lg text-violet-600 bg-violet-50 hover:bg-violet-100 transition-colors shadow-sm border border-violet-100"
            >
              <Edit2 size={16} />
            </button>
          </Protect>
        )}

        <NotePhotoButton note={note} />

        {onCallReminder && (
          <button
            onClick={() => onCallReminder(note)}
            title={txt.callReminder}
            aria-label={txt.callReminder}
            className="p-2.5 max-md:p-3 rounded-lg text-ink-body bg-surface-subtle hover:bg-surface-muted transition-colors shadow-sm border border-line"
          >
            <PhoneForwarded size={16} />
          </button>
        )}

        <Protect permission="clinical.delete">
          <button
            onClick={() => onDelete(note)}
            title={txt.delete}
            aria-label={txt.delete}
            className="p-2.5 max-md:p-3 rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors shadow-sm border border-rose-100"
          >
            <Trash2 size={16} />
          </button>
        </Protect>
      </div>
    </div>
    </>
  );
}
