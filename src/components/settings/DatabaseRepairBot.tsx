"use client";

import { useState } from "react";
import { Wrench, Loader2, CheckCircle, AlertTriangle } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useUI } from "@/context/UIContext";
import { useClinic } from "@/context/ClinicContext";

export default function DatabaseRepairBot() {
  const { showToast, confirm } = useUI();
  const { clinicId } = useClinic();
  const [isScanning, setIsScanning] = useState(false);
  const [results, setResults] = useState<{ scanned: number, fixed: number } | null>(null);

  const runRepair = async () => {
    if (!await confirm("Run the automated repair bot? This will scan all users and staff, relink broken profiles by email, and generate missing profile data.")) {
      return;
    }

    setIsScanning(true);
    setResults(null);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token || !clinicId) {
        showToast("You must be logged in with a valid clinic selected.", "error");
        return;
      }

      const res = await fetch("/api/admin/repair", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ clinicId }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Repair failed");
      }

      setResults({ scanned: data.scanned, fixed: data.fixed });
      showToast(`Scan complete. Fixed ${data.fixed} broken links.`, "success");

      if (data.fixed > 0) {
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (error) {
      console.error("Repair Bot Error:", error);
      showToast(error instanceof Error ? error.message : "The repair bot encountered an error.", "error");
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="bg-amber-50 border-2 border-dashed border-amber-300 p-6 rounded-3xl mb-8 animate-in fade-in">
      <div className="flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="bg-amber-200 text-amber-700 p-4 rounded-2xl">
            <Wrench size={28} />
          </div>
          <div>
            <h3 className="text-lg font-black text-amber-900">Temporary Database Repair Bot</h3>
            <p className="text-sm font-semibold text-amber-700/80 mt-1">
              Finds and fixes &quot;Ghost&quot; accounts by rebuilding missing staff profiles and reconnecting broken IDs.
            </p>
          </div>
        </div>

        <button 
          onClick={runRepair} 
          disabled={isScanning}
          className="w-full md:w-auto bg-amber-600 text-white px-8 py-4 rounded-2xl font-bold shadow-lg hover:bg-amber-700 transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
        >
          {isScanning ? <Loader2 size={20} className="animate-spin" /> : <AlertTriangle size={20} />}
          {isScanning ? "Crawling Database..." : "Run Repair Bot"}
        </button>
      </div>

      {results && (
        <div className="mt-6 p-4 bg-white/60 rounded-2xl border border-amber-200 flex items-center gap-3">
          <CheckCircle size={20} className="text-green-600" />
          <p className="text-sm font-bold text-amber-900">
            Successfully scanned <span className="text-blue-600">{results.scanned}</span> user profiles and applied <span className="text-green-600">{results.fixed}</span> structural fixes.
          </p>
        </div>
      )}
    </div>
  );
}