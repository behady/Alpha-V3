"use client";

/**
 * A named list the clinic maintains — visit reasons, patient sources.
 *
 * These were two files that differed only in the noun and the icon: the same string array in the
 * same shape of settings document, added to and removed from the same way, saved the same way. One
 * of them is now the screen and the other two are three lines of configuration each.
 *
 * Three things that were wrong in both, and are the reason this was worth doing once rather than
 * fixing twice:
 *
 *   - The remove button was `opacity-0 group-hover:opacity-100`. There is no hover on a tablet, so
 *     on the device most likely to be at a reception desk the only way to remove an entry was
 *     invisible. It is always there now, quiet until you reach for it.
 *
 *   - A drag handle that dragged nothing. It said the order could be rearranged, and it could not.
 *
 *   - An indigo accent that belonged to neither the clinic's theme nor anything else on the page.
 */

import { useEffect, useState } from "react";
import { getDoc, setDoc } from "firebase/firestore";
import { Plus, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { getClinicDoc } from "@/lib/db-utils";
import { useSettingsDraft } from "@/lib/settingsDraft";

export interface NamedListText {
  title: string;
  hint: string;
  addPlaceholder: string;
  add: string;
  empty: string;
  duplicate: string;
  saved: string;
  failed: string;
  save: string;
  discard: string;
  remove: string;
  /** e.g. "6 reasons" — the count is worth stating, the noun changes per list. */
  countLabel: (n: number) => string;
}

export default function NamedList({
  sectionId,
  docId,
  field,
  defaults,
  icon: Icon,
  text,
  canEdit = true,
}: {
  /** Registry id, so unsaved edits can be named when someone tries to leave. */
  sectionId: string;
  /** The settings document this list lives in. */
  docId: string;
  /** The array field inside it. */
  field: string;
  defaults: string[];
  icon: LucideIcon;
  text: NamedListText;
  canEdit?: boolean;
}) {
  const { showToast } = useUI();
  const { isRTL } = useLanguage();

  const [stored, setStored] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [fetched, setFetched] = useState(false);

  const {
    value: items,
    setValue: setItems,
    isDirty,
    discard,
    markSaved,
  } = useSettingsDraft<string[]>(sectionId, stored, defaults);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDoc(getClinicDoc("settings", docId));
        const saved = snap.exists() ? (snap.data() as Record<string, unknown>)[field] : null;
        if (!cancelled) setStored(Array.isArray(saved) ? (saved as string[]) : defaults);
      } finally {
        // An empty list an admin can start typing into beats a skeleton that never resolves.
        if (!cancelled) setFetched(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `defaults` is a module-level constant at every call site, so it is stable by construction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, field]);

  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (items.some((i) => i.toLowerCase() === trimmed.toLowerCase())) {
      showToast(text.duplicate, "error");
      return;
    }
    setItems([...items, trimmed]);
    setDraft("");
  };

  const save = async () => {
    setSaving(true);
    try {
      await setDoc(getClinicDoc("settings", docId), { [field]: items }, { merge: true });
      setStored(items);
      markSaved();
      showToast(text.saved, "success");
    } catch {
      showToast(text.failed, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full space-y-8">
      <div className="flex items-start gap-3.5">
        <span className="mt-0.5 shrink-0 rounded-2xl bg-accent-tint p-2.5 text-accent">
          <Icon size={18} />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-black tracking-tight text-ink">{text.title}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-body">{text.hint}</p>
        </div>
      </div>

      {canEdit && (
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder={text.addPlaceholder}
            aria-label={text.add}
            className="flex-1 rounded-xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent-soft"
          />
          <button
            type="button"
            onClick={add}
            disabled={!draft.trim()}
            aria-label={text.add}
            className="rounded-xl border border-line px-4 text-ink-body transition-colors hover:border-accent-soft hover:text-accent disabled:opacity-40"
          >
            <Plus size={18} />
          </button>
        </div>
      )}

      <div>
        <p className="pb-2 text-[11px] font-black uppercase tracking-[0.16em] text-ink-muted">
          {text.countLabel(items.length)}
        </p>
        <div className="divide-y divide-line border-t border-line">
          {!fetched ? (
            <div className="h-24 animate-pulse bg-surface-subtle" aria-hidden="true" />
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm font-semibold text-ink-muted">{text.empty}</p>
          ) : (
            items.map((item, index) => (
              <div key={`${item}-${index}`} className="flex items-center gap-3 py-3">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{item}</span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setItems(items.filter((_, i) => i !== index))}
                    aria-label={`${text.remove}: ${item}`}
                    className="shrink-0 rounded-lg p-2 text-ink-faint transition-colors hover:bg-danger-tint hover:text-danger"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Only when there is something to save, so there is never a button to go and find and never
          one to wonder about. */}
      {canEdit && isDirty && (
        <div className={`flex items-center gap-3 ${isRTL ? "flex-row-reverse" : ""}`}>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-xl bg-ink-slab px-5 py-2.5 text-xs font-black uppercase tracking-wider text-white transition-all active:scale-95 disabled:opacity-50"
          >
            {text.save}
          </button>
          <button
            type="button"
            onClick={discard}
            className="text-xs font-bold text-ink-muted transition-colors hover:text-ink"
          >
            {text.discard}
          </button>
        </div>
      )}
    </div>
  );
}
