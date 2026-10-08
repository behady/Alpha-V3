"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { isInsurerFormat, parsePayers, PRIVATE_PAYER_ID, type Payer } from "@/lib/payers";
import { readInsurance } from "@/lib/patientInsurance";

type Props = {
  patientId: string;
  patientName: string;
  language: string;
  /**
   * Open the panel from outside (the Insurance tab's "add another insurance" and "upload for this
   * company" buttons). Each new `n` opens it once, on `payerId` when given, and scrolls it into view.
   */
  request?: { n: number; payerId?: string };
};

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
export default function ApprovalUploadPanel({ patientId, patientName, language, request }: Props) {
  const isAr = language === "ar";
  const { clinicId, clinic } = useClinic();
  const { showToast } = useUI();
  const unlocked = !!clinic && isAnyUnlocked(clinic, "insurance");

  const [openPanel, setOpenPanel] = useState(false);
  const [payers, setPayers] = useState<Payer[]>([]);
  /** The whole wording document: each insurer format keeps its own code table in it. */
  const [wordingDoc, setWordingDoc] = useState<Record<string, unknown>>({});
  const [patient, setPatient] = useState<PatientOption | null>(null);
  const [cards, setCards] = useState<OpenDoc[]>([]);
  const [pickedPayer, setPickedPayer] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  // A new request opens the panel on its insurer (adjusted during render, not in an effect)…
  const [seenRequest, setSeenRequest] = useState(0);
  if (request && request.n > seenRequest) {
    setSeenRequest(request.n);
    setOpenPanel(true);
    if (request.payerId) setPickedPayer(request.payerId);
  }
  // …and brings it on screen once it has rendered open.
  useEffect(() => {
    if (seenRequest <= 0) return;
    const id = window.setTimeout(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    return () => window.clearTimeout(id);
  }, [seenRequest]);

  useEffect(() => {
    if (!clinicId || !unlocked || !openPanel) return;
    const stopPayers = onSnapshot(
      doc(db, "clinics", clinicId, "settings", "payers"),
      (snap) => setPayers(parsePayers(snap.data())),
      () => setPayers([]),
    );
    const stopWording = onSnapshot(
      doc(db, "clinics", clinicId, "settings", WORDING_DOC),
      (snap) => setWordingDoc((snap.data() as Record<string, unknown> | undefined) ?? {}),
      () => setWordingDoc({}),
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

  const insurers = useMemo(() => payers.filter((p) => p.active && p.id !== PRIVATE_PAYER_ID && isInsurerFormat(p.format)), [payers]);
  const payerId = insurers.some((p) => p.id === pickedPayer) ? pickedPayer : (insurers[0]?.id ?? "");
  const payer = insurers.find((p) => p.id === payerId) ?? null;
  const storedWording = useMemo(() => {
    const table = wordingDoc[payer?.format ?? "metlife"];
    const out: Record<string, string> = {};
    if (table && typeof table === "object") {
      for (const [code, entry] of Object.entries(table as Record<string, unknown>)) {
        const ar = entry && typeof entry === "object" ? (entry as { ar?: unknown }).ar : undefined;
        if (typeof ar === "string" && ar.trim()) out[code] = ar.trim();
      }
    }
    return out;
  }, [wordingDoc, payer?.format]);

  if (!unlocked) return null;

  return (
    <Protect permission="patients.edit">
      <div ref={panelRef} className="mt-4">
        {!openPanel ? (
          <button
            type="button"
            onClick={() => setOpenPanel(true)}
            className="inline-flex h-12 items-center gap-2 rounded-xl border border-line-strong bg-surface px-5 text-[15px] font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-subtle"
          >
            <Upload size={16} /> {isAr ? "ارفع موافقة" : "Upload approval"}
          </button>
        ) : (
          <div className="space-y-4 rounded-2xl border border-line-strong p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[15px] font-semibold text-ink">{isAr ? "رفع موافقة لـ" : "Upload an approval for"} {patientName}</p>
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
                  <label className="block">
                    <span className="mb-1 block text-[13px] font-semibold text-ink-body">{isAr ? "شركة التأمين" : "Insurance company"}</span>
                    <select
                      value={payerId}
                      onChange={(e) => setPickedPayer(e.target.value)}
                      className="w-full max-w-xs rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-sm font-semibold text-ink outline-none focus:border-ink"
                    >
                      {insurers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {isAr ? p.nameAr || p.name : p.name}
                        </option>
                      ))}
                    </select>
                  </label>
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
