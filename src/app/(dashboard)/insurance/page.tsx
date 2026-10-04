"use client";

/**
 * Insurance — the approval papers, the claims they become, and the monthly sheet to the insurer.
 *
 * The receptionist drops the insurer's approval (a scan or a photo), the server reads it, and a card
 * shows what was read beside the paper. She corrects anything the checks flag, picks the patient,
 * saves; the claim appears in the list below. At the end of the month the Excel button builds the
 * insurer's own statement from those claims, and "Mark all as sent" records that it went.
 *
 * Only payers with a document format appear here (MetLife this round). Nothing on this page writes
 * to Firestore: reads are live listeners, every change goes through /api/insurance/* or the recycle
 * bin route. Unsaved readings live in this page's state; a refresh loses the card but not the file,
 * which comes back under "Uploaded, not saved" and is read again on a click.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, doc, getDoc, getDocs, limit, onSnapshot, query, where } from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import { ArrowUpRight, FileClock, Loader2, ShieldCheck } from "lucide-react";
import FeatureGate from "@/components/FeatureGate";
import PermissionGuard from "@/components/PermissionGuard";
import PageHeader from "@/components/dashboard/PageHeader";
import { useLanguage } from "@/context/LanguageContext";
import { useClinic } from "@/context/ClinicContext";
import { useUI } from "@/context/UIContext";
import { db, storage } from "@/lib/firebase";
import { parsePayers, PRIVATE_PAYER_ID, type Payer } from "@/lib/payers";
import { readInsurance } from "@/lib/patientInsurance";
import { CLAIMS_COLLECTION, claimExtraction, DOCS_COLLECTION, parseClaim, WORDING_DOC, type InsuranceClaim } from "@/lib/insurance/claims";
import { DEFAULT_METLIFE_WORDING } from "@/lib/insuranceStatementMetlife";
import { useStatementHeader } from "@/lib/insuranceStatementHeader";
import { deleteRecord, RecycleBinError } from "@/lib/recycleBinApi";
import ApprovalDropZone from "@/components/insurance/ApprovalDropZone";
import ApprovalConfirmCard, { type PatientOption } from "@/components/insurance/ApprovalConfirmCard";
import ClaimsTable from "@/components/insurance/ClaimsTable";
import ClaimsExportBar from "@/components/insurance/ClaimsExportBar";
import { useClaims } from "@/components/insurance/useClaims";
import type { LinkedAppointmentLite } from "@/lib/insurance/appointments";
import { cairoToday, InsuranceCallError, monthRange, patchClaim, readDocument, type ClaimPatch, type OpenDoc } from "@/components/insurance/api";
import { tr } from "@/components/insurance/text";

const MAX_PATIENTS = 5000;

type UnsavedDoc = { id: string; path: string; contentType: string; uploadedAt: number };

function fileNameOf(path: string): string {
  return path.split("/").pop() || path;
}

function InsurancePage() {
  const { language, isRTL } = useLanguage();
  const isAr = language === "ar";
  const t = useMemo(() => tr(isAr), [isAr]);
  const { clinicId } = useClinic();
  const { showToast } = useUI();

  // --- the insurers this page can read for ------------------------------------------------------
  const [payers, setPayers] = useState<{ clinicId: string; list: Payer[] } | null>(null);
  useEffect(() => {
    if (!clinicId) return;
    return onSnapshot(
      doc(db, "clinics", clinicId, "settings", "payers"),
      (snap) => setPayers({ clinicId, list: parsePayers(snap.data()) }),
      (err) => {
        console.error("Payers subscription failed", err);
        setPayers({ clinicId, list: [] });
      },
    );
  }, [clinicId]);
  const payersReady = !!payers && payers.clinicId === clinicId;
  const insurers = useMemo(
    () => (payersReady ? payers!.list.filter((p) => p.active && p.id !== PRIVATE_PAYER_ID && p.format === "metlife") : []),
    [payers, payersReady],
  );
  const [pickedPayer, setPickedPayer] = useState("");
  const payerId = insurers.some((p) => p.id === pickedPayer) ? pickedPayer : (insurers[0]?.id ?? "");
  const payer = insurers.find((p) => p.id === payerId) ?? null;

  // --- the clinic's sheet wording, over the defaults ---------------------------------------------
  const [storedWording, setStoredWording] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!clinicId) return;
    return onSnapshot(
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
  }, [clinicId]);
  const wording = useMemo(() => ({ ...DEFAULT_METLIFE_WORDING, ...storedWording }), [storedWording]);

  // --- range, header, claims ---------------------------------------------------------------------
  const [range, setRange] = useState(() => monthRange(cairoToday()));
  const [header, setHeaderLine] = useStatementHeader(clinicId);
  const { claims, loading: claimsLoading, failed: claimsFailed } = useClaims(clinicId, payerId, range.from, range.to);

  // --- the visits booked for approved services, for the progress line under each status ----------
  // One listener for the clinic: `claimId > ""` is every appointment that carries a link, and the
  // table matches them to its rows. Cancelled and no-show visits are filtered when counted.
  const [claimAppointments, setClaimAppointments] = useState<LinkedAppointmentLite[]>([]);
  useEffect(() => {
    if (!clinicId) return;
    return onSnapshot(
      query(collection(db, "clinics", clinicId, "appointments"), where("claimId", ">", "")),
      (snap) => setClaimAppointments(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as LinkedAppointmentLite)),
      (err) => {
        console.error("Insurance appointments subscription failed", err);
        setClaimAppointments([]);
      },
    );
  }, [clinicId]);

  // --- the clinic's patients, for the picker -----------------------------------------------------
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [patientsVersion, setPatientsVersion] = useState(0);
  useEffect(() => {
    if (!clinicId) return;
    let cancelled = false;
    getDocs(query(collection(db, "clinics", clinicId, "patients"), limit(MAX_PATIENTS)))
      .then((snap) => {
        if (cancelled) return;
        setPatients(
          snap.docs
            .map((d) => {
              const p = d.data() as { name?: unknown; phone?: unknown };
              return {
                id: d.id,
                name: typeof p.name === "string" ? p.name : "",
                phone: typeof p.phone === "string" ? p.phone : "",
                // The stored membership, so the card can warn before a save overwrites it.
                insurance: readInsurance(d.data()),
              };
            })
            .filter((p) => p.name)
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch((err) => console.error("Patients load failed", err));
    return () => {
      cancelled = true;
    };
  }, [clinicId, patientsVersion]);

  // --- cards waiting to be confirmed -------------------------------------------------------------
  const [open, setOpen] = useState<OpenDoc[]>([]);
  const onRead = useCallback((d: OpenDoc) => {
    setOpen((prev) => (prev.some((o) => o.docId === d.docId) ? prev : [...prev, d]));
  }, []);
  const closeCard = (docId: string) => setOpen((prev) => prev.filter((o) => o.docId !== docId));

  // --- uploaded, read, never saved ---------------------------------------------------------------
  const [unsaved, setUnsaved] = useState<{ key: string; rows: UnsavedDoc[] }>({ key: "", rows: [] });
  const unsavedKey = clinicId && payerId ? `${clinicId}|${payerId}` : "";
  useEffect(() => {
    if (!unsavedKey || !clinicId) return;
    return onSnapshot(
      query(collection(db, "clinics", clinicId, DOCS_COLLECTION), where("payerId", "==", payerId), where("claimId", "==", null)),
      (snap) => {
        const rows = snap.docs
          .map((d) => {
            const r = d.data() as { path?: unknown; contentType?: unknown; uploadedAt?: { toMillis?: () => number } };
            return {
              id: d.id,
              path: typeof r.path === "string" ? r.path : "",
              contentType: typeof r.contentType === "string" ? r.contentType : "",
              uploadedAt: r.uploadedAt?.toMillis?.() ?? 0,
            };
          })
          .filter((r) => r.path)
          .sort((a, b) => b.uploadedAt - a.uploadedAt);
        setUnsaved({ key: unsavedKey, rows });
      },
      (err) => {
        console.error("Unsaved insurance documents subscription failed", err);
        setUnsaved({ key: unsavedKey, rows: [] });
      },
    );
  }, [unsavedKey, clinicId, payerId]);
  const waiting = (unsaved.key === unsavedKey ? unsaved.rows : []).filter((u) => !open.some((o) => o.docId === u.id));

  const [rereading, setRereading] = useState("");
  const reread = async (row: UnsavedDoc) => {
    if (!clinicId || !payer || rereading) return;
    setRereading(row.id);
    try {
      const outcome = await readDocument({ clinicId, payerId: payer.id, docId: row.id, docPath: row.path });
      if (!outcome.ok) {
        showToast(outcome.error || t("rereadFailed"), "error");
        return;
      }
      const docUrl = await getDownloadURL(ref(storage, row.path)).catch(() => "");
      onRead({ payerId: payer.id, docId: row.id, docPath: row.path, docUrl, contentType: row.contentType, result: outcome.result, typed: false });
    } catch (err) {
      showToast(err instanceof InsuranceCallError && err.kind === "signed_out" ? t("signedOut") : t("rereadFailed"), "error");
    } finally {
      setRereading("");
    }
  };

  // --- showing one claim (after a save, or "already saved — open") ------------------------------
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const showClaim = async (claimId: string) => {
    if (!clinicId || !claimId) return;
    let claim: InsuranceClaim | null = null;
    try {
      const snap = await getDoc(doc(db, "clinics", clinicId, CLAIMS_COLLECTION, claimId));
      claim = snap.exists() ? parseClaim(snap.id, snap.data()) : null;
    } catch (err) {
      console.error("Claim lookup failed", err);
    }
    if (!claim) {
      showToast(t("claimNotFound"), "error");
      return;
    }
    if (claim.payerId !== payerId && insurers.some((p) => p.id === claim.payerId)) setPickedPayer(claim.payerId);
    if (claim.approvalDate && (claim.approvalDate < range.from || claim.approvalDate > range.to)) setRange(monthRange(claim.approvalDate));
    setHighlightId(claim.id);
    const id = `claim-${claim.id}`;
    // The row may only exist after the range moves and the listener answers.
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" }), 600);
  };

  // --- editing a saved approval ------------------------------------------------------------------
  const [editing, setEditing] = useState<{ claim: InsuranceClaim; docUrl: string } | null>(null);
  const openEdit = async (claim: InsuranceClaim) => {
    let docUrl = "";
    if (claim.doc.path) {
      try {
        docUrl = await getDownloadURL(ref(storage, claim.doc.path));
      } catch (err) {
        console.error("Approval document link failed", err);
      }
    }
    setEditing({ claim, docUrl });
    window.setTimeout(() => document.getElementById("insurance-edit-card")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const onSaved = (docId: string, claimId: string) => {
    closeCard(docId);
    showToast(t("savedToast"), "success");
    // A new patient may have been created with the claim.
    setPatientsVersion((v) => v + 1);
    void showClaim(claimId);
  };

  // --- row changes -------------------------------------------------------------------------------
  const onPatch = useCallback(
    async (claim: InsuranceClaim, patch: ClaimPatch): Promise<boolean> => {
      if (!clinicId) return false;
      try {
        const error = await patchClaim(clinicId, claim.id, patch);
        if (error) {
          showToast(`${t("updateFailed")}: ${error}`, "error");
          return false;
        }
        return true;
      } catch (err) {
        showToast(err instanceof InsuranceCallError && err.kind === "signed_out" ? t("signedOut") : t("updateFailed"), "error");
        return false;
      }
    },
    [clinicId, showToast, t],
  );

  const onDelete = async (claim: InsuranceClaim) => {
    if (!clinicId) return;
    try {
      const result = await deleteRecord(clinicId, CLAIMS_COLLECTION, claim.id);
      // The route answers per item: an approval whose share or insurer payment is already in the
      // books comes back "blocked" with the reason, not deleted.
      const item = result.results?.[0];
      if (item && item.status !== "deleted") {
        showToast(item.error || t("deleteFailed"), "error");
        return;
      }
      showToast(t("deleted"), "success");
    } catch (err) {
      showToast(err instanceof RecycleBinError ? err.message : t("deleteFailed"), "error");
    }
  };

  return (
    <div className={`min-h-full pb-24 lg:pb-8 ${isRTL ? "text-right" : "text-left"}`} dir={isRTL ? "rtl" : "ltr"}>
      <div className="mx-auto w-full max-w-[1920px] space-y-6 px-4 pt-5 pb-8 md:px-6 xl:space-y-8 xl:px-10 xl:pt-7 2xl:px-12">
        <PageHeader title={t("title")} subtitle={t("subtitle")} />

        {!payersReady ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-ink-muted" size={22} />
          </div>
        ) : insurers.length === 0 ? (
          <div className="flex flex-col items-start gap-4 rounded-3xl border border-line bg-surface p-6 sm:flex-row sm:items-center">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-ink-slab text-white">
              <ShieldCheck size={22} />
            </div>
            <p className="flex-1 text-[14px] font-semibold leading-relaxed text-ink-body">{t("noFormatPayers")}</p>
            <Link
              href="/settings/payers"
              className="inline-flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-[13px] font-black text-ink transition-colors hover:bg-surface-subtle"
            >
              {t("openPayers")} <ArrowUpRight size={14} />
            </Link>
          </div>
        ) : (
          <>
            {/* --- which insurer ------------------------------------------------------------- */}
            <label className="flex max-w-sm flex-col gap-1">
              <span className="text-[10.5px] font-black uppercase tracking-wider text-ink-muted">{t("insurer")}</span>
              <select
                value={payerId}
                onChange={(e) => setPickedPayer(e.target.value)}
                className="rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-bold text-ink outline-none focus:border-ink"
              >
                {insurers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {isAr ? p.nameAr || p.name : p.name}
                  </option>
                ))}
              </select>
            </label>

            <ApprovalDropZone payer={payer} onRead={onRead} />

            {/* --- uploaded, not saved ------------------------------------------------------- */}
            {waiting.length > 0 && (
              <section className="rounded-3xl border border-line bg-surface-subtle p-4">
                <p className="flex items-center gap-2 text-[12px] font-black uppercase tracking-wider text-ink">
                  <FileClock size={14} /> {t("unsavedTitle")}
                </p>
                <p className="mt-1 text-[12px] font-semibold text-ink-muted">{t("unsavedHint")}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {waiting.slice(0, 30).map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      disabled={!!rereading}
                      onClick={() => reread(row)}
                      className="inline-flex max-w-full items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[12.5px] font-bold text-ink transition-colors hover:border-ink disabled:cursor-wait disabled:opacity-60"
                    >
                      {rereading === row.id && <Loader2 size={13} className="animate-spin" />}
                      <span className="truncate" dir="ltr">
                        {fileNameOf(row.path)}
                      </span>
                      {row.uploadedAt > 0 && (
                        <span className="shrink-0 text-[11px] font-semibold text-ink-faint">
                          {new Date(row.uploadedAt).toLocaleDateString(isAr ? "ar-EG" : "en-GB", { day: "numeric", month: "short" })}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* --- a saved approval being corrected ------------------------------------------- */}
            {editing && insurers.find((p) => p.id === editing.claim.payerId) && (
              <div id="insurance-edit-card">
                <ApprovalConfirmCard
                  key={`edit-${editing.claim.id}`}
                  editing={editing.claim}
                  payer={insurers.find((p) => p.id === editing.claim.payerId)!}
                  docId=""
                  docPath={editing.claim.doc.path}
                  docUrl={editing.docUrl}
                  contentType={editing.claim.doc.contentType}
                  result={{
                    docId: "",
                    extraction: claimExtraction(editing.claim),
                    checks: [],
                    match: { kind: "exact", patientId: editing.claim.patientId },
                    duplicate: null,
                    inBin: null,
                    wording: {},
                  }}
                  typed={false}
                  patients={patients}
                  storedWording={storedWording}
                  onSaved={(claimId) => {
                    setEditing(null);
                    showToast(t("editedToast"), "success");
                    void showClaim(claimId);
                  }}
                  onDismiss={() => setEditing(null)}
                  onOpenClaim={(claimId) => void showClaim(claimId)}
                />
              </div>
            )}

            {/* --- cards waiting to be confirmed --------------------------------------------- */}
            {open.map((d) => {
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
                  result={d.result}
                  typed={d.typed}
                  patients={patients}
                  storedWording={storedWording}
                  onSaved={(claimId) => onSaved(d.docId, claimId)}
                  onDismiss={() => closeCard(d.docId)}
                  onOpenClaim={(claimId) => void showClaim(claimId)}
                />
              );
            })}

            {/* --- the monthly sheet --------------------------------------------------------- */}
            <ClaimsExportBar
              claims={claims}
              from={range.from}
              to={range.to}
              setRange={setRange}
              header={header}
              setHeader={setHeaderLine}
              wording={wording}
              onPatch={onPatch}
            />

            {/* --- the claims ---------------------------------------------------------------- */}
            <section className="space-y-3">
              <p className="text-[10.5px] font-black uppercase tracking-wider text-ink-muted">
                {t("claimsTitle")} · {range.from} → {range.to}
              </p>
              {claimsFailed && <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] font-bold text-rose-800">{t("claimsFailed")}</p>}
              <ClaimsTable claims={claims} loading={claimsLoading} onPatch={onPatch} onDelete={onDelete} onEdit={(c) => void openEdit(c)} highlightId={highlightId} payerName={payer?.name} appointments={claimAppointments} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default function InsurancePageGated() {
  return (
    <FeatureGate feature="insurance">
      <PermissionGuard permission="patients.edit">
        <InsurancePage />
      </PermissionGuard>
    </FeatureGate>
  );
}
