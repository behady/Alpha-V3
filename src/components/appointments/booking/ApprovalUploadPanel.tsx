"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { Upload, X } from "lucide-react";
import Protect from "@/components/Protect";
import ApprovalDropZone from "@/components/insurance/ApprovalDropZone";
import ApprovalConfirmCard, { type PatientOption } from "@/components/insurance/ApprovalConfirmCard";
import type { OpenDoc } from "@/components/insurance/api";
import { useClinic } from "@/context/ClinicContext";
import { useUI } from "@/context/UIContext";
import { db } from "@/lib/firebase";
import { isAnyUnlocked } from "@/lib/featureCatalog";
import { WORDING_DOC } from "@/lib/insurance/claims";
import { parsePayers, PRIVATE_PAYER_ID, type Payer } from "@/lib/payers";
import { readInsurance } from "@/lib/patientInsurance";

type Props = { patientId: string; patientName: string; language: string };

/**
 * "Upload approval" inside the booking popup's Insurance tab.
 *
 * The same drop zone and confirm card as the Insurance page, so a paper read here is read, checked
 * and saved exactly as it would be there. The one difference: the approval is being added from this
 * patient's popup, so the card opens already pointed at this patient. Once saved, the approval
 * appears in the list above it (the popup listens to the patient's claims).
 *
 * Shown only where the Insurance page itself would be: the add-on is on and the user may edit
 * patients.
 */
export default function ApprovalUploadPanel({ patientId, patientName, language }: Props) {
  const isAr = language === "ar";
  const { clinicId, clinic } = useClinic();
  const { showToast } = useUI();
  const unlocked = !!clinic && isAnyUnlocked(clinic, "insurance");

  const [openPanel, setOpenPanel] = useState(false);
  const [payers, setPayers] = useState<Payer[]>([]);
  const [storedWording, setStoredWording] = useState<Record<string, string>>({});
  const [patient, setPatient] = useState<PatientOption | null>(null);
  const [cards, setCards] = useState<OpenDoc[]>([]);
  const [pickedPayer, setPickedPayer] = useState("");

  useEffect(() => {
    if (!clinicId || !unlocked || !openPanel) return;
    const stopPayers = onSnapshot(
      doc(db, "clinics", clinicId, "settings", "payers"),
      (snap) => setPayers(parsePayers(snap.data())),
      () => setPayers([]),
    );
    const stopWording = onSnapshot(
      doc(db, "clinics", clinicId, "settings", WORDING_DOC),
      (snap) => {
        const table = snap.get("metlife");
        const out: Record<string, string> = {};
        if (table && typeof table === "object") {
          for (const [code, entry] of Object.entries(table as Record<string, unknown>)) {
            const ar = entry && typeof entry === "object" ? (entry as { ar?: unknown }).ar : undefined;
            if (typeof ar === "string" && ar.trim()) out[code] = ar.trim();
          }
        }
        setStoredWording(out);
      },
      () => setStoredWording({}),
    );
    return () => {
      stopPayers();
      stopWording();
    };
  }, [clinicId, unlocked, openPanel]);

  useEffect(() => {
    if (!clinicId || !patientId || !openPanel) return;
    let live = true;
    getDoc(doc(db, "clinics", clinicId, "patients", patientId))
      .then((snap) => {
        if (!live) return;
        const d = snap.exists() ? snap.data() : {};
        setPatient({ id: patientId, name: String(d.name || patientName), phone: String(d.phone || ""), insurance: readInsurance(d) });
      })
      .catch(() => live && setPatient({ id: patientId, name: patientName, phone: "" }));
    return () => {
      live = false;
    };
  }, [clinicId, patientId, patientName, openPanel]);

  const insurers = useMemo(() => payers.filter((p) => p.active && p.id !== PRIVATE_PAYER_ID && p.format === "metlife"), [payers]);
  const payerId = insurers.some((p) => p.id === pickedPayer) ? pickedPayer : (insurers[0]?.id ?? "");
  const payer = insurers.find((p) => p.id === payerId) ?? null;

  if (!unlocked) return null;

  return (
    <Protect permission="patients.edit">
      <div className="mt-4">
        {!openPanel ? (
          <button
            type="button"
            onClick={() => setOpenPanel(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-ink"
          >
            <Upload size={16} /> {isAr ? "ارفع موافقة" : "Upload approval"}
          </button>
        ) : (
          <div className="space-y-3 rounded-2xl border border-line p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink">{isAr ? "رفع موافقة لـ" : "Upload an approval for"} {patientName}</p>
              <button
                type="button"
                onClick={() => {
                  setOpenPanel(false);
                  setCards([]);
                }}
                aria-label={isAr ? "إغلاق" : "Close"}
                className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-muted hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>
            {insurers.length === 0 ? (
              <p className="text-sm text-ink-muted">
                {isAr ? "مفيش شركة تأمين بتقرا الموافقات. ضيفها من الإعدادات ← شركات التأمين." : "No insurer is set up to read approvals. Add one under Settings → Insurance companies."}
              </p>
            ) : (
              <>
                {insurers.length > 1 && (
                  <select
                    value={payerId}
                    onChange={(e) => setPickedPayer(e.target.value)}
                    aria-label={isAr ? "شركة التأمين" : "Insurer"}
                    className="w-full max-w-xs rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-ink"
                  >
                    {insurers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {isAr ? p.nameAr || p.name : p.name}
                      </option>
                    ))}
                  </select>
                )}
                <ApprovalDropZone payer={payer} onRead={(d) => setCards((prev) => (prev.some((c) => c.docId === d.docId) ? prev : [...prev, d]))} />
              </>
            )}
            {patient &&
              cards.map((d) => {
                const cardPayer = insurers.find((p) => p.id === d.payerId);
                if (!cardPayer) return null;
                return (
                  <ApprovalConfirmCard
                    key={d.docId}
                    payer={cardPayer}
                    docId={d.docId}
                    docPath={d.docPath}
                    docUrl={d.docUrl}
                    contentType={d.contentType}
                    // Uploaded from this patient's popup: the approval is theirs.
                    result={{ ...d.result, match: { kind: "exact", patientId } }}
                    typed={d.typed}
                    patients={[patient]}
                    storedWording={storedWording}
                    onSaved={() => {
                      setCards((prev) => prev.filter((c) => c.docId !== d.docId));
                      showToast(isAr ? "الموافقة اتحفظت" : "Approval saved", "success");
                    }}
                    onDismiss={() => setCards((prev) => prev.filter((c) => c.docId !== d.docId))}
                    onOpenClaim={() => setCards((prev) => prev.filter((c) => c.docId !== d.docId))}
                  />
                );
              })}
          </div>
        )}
      </div>
    </Protect>
  );
}
