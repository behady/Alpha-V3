"use client";

import { useState } from "react";
import { collection, getDocs, updateDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

export default function MigratePage() {
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  const addLog = (msg: string) => setLog((prev) => [...prev, msg]);

  const runMigration = async () => {
    setRunning(true);
    setLog([]);
    addLog("Starting migration...");

    try {
      const querySnapshot = await getDocs(getClinicCollection("appointments"));
      let migratedCount = 0;

      for (const appointmentDoc of querySnapshot.docs) {
        const data = appointmentDoc.data();
        let updated = false;
        let newTreatment = data.treatment || "";

        // If treatment is empty but there are services, migrate them to treatment.
        if (!newTreatment && data.services && Array.isArray(data.services) && data.services.length > 0) {
          newTreatment = data.services.map((s: any) => s.serviceName).filter(Boolean).join(", ");
          updated = true;
        }

        // If treatment is still empty but there is a single serviceName, use that.
        if (!newTreatment && data.serviceName) {
            newTreatment = data.serviceName;
            updated = true;
        }

        if (updated && newTreatment) {
          addLog(`Migrating appointment ${appointmentDoc.id}: Setting reason to "${newTreatment}"`);
          await updateDoc(getClinicDoc("appointments", appointmentDoc.id), {
            treatment: newTreatment,
          });
          migratedCount++;
        }
      }

      addLog(`Migration completed! Migrated ${migratedCount} appointments.`);
    } catch (e: any) {
      addLog(`Error during migration: ${e.message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Migrate Appointments</h1>
      <p className="mb-4 text-ink-body">
        This script migrates existing appointments. If an appointment has no "Reason for Visit" (treatment) but has legacy services, it extracts the service names and saves them as the reason for visit.
      </p>
      
      <button 
        onClick={runMigration} 
        disabled={running}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {running ? "Running..." : "Run Migration"}
      </button>

      <div className="mt-8 bg-slate-900 text-green-400 p-4 rounded font-mono text-sm h-96 overflow-y-auto">
        {log.map((l, i) => <div key={i}>{l}</div>)}
        {log.length === 0 && <div className="text-slate-500">Awaiting execution...</div>}
      </div>
    </div>
  );
}
