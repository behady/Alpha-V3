"use client";

import { useMemo, useState } from "react";
import { X, Search, ChevronDown, ChevronRight, Info, Shield, Check } from "lucide-react";
import { PERMISSIONS_CATALOG, getAllPermissionIds, type PermissionCatalogGroup } from "@/config/permissionsCatalog";

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
  handleRoleChange: (userId: string, newRole: string, targetUser: UserRow) => void;
  handleToggleAlsoDentist: (userId: string, targetUser: UserRow, next: boolean) => void;
  togglePermission: (userId: string, currentPerms: string[], key: string, targetUser: UserRow) => void;
  togglePermissionGroup: (userId: string, currentPerms: string[], keys: string[], targetUser: UserRow, setAll: boolean) => void;
};

export default function UserAccessModal({
  user,
  isOpen,
  onClose,
  language,
  isRTL,
  updatingUserId,
  handleRoleChange,
  handleToggleAlsoDentist,
  togglePermission,
  togglePermissionGroup
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

  const ROLES = ["Admin", "Dentist", "Assistant", "Receptionist"] as const;

  const toggleGroupCollapsed = (groupId: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const groupTitle = (g: PermissionCatalogGroup) => (isAr ? g.titleAr : g.titleEn);
  const groupDescription = (g: PermissionCatalogGroup) => (isAr ? g.descriptionAr : g.descriptionEn);
  const itemLabel = (it: PermissionCatalogGroup["items"][0]) => (isAr ? it.labelAr : it.labelEn);

  if (!isOpen || !user) return null;

  const perms = user.permissions || [];
  const isUpdating = updatingUserId === user.id;

  const txt = {
    title: isAr ? "إدارة الصلاحيات" : "Manage Access",
    systemRole: isAr ? "دور النظام الأساسي" : "Primary System Role",
    alsoDentist: isAr ? "يعمل أيضاً كطبيب (يظهر في المواعيد)" : "Also acts as Dentist (Shows in appointments)",
    adminBypass: isAr ? "دور المدير (Admin) يتجاوز جميع هذه الصلاحيات تلقائياً." : "The Admin role automatically bypasses all permissions below.",
    searchPlaceholder: isAr ? "بحث في الصلاحيات..." : "Search permissions...",
    selectAll: isAr ? "تحديد الكل" : "Select All",
    deselectAll: isAr ? "إلغاء الكل" : "Deselect All",
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[110] flex items-center justify-end p-0 sm:p-4 transition-all duration-300">
      <div 
        className="bg-white w-full h-full sm:h-auto sm:max-h-[90vh] sm:w-[600px] sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right-8 sm:slide-in-from-bottom-8 duration-300"
        dir={isRTL ? "rtl" : "ltr"}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-5 border-b border-slate-100 bg-white z-10 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-emerald-50 text-[#60d297] rounded-xl flex items-center justify-center shrink-0">
              <Shield size={20} />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-900 truncate tracking-tight">{txt.title}</h2>
              <p className="text-xs font-semibold text-slate-500 truncate">{user.name}</p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className="text-slate-400 hover:text-red-500 bg-slate-50 hover:bg-red-50 p-2.5 rounded-full transition-colors shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 space-y-8 custom-scrollbar">
          
          {/* Role Section */}
          <div className="space-y-4">
            <label className="text-xs font-black text-slate-400 uppercase tracking-widest block px-1">
              {txt.systemRole}
            </label>
            <div className="bg-white rounded-[1.5rem] p-4 sm:p-5 border border-slate-200/60 shadow-sm space-y-4">
              <select
                value={user.role || "Assistant"}
                disabled={isUpdating}
                onChange={(e) => handleRoleChange(user.id, e.target.value, user)}
                className="w-full py-3 px-4 rounded-xl border border-slate-200 text-sm font-bold text-slate-800 bg-slate-50 outline-none focus:ring-2 focus:ring-[#60d297]/20 focus:border-[#60d297] transition-all cursor-pointer"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>

              {user.role === "Admin" && (
                <label className="flex items-center gap-3 cursor-pointer group p-3 rounded-xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100">
                  <div className={`relative w-11 h-6 rounded-full transition-colors duration-300 flex items-center ${user.isDentist ? 'bg-[#60d297]' : 'bg-slate-200'} shrink-0`}>
                    <div className={`w-5 h-5 bg-white rounded-full shadow-sm transform transition-transform duration-300 mx-0.5 ${user.isDentist ? (isRTL ? '-translate-x-5' : 'translate-x-5') : 'translate-x-0'}`}></div>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={user.isDentist === true}
                      disabled={isUpdating}
                      onChange={(e) => handleToggleAlsoDentist(user.id, user, e.target.checked)}
                    />
                  </div>
                  <span className="text-sm font-bold text-slate-700 group-hover:text-slate-900 transition-colors">
                    {txt.alsoDentist}
                  </span>
                </label>
              )}
            </div>
            
            {user.role === "Admin" && (
              <div className="flex gap-3 items-start bg-blue-50/50 border border-blue-100 text-blue-600 p-4 rounded-[1.25rem] text-xs font-bold leading-relaxed">
                <Info size={16} className="shrink-0 mt-0.5" />
                <p>{txt.adminBypass}</p>
              </div>
            )}
          </div>

          {/* Permissions Section */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                Modular Access
              </label>
            </div>

            <div className="relative mb-4">
              <Search size={18} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? "right-4" : "left-4"}`} />
              <input
                type="search"
                value={permissionSearch}
                onChange={(e) => setPermissionSearch(e.target.value)}
                placeholder={txt.searchPlaceholder}
                className={`w-full py-3.5 rounded-[1.25rem] border border-slate-200/60 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#60d297]/20 focus:border-[#60d297] bg-white shadow-sm transition-all ${
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
                  <div key={group.id} className="bg-white rounded-[1.5rem] border border-slate-200/60 shadow-sm overflow-hidden transition-all duration-300">
                    <div 
                      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5 cursor-pointer hover:bg-slate-50 transition-colors ${!collapsed ? 'border-b border-slate-100' : ''}`}
                      onClick={(e) => {
                        // Prevent toggling accordion if clicking a button inside it
                        if ((e.target as HTMLElement).closest('button')) return;
                        toggleGroupCollapsed(group.id);
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${!collapsed ? 'bg-[#E8F7F0] text-[#60d297]' : 'bg-slate-100 text-slate-400'}`}>
                          {collapsed ? (isRTL ? <ChevronRight size={16}/> : <ChevronDown size={16}/>) : <ChevronDown size={16}/>}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 truncate tracking-tight">{groupTitle(group)}</p>
                          {groupDescription(group) && (
                            <p className="text-[11px] font-semibold text-slate-500 mt-0.5 truncate">{groupDescription(group)}</p>
                          )}
                        </div>
                      </div>
                      
                      {!collapsed && (
                        <button
                          type="button"
                          disabled={isUpdating}
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePermissionGroup(user.id, perms, groupKeys, user, !isAllSelected);
                          }}
                          className={`shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${
                            isAllSelected 
                              ? 'bg-red-50 text-red-600 border-red-100 hover:bg-red-100' 
                              : 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-100'
                          }`}
                        >
                          {isAllSelected ? txt.deselectAll : txt.selectAll}
                        </button>
                      )}
                    </div>

                    {!collapsed && (
                      <div className="p-2 sm:p-3 divide-y divide-slate-50">
                        {group.items.map((pk) => {
                          const isSet = perms.includes(pk.id);
                          return (
                            <label 
                              key={pk.id} 
                              className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition-colors border border-transparent ${isSet ? 'bg-[#E8F7F0]/40' : 'hover:bg-slate-50'}`}
                            >
                              <div className="flex items-center gap-4 min-w-0 pr-4">
                                <div className={`relative w-11 h-6 rounded-full transition-colors duration-300 flex items-center shrink-0 ${isSet ? 'bg-[#60d297]' : 'bg-slate-200'}`}>
                                  <div className={`w-5 h-5 bg-white rounded-full shadow-sm transform transition-transform duration-300 mx-0.5 ${isSet ? (isRTL ? '-translate-x-5' : 'translate-x-5') : 'translate-x-0'}`}></div>
                                  <input
                                    type="checkbox"
                                    className="sr-only"
                                    checked={isSet}
                                    disabled={isUpdating}
                                    onChange={() => togglePermission(user.id, perms, pk.id, user)}
                                  />
                                </div>
                                <div className="min-w-0 py-1">
                                  <p className={`text-sm font-bold truncate transition-colors ${isSet ? 'text-slate-900' : 'text-slate-600'}`}>{itemLabel(pk)}</p>
                                  <p className="text-[10px] font-semibold text-slate-400 font-mono mt-0.5 truncate">{pk.id}</p>
                                </div>
                              </div>
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

// Fallback for RTL
const ChevronLeft = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
