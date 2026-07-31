import type { Timestamp } from "firebase/firestore";

export type StaffSummonStatus = "pending" | "seen";

export type StaffSummon = {
  id: string;
  targetStaffId: string;
  targetUid: string;
  targetName: string;
  requestedByStaffId: string;
  requestedByUid: string;
  requestedByName: string;
  status: StaffSummonStatus;
  createdAt?: Timestamp;
  seenAt?: Timestamp;
};

export type ReceptionistOption = {
  staffId: string;
  uid: string;
  name: string;
  role: string;
};
