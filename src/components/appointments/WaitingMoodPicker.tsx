"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WAITING_MOODS, getWaitingMoodEmoji } from "@/lib/waitingMoods";

type Props = {
  value: string | null | undefined;
  onChange: (mood: string) => void;
  language: "en" | "ar";
  /** Stop parent row click (dashboard / calendar). */
  isolateClicks?: boolean;
  className?: string;
};

export default function WaitingMoodPicker({
  value,
  onChange,
  language,
  isolateClicks = true,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  const current = value || "neutral";
  const emoji = getWaitingMoodEmoji(current) || "😐";

  const updateMenuPosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = 200;
    let left = rect.left;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    setMenuPos({ top: rect.bottom + 4, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      const portal = document.getElementById("waiting-mood-picker-menu");
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

  const stop = (e: React.SyntheticEvent) => {
    if (!isolateClicks) return;
    e.stopPropagation();
  };

  const menu =
    open && menuPos && mounted ? (
      <div
        id="waiting-mood-picker-menu"
        role="listbox"
        className="fixed z-[9999] min-w-[200px] rounded-xl border border-line bg-surface py-1 shadow-xl"
        style={{ top: menuPos.top, left: menuPos.left }}
        onClick={stop}
        onMouseDown={stop}
      >
        {WAITING_MOODS.map((m) => {
          const active = current === m.key;
          return (
            <button
              key={m.key}
              type="button"
              role="option"
              aria-selected={active}
              onClick={(e) => {
                stop(e);
                onChange(m.key);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-bold transition-colors hover:bg-surface-subtle ${
                active ? "bg-primary-50 text-primary-800" : "text-slate-700"
              }`}
            >
              <span className="text-lg leading-none">{m.emoji}</span>
              {language === "ar" ? m.labelAr : m.labelEn}
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          stop(e);
          if (open) setOpen(false);
          else {
            updateMenuPosition();
            setOpen(true);
          }
        }}
        title={language === "ar" ? "اضغط لتغيير مزاج الانتظار" : "Click to change waiting mood"}
        aria-label={language === "ar" ? "مزاج الانتظار" : "Waiting mood"}
        aria-expanded={open}
        className={`inline-flex shrink-0 items-center justify-center rounded-lg text-xl leading-none transition hover:bg-white/60 hover:scale-110 active:scale-95 ${className}`}
      >
        {emoji}
      </button>
      {mounted && menu ? createPortal(menu, document.body) : null}
    </>
  );
}
