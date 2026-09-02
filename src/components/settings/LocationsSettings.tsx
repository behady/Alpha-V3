"use client";

import { useEffect, useMemo, useState } from "react";
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
  RotateCcw,
  Tag,
} from "lucide-react";
import { useUI } from "@/context/UIContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSettingsText } from "@/lib/useSettingsText";
import { countedNoun } from "@/lib/arabicCount";
import { getClinicDoc } from "@/lib/db-utils";
import { useSettingsDraft } from "@/lib/settingsDraft";
import {
  LOCATIONS_DOC,
  makeLocationId,
  parseClinicBranches,
  type ClinicBranch,
} from "@/lib/clinicLocations";
import { branchCodeFor, deriveBranchCode } from "@/lib/labCases";

/**
 * Branches & rooms management.
 *
 * The whole layout is saved as one document on demand rather than per keystroke, so half-typed
 * branch names never leak into the booking pickers other staff are using. That makes the Save
 * button load-bearing, which is why it now arrives in a bar the moment anything is unsaved
 * instead of sitting in the header looking the same whether or not there is work to lose.
 */
/** Module-level so the fallback keeps its identity between renders. */
const EMPTY_BRANCHES: ClinicBranch[] = [];

const INPUT =
  "border border-line bg-surface-subtle text-ink outline-none transition-all " +
  "placeholder:text-ink-muted focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10";

export default function LocationsSettings() {
  const { showToast, confirm } = useUI();
  const { language, isRTL } = useLanguage();
  const isAr = language === "ar";
  const txt = useSettingsText("locations");

  const [stored, setStored] = useState<ClinicBranch[] | null>(null);
  const [newBranchName, setNewBranchName] = useState("");
  const [newRoomNames, setNewRoomNames] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [fetched, setFetched] = useState(false);

  // Branches and rooms are built up over several edits before anyone presses Save, so this is the
  // screen where losing the lot to a stray click hurt most. See lib/settingsDraft.ts.
  const {
    value: branches,
    setValue: setBranches,
    isDirty,
    discard,
    markSaved,
  } = useSettingsDraft<ClinicBranch[]>("locations", stored, EMPTY_BRANCHES);

  useEffect(() => {
    getDoc(getClinicDoc("settings", LOCATIONS_DOC)).then((snap) => {
      setStored(parseClinicBranches(snap.exists() ? snap.data() : null));
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
      setStored(branches);
      markSaved();
      showToast(txt.saved, "success");
    } catch {
      showToast(txt.failed, "error");
    } finally {
      setSaving(false);
    }
  };

  const addBranch = () => {
    const name = newBranchName.trim();
    if (!name) return;
    if (branches.some((b) => b.name.toLowerCase() === name.toLowerCase())) {
      showToast(txt.branchExists, "error");
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
      showToast(txt.roomExists, "error");
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

  /**
   * Codes claimed by more than one branch.
   *
   * Not an error — the counter is keyed on the code, so two branches sharing one simply share a
   * sequence and no number is ever printed twice. It is worth saying out loud all the same,
   * because the whole point of a per-branch prefix is that the code tells you where a case came
   * from, and a shared prefix quietly gives that up.
   */
  const duplicateCodes = useMemo(() => {
    const seen = new Map<string, number>();
    branches.forEach((b, i) => {
      const code = branchCodeFor(b, i);
      seen.set(code, (seen.get(code) || 0) + 1);
    });
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([code]) => code));
  }, [branches]);

  const roomCount = branches.reduce((sum, b) => sum + b.rooms.length, 0);

  if (!fetched) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-ink-muted" />
      </div>
    );
  }

  const counts = [
    countedNoun(branches.length, isAr, {
      one: txt.branchOne, two: txt.branchTwo, few: txt.branchFew, many: txt.branchMany,
    }),
    countedNoun(roomCount, isAr, {
      one: txt.roomOne, two: txt.roomTwo, few: txt.roomFew, many: txt.roomMany,
    }),
  ].join(" · ");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 pb-4" dir={isRTL ? "rtl" : "ltr"}>
      {/* What a branch is for, said once at the top. The two notes this replaces sat at the very
          bottom of the page and inside the empty state, where a clinic that already had branches
          never saw either. */}
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="flex items-center gap-2 font-display text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
              <Building2 size={12} />
              {txt.title}
            </p>
            <p className="max-w-xl font-display text-[15px] font-bold leading-relaxed text-white sm:text-base">
              {txt.railNote}
            </p>
            <p className="font-figure text-[13px] tracking-tight text-white/70">{counts}</p>
          </div>

          {duplicateCodes.size > 0 && (
            <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-amber-400/20 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-amber-200">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              {txt.sharedCode}
            </span>
          )}
        </div>
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
          placeholder={txt.newBranch}
          className={`min-w-0 flex-1 rounded-xl px-4 py-3 text-sm font-bold ${INPUT}`}
        />
        <button
          type="button"
          onClick={addBranch}
          disabled={!newBranchName.trim()}
          aria-label={txt.addBranch}
          className="shrink-0 rounded-xl bg-accent px-4 py-3 text-ink-on-accent transition-colors hover:bg-accent-strong disabled:opacity-50"
        >
          <Plus size={20} />
        </button>
      </div>

      {branches.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-surface-subtle p-8 text-center text-sm font-medium text-ink-muted">
          {txt.empty}
        </div>
      )}

      {branches.map((branch) => {
        const index = branches.indexOf(branch);
        const code = branchCodeFor(branch, index);
        return (
          <div key={branch.id} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
            <div className="space-y-3 p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <Building2 size={16} className="shrink-0 text-ink-muted" />
                <input
                  type="text"
                  value={branch.name}
                  onChange={(e) => updateBranch(branch.id, { name: e.target.value })}
                  className={`min-w-0 flex-1 rounded-xl px-3 py-2 text-sm font-black ${INPUT}`}
                />
                <button
                  type="button"
                  onClick={() => void removeBranch(branch.id)}
                  className="shrink-0 rounded-lg p-2 text-ink-muted transition-colors hover:bg-danger-tint hover:text-danger"
                  aria-label={txt.deleteBranch}
                >
                  <Trash2 size={16} />
                </button>
              </div>

              {/* Lab case prefix.
                  Its own row rather than a third cell in the grid below, because it is the only
                  field here that gets printed on paper and written on a bag with a marker — and
                  because the preview beside it is the point: an admin should see MAD-0142 before
                  they commit to MAD. */}
              <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-subtle px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                <div className="flex shrink-0 items-center gap-2">
                  <Tag size={14} className="text-ink-muted" />
                  <span className="text-[11px] font-black uppercase tracking-wider text-ink-muted">
                    {txt.labCode}
                  </span>
                </div>
                <input
                  type="text"
                  dir="ltr"
                  maxLength={4}
                  value={branch.code || ""}
                  onChange={(e) =>
                    updateBranch(branch.id, {
                      code: e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4),
                    })
                  }
                  placeholder={deriveBranchCode(branch.name, index)}
                  className={`w-24 rounded-lg bg-surface px-3 py-1.5 text-center text-sm font-black uppercase tracking-widest ${INPUT}`}
                />
                <p className="min-w-0 text-[11px] font-semibold leading-relaxed text-ink-muted">
                  {txt.labCodeHint}{" "}
                  <span className="font-figure font-black text-ink-body" dir="ltr">
                    {code}-0001
                  </span>
                  {!branch.code && ` ${txt.labCodeDerived}`}
                </p>
              </div>

              {duplicateCodes.has(code) && (
                <p className="rounded-xl border border-warn/25 bg-warn-tint px-3 py-2 text-[11px] font-semibold leading-relaxed text-warn">
                  {txt.sharedCodeHint}
                </p>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="relative">
                  <MapPin size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                  <input
                    type="text"
                    value={branch.address || ""}
                    onChange={(e) => updateBranch(branch.id, { address: e.target.value })}
                    placeholder={txt.address}
                    className={`w-full rounded-xl py-2 pe-3 ps-9 text-xs font-bold ${INPUT}`}
                  />
                </div>
                <div className="relative">
                  <Phone size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                  <input
                    type="tel"
                    dir="ltr"
                    value={branch.phone || ""}
                    onChange={(e) => updateBranch(branch.id, { phone: e.target.value })}
                    placeholder={txt.phone}
                    className={`w-full rounded-xl py-2 pe-3 ps-9 text-xs font-bold ${INPUT}`}
                  />
                </div>
              </div>
            </div>

            {/* Rooms */}
            <div className="space-y-3 border-t border-line bg-surface-subtle p-4 sm:p-5">
              <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-ink-muted">
                <DoorOpen size={12} /> {txt.rooms}
              </p>

              {branch.rooms.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {branch.rooms.map((room) => (
                    <span
                      key={room.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-1.5 pe-1.5 ps-3 text-xs font-bold text-ink-body shadow-sm"
                    >
                      {room.name}
                      <button
                        type="button"
                        onClick={() => removeRoom(branch.id, room.id)}
                        className="rounded-full p-1 text-ink-muted transition-colors hover:bg-danger-tint hover:text-danger"
                        aria-label={txt.deleteRoom}
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
                  onChange={(e) => setNewRoomNames((prev) => ({ ...prev, [branch.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addRoom(branch.id);
                    }
                  }}
                  placeholder={txt.newRoom}
                  className={`min-w-0 flex-1 rounded-xl bg-surface px-3 py-2 text-xs font-bold ${INPUT}`}
                />
                <button
                  type="button"
                  onClick={() => addRoom(branch.id)}
                  disabled={!(newRoomNames[branch.id] || "").trim()}
                  aria-label={txt.addRoom}
                  className="shrink-0 rounded-xl border border-line bg-surface px-3 py-2 text-accent transition-colors hover:bg-accent-tint disabled:opacity-50"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {/* Nothing here is written until this is pressed, so it says whether there is anything to
          write. The old button sat in the header looking identical either way. */}
      {isDirty && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-ink-slab px-4 py-3 shadow-2xl">
          <span className="text-xs font-bold text-white/70">{txt.unsaved}</span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={discard}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white/60 transition hover:text-white disabled:opacity-50"
            >
              <RotateCcw size={14} /> {txt.discard}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-ink-on-accent transition hover:bg-accent-strong disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {txt.save}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
