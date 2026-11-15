"use client";

/**
 * A field you can type in or pick from.
 *
 * The browser's own version (`<input list>`) is drawn by the phone, not by us: on Android it is a
 * strip of words above the keyboard, which nobody reads as a drop-down. This draws the list
 * under the field instead, the same on every screen. Typing a name that is not in the list is
 * still allowed.
 */

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { suggestionsFor } from "@/lib/suggestInput";

export default function SuggestInput({
  value,
  onChange,
  options,
  placeholder,
  className = "",
  dataTour,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  placeholder?: string;
  /** The form's own input classes, so the field looks like its neighbours. */
  className?: string;
  dataTour?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const shown = open ? suggestionsFor(options, value) : [];

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const pick = (option: string) => {
    onChange(option);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div ref={boxRef} className="relative">
      <input
        ref={inputRef}
        data-tour={dataTour}
        role="combobox"
        aria-expanded={shown.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) return setOpen(true);
            if (!shown.length) return;
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive((i) => (i + step + shown.length) % shown.length);
          } else if (e.key === "Enter" && open && active >= 0 && shown[active]) {
            e.preventDefault();
            pick(shown[active]);
          }
        }}
        placeholder={placeholder}
        className={`${className} pe-9`}
      />
      {options.length > 0 && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setOpen((o) => !o);
            inputRef.current?.focus();
          }}
          className="absolute inset-y-0 end-0 flex w-9 items-center justify-center text-slate-400"
        >
          <ChevronDown size={16} className={`transition-transform ${open && shown.length ? "rotate-180" : ""}`} />
        </button>
      )}
      {shown.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-xl custom-scrollbar"
        >
          {shown.map((option, i) => {
            const chosen = option.toLowerCase() === value.trim().toLowerCase();
            return (
              <li
                key={option}
                role="option"
                aria-selected={chosen}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(option)}
                className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-start text-sm ${
                  chosen ? "font-black text-ink" : "font-bold text-slate-700"
                } ${i === active || chosen ? "bg-surface-subtle" : "hover:bg-surface-subtle"}`}
              >
                <bdi className="min-w-0 truncate">{option}</bdi>
                {chosen && <Check size={15} className="shrink-0 text-ink" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
