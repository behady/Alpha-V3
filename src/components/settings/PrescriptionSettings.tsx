"use client";

import { deleteRecord, RecycleBinError } from "@/lib/recycleBinApi";
import { useSettingsText } from "@/lib/useSettingsText";
import { useClinic } from "@/context/ClinicContext";
import { useState, useEffect, useMemo } from "react";
import { Pill, Plus, Trash2, X, Save, Search, Pencil, RotateCcw } from "lucide-react";
import { onSnapshot, addDoc, updateDoc } from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { DRUG_CATALOG, DRUG_CATEGORIES } from "@/lib/drugCatalog";
import {
  catalogDrugById,
  mergeDrugList,
  searchDrugEntries,
  type ClinicDrugDoc,
  type DrugListEntry,
} from "@/lib/drugList";

/**
 * The clinic's drug list: the built-in Egyptian library and the clinic's own shortcuts, in one
 * place, all of it editable.
 *
 * This page used to show only what the clinic had typed, which meant a brand-new clinic looked at
 * an empty screen while 53 drugs sat in the prescription studio with no way to change any of them.
 * Now every drug in the system is listed here and every one can be renamed, re-dosed or removed.
 *
 * Copy-on-write is what keeps that cheap. A built-in stores nothing until it is touched; editing
 * one writes a single document carrying `catalogId`, and removing one writes that document with
 * `hidden: true`. `src/lib/drugList.ts` owns the merge rules, so the studio shows exactly this.
 *
 * Restoring writes the built-in's values back rather than deleting the row: firestore.rules puts
 * `drugs` behind the recycle bin, so the browser cannot delete one of these documents directly.
 */
export default function PrescriptionSettings() {
  const { clinicId } = useClinic();
  const { language, isRTL } = useLanguage();
  const { showToast, confirm } = useUI();
  const isAr = language === "ar";

  const [drugDocs, setDrugDocs] = useState<ClinicDrugDoc[]>([]);
  const [search, setSearch] = useState("");
  const [showRemoved, setShowRemoved] = useState(false);

  const [isDrugModalOpen, setIsDrugModalOpen] = useState(false);
  const [editing, setEditing] = useState<DrugListEntry | null>(null);
  const [newDrugName, setNewDrugName] = useState("");
  const [newDrugDose, setNewDrugDose] = useState("");
  const [newDrugDoseAr, setNewDrugDoseAr] = useState("");
  const [saving, setSaving] = useState(false);

  const txt = useSettingsText("prescriptions");

  useEffect(() => {
    // No orderBy: a "removed" marker carries no dose and ordering on a field would be one more
    // way for a document to fall out of the list silently. mergeDrugList sorts what it returns.
    const unsub = onSnapshot(getClinicCollection("drugs"), (s) =>
      setDrugDocs(s.docs.map((d) => ({ id: d.id, ...d.data() }) as ClinicDrugDoc))
    );
    return () => unsub();
  }, []);

  const entries = useMemo(() => mergeDrugList(drugDocs), [drugDocs]);
  const visible = useMemo(() => searchDrugEntries(entries, search), [entries, search]);
  const ownCount = entries.filter((e) => e.origin === "clinic").length;

  /** Built-ins the dentist took off the list, so there is always a way back. */
  const removed = useMemo(
    () =>
      drugDocs
        .filter((d) => d.hidden && d.catalogId)
        .map((d) => ({ doc: d, drug: catalogDrugById(d.catalogId || "") }))
        .filter((r) => !!r.drug),
    [drugDocs]
  );

  const openAddModal = () => {
    setEditing(null);
    setNewDrugName("");
    setNewDrugDose("");
    setNewDrugDoseAr("");
    setIsDrugModalOpen(true);
  };

  const openEditModal = (entry: DrugListEntry) => {
    setEditing(entry);
    setNewDrugName(entry.name);
    setNewDrugDose(entry.dose);
    setNewDrugDoseAr(entry.doseAr);
    setIsDrugModalOpen(true);
  };

  const handleSaveDrug = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newDrugName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      const fields = { name, dose: newDrugDose.trim(), doseAr: newDrugDoseAr.trim() };

      if (editing?.docId) {
        await updateDoc(getClinicDoc("drugs", editing.docId), { ...fields, hidden: false });
      } else if (editing?.catalogId) {
        // First edit of a built-in: this is the document that from now on stands in front of it.
        await addDoc(getClinicCollection("drugs"), { ...fields, catalogId: editing.catalogId, hidden: false });
      } else {
        await addDoc(getClinicCollection("drugs"), fields);
      }

      setIsDrugModalOpen(false);
      showToast(isAr ? "اتحفظ" : "Saved", "success");
    } catch {
      showToast(isAr ? "تعذر الحفظ" : "Could not save", "error");
    } finally {
      setSaving(false);
    }
  };

  const removeDrug = async (entry: DrugListEntry) => {
    const question = isAr
      ? `تشيل «${entry.name}» من قائمة العيادة؟`
      : `Remove “${entry.name}” from the clinic's list?`;
    if (!(await confirm(question))) return;

    try {
      if (entry.catalogId) {
        // A built-in is not deleted, it is marked hidden — there is nothing in the database to
        // delete until the clinic has touched it, and it must stay restorable afterwards.
        const marker = { catalogId: entry.catalogId, name: entry.name, hidden: true };
        if (entry.docId) await updateDoc(getClinicDoc("drugs", entry.docId), marker);
        else await addDoc(getClinicCollection("drugs"), marker);
        showToast(isAr ? "اتشال من القائمة" : "Removed from the list", "success");
        return;
      }

      await deleteRecord(clinicId || "", "drugs", entry.docId || "");
      showToast(isAr ? "اتنقل لسلة المحذوفات" : "Moved to Recently Deleted", "success");
    } catch (err) {
      showToast(
        err instanceof RecycleBinError ? err.message : isAr ? "تعذر الحذف" : "Could not remove",
        "error"
      );
    }
  };

  /** Put a built-in back the way it ships — used both for an edited row and a removed one. */
  const restoreBuiltIn = async (docId: string, catalogId: string) => {
    const drug = catalogDrugById(catalogId);
    if (!drug) return;
    try {
      await updateDoc(getClinicDoc("drugs", docId), {
        catalogId,
        name: drug.name,
        dose: drug.doseEn,
        doseAr: drug.doseAr,
        hidden: false,
      });
      showToast(isAr ? "رجع زي ما كان" : "Restored", "success");
    } catch {
      showToast(isAr ? "تعذر الاسترجاع" : "Could not restore", "error");
    }
  };

  const badgeFor = (entry: DrugListEntry) => {
    if (entry.origin === "clinic") {
      return { label: isAr ? "بتاع العيادة" : "Your own", cls: "bg-accent-tint text-accent border-transparent" };
    }
    if (entry.origin === "customized") {
      return { label: isAr ? "معدّل" : "Edited", cls: "bg-warn-tint text-warn border-warn/25" };
    }
    const cat = DRUG_CATEGORIES.find((c) => c.id === entry.cat);
    return { label: (isAr ? cat?.labelAr : cat?.labelEn) || "", cls: cat?.soft || "bg-slate-100 text-slate-700 border-slate-200" };
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-2 border-b border-line pb-6">
            <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-tint text-accent"><Pill size={28}/></div>
                <div>
                    <h3 className="text-xl font-bold text-ink">{txt.drugDbTitle}</h3>
                    <p className="text-sm font-semibold text-ink-muted mt-1">
                      {isAr
                        ? `${DRUG_CATALOG.length} دوا مصري جاهز${ownCount ? ` + ${ownCount} من عندك` : ""} — كلهم تقدر تعدلهم`
                        : `${DRUG_CATALOG.length} built-in Egyptian drugs${ownCount ? ` + ${ownCount} of your own` : ""} — every one editable`}
                    </p>
                </div>
            </div>
            <button onClick={openAddModal} className="flex items-center gap-2 rounded-2xl bg-accent px-5 py-3 text-sm font-bold text-ink-on-accent transition-all active:scale-95">
                <Plus size={20}/> {txt.addDrug}
            </button>
        </div>

        <div className="relative">
            <Search size={18} className={`absolute top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none ${isRTL ? "right-4" : "left-4"}`} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isAr ? "دوّر بالاسم أو الاستخدام — أوجمنتين، تورم، فطريات…" : "Search by name or use — Augmentin, swelling, فطريات…"}
              className={`w-full py-3.5 bg-surface-subtle rounded-xl border border-line font-semibold text-ink outline-none focus:bg-surface focus:border-accent transition-all placeholder:text-ink-muted ${isRTL ? "pr-11 pl-4" : "pl-11 pr-4"}`}
            />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {visible.map(entry => {
                const badge = badgeFor(entry);
                return (
                <div key={entry.key} className="flex justify-between items-start gap-3 p-5 bg-surface-subtle rounded-3xl border border-line shadow-sm hover:border-line-strong hover:bg-surface transition-all group">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-ink text-base">{entry.name}</p>
                          {badge.label && (
                            <span className={`px-2 py-0.5 rounded-md border text-[9px] font-black uppercase tracking-wider ${badge.cls}`}>
                              {badge.label}
                            </span>
                          )}
                        </div>
                        {entry.dose && <p dir="ltr" className="text-sm font-medium text-ink-muted mt-1">{entry.dose}</p>}
                        {entry.doseAr && <p dir="rtl" className="text-sm font-medium text-ink-muted">{entry.doseAr}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        {entry.origin === "customized" && entry.docId && entry.catalogId && (
                          <button
                            onClick={() => restoreBuiltIn(entry.docId!, entry.catalogId!)}
                            title={isAr ? "رجّعه زي ما كان" : "Reset to the built-in version"}
                            className="text-ink-muted hover:bg-accent-tint hover:text-accent bg-surface rounded-xl transition-colors p-2.5"
                          >
                            <RotateCcw size={16}/>
                          </button>
                        )}
                        <button
                          onClick={() => openEditModal(entry)}
                          title={isAr ? "تعديل" : "Edit"}
                          className="text-ink-muted hover:bg-accent-tint hover:text-accent bg-surface rounded-xl transition-colors p-2.5"
                        >
                          <Pencil size={16}/>
                        </button>
                        <button
                          onClick={() => removeDrug(entry)}
                          title={isAr ? "شيله من القائمة" : "Remove from the list"}
                          className="text-ink-muted hover:bg-danger-tint hover:text-danger bg-surface rounded-xl transition-colors p-2.5"
                        >
                          <Trash2 size={16}/>
                        </button>
                    </div>
                </div>
                );
            })}
            {visible.length === 0 && (
              <div className="col-span-full py-16 bg-surface-subtle rounded-3xl text-center">
                <p className="text-ink-muted font-bold text-base">
                  {search ? (isAr ? "مفيش دوا مطابق." : "Nothing matches that.") : txt.noDrugs}
                </p>
              </div>
            )}
        </div>

        {removed.length > 0 && (
          <div className="pt-2">
            <button
              onClick={() => setShowRemoved((v) => !v)}
              className="text-sm font-bold text-ink-muted hover:text-ink transition-colors"
            >
              {isAr ? `الأدوية اللي شيلتها (${removed.length})` : `Removed from your list (${removed.length})`}
            </button>
            {showRemoved && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mt-3">
                {removed.map(({ doc: d, drug }) => (
                  <div key={d.id} className="flex justify-between items-center gap-3 px-5 py-4 bg-surface-subtle/60 rounded-2xl border border-dashed border-line">
                    <p className="font-bold text-ink-muted text-sm truncate">{drug!.name}</p>
                    <button
                      onClick={() => restoreBuiltIn(d.id, d.catalogId!)}
                      className="flex items-center gap-1.5 text-xs font-bold text-accent hover:bg-accent-tint rounded-lg px-2.5 py-1.5 transition-colors shrink-0"
                    >
                      <RotateCcw size={14}/> {isAr ? "رجّعه" : "Put back"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {isDrugModalOpen && (
          <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
              <div className="bg-white rounded-[2rem] p-8 w-full max-w-md shadow-2xl animate-in zoom-in-95 border border-line">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-ink tracking-tight">
                      {editing ? (isAr ? "تعديل الدواء" : "Edit medicine") : txt.addDrug}
                    </h2>
                    <button onClick={() => setIsDrugModalOpen(false)} className="text-ink-muted bg-surface-subtle hover:bg-danger-tint hover:text-danger p-2 rounded-full transition-colors"><X size={20}/></button>
                </div>

                <form onSubmit={handleSaveDrug} className="space-y-4">
                    <div className="relative">
                        <Pill size={18} className={`absolute top-1/2 -translate-y-1/2 text-ink-muted ${isRTL ? 'right-4' : 'left-4'}`}/>
                        <input autoFocus required value={newDrugName} onChange={e => setNewDrugName(e.target.value)} placeholder={isAr ? "اسم الدواء (مثال: Augmentin 1gm)" : "e.g. Augmentin 1gm"} className={`w-full py-3.5 bg-surface-subtle rounded-xl border border-line font-semibold text-ink outline-none focus:bg-surface focus:border-accent transition-all placeholder:text-ink-muted ${isRTL ? 'pr-11 pl-4' : 'pl-11 pr-4'}`}/>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-ink-muted uppercase tracking-widest pl-1">{isAr ? "الجرعة بالإنجليزي" : "Dose (English)"}</label>
                      <input dir="ltr" value={newDrugDose} onChange={e => setNewDrugDose(e.target.value)} placeholder="1 tablet every 12 hours after food" className="w-full px-4 py-3.5 bg-surface-subtle rounded-xl border border-line font-semibold text-ink outline-none focus:bg-white focus:border-accent transition-all placeholder:text-ink-muted"/>
                    </div>

                    {/* Both doses print, one under the other, so both are editable here. */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-ink-muted uppercase tracking-widest pl-1">{isAr ? "الجرعة بالعربي" : "Dose (Arabic)"}</label>
                      <input dir="rtl" value={newDrugDoseAr} onChange={e => setNewDrugDoseAr(e.target.value)} placeholder="قرص كل 12 ساعة بعد الأكل" className="w-full px-4 py-3.5 bg-surface-subtle rounded-xl border border-line font-semibold text-ink outline-none focus:bg-white focus:border-accent transition-all placeholder:text-ink-muted"/>
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button type="submit" disabled={saving || !newDrugName.trim()} className="w-full bg-accent text-ink-on-accent py-3.5 rounded-xl font-bold text-sm shadow-md hover:bg-accent-strong active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"><Save size={16} /> {isAr ? "حفظ" : "Save"}</button>
                    </div>
                </form>
              </div>
          </div>
        )}
    </div>
  );
}
