import { collection, CollectionReference, DocumentData, doc, DocumentReference } from "firebase/firestore";
import { db } from "@/lib/firebase";

let globalClinicId: string | null = null;

export function setGlobalClinicId(id: string | null) {
  globalClinicId = id;
}

export function getGlobalClinicId(): string {
  if (!globalClinicId) {
    throw new Error("No clinic selected globally. Ensure ClinicProvider is mounted.");
  }
  return globalClinicId;
}

/**
 * Helper to get a collection reference scoped to the currently selected clinic.
 * For global collections (users, clinics, join_requests), it returns the root collection.
 *
 * system_logs is deliberately NOT global: it's each clinic's audit trail, and a root collection
 * would mix every clinic's activity into one place with no way to scope reads to just your own
 * clinic. It used to be listed here, which meant firestore.rules had nothing that matched it
 * (there's no root-level rule for it) — every write silently failed with a permission error,
 * and the Activity Logs screen was permanently empty for the same reason.
 */
export function getClinicCollection(path: string): CollectionReference<DocumentData> {
  if (path === 'users' || path === 'clinics' || path === 'join_requests') {
    return collection(db, path);
  }

  return collection(db, `clinics/${getGlobalClinicId()}/${path}`);
}

/**
 * Helper to get a document reference scoped to the currently selected clinic.
 */
export function getClinicDoc(path: string, docId?: string): DocumentReference<DocumentData> {
  if (path === 'users' || path === 'clinics' || path === 'join_requests') {
    return docId ? doc(db, path, docId) : doc(collection(db, path));
  }

  return docId 
    ? doc(db, `clinics/${getGlobalClinicId()}/${path}`, docId)
    : doc(collection(db, `clinics/${getGlobalClinicId()}/${path}`));
}
