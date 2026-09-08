"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { 
  ChevronDown, 
  ChevronUp,
  CalendarClock,
  CheckCircle2,
  ClockAlert,
  XCircle,
  UserCheck,
  Stethoscope,
  Banknote,
  CheckSquare,
  Timer,
  UserX,
  Siren,
  RefreshCcw,
  CircleDashed
} from "lucide-react";
import {
  APPOINTMENT_STAGES,
  getAppointmentStageLabel,
  getAppointmentStatusStyles,
} from "@/lib/appointmentStages";

type MenuPos = { top: number; left: number; width: number };

type Props = {
  value: string;
  onChange: (next: string) => void;
  language: "en" | "ar";
  compact?: boolean;
  /** Stop click from opening parent (calendar card / modal). */
  isolateClicks?: boolean;
  className?: string;
  fullWidth?: boolean;
};

const MENU_MIN_W = 172;

export function getStageIcon(status: string) {
  switch (status) {
    case "Scheduled": return CalendarClock;
    case "Confirmed": return CheckCircle2;
    case "Checked In": return UserCheck;
    case "In Chair": return Stethoscope;
    case "Checking Out": return Banknote;
    case "Completed": return CheckSquare;
    case "Late": return Timer;
    case "Delayed": return ClockAlert;
    case "Cancelled": return XCircle;
    case "No Show": return UserX;
    case "Rescheduled": return RefreshCcw;
    case "Emergency": return Siren;
    default: return CircleDashed;
  }
}

export default function AppointmentStagePicker({
  value,
  onChange,
  language,
  compact = false,
  isolateClicks = true,
  className = "",
  fullWidth = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  const updateMenuPosition = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = fullWidth ? rect.width : Math.max(MENU_MIN_W, rect.width);
    let left = rect.left;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    if (left < 8) left = 8;

    const spaceBelow = window.innerHeight - rect.bottom;
    const estimatedHeight = APPOINTMENT_STAGES.length * 36 + 12;
    const top =
      spaceBelow < estimatedHeight + 8 && rect.top > estimatedHeight + 8
        ? rect.top - estimatedHeight - 4
        : rect.bottom + 4;

    setMenuPos({ top, left, width });
  }, [fullWidth]);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      const portal = document.getElementById("appointment-stage-picker-menu");
      if (portal?.contains(target)) return;
      setOpen(false);
    };
    const onReposition = () => updateMenuPosition();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, updateMenuPosition]);

  const current = value || "Scheduled";
  const st = getAppointmentStatusStyles(current);
  const label = getAppointmentStageLabel(current, language);
  const CurrentIcon = getStageIcon(current);

  const stop = (e: React.SyntheticEvent) => {
    if (!isolateClicks) return;
    e.stopPropagation();
  };

  const toggleOpen = (e: React.MouseEvent) => {
    stop(e);
    if (open) {
      setOpen(false);
      return;
    }
    updateMenuPosition();
    setOpen(true);
  };

  const menu =
    open && menuPos && mounted ? (
      <div
        id="appointment-stage-picker-menu"
        role="listbox"
        className="fixed z-[9999] rounded-xl border border-line bg-surface py-1 shadow-xl shadow-slate-300/40 max-h-[min(320px,70vh)] overflow-y-auto custom-scrollbar"
        style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
        onClick={stop}
        onMouseDown={stop}
      >
        {APPOINTMENT_STAGES.map((stage) => {
          const stageSt = getAppointmentStatusStyles(stage.value);
          const stageLabel = getAppointmentStageLabel(stage.value, language);
          const active = current === stage.value;
          const StageIcon = getStageIcon(stage.value);
          return (
            <button
              key={stage.value}
              type="button"
              role="option"
              aria-selected={active}
              onClick={(e) => {
                stop(e);
                onChange(stage.value);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-3 px-4 py-3.5 text-[15px] font-bold transition-colors hover:bg-surface-subtle justify-start text-left ${
                active ? "bg-primary-50 text-primary-800" : "text-slate-700"
              }`}
            >
              <StageIcon size={18} className={`shrink-0 ${stageSt.dot.replace("bg-", "text-")}`} />
              {stageLabel}
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <div
      ref={rootRef}
      className={`relative shrink-0 ${fullWidth ? 'w-full' : ''} ${className}`}
      onClick={stop}
      onMouseDown={stop}
    >
      <div 
        className={`flex items-center ${fullWidth ? 'w-full relative border-2 border-slate-100 rounded-xl px-3 py-3 bg-surface cursor-pointer focus-within:border-primary-500 shadow-sm' : 'gap-0.5'}`}
        onClick={toggleOpen}
      >
        <span
          className={`flex items-center gap-3 font-bold leading-tight ${
            fullWidth ? 'text-[15px] text-slate-800 flex-1 justify-start py-0.5 px-1' :
            (compact ? `inline-flex rounded-md px-1.5 py-0.5 text-[9px] ${st.pill}` : `inline-flex rounded-md px-2 py-1 text-[10px] sm:text-xs ${st.pill}`)
          }`}
        >
          {fullWidth ? (
            <CurrentIcon size={18} className={`shrink-0 ${st.dot.replace("bg-", "text-")}`} />
          ) : (
            <span className={`rounded-full shrink-0 ${st.dot} ${compact ? "w-1.5 h-1.5" : "w-2 h-2"}`} />
          )}
          <span className="whitespace-nowrap truncate">{label}</span>
        </span>
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={language === "ar" ? "مراحل الموعد" : "Appointment stages"}
          className={`rounded-md text-ink-muted transition-colors ${
            fullWidth ? "absolute end-3 p-0.5 pointer-events-none" : (compact ? "p-0.5 hover:bg-surface-muted hover:text-slate-800" : "p-1 hover:bg-surface-muted hover:text-slate-800")
          }`}
        >
          {open ? <ChevronUp size={fullWidth ? 16 : (compact ? 12 : 14)} /> : <ChevronDown size={fullWidth ? 16 : (compact ? 12 : 14)} />}
        </button>
      </div>

      {mounted && menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
