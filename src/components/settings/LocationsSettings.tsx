"use client";

import { useEffect, useState } from "react";
import { getDoc, setDoc } from "firebase/firestore";
import {
  Plus,
  Trash2,
  Save,
  Building2,
  MapPin,
  Phone,
  DoorOpen,
  Loader2,
} from "lucide-react";
import { useUI } from "@/context/UIContext";
import { useLanguage } from "@/context/LanguageContext";
import { getClinicDoc } from "@/lib/db-utils";
import {
  LOCATIONS_DOC,
  makeLocationId,
  parseClinicBranches,
  type ClinicBranch,
} from "@/lib/clinicLocations";

/**
 * Branches & rooms management.
 *
 * The whole layout is saved as one document on demand (the Save button) rather than per keystroke,
 * so half-typed branch names never leak into the booking pickers other staff are using.
 */
export default function LocationsSettings() {
  const { showToast, confirm } = useUI();
  const { language } = useLanguage();
  const isAr = language === "ar";

  const [branches, setBranches] = useState<ClinicBranch[]>([]);
  const [newBranchName, setNewBranchName] = useState("");
  const [newRoomNames, setNewRoomNames] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    getDoc(getClinicDoc("settings", LOCATIONS_DOC)).then((snap) => {
      setBranches(parseClinicBranches(snap.exists() ? snap.data() : null));
      setFetched(true);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setDoc(
        getClinicDoc("settings", LOCATIONS_DOC),
        { branches, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      showToast(isAr ? "تم الحفظ!" : "Branches saved!", "success");
    } catch {
      showToast(isAr ? "فشل الحفظ" : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const addBranch = () => {
    const name = newBranchName.trim();
    if (!name) return;
    if (branches.some((b) => b.name.toLowerCase() === name.toLowerCase())) {
      showToast(isAr ? "الفرع موجود بالفعل" : "Branch already exists", "error");
      return;
    }
    setBranches([...branches, { id: makeLocationId(), name, address: "", phone: "", rooms: [] }]);
    setNewBranchName("");
  };

  const updateBranch = (id: string, patch: Partial<ClinicBranch>) => {
    setBranches((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const removeBranch = async (id: string) => {
    const b = branches.find((x) => x.id === id);
    if (!b) return;
    const ok = await confirm(
      isAr
        ? `حذف فرع "${b.name}"؟ المواعيد القديمة المسجلة عليه هتفضل موجودة.`
        : `Delete branch "${b.name}"? Existing appointments booked on it are kept.`
    );
    if (ok) setBranches((prev) => prev.filter((x) => x.id !== id));
  };

  const addRoom = (branchId: string) => {
    const name = (newRoomNames[branchId] || "").trim();
    if (!name) return;
    const branch = branches.find((b) => b.id === branchId);
    if (!branch) return;
    if (branch.rooms.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
      showToast(isAr ? "الغرفة موجودة بالفعل" : "Room already exists", "error");
      return;
    }
    updateBranch(branchId, { rooms: [...branch.rooms, { id: makeLocationId(), name }] });
    setNewRoomNames((prev) => ({ ...prev, [branchId]: "" }));
  };

  const removeRoom = (branchId: string, roomId: string) => {
    const branch = branches.find((b) => b.id === branchId);
    if (!branch) return;
    updateBranch(branchId, { rooms: branch.rooms.filter((r) => r.id !== roomId) });
  };

  if (!fetched) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-teal-50 flex items-center justify-center shrink-0">
            <Building2 size={20} className="text-teal-600" />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-900 tracking-tight">
              {isAr ? "الفروع والغرف" : "Branches & Rooms"}
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              {isAr
                ? "أضف فروع العيادة وغرف الكشف (الكراسي) في كل فرع. هتظهر عند حجز المواعيد وفي الحجز الأونلاين."
                : "Add your clinic branches and the treatment rooms (chairs) in each. They appear when booking appointments and on the online booking page."}
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-wide shadow-md hover:bg-slate-700 disabled:opacity-50 transition-all shrink-0"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {isAr ? "حفظ" : "Save"}
        </button>
      </div>

      {/* Add branch */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newBranchName}
          onChange={(e) => setNewBranchName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addBranch();
            }
          }}
          placeholder={isAr ? "اسم الفرع الجديد… (مثال: فرع مدينة نصر)" : "New branch name… (e.g. Downtown Branch)"}
          className="flex-1 px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 transition-all min-w-0"
        />
        <button
          onClick={addBranch}
          disabled={!newBranchName.trim()}
          className="px-4 py-3 bg-teal-50 text-teal-700 rounded-xl hover:bg-teal-100 disabled:opacity-50 transition-colors shrink-0"
        >
          <Plus size={20} />
        </button>
      </div>

      {branches.length === 0 && (
        <div className="p-8 text-center text-slate-400 text-sm font-medium bg-white border border-dashed border-slate-200 rounded-2xl">
          {isAr
            ? "مفيش فروع لسه. لو عندك مكان واحد بس، ممكن تسيب الصفحة دي فاضية — كل حاجة هتشتغل عادي."
            : "No branches yet. If you have a single location you can leave this empty — everything keeps working as before."}
        </div>
      )}

      {branches.map((branch) => (
        <div key={branch.id} className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Building2 size={16} className="text-teal-600 shrink-0" />
              <input
                type="text"
                value={branch.name}
                onChange={(e) => updateBranch(branch.id, { name: e.target.value })}
                className="flex-1 min-w-0 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black text-slate-800 focus:outline-none focus:border-teal-500 transition-all"
              />
              <button
                onClick={() => void removeBranch(branch.id)}
                className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors shrink-0"
                aria-label={isAr ? "حذف الفرع" : "Delete branch"}
              >
                <Trash2 size={16} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="relative">
                <MapPin size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={branch.address || ""}
                  onChange={(e) => updateBranch(branch.id, { address: e.target.value })}
                  placeholder={isAr ? "العنوان (اختياري)" : "Address (optional)"}
                  className="w-full ps-9 pe-3 py-2 bg-slate-50/60 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 placeholder:text-slate-400 focus:outline-none focus:border-teal-500 transition-all"
                />
              </div>
              <div className="relative">
                <Phone size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="tel"
                  dir="ltr"
                  value={branch.phone || ""}
                  onChange={(e) => updateBranch(branch.id, { phone: e.target.value })}
                  placeholder={isAr ? "التليفون (اختياري)" : "Phone (optional)"}
                  className="w-full ps-9 pe-3 py-2 bg-slate-50/60 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 placeholder:text-slate-400 focus:outline-none focus:border-teal-500 transition-all"
                />
              </div>
            </div>
          </div>

          {/* Rooms */}
          <div className="border-t border-slate-100 bg-slate-50/60 p-4 sm:p-5 space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
              <DoorOpen size={12} /> {isAr ? "الغرف / الكراسي" : "Rooms / Chairs"}
            </p>

            {branch.rooms.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {branch.rooms.map((room) => (
                  <span
                    key={room.id}
                    className="inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-full ps-3 pe-1.5 py-1.5 text-xs font-bold text-slate-700 shadow-sm"
                  >
                    {room.name}
                    <button
                      onClick={() => removeRoom(branch.id, room.id)}
                      className="p-1 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-full transition-colors"
                      aria-label={isAr ? "حذف الغرفة" : "Remove room"}
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                value={newRoomNames[branch.id] || ""}
                onChange={(e) =>
                  setNewRoomNames((prev) => ({ ...prev, [branch.id]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addRoom(branch.id);
                  }
                }}
                placeholder={isAr ? "اسم الغرفة… (مثال: غرفة 1)" : "Room name… (e.g. Room 1)"}
                className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-teal-500 transition-all min-w-0"
              />
              <button
                onClick={() => addRoom(branch.id)}
                disabled={!(newRoomNames[branch.id] || "").trim()}
                className="px-3 py-2 bg-white border border-slate-200 text-teal-700 rounded-xl hover:bg-teal-50 disabled:opacity-50 transition-colors shrink-0"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
        </div>
      ))}

      <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
        {isAr
          ? "ملاحظة: بعد الحفظ، هيظهر اختيار الفرع والغرفة في شاشة حجز المواعيد، وهيظهر اختيار الفرع لمرضاك في صفحة الحجز الأونلاين لو عندك أكتر من فرع."
          : "Note: after saving, branch and room pickers appear on the booking form, and patients get a branch choice on the online booking page when you have more than one branch."}
      </p>
    </div>
  );
}
