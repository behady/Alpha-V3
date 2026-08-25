"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Search, Printer, Pill, Loader2, ChevronLeft, User } from "lucide-react";
import { collection, doc, getDoc, getDocs, query, where, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { patientMatchesSearch } from "@/lib/flexibleSearch";
import {
  buildPrescriptionPayloadFromRecord,
  formatPrescriptionCardDate,
  normalizeRxItemsFromRecord,
  openPrescriptionPdf,
  prescriptionCreatedMs,
  prescriptionPreviewText,
} from "@/lib/prescriptionRecord";
import { prescriptionPayloadToPdfBlob } from "@/lib/prescriptionPdfHtml";
import { useUI } from "@/context/UIContext";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

type PatientRow = { id: string; name: string; phone?: string };

type PrescriptionRow = Record<string, unknown> & { id: string };

type Props = {
  isOpen: boolean;
  onClose: () => void;
  patients: PatientRow[];
  language: "en" | "ar";
};

export default function PrescriptionPrintFinderModal({
  isOpen,
  onClose,
  patients,
  language,
}: Props) {
  const { showToast } = useUI();
  const isAr = language === "ar";

  const [search, setSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<PatientRow | null>(null);
  const [prescriptions, setPrescriptions] = useState<PrescriptionRow[]>([]);
  const [loadingRx, setLoadingRx] = useState(false);
  const [printingId, setPrintingId] = useState<string | null>(null);

  const txt = useMemo(
    () => ({
      title: isAr ? "طباعة وصفة" : "Print prescription",
      subtitle: isAr ? "ابحث عن مريض ثم اختر وصفة محفوظة" : "Search for a patient, then pick a saved prescription",
      search: isAr ? "ابحث بالاسم أو الهاتف..." : "Search by name or phone...",
      noPatients: isAr ? "لا يوجد مرضى مطابقون" : "No matching patients",
      selectPatient: isAr ? "اختر مريضاً" : "Select a patient",
      back: isAr ? "رجوع" : "Back",
      noRx: isAr ? "لا توجد وصفات محفوظة لهذا المريض" : "No saved prescriptions for this patient",
      print: isAr ? "طباعة" : "Print",
      meds: isAr ? "دواء" : "medication",
      medsPlural: isAr ? "أدوية" : "medications",
      opening: isAr ? "جاري فتح الوصفة..." : "Opening prescription...",
      noMeds: isAr ? "هذه الوصفة لا تحتوي على أدوية" : "This prescription has no medications",
      printFailed: isAr ? "تعذّر طباعة الوصفة" : "Could not print prescription",
    }),
    [isAr]
  );

  useEffect(() => {
    if (!isOpen) {
      setSearch("");
      setSelectedPatient(null);
      setPrescriptions([]);
      setLoadingRx(false);
      setPrintingId(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!selectedPatient?.id) {
      setPrescriptions([]);
      return;
    }

    let cancelled = false;
    setLoadingRx(true);
    (async () => {
      try {
        const snap = await getDocs(
          query(
            getClinicCollection("prescriptions"),
            where("patientId", "==", selectedPatient.id),
            limit(100)
          )
        );
        if (cancelled) return;
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as PrescriptionRow)
          .sort((a, b) => prescriptionCreatedMs(b) - prescriptionCreatedMs(a));
        setPrescriptions(rows);
      } catch {
        if (!cancelled) {
          setPrescriptions([]);
          showToast(txt.printFailed, "error");
        }
      } finally {
        if (!cancelled) setLoadingRx(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedPatient?.id, showToast, txt.printFailed]);

  const filteredPatients = useMemo(() => {
    const q = search.trim();
    if (!q) return patients.slice(0, 12);
    return patients
      .filter((p) => patientMatchesSearch(q, p.name, p.phone))
      .slice(0, 12);
  }, [patients, search]);

  const handlePrint = async (record: PrescriptionRow) => {
    const rxItems = normalizeRxItemsFromRecord(record.drugs);
    if (rxItems.length === 0) {
      showToast(txt.noMeds, "error");
      return;
    }

    const patientId = String(record.patientId || selectedPatient?.id || "");
    if (!patientId) return;

    setPrintingId(record.id);
    try {
      const [patientSnap, clinicSnap] = await Promise.all([
        getDoc(getClinicDoc("patients", patientId)),
        getDoc(getClinicDoc("settings", "clinic_info")),
      ]);
      const patient = patientSnap.exists()
        ? (patientSnap.data() as {
            name?: string;
            dateOfBirth?: string;
            age?: string | number;
            gender?: string;
          })
        : { name: String(record.patientName || selectedPatient?.name || "Patient") };
      const clinicInfo = clinicSnap.exists() ? clinicSnap.data() : {};

      const payload = buildPrescriptionPayloadFromRecord(record, patient, clinicInfo);
      const blob = await prescriptionPayloadToPdfBlob(payload);
      openPrescriptionPdf(blob, `Prescription-${record.id.slice(0, 8)}.pdf`);
      showToast(txt.opening, "success");
    } catch (e) {
      console.error(e);
      showToast(txt.printFailed, "error");
    } finally {
      setPrintingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[min(90vh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/80 px-5 py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-black text-slate-900">
              <Pill className="shrink-0 text-primary-500" size={20} />
              {txt.title}
            </h2>
            <p className="mt-0.5 text-xs font-medium text-slate-500">{txt.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full border border-slate-200 bg-white p-2 text-slate-400 transition hover:text-rose-500"
            aria-label={isAr ? "إغلاق" : "Close"}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden px-5 py-4">
          {selectedPatient ? (
            <>
              <button
                type="button"
                onClick={() => setSelectedPatient(null)}
                className="mb-3 flex items-center gap-1 text-xs font-bold text-primary-600 hover:text-primary-800"
              >
                <ChevronLeft size={16} className={isAr ? "rotate-180" : ""} />
                {txt.back}
              </button>
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-primary-100 bg-primary-50/60 px-3 py-2">
                <User size={16} className="shrink-0 text-primary-600" />
                <span className="truncate font-bold text-slate-900">{selectedPatient.name}</span>
              </div>
            </>
          ) : (
            <div className="relative mb-3">
              <Search size={16} className="pointer-events-none absolute top-3.5 text-slate-400 start-3" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={txt.search}
                autoFocus
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 ps-9 pe-3 text-sm font-bold text-slate-900 outline-none focus:border-primary-500 focus:bg-white"
              />
            </div>
          )}

          <div className="flex-1 overflow-y-auto custom-scrollbar -mx-1 px-1">
            {!selectedPatient ? (
              <div className="space-y-1">
                {filteredPatients.length === 0 ? (
                  <p className="py-8 text-center text-sm font-bold text-slate-400">{txt.noPatients}</p>
                ) : (
                  filteredPatients.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedPatient(p)}
                      className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-3 text-start transition hover:border-slate-200 hover:bg-slate-50"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-black text-slate-600">
                        {p.name?.charAt(0)?.toUpperCase() || "P"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold text-slate-900">{p.name}</p>
                        {p.phone ? (
                          <p className="truncate text-xs font-medium text-slate-500" dir="ltr">
                            {p.phone}
                          </p>
                        ) : null}
                      </div>
                    </button>
                  ))
                )}
              </div>
            ) : loadingRx ? (
              <div className="flex justify-center py-12">
                <Loader2 className="animate-spin text-primary-500" size={28} />
              </div>
            ) : prescriptions.length === 0 ? (
              <p className="py-8 text-center text-sm font-bold text-slate-400">{txt.noRx}</p>
            ) : (
              <ul className="space-y-2">
                {prescriptions.map((rx) => {
                  const items = normalizeRxItemsFromRecord(rx.drugs);
                  const countLabel =
                    items.length === 1
                      ? `1 ${txt.meds}`
                      : `${items.length} ${txt.medsPlural}`;
                  const isPrinting = printingId === rx.id;
                  return (
                    <li
                      key={rx.id}
                      className="rounded-2xl border border-slate-200 bg-slate-50/50 p-3 transition hover:border-primary-200 hover:bg-white"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-black text-slate-900">
                            {formatPrescriptionCardDate(rx)}
                          </p>
                          {typeof rx.doctor === "string" && rx.doctor.trim() ? (
                            <p className="mt-0.5 text-xs font-semibold text-slate-500">
                              {rx.doctor}
                            </p>
                          ) : null}
                          <p className="mt-1 line-clamp-2 text-xs font-medium text-slate-600">
                            {prescriptionPreviewText(rx)}
                          </p>
                          <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                            {countLabel}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={isPrinting || items.length === 0}
                          onClick={() => void handlePrint(rx)}
                          className="shrink-0 flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white transition hover:bg-slate-800 disabled:opacity-50"
                        >
                          {isPrinting ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Printer size={14} />
                          )}
                          {txt.print}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
