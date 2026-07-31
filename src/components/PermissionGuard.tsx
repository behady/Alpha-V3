"use client";

import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { Lock, ShieldAlert } from "lucide-react";

interface PermissionGuardProps {
  children: React.ReactNode;
  permission: string; // e.g., 'access.finance'
  allowedRoles?: string[]; // e.g., ['Dentist']
}

export default function PermissionGuard({ children, permission, allowedRoles }: PermissionGuardProps) {
  const { user, loading } = useAuth();
  const { isAdmin } = useClinic();

  // 1. Wait for auth to load
  if (loading) return null; // Or return a <Loader />

  // 2. Admins get access to EVERYTHING automatically
  if (isAdmin) return <>{children}</>;

  // 3. Check if user has the specific permission key or an allowed role
  const hasAccess = user?.permissions?.includes(permission) || (allowedRoles && user?.role && allowedRoles.includes(user.role));

  if (hasAccess) {
    return <>{children}</>;
  }

  // 4. If no access, show the "Access Denied" screen
  return (
    <div className="flex flex-col items-center justify-center h-[70vh] text-center p-6 animate-in fade-in zoom-in-95">
      <div className="w-24 h-24 bg-red-50 text-red-500 rounded-[2rem] flex items-center justify-center mb-6 shadow-sm">
        <Lock size={40} />
      </div>
      
      <h1 className="text-3xl font-black text-gray-900 mb-2 tracking-tight">Access Restricted</h1>
      
      <p className="text-gray-400 font-bold max-w-md mx-auto mb-8">
        You do not have the required permissions to view the 
        <span className="text-gray-900 mx-1 uppercase">{permission.split('.')[1]}</span> 
        module.
      </p>

      <div className="flex items-center gap-3 px-5 py-4 bg-gray-50 rounded-2xl border border-gray-100 text-gray-400">
        <ShieldAlert size={18} />
        <span className="text-xs font-black uppercase tracking-wide">Please contact admin for permissions</span>
      </div>
    </div>
  );
}