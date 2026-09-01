"use client";

import { useMemo, useState } from "react";
import { useSettingsText } from "@/lib/useSettingsText";
import { X, Search, ChevronDown, ChevronRight, Info, Shield, Crown, RotateCcw, ArrowRightLeft } from "lucide-react";
import { PERMISSIONS_CATALOG, type PermissionCatalogGroup } from "@/config/permissionsCatalog";
import { ASSIGNABLE_ROLES, isFullAccessRole, isOwnerRole, presetDiff, rolePreset } from "@/lib/permissions";

type UserRow = {
  id: string;
  uid?: string;
  name?: string;
  email?: string;
  role?: string;
  isDentist?: boolean;
  staffId?: string;
  permissions?: string[];
};

type Props = {
  user: UserRow | null;
  isOpen: boolean;
  onClose: () => void;
  language: "en" | "ar";
  isRTL: boolean;
  updatingUserId: string | null;
  /** True when the person LOOKING at this screen owns the clinic. */
  viewerIsOwner: boolean;
  handleRoleChange: (userId: string, newRole: string, targetUser: UserRow) => void;
  handleToggleAlsoDentist: (userId: string, targetUser: UserRow, next: boolean) => void;
  togglePermission: (userId: string, currentPerms: string[], key: string, targetUser: UserRow) => void;
  togglePermissionGroup: (userId: string, currentPerms: string[], keys: string[], targetUser: UserRow, setAll: boolean) => void;
  applyRolePreset: (userId: string, targetUser: UserRow) => void;
  transferOwnership: (targetUser: UserRow) => void;
};

export default function UserAccessModal({
  user,
  isOpen,
  onClose,
  language,
  isRTL,
  updatingUserId,
  viewerIsOwner,
  handleRoleChange,
  handleToggleAlsoDentist,
  togglePermission,
  togglePermissionGroup,
  applyRolePreset,
  transferOwnership,
}: Props) {
  const isAr = language === "ar";
  const [permissionSearch, setPermissionSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const filteredCatalog = useMemo(() => {
    const q = permissionSearch.trim().toLowerCase();
    if (!q) return PERMISSIONS_CATALOG;
    return PERMISSIONS_CATALOG.map((g) => ({
      ...g,
      items: g.items.filter((it) => {
        const en = `${it.labelEn} ${it.id} ${it.hintEn || ""}`.toLowerCase();
        const ar = `${it.labelAr} ${it.id} ${it.hintAr || ""}`;
        return en.includes(q) || ar.includes(permissionSearch.trim());
      }),
    })).filter((g) => g.items.length > 0);
  }, [permissionSearch]);

  /**
   * What this role starts with, and how far this person has moved from it.
   *
   * The switches themselves have always been the admin's to set — `sanitizePermissionList` stores
   * an edit verbatim, so unticking one sticks. What was missing is any way to SEE the starting
   * point: a hand-tuned receptionist looked identical to a fresh one, and the only way to learn
   * what a role means was to invite a test user and read thirteen toggles.
   */
  const presetKeys = useMemo(() => new Set(rolePreset(user?.role)), [user?.role]);
  const diff = useMemo(() => presetDiff(user?.role, user?.permissions), [user?.role, user?.permissions]);

  /**
   * Above the guard clause below, and not inside the `txt` object where it reads more
   * naturally. This drawer stays mounted and returns null while closed, so a hook called
   * after that return runs on the open renders only — React counts hooks per render and
   * throws on the one that opens it.
   */
  const sectionText = useSettingsText("userAccess");

  const toggleGroupCollapsed = (groupId: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const groupTitle = (g: PermissionCatalogGroup) => (isAr ? g.titleAr : g.titleEn);
  const groupDescription = (g: PermissionCatalogGroup) => (isAr ? g.descriptionAr : g.descriptionEn);
  const itemLabel = (it: PermissionCatalogGroup["items"][0]) => (isAr ? it.labelAr : it.labelEn);

  if (!isOpen || !user) return null;

  const perms = user.permissions || [];

  /**
   * Owner and Admin never consult the switch list, so drawing theirs as adjustable would be a
   * lie — every box is already answered "yes" by the role itself. They render on and locked.
   */
  const targetIsOwner = isOwnerRole(user.role);
  const bypassesEverything = isFullAccessRole(user.role);
  const canTransferToThisPerson = viewerIsOwner && !targetIsOwner;
  const isUpdating = updatingUserId === user.id;

  const roleName = user.role || "Assistant";
  const presetSize = presetKeys.size;


  const txt = {

    ...sectionText,

    presetLabel: isAr ? `الإعداد الجاهز لدور ${roleName}` : `${roleName} preset`,

    presetSwitches: isAr ? `${presetSize} صلاحية` : `${presetSize} switches`,

    presetAdded: (n: number) => (isAr ? `${n} مضافة` : `${n} added`),

    presetRemoved: (n: number) => (isAr ? `${n} مُزالة` : `${n} removed`),

  };

  return (
    <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-[110] flex items-center justify-end p-0 sm:p-4 transition-all duration-300">
      <div 
        className="bg-surface w-full h-full sm:h-auto sm:max-h-[90vh] sm:w-[600px] sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right-8 sm:slide-in-from-bottom-8 duration-300"
        dir={isRTL ? "rtl" : "ltr"}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-5 border-b border-line bg-surface z-10 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${targetIsOwner ? "bg-accent-tint text-accent" : "bg-surface-muted text-ink-body"}`}>
              {targetIsOwner ? <Crown size={20} /> : <Shield size={20} />}
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-ink truncate tracking-tight">{txt.title}</h2>
              <p className="text-xs font-semibold text-ink-muted truncate">{user.name}</p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className="text-ink-muted bg-surface-subtle hover:bg-danger-tint hover:text-danger p-2.5 rounded-full transition-colors shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-surface-subtle/50 space-y-8 custom-scrollbar">
          
          {/* Role Section */}
          <div className="space-y-4">
            <label className="text-xs font-black text-ink-muted uppercase tracking-widest block px-1">
              {txt.systemRole}
            </label>
            <div className="bg-surface rounded-[1.5rem] p-4 sm:p-5 border border-line shadow-sm space-y-4">
              {targetIsOwner ? (
                <div className="flex items-start gap-3 py-2 px-4 rounded-xl bg-accent-tint/60 border border-accent/20">
                  <Crown size={18} className="shrink-0 mt-0.5 text-accent" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-ink">{txt.ownerLocked}</p>
                    <p className="text-[11px] font-semibold text-ink-body mt-0.5 leading-relaxed">{txt.ownerLockedHint}</p>
                  </div>
                </div>
              ) : (
                <select
                  value={user.role || "Assistant"}
                  disabled={isUpdating}
                  onChange={(e) => handleRoleChange(user.id, e.target.value, user)}
                  className="w-full py-3 px-4 rounded-xl border border-line text-sm font-bold text-ink bg-surface-subtle outline-none focus:ring-2 focus:ring-accent-soft/20 focus:border-accent-soft transition-all cursor-pointer"
                >
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              )}

              {bypassesEverything && (
                <label className="flex items-center gap-3 cursor-pointer group p-3 rounded-xl hover:bg-surface-subtle transition-colors border border-transparent hover:border-line">
                  <div className={`relative w-11 h-6 rounded-full transition-colors duration-300 flex items-center ${user.isDentist ? 'bg-accent-soft' : 'bg-surface-muted'} shrink-0`}>
                    <div className={`w-5 h-5 bg-surface rounded-full shadow-sm transform transition-transform duration-300 mx-0.5 ${user.isDentist ? (isRTL ? '-translate-x-5' : 'translate-x-5') : 'translate-x-0'}`}></div>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={user.isDentist === true}
                      disabled={isUpdating}
                      onChange={(e) => handleToggleAlsoDentist(user.id, user, e.target.checked)}
                    />
                  </div>
                  <span className="text-sm font-bold text-ink-body group-hover:text-ink transition-colors">
                    {txt.alsoDentist}
                  </span>
                </label>
              )}
            </div>
            
            {bypassesEverything && (
              <div className={`flex gap-3 items-start border p-4 rounded-[1.25rem] text-xs font-bold leading-relaxed ${
                targetIsOwner
                  ? "border-info/20 bg-info-tint text-info"
                  : "border-info/20 bg-info-tint text-info"
              }`}>
                <Info size={16} className="shrink-0 mt-0.5" />
                <p>{targetIsOwner ? txt.ownerBypass : txt.adminBypass}</p>
              </div>
            )}

            {canTransferToThisPerson && (
              <button
                type="button"
                disabled={isUpdating}
                onClick={() => transferOwnership(user)}
                className="w-full flex items-center gap-3 p-4 rounded-[1.25rem] border border-warn/30 bg-surface hover:bg-warn-tint transition-colors text-start disabled:opacity-50"
              >
                <div className="w-9 h-9 rounded-xl bg-warn-tint text-warn flex items-center justify-center shrink-0">
                  <ArrowRightLeft size={16} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink">{txt.transfer}</p>
                  <p className="text-[11px] font-semibold text-ink-muted mt-0.5">{txt.transferHint}</p>
                </div>
              </button>
            )}
          </div>

          {/* Permissions Section */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
              <label className="text-xs font-black text-ink-muted uppercase tracking-widest">
                Modular Access
              </label>
            </div>

            {/*
              The preset bar: what this role starts with, how far this person has drifted, and the
              one button that puts them back. Hidden for Owner and Admin, whose switches are
              decoration.
            */}
            {!bypassesEverything && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface rounded-[1.25rem] border border-line shadow-sm p-4">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink truncate">
                    {txt.presetLabel} · {txt.presetSwitches}
                  </p>
                  <p className="text-[11px] font-semibold mt-0.5 truncate">
                    {!diff.hasRecord ? (
                      <span className="text-ink-muted">{txt.presetUnset}</span>
                    ) : diff.matchesPreset ? (
                      <span className="text-ok">{txt.presetMatches}</span>
                    ) : (
                      <span className="text-warn">
                        {[
                          diff.added.length ? txt.presetAdded(diff.added.length) : null,
                          diff.removed.length ? txt.presetRemoved(diff.removed.length) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  title={txt.applyPresetHint}
                  disabled={isUpdating || diff.matchesPreset}
                  onClick={() => applyRolePreset(user.id, user)}
                  className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-wider border border-line bg-surface-subtle text-ink-body hover:bg-surface-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RotateCcw size={14} />
                  {txt.applyPreset}
                </button>
              </div>
            )}

            <div className="relative mb-4">
              <Search size={18} className={`absolute top-1/2 -translate-y-1/2 text-ink-muted ${isRTL ? "right-4" : "left-4"}`} />
              <input
                type="search"
                value={permissionSearch}
                onChange={(e) => setPermissionSearch(e.target.value)}
                placeholder={txt.searchPlaceholder}
                className={`w-full py-3.5 rounded-[1.25rem] border border-line text-sm font-bold text-ink outline-none focus:ring-2 focus:ring-accent-soft/20 focus:border-accent-soft bg-surface shadow-sm transition-all ${
                  isRTL ? "pr-12 pl-4" : "pl-12 pr-4"
                }`}
              />
            </div>

            <div className="space-y-4 pb-12">
              {filteredCatalog.map((group) => {
                const collapsed = collapsedGroups[group.id];
                const groupItems = group.items;
                const groupKeys = groupItems.map(it => it.id);
                const isAllSelected = groupKeys.every(k => perms.includes(k));

                return (
                  <div key={group.id} className="bg-surface rounded-[1.5rem] border border-line shadow-sm overflow-hidden transition-all duration-300">
                    <div 
                      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5 cursor-pointer hover:bg-surface-subtle transition-colors ${!collapsed ? 'border-b border-line' : ''}`}
                      onClick={(e) => {
                        // Prevent toggling accordion if clicking a button inside it
                        if ((e.target as HTMLElement).closest('button')) return;
                        toggleGroupCollapsed(group.id);
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${!collapsed ? 'bg-accent-tint text-accent-soft' : 'bg-surface-muted text-ink-muted'}`}>
                          {collapsed ? (isRTL ? <ChevronRight size={16}/> : <ChevronDown size={16}/>) : <ChevronDown size={16}/>}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-ink truncate tracking-tight">{groupTitle(group)}</p>
                          {groupDescription(group) && (
                            <p className="text-[11px] font-semibold text-ink-muted mt-0.5 truncate">{groupDescription(group)}</p>
                          )}
                        </div>
                      </div>
                      
                      {!collapsed && !bypassesEverything && (
                        <button
                          type="button"
                          disabled={isUpdating}
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePermissionGroup(user.id, perms, groupKeys, user, !isAllSelected);
                          }}
                          className={`shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${
                            isAllSelected 
                              ? 'border-line bg-surface-muted text-ink-body hover:bg-surface-subtle'
                              : 'border-accent/20 bg-accent-tint text-accent hover:bg-accent-tint/70'
                          }`}
                        >
                          {isAllSelected ? txt.deselectAll : txt.selectAll}
                        </button>
                      )}
                    </div>

                    {!collapsed && (
                      <div className="p-2 sm:p-3 divide-y divide-line">
                        {group.items.map((pk) => {
                          const isSet = bypassesEverything || perms.includes(pk.id);
                          const inPreset = presetKeys.has(pk.id);
                          const hint = isAr ? pk.hintAr : pk.hintEn;
                          return (
                            <label
                              key={pk.id}
                              title={hint || undefined}
                              className={`flex items-center justify-between p-3 rounded-xl transition-colors border border-transparent ${
                                bypassesEverything
                                  ? 'bg-surface-subtle cursor-default'
                                  : isSet
                                    ? 'bg-accent-tint/40 cursor-pointer'
                                    : 'hover:bg-surface-subtle cursor-pointer'
                              }`}
                            >
                              <div className="flex items-center gap-4 min-w-0 pr-4">
                                <div className={`relative w-11 h-6 rounded-full transition-colors duration-300 flex items-center shrink-0 ${
                                  bypassesEverything ? 'bg-line-strong' : isSet ? 'bg-accent-soft' : 'bg-surface-muted'
                                }`}>
                                  <div className={`w-5 h-5 bg-surface rounded-full shadow-sm transform transition-transform duration-300 mx-0.5 ${isSet ? (isRTL ? '-translate-x-5' : 'translate-x-5') : 'translate-x-0'}`}></div>
                                  <input
                                    type="checkbox"
                                    className="sr-only"
                                    checked={isSet}
                                    disabled={isUpdating || bypassesEverything}
                                    onChange={() => {
                                      if (bypassesEverything) return;
                                      togglePermission(user.id, perms, pk.id, user);
                                    }}
                                  />
                                </div>
                                <div className="min-w-0 py-1">
                                  <p className={`text-sm font-bold truncate transition-colors ${isSet ? 'text-ink' : 'text-ink-body'}`}>{itemLabel(pk)}</p>
                                  <p className="text-[10px] font-semibold text-ink-muted font-mono mt-0.5 truncate">{pk.id}</p>
                                </div>
                              </div>
                              {bypassesEverything ? (
                                <span className="shrink-0 px-2 py-1 rounded-md bg-surface-muted text-ink-body text-[10px] font-black uppercase tracking-wider">
                                  {txt.always}
                                </span>
                              ) : inPreset ? (
                                <span className="shrink-0 px-2 py-1 rounded-md bg-surface-muted text-ink-muted text-[10px] font-black uppercase tracking-wider">
                                  {roleName}
                                </span>
                              ) : null}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
