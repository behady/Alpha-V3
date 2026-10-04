"use client";

/**
 * The patient file's Insurance tab.
 *
 * Two things live here. The patient's membership with each insurer (read here, edited through the
 * patient's own edit modal, so there is one place that writes it). And every approval saved
 * against this patient, laid out like the insurer's sheet — approval number, date, one row per
 * service with count, requested and approved — plus the one column the sheet never shows: the
 * dentist who did each service. Picking a dentist on a line saves at once; picking one on the
 * first line of an approval prefills that approval's other lines, so the usual case is one click.
 * Beside it, each service's state (Completed / Planned / Ongoing), also saved at once; only
 * Completed services go on the insurer's sheet and into payroll.
 *
 * The patient's share is cash the desk takes at the counter. "Collect" posts it as one income row
 * in today's ledger and remembers the row on the claim, so it is counted once and never again.
 *
 * Reads only (`onSnapshot` on the claims, a one-off read of the dentists); every write goes
 * through /api/insurance/claims and /api/finance/ledger.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, doc, getDocs, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { ref, getDownloadURL } from "firebase/storage";
import { CalendarPlus, FileText, Loader2, Banknote, CheckCircle2, RefreshCw, RotateCcw, Send } from "lucide-react";
import { db, storage } from "@/lib/firebase";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { isAnyUnlocked } from "@/lib/featureCatalog";
import { CLAIMS_COLLECTION, LINE_STATUSES, lineStatusOf, parseClaim, type ClaimStatus, type InsuranceClaim, type LineStatus } from "@/lib/insurance/claims";
import { bookLineUrl, lineBooking, type LinkedAppointmentLite } from "@/lib/insurance/appointments";
import { readInsurance } from "@/lib/patientInsurance";
import { parsePayers, PRIVATE_PAYER_ID, type Payer } from "@/lib/payers";
import { isDentistStaff } from "@/lib/staffRoles";
import { collectPatientShare, patchClaim, recordInsurerPayment, InsuranceCallError, type ClaimPatch } from "./api";
import { STATE_KEY, tr, type TextKey } from "./text";
import { useWording } from "./useWording";

type Dentist = { id: string; name: string };

const STATUS: Record<ClaimStatus, { key: TextKey; pill: string }> = {
  approved: { key: "statusApproved", pill: "border-amber-200 bg-amber-50 text-amber-800" },
  treated: { key: "statusTreated", pill: "border-line bg-surface-subtle text-ink" },
  sent: { key: "statusSent", pill: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  cancelled: { key: "statusCancelled", pill: "border-line bg-surface-subtle text-ink-faint line-through" },
};

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export default function PatientInsuranceTab({ patientId, patient }: { patientId: string; patient: Record<string, unknown> }) {
  const { clinicId, clinic } = useClinic();
  const { language } = useLanguage();
  const isAr = language === "ar";
  const t = tr(isAr);
  const { confirm, showToast } = useUI();
  const wording = useWording(clinicId);

  const [payers, setPayers] = useState<Payer[]>([]);
  const [dentists, setDentists] = useState<Dentist[]>([]);
  const [claims, setClaims] = useState<InsuranceClaim[]>([]);
  /** This patient's appointments, for the Visit column: which approved service is booked, done, or neither. */
  const [appointments, setAppointments] = useState<LinkedAppointmentLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!clinicId) return;
    const stop = onSnapshot(
      query(collection(db, "clinics", clinicId, CLAIMS_COLLECTION), where("patientId", "==", patientId), orderBy("approvalDate", "desc")),
      (snap) => {
        setClaims(snap.docs.map((d) => parseClaim(d.id, d.data())).filter((c): c is InsuranceClaim => c !== null));
        setLoading(false);
      },
      (err) => {
        console.error("Patient insurance claims failed", err);
        setFailed(true);
        setLoading(false);
      },
    );
    const unsubPayers = onSnapshot(
      doc(db, "clinics", clinicId, "settings", "payers"),
      (snap) => setPayers(parsePayers(snap.data())),
      () => setPayers([]),
    );
    const unsubAppts = onSnapshot(
      query(collection(db, "clinics", clinicId, "appointments"), where("patientId", "==", patientId)),
      (snap) => setAppointments(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as LinkedAppointmentLite)),
      (err) => console.error("Patient appointments failed", err),
    );
    getDocs(collection(db, "clinics", clinicId, "staff"))
      .then((snap) =>
        setDentists(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
            .filter((s) => isDentistStaff(s as { role?: string; isDentist?: boolean }))
            .map((s) => ({ id: s.id, name: String((s as { name?: unknown }).name ?? "") }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        ),
      )
      .catch((err) => console.error("Dentist list failed", err));
    return () => {
      stop();
      unsubPayers();
      unsubAppts();
    };
  }, [clinicId, patientId]);

  const membership = useMemo(() => readInsurance(patient), [patient]);
  const insurers = useMemo(() => payers.filter((p) => p.id !== PRIVATE_PAYER_ID && p.active), [payers]);
  const payerName = (id: string) => {
    const p = payers.find((x) => x.id === id);
    return p ? (isAr ? p.nameAr || p.name : p.name) : id;
  };

  if (!clinic || !isAnyUnlocked(clinic, "insurance")) {
    return <p className="rounded-2xl border border-line bg-surface-subtle p-5 text-[13px] font-semibold text-ink-muted">{t("insuranceNotOn")}</p>;
  }

  const fail = (err: unknown, key: TextKey) => {
    const msg = err instanceof InsuranceCallError ? (err.kind === "signed_out" ? t("signedOut") : t("networkFailed")) : t(key);
    showToast(msg, "error");
  };

  const pickDentist = async (claim: InsuranceClaim, lineIndex: number, staffId: string) => {
    if (!clinicId) return;
    // The first line's pick fills the approval's other empty lines: one visit, one dentist, usually.
    const picks: Record<number, string | null> = { [lineIndex]: staffId || null };
    if (staffId && lineIndex === 0) {
      claim.lines.forEach((_, i) => {
        if (i !== 0 && !claim.dentists[i]) picks[i] = staffId;
      });
    }
    setBusy(claim.id);
    try {
      const error = await patchClaim(clinicId, claim.id, { dentists: picks });
      if (error) showToast(error, "error");
      else showToast(t("dentistSaved"), "success");
    } catch (err) {
      fail(err, "dentistFailed");
    } finally {
      setBusy(null);
    }
  };

  // A service's state (Completed / Planned / Ongoing): saved at once, and it follows into the
  // treatment row's note. Only Completed services go on the insurer's sheet and into payroll.
  const pickState = async (claim: InsuranceClaim, lineIndex: number, state: LineStatus) => {
    if (!clinicId || lineStatusOf(claim, lineIndex) === state) return;
    // The sheet already went to the insurer: changing a service's state changes what it showed.
    if (claim.status === "sent" && !(await confirm(t("sentWarning"), { confirmLabel: t("continue") }))) return;
    setBusy(claim.id);
    try {
      const error = await patchClaim(clinicId, claim.id, { lineStatus: { [lineIndex]: state } });
      if (error) showToast(error, "error");
      else showToast(t("updated"), "success");
    } catch (err) {
      fail(err, "updateFailed");
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (claim: InsuranceClaim, patch: ClaimPatch) => {
    if (!clinicId) return;
    if (claim.status === "sent" && !(await confirm(t("sentWarning"), { confirmLabel: t("continue") }))) return;
    setBusy(claim.id);
    try {
      const error = await patchClaim(clinicId, claim.id, patch);
      if (error) showToast(error, "error");
    } catch (err) {
      fail(err, "dentistFailed");
    } finally {
      setBusy(null);
    }
  };

  // Re-stamp every assigned line from the rates on file now: for the dentist whose percentage
  // was set after the lines were picked.
  const reapplyRates = async (claim: InsuranceClaim) => {
    if (!clinicId) return;
    const picks: Record<number, string | null> = {};
    for (const [k, d] of Object.entries(claim.dentists)) picks[Number(k)] = d.staffId;
    if (Object.keys(picks).length === 0) return;
    setBusy(claim.id);
    try {
      const error = await patchClaim(clinicId, claim.id, { dentists: picks });
      if (error) showToast(error, "error");
      else showToast(t("ratesReapplied"), "success");
    } catch (err) {
      fail(err, "dentistFailed");
    } finally {
      setBusy(null);
    }
  };

  const collect = async (claim: InsuranceClaim) => {
    if (!clinicId || claim.totals.patientShare <= 0 || claim.shareCollected) return;
    const amount = claim.totals.patientShare;
    const ok = await confirm(t("confirmShare").replace("{amount}", money(amount)).replace("{number}", claim.approvalNumber), { confirmLabel: t("collectShare") });
    if (!ok) return;
    setBusy(claim.id);
    try {
      const error = await collectPatientShare(clinicId, claim.id);
      if (error) showToast(error, "error");
      else showToast(t("shareCollectedToast"), "success");
    } catch (err) {
      fail(err, "shareFailed");
    } finally {
      setBusy(null);
    }
  };

  const insurerPaid = async (claim: InsuranceClaim) => {
    if (!clinicId || claim.insurerPaid) return;
    const ok = await confirm(
      t("confirmInsurerPaid").replace("{amount}", money(claim.totals.approved)).replace("{insurer}", payerName(claim.payerId)).replace("{number}", claim.approvalNumber),
      { confirmLabel: t("markInsurerPaid") },
    );
    if (!ok) return;
    setBusy(claim.id);
    try {
      const error = await recordInsurerPayment(clinicId, claim.id);
      if (error) showToast(error, "error");
      else showToast(t("insurerPaidToast"), "success");
    } catch (err) {
      fail(err, "insurerPaidFailed");
    } finally {
      setBusy(null);
    }
  };

  const openDoc = async (claim: InsuranceClaim) => {
    if (!claim.doc.path) {
      showToast(t("noDocument"), "error");
      return;
    }
    const win = window.open("", "_blank");
    try {
      const url = await getDownloadURL(ref(storage, claim.doc.path));
      if (win) {
        win.opener = null;
        win.location.href = url;
      } else window.location.assign(url);
    } catch (err) {
      console.error("Insurance document link failed", err);
      win?.close();
      showToast(t("noDocument"), "error");
    }
  };

  return (
    <div className="space-y-6">
      {/* --- membership ------------------------------------------------------------------------ */}
      <section className="rounded-2xl border border-line bg-surface p-5">
        <h3 className="text-[11px] font-black uppercase tracking-widest text-ink-muted">{t("tabMembership")}</h3>
        {insurers.length === 0 || Object.keys(membership).length === 0 ? (
          <p className="mt-3 text-[13px] font-semibold text-ink-muted">{t("noMembership")}</p>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {insurers
              .filter((p) => membership[p.id])
              .map((p) => {
                const m = membership[p.id];
                const fields: Array<[TextKey, string]> =
                  p.format === "metlife"
                    ? [
                        ["policyNumber", m.policyNumber || ""],
                        ["certificateNumber", m.certificateNumber || ""],
                        ["dependentCode", m.dependentCode || ""],
                      ]
                    : [["memberNumber", m.memberNumber]];
                return (
                  <div key={p.id} className="rounded-xl border border-line bg-surface-subtle p-4">
                    <p className="text-[13px] font-black text-ink">{isAr ? p.nameAr || p.name : p.name}</p>
                    <dl className="mt-2 grid grid-cols-3 gap-3">
                      {fields.map(([k, v]) => (
                        <div key={k}>
                          <dt className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">{t(k)}</dt>
                          <dd className="font-figure text-[15px] font-extrabold text-ink" dir="ltr">
                            {v || "—"}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                );
              })}
          </div>
        )}
      </section>

      {/* --- approvals, laid out like the sheet ------------------------------------------------ */}
      <section className="rounded-2xl border border-line bg-surface p-5">
        <h3 className="text-[11px] font-black uppercase tracking-widest text-ink-muted">{t("tabClaims")}</h3>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="animate-spin text-ink-muted" size={22} />
          </div>
        ) : failed ? (
          <p className="mt-3 text-[13px] font-semibold text-red-700">{t("claimsFailed")}</p>
        ) : claims.length === 0 ? (
          <p className="mt-3 text-[13px] font-semibold text-ink-muted">{t("noPatientClaims")}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[60rem] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-[10px] font-black uppercase tracking-wider text-ink-muted">
                  <th className="py-2 pe-3 text-start">{t("approvalNumber")}</th>
                  <th className="py-2 pe-3 text-start">{t("approvalDate")}</th>
                  <th className="py-2 pe-3 text-start">{t("colService")}</th>
                  <th className="py-2 pe-3 text-end">{t("colCount")}</th>
                  <th className="py-2 pe-3 text-end">{t("colRequested")}</th>
                  <th className="py-2 pe-3 text-end">{t("colApproved")}</th>
                  <th className="py-2 pe-3 text-start">{t("colDentist")}</th>
                  <th className="py-2 pe-3 text-start">{t("colState")}</th>
                  <th className="py-2 text-start">{t("colVisit")}</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => {
                  const status = STATUS[c.status];
                  const rows = c.lines.length;
                  const isBusy = busy === c.id;
                  return c.lines.map((line, i) => (
                    <tr key={`${c.id}-${i}`} className={i === rows - 1 ? "border-b border-line" : "border-b border-line/40"}>
                      {i === 0 && (
                        <>
                          <td rowSpan={rows} className="py-2.5 pe-3 align-top">
                            <p className="font-figure text-[14px] font-extrabold text-ink" dir="ltr">
                              {c.approvalNumber}
                            </p>
                            <p className="mt-0.5 text-[11px] font-semibold text-ink-muted">{payerName(c.payerId)}</p>
                            {/* One status per approval, as on the insurer's sheet: the paper is treated or sent as a whole. */}
                            <div className="mt-2 flex flex-wrap items-center gap-1.5" title={t("statusForApproval")}>
                              <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-black ${status.pill}`}>{t(status.key)}</span>
                              {(c.status === "approved" || c.status === "cancelled") && (
                                <button type="button" onClick={() => setStatus(c, { status: "treated" })} disabled={isBusy} title={t("markTreated")} className="rounded-lg border border-line p-1.5 text-ink-muted hover:text-ink disabled:opacity-40">
                                  <CheckCircle2 size={14} />
                                </button>
                              )}
                              {(c.status === "treated" || c.status === "sent") && (
                                <button type="button" onClick={() => setStatus(c, { status: "approved" })} disabled={isBusy} title={t("markNotTreated")} className="rounded-lg border border-line p-1.5 text-ink-muted hover:text-ink disabled:opacity-40">
                                  <RotateCcw size={14} />
                                </button>
                              )}
                              {c.status === "treated" && (
                                <button type="button" onClick={() => setStatus(c, { status: "sent" })} disabled={isBusy} title={t("markSent")} className="rounded-lg border border-line p-1.5 text-ink-muted hover:text-ink disabled:opacity-40">
                                  <Send size={14} />
                                </button>
                              )}
                              {isBusy && <Loader2 size={14} className="animate-spin text-ink-muted" />}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {Object.keys(c.dentists).length > 0 && (
                                <button type="button" onClick={() => reapplyRates(c)} disabled={isBusy} title={t("reapplyRates")} className="rounded-lg border border-line p-1.5 text-ink-muted hover:text-ink disabled:opacity-40">
                                  <RefreshCw size={14} />
                                </button>
                              )}
                              <button type="button" onClick={() => openDoc(c)} disabled={!c.doc.path} title={t("openPdf")} className="rounded-lg border border-line p-1.5 text-ink-muted hover:text-ink disabled:opacity-40">
                                <FileText size={14} />
                              </button>
                              {c.status !== "cancelled" && Object.keys(c.ledgerIds).length > 0 &&
                                (c.insurerPaid ? (
                                  <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-800">
                                    <CheckCircle2 size={12} /> {t("insurerPaidOn")} {c.insurerPaid.date}
                                  </span>
                                ) : (c.status === "treated" || c.status === "sent") && (
                                  <button type="button" onClick={() => insurerPaid(c)} disabled={isBusy} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface-subtle px-2 py-1 text-[11px] font-bold text-ink hover:bg-surface disabled:opacity-40">
                                    <Banknote size={12} /> {t("markInsurerPaid")} {money(c.totals.approved)}
                                  </button>
                                ))}
                              {c.totals.patientShare > 0 && c.status !== "cancelled" &&
                                (c.shareCollected ? (
                                  <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-800">
                                    <CheckCircle2 size={12} /> {t("shareCollectedOn")} {c.shareCollected.date}
                                  </span>
                                ) : (c.status === "treated" || c.status === "sent") && (
                                  <button type="button" onClick={() => collect(c)} disabled={isBusy} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface-subtle px-2 py-1 text-[11px] font-bold text-ink hover:bg-surface disabled:opacity-40">
                                    <Banknote size={12} /> {t("collectShare")} {money(c.totals.patientShare)}
                                  </button>
                                ))}
                            </div>
                          </td>
                          <td rowSpan={rows} className="py-2.5 pe-3 text-start align-top font-figure font-semibold text-ink-muted">
                            <bdi dir="ltr">{c.approvalDate}</bdi>
                          </td>
                        </>
                      )}
                      <td className="py-2.5 pe-3 font-semibold text-ink-body">{wording[line.code]?.trim() || line.description}</td>
                      <td className="py-2.5 pe-3 text-end font-figure font-bold tabular-nums">{line.unitsApproved}</td>
                      <td className="py-2.5 pe-3 text-end font-figure font-bold tabular-nums text-ink-muted">{money(line.grossTotal)}</td>
                      <td className="py-2.5 pe-3 text-end font-figure font-extrabold tabular-nums text-ink">{money(line.approvedAmount)}</td>
                      <td className="py-2 pe-3">
                        <div className="flex items-center gap-2">
                        <select
                          value={c.dentists[i]?.staffId ?? ""}
                          disabled={isBusy || c.status === "cancelled"}
                          onChange={(e) => pickDentist(c, i, e.target.value)}
                          className="w-full min-w-[9rem] rounded-lg border border-line bg-surface px-2 py-1.5 text-[12px] font-bold text-ink outline-none focus:border-ink disabled:opacity-50"
                        >
                          <option value="">{t("pickDentist")}</option>
                          {dentists.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                          {c.dentists[i] && !dentists.some((d) => d.id === c.dentists[i].staffId) && (
                            <option value={c.dentists[i].staffId}>{c.dentists[i].name}</option>
                          )}
                        </select>
                        {c.dentists[i] && (
                          <span
                            title={c.dentists[i].rate === 0 ? t("noRate") : undefined}
                            className={`shrink-0 font-figure text-[12px] font-extrabold tabular-nums ${c.dentists[i].rate === 0 ? "text-red-700" : "text-ink-muted"}`}
                          >
                            {c.dentists[i].rate}%
                          </span>
                        )}
                        </div>
                      </td>
                      <td className="py-2 pe-3">
                        <select
                          value={lineStatusOf(c, i)}
                          disabled={isBusy || c.status === "cancelled"}
                          onChange={(e) => pickState(c, i, e.target.value as LineStatus)}
                          aria-label={t("colState")}
                          className="w-full min-w-[7rem] rounded-lg border border-line bg-surface px-2 py-1.5 text-[12px] font-bold text-ink outline-none focus:border-ink disabled:opacity-50"
                        >
                          {LINE_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {t(STATE_KEY[s])}
                            </option>
                          ))}
                        </select>
                      </td>
                      {/* The calendar's view of this service: booked, done, or a Book button that opens the
                          booking page on this patient with this service and its dentist already picked. */}
                      <td className="py-2 text-[12px] font-semibold text-ink-muted">
                        {(() => {
                          const visit = lineBooking(appointments, c.id, i);
                          const open = c.status !== "cancelled" && lineStatusOf(c, i) !== "Completed";
                          if (visit.kind === "done") {
                            return (
                              <span className="inline-flex items-center gap-1 text-emerald-800" dir="ltr">
                                <CheckCircle2 size={12} /> {t("doneOn")} {visit.date}
                              </span>
                            );
                          }
                          if (visit.kind === "booked") {
                            return (
                              <span className="inline-flex flex-wrap items-center gap-x-1.5">
                                <span className="font-figure tabular-nums text-ink" dir="ltr">
                                  {t("bookedOn")} {visit.date} {visit.time}
                                </span>
                                {visit.doctor && <span>· {visit.doctor}</span>}
                                {open && (
                                  <Link href={bookLineUrl(patientId, { claimId: c.id, claimLine: i })} title={t("bookAnother")} className="rounded-lg border border-line p-1 text-ink-muted hover:text-ink">
                                    <CalendarPlus size={12} />
                                  </Link>
                                )}
                              </span>
                            );
                          }
                          if (!open) return <span>—</span>;
                          return (
                            <Link href={bookLineUrl(patientId, { claimId: c.id, claimLine: i })} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface-subtle px-2 py-1 text-[11px] font-bold text-ink hover:bg-surface">
                              <CalendarPlus size={12} /> {t("book")}
                            </Link>
                          );
                        })()}
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
