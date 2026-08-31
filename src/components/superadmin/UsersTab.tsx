"use client";

import React, { useState } from "react";
import { Users, Search, ShieldCheck } from "lucide-react";

interface UsersTabProps {
  users: any[];
  onToggleSuperAdmin: (userId: string, currentStatus: boolean, userName: string) => void;
}

export function UsersTab({ users, onToggleSuperAdmin }: UsersTabProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase();
    return (
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      u.id.includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-surface p-4 rounded-2xl border border-slate-200/60 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 text-indigo-600 flex items-center justify-center rounded-xl">
            <Users size={20} />
          </div>
          <div>
            <h3 className="font-bold text-ink">SaaS Users</h3>
            <p className="text-xs text-ink-muted">Manage all registered accounts ({users.length})</p>
          </div>
        </div>
        <div className="w-full md:w-96 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="search"
            placeholder="Search users by name, email, or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-surface-subtle border border-line rounded-xl py-2.5 pl-11 pr-4 text-sm font-bold text-slate-800 outline-none focus:border-indigo-500 transition-all"
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-surface rounded-[2rem] border border-slate-200/60 shadow-sm overflow-hidden">
        {filteredUsers.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-20 h-20 bg-surface-muted text-slate-300 rounded-3xl flex items-center justify-center mx-auto mb-4">
              <Users size={32} />
            </div>
            <h3 className="text-lg font-bold text-slate-700">No users found</h3>
            <p className="text-ink-muted text-sm mt-1">Try adjusting your search query.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-subtle border-b border-slate-100 text-xs font-black text-slate-400 uppercase tracking-widest">
                  <th className="px-6 py-4">User</th>
                  <th className="px-6 py-4">Created At</th>
                  <th className="px-6 py-4 text-center">Clinics</th>
                  <th className="px-6 py-4 text-right">Super Admin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map((user) => {
                  const clinicCount = user.clinicRoles ? Object.keys(user.clinicRoles).length : 0;
                  const isSuperAdmin = !!user.isSuperAdmin;

                  return (
                    <tr key={user.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-surface-muted flex items-center justify-center font-bold text-ink-muted shrink-0">
                            {(user.name || "U").charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-bold text-ink">{user.name || "No Name"}</p>
                            <p className="text-xs text-ink-muted">{user.email || "No Email"}</p>
                            <p className="text-xs font-mono text-slate-400 mt-0.5" title={user.id}>ID: {user.id.slice(0, 8)}...</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {user.createdAt ? (
                          <span className="text-sm text-ink-body font-medium">
                            {new Date(user.createdAt.toDate ? user.createdAt.toDate() : user.createdAt).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="text-sm text-slate-400">Unknown</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-surface-muted text-slate-700 font-bold text-sm">
                          {clinicCount}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end items-center gap-3">
                          {isSuperAdmin && (
                            <span className="flex items-center gap-1 text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md">
                              <ShieldCheck size={14} /> Admin
                            </span>
                          )}
                          <button
                            onClick={() => onToggleSuperAdmin(user.id, isSuperAdmin, user.name || user.email || "Unknown")}
                            className={`w-11 h-6 rounded-full transition-colors relative ${
                              isSuperAdmin ? 'bg-indigo-500' : 'bg-slate-200 hover:bg-slate-300'
                            }`}
                          >
                            <div className={`w-5 h-5 bg-surface rounded-full absolute top-0.5 shadow transition-transform ${
                              isSuperAdmin ? 'translate-x-5' : 'translate-x-0.5'
                            }`} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
