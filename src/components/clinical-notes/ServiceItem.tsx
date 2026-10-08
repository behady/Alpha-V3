import { Edit2, ArrowRightLeft, Copy, Trash2, RefreshCcw, GripVertical, ChevronUp, ChevronDown } from "lucide-react";
import { Note } from "./types";
import { useLanguage } from "@/context/LanguageContext";
import Protect from "@/components/Protect";
import InsurerBadge from "@/components/shared/InsurerBadge";
import { PRIVATE_PAYER_ID } from "@/lib/payers";

interface Props {
  note: Note;
  onEdit: (note: Note) => void;
  onDelete: (note: Note) => void;
  onMove: (note: Note) => void;
  onContinue: (note: Note) => void;
  /** One dense line instead of the full card. Set from the Interface setting. */
  compact?: boolean;
  /** Reorder affordances, shown only while the timeline is in manual order. */
  reorder?: {
    onMoveUp: () => void;
    onMoveDown: () => void;
    canMoveUp: boolean;
    canMoveDown: boolean;
  };
}

export default function ServiceItem({ note, onEdit, onDelete, onMove, onContinue, compact = false, reorder }: Props) {
  const { language } = useLanguage();
  /** The insurer this note is charged to; nothing for the clinic's own work or for older notes. */
  const insurer = note.payerId && note.payerId !== PRIVATE_PAYER_ID && note.payerName ? note.payerName : null;

  const txt = {
    edit: language === "ar" ? "تعديل" : "Edit",
    move: language === "ar" ? "نقل إلى موعد آخر" : "Move to another appointment",
    continue: language === "ar" ? "استكمال في موعد آخر" : "Continue in another appointment",
    delete: language === "ar" ? "حذف" : "Delete",
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
    <div className="flex flex-col items-center justify-center shrink-0 -ml-1 mr-1">
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
          title={note.status || "Planned"}
        />

        <p className="font-bold text-ink truncate text-sm min-w-0 flex-1">{note.procedure}</p>

        {note.tooth && note.tooth !== "Gen" && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-subtle text-ink-body border border-line shrink-0">
            {note.tooth}
          </span>
        )}

        {insurer && <InsurerBadge name={insurer} size={16} />}

        {Number(note.cost) > 0 && (
          <span className="text-xs font-black text-ink-body shrink-0">EGP {Number(note.cost).toLocaleString()}</span>
        )}

        <div className="flex items-center gap-1 shrink-0">
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

  /*
   * The owner's layout: the treatment's name is the one thing a dentist scans the file for, so
   * it sits big and centred with its tags under it; the edit and delete buttons stack at the
   * edge, edit on top.
   */
  return (
    <div className={`flex items-center justify-between gap-3 p-4 border rounded-xl transition-all group relative ${getContainerStyles(note.status)}`}>
      {reorderControls}
      <div className="flex flex-col items-center gap-2 min-w-0 flex-1 text-center">
        <p className="font-black text-ink text-xl leading-tight">{note.procedure}</p>
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
            {note.status || "Planned"}
          </span>
          {note.tooth && note.tooth !== "Gen" && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-md bg-surface-subtle text-ink border border-line">
              <bdi dir="ltr">{language === 'ar' ? `سن ${note.tooth}` : `Tooth ${note.tooth}`}</bdi>
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

        {(note.doctor || Number(note.cost) > 0) && (
          <div className="flex items-center justify-center gap-3 flex-wrap">
            {note.doctor && (
              <p className="text-sm font-bold text-ink-muted">Dr. {note.doctor}</p>
            )}
            {Number(note.cost) > 0 && (
              <p className="text-sm font-black text-ink bg-surface-muted px-2.5 py-1 rounded-md font-figure">
                <bdi dir="ltr">EGP {Number(note.cost).toLocaleString()}</bdi>
              </p>
            )}
          </div>
        )}
      </div>

      {/* Edit above delete, at the edge of the card. */}
      <div className="flex flex-col items-center gap-1.5 shrink-0">
        {!note.isContinued && (
          <Protect permission="clinical.edit">
            <button
              onClick={() => onEdit(note)}
              title={txt.edit}
              aria-label={txt.edit}
              className="p-2.5 rounded-lg text-violet-600 bg-violet-50 hover:bg-violet-100 transition-colors shadow-sm border border-violet-100"
            >
              <Edit2 size={16} />
            </button>
          </Protect>
        )}

        <Protect permission="clinical.delete">
          <button
            onClick={() => onDelete(note)}
            title={txt.delete}
            aria-label={txt.delete}
            className="p-2.5 rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors shadow-sm border border-rose-100"
          >
            <Trash2 size={16} />
          </button>
        </Protect>
      </div>
    </div>
  );
}
