import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

export type LogAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'AUTH' | 'PRINT';

export const logActivity = async (
  user: { uid: string; name: string; role: string } | null,
  action: LogAction,
  details: string,
  collectionName: string = "system_logs"
) => {
  if (!user) return; // Don't log if no user (shouldn't happen)

  try {
    await addDoc(getClinicCollection(collectionName), {
      userId: user.uid,
      userName: user.name,
      userRole: user.role,
      action,
      details,
      timestamp: serverTimestamp(),
      date: new Date().toISOString().split('T')[0]
    });
  } catch (error) {
    console.error("Logging failed:", error);
  }
};