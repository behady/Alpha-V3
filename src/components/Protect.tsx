"use client";

import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";

interface ProtectProps {
  children: React.ReactNode;
  permission: string; // e.g., 'patients.add'
  fallback?: React.ReactNode; // Optional: Show something else if blocked
}

export default function Protect({ children, permission, fallback = null }: ProtectProps) {
  const { user } = useAuth();
  const { isAdmin } = useClinic();

  if (isAdmin) return <>{children}</>; // Admins ignore locks

  // Check if the user's permissions array includes the specific key
  if (user?.permissions?.includes(permission)) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}