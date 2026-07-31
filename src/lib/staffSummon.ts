import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ReceptionistOption, StaffSummon, StaffSummonStatus } from "@/types/staffSummon";
import { isDentistStaff } from "@/lib/staffRoles";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

type SummonRequester = {
  uid: string;
  name: string;
  role: string;
  staffId?: string;
  isDentist?: boolean;
};

const COLLECTION = "staff_summons";

export function canRequestReceptionSummon(user: SummonRequester | null): boolean {
  if (!user) return false;
  if (user.role === "Admin" || user.role === "Dentist") return true;
  return isDentistStaff(user);
}

export function isReceptionSummonTarget(user: SummonRequester | null): boolean {
  if (!user) return false;
  return user.role === "Receptionist" || user.role === "Assistant";
}

export async function loadReceptionistOptions(): Promise<ReceptionistOption[]> {
  const [staffSnap, usersSnap] = await Promise.all([
    getDocs(getClinicCollection("staff")),
    getDocs(getClinicCollection("users")),
  ]);

  const uidByStaffId = new Map<string, string>();
  usersSnap.docs.forEach((d) => {
    const data = d.data();
    const staffId = typeof data.staffId === "string" ? data.staffId : "";
    if (staffId) uidByStaffId.set(staffId, d.id);
  });

  const options: ReceptionistOption[] = [];
  staffSnap.docs.forEach((d) => {
    const data = d.data();
    const role = String(data.role || "");
    if (role !== "Receptionist" && role !== "Assistant") return;

    const staffId = d.id;
    const uid =
      (typeof data.uid === "string" && data.uid) || uidByStaffId.get(staffId) || "";
    if (!uid) return;

    options.push({
      staffId,
      uid,
      name: String(data.name || "Reception"),
      role,
    });
  });

  return options.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createStaffSummon(
  target: ReceptionistOption,
  requester: SummonRequester
): Promise<string> {
  const ref = await addDoc(getClinicCollection(COLLECTION), {
    targetStaffId: target.staffId,
    targetUid: target.uid,
    targetName: target.name,
    requestedByStaffId: requester.staffId || "",
    requestedByUid: requester.uid,
    requestedByName: requester.name,
    status: "pending" satisfies StaffSummonStatus,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function acknowledgeStaffSummon(summonId: string): Promise<void> {
  await updateDoc(getClinicDoc(COLLECTION, summonId), {
    status: "seen",
    seenAt: serverTimestamp(),
  });
}

export function subscribeToSummon(
  summonId: string,
  onChange: (summon: StaffSummon | null) => void
): Unsubscribe {
  return onSnapshot(getClinicDoc(COLLECTION, summonId), (snap) => {
    if (!snap.exists()) {
      onChange(null);
      return;
    }
    onChange({ id: snap.id, ...(snap.data() as Omit<StaffSummon, "id">) });
  });
}

export function subscribeToPendingSummonForUser(
  targetUid: string,
  onPending: (summon: StaffSummon | null) => void
): Unsubscribe {
  const q = query(
    getClinicCollection(COLLECTION),
    where("targetUid", "==", targetUid),
    where("status", "==", "pending")
  );

  return onSnapshot(
    q,
    (snap) => {
      if (snap.empty) {
        onPending(null);
        return;
      }
      const docs = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<StaffSummon, "id">) }))
        .sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
      onPending(docs[0] ?? null);
    },
    (err) => {
      console.warn("staff_summons listener error", err);
      void fetchPendingSummonForUser(targetUid).then(onPending);
    }
  );
}

/** One-shot fetch — used when the tab wakes or as a background poll fallback. */
export async function fetchPendingSummonForUser(targetUid: string): Promise<StaffSummon | null> {
  const q = query(
    getClinicCollection(COLLECTION),
    where("targetUid", "==", targetUid),
    where("status", "==", "pending")
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const docs = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<StaffSummon, "id">) }))
    .sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? 0;
      const tb = b.createdAt?.toMillis?.() ?? 0;
      return tb - ta;
    });
  return docs[0] ?? null;
}
