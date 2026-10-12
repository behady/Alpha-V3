"use client";

/**
 * The team list, and the invite form that used to live in the settings page itself.
 *
 * `staff` is the source of truth for who works at this clinic — the user list is built from it
 * rather than from the platform-wide `users` collection, because a person can work at more than
 * one clinic and only their staff row is scoped to this one.
 *
 * The invite form is AddUserModal, shared with the Team page. Creating the login goes through
 * /api/staff/create on the Admin SDK (via lib/staffLogin, which the clinic setup's team step calls
 * too): the browser cannot create an Auth account, and the route also refuses to hand an existing
 * account a second clinic without saying so.
 */

import { useCallback, useEffect, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import UserManagement from "@/components/settings/UserManagement";
import AddUserModal from "@/components/settings/AddUserModal";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { getClinicCollection } from "@/lib/db-utils";

/**
 * Matches the shape UserManagement expects. The index signature is load-bearing: staff rows carry
 * clinic-specific fields (commission, working days) that this host never reads but must pass
 * through untouched.
 */
type StaffRecord = {
  id: string;
  uid?: string;
  name?: string;
  email?: string;
  role?: string;
  isDentist?: boolean;
  permissions?: string[];
  [key: string]: unknown;
};

export default function UsersHost() {
  const { user } = useAuth();
  const { clinicId } = useClinic();

  const [staffMembers, setStaffMembers] = useState<StaffRecord[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(getClinicCollection("staff"), (snap) => {
      setStaffMembers(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StaffRecord));
    });
    return () => unsub();
  }, []);

  // `staff` IS the user list for this clinic; the uid is the user-document id when one exists.
  const usersList = staffMembers.map((staff) => ({
    id: staff.uid || staff.id,
    uid: staff.uid,
    name: staff.name,
    email: staff.email,
    role: staff.role,
    isDentist: staff.isDentist,
    staffId: staff.id,
    permissions: staff.permissions || [],
  }));

  const openAddUser = useCallback(() => setIsModalOpen(true), []);

  return (
    <>
      <UserManagement
        usersList={usersList}
        currentUser={user}
        openAddUser={openAddUser}
        clinicId={clinicId}
      />

      {isModalOpen && <AddUserModal clinicId={clinicId} onClose={() => setIsModalOpen(false)} />}
    </>
  );
}
