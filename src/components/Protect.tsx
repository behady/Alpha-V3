"use client";

import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { listHoldsPermission } from "@/config/permissionsCatalog";

interface ProtectProps {
  children: React.ReactNode;
  permission: string; // e.g., 'patients.add'
  fallback?: React.ReactNode; // Optional: Show something else if blocked
}

export default function Protect({ children, permission, fallback = null }: ProtectProps) {
  const { user } = useAuth();
  const { isAdmin } = useClinic();

  if (isAdmin) return <>{children}</>; // Admins ignore locks

  // In the user's list — or a default-on permission nobody switched off for them.
  if (listHoldsPermission(user?.permissions, permission)) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}