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
import { bookLineUrl, claimProgress, lineBooking, type LinkedAppointmentLite } from "@/lib/insurance/appointments";
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

  /** One labelled figure: the small grey caption above, the number big below. */
  const figure = (label: string, value: string) => (
    <div>
      <p className="text-[12px] font-bold text-ink-muted">{label}</p>
      <p className="mt-0.5 font-figure text-[19px] font-extrabold tabular-nums text-ink">
        <bdi dir="ltr">{value}</bdi>
      </p>
    </div>
  );
  // Every action carries its words, not just an icon: the desk should never hover to find a button.
  const actionBtn = "inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-bold text-ink transition-colors hover:bg-surface-subtle disabled:opacity-40";
  const doneChip = "inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[13px] font-bold text-emerald-800";
  const selectCls = "h-10 w-full rounded-lg border border-line bg-surface px-2.5 text-[14px] font-bold text-ink outline-none focus:border-ink disabled:opacity-50";

  return (
    <div className="space-y-6">
      {/* --- membership ------------------------------------------------------------------------ */}
      <section className="rounded-2xl border border-line bg-surface p-6">
        <h3 className="text-[17px] font-black text-ink">{t("tabMembership")}</h3>
        {insurers.length === 0 || Object.keys(membership).length === 0 ? (
          <p className="mt-3 text-[14px] font-semibold text-ink-muted">{t("noMembership")}</p>
        ) : (
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
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
                  <div key={p.id} className="rounded-xl border border-line bg-surface-subtle p-5">
                    <p className="text-[16px] font-black text-ink">{isAr ? p.nameAr || p.name : p.name}</p>
                    {/* The value sits straight under its label: the number is isolated as left-to-right
                        text, but the cell keeps the page's direction, so both line up at the same edge. */}
                    <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                      {fields.map(([k, v]) => (
                        <div key={k}>
                          <dt className="text-[13px] font-bold text-ink-muted">{t(k)}</dt>
                          <dd className="mt-1 font-figure text-[20px] font-extrabold text-ink">
                            <bdi dir="ltr">{v || "—"}</bdi>
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

      {/* --- approvals: one card per approval paper -------------------------------------------- */}
      <section className="rounded-2xl border border-line bg-surface p-6">
        <h3 className="text-[17px] font-black text-ink">
          {t("tabClaims")}
          {claims.length > 0 && <span className="ms-2 font-figure text-[15px] font-bold text-ink-muted">({claims.length})</span>}
        </h3>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="animate-spin text-ink-muted" size={22} />
          </div>
        ) : failed ? (
          <p className="mt-3 text-[14px] font-semibold text-red-700">{t("claimsFailed")}</p>
        ) : claims.length === 0 ? (
          <p className="mt-3 text-[14px] font-semibold text-ink-muted">{t("noPatientClaims")}</p>
        ) : (
          <div className="mt-4 space-y-5">
            {claims.map((c) => {
              const status = STATUS[c.status];
              const isBusy = busy === c.id;
              const progress = claimProgress(c, appointments);
              return (
                <article key={c.id} className="overflow-hidden rounded-xl border border-line">
                  {/* The paper itself: its number, insurer and date, and what it is worth. */}
                  <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-line bg-surface-subtle px-5 py-4">
                    <div>
                      <p className="text-[12px] font-bold text-ink-muted">{t("approvalNumber")}</p>
                      <p className="mt-0.5 font-figure text-[22px] font-extrabold text-ink">
                        <bdi dir="ltr">{c.approvalNumber}</bdi>
                      </p>
                      <p className="mt-1 text-[14px] font-semibold text-ink-body">
                        {payerName(c.payerId)} · <bdi dir="ltr" className="font-figure">{c.approvalDate}</bdi>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                      {figure(t("approvedTotal"), money(c.totals.approved))}
                      {c.totals.patientShare > 0 && figure(t("share"), money(c.totals.patientShare))}
                      <div>
                        <p className="text-[12px] font-bold text-ink-muted">
                          {t("progress").replace("{done}", String(progress.done)).replace("{total}", String(progress.total)).replace("{booked}", String(progress.booked))}
                        </p>
                        {/* One status per approval, as on the insurer's sheet: the paper is treated or sent as a whole. */}
                        <span title={t("statusForApproval")} className={`mt-1 inline-block rounded-full border px-3 py-1 text-[13px] font-black ${status.pill}`}>
                          {t(status.key)}
                        </span>
                      </div>
                    </div>
                  </header>

                  {/* What can be done to the paper as a whole. */}
                  <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
                    <button type="button" onClick={() => openDoc(c)} disabled={!c.doc.path} className={actionBtn}>
                      <FileText size={15} /> {t("openPdf")}
                    </button>
                    {(c.status === "approved" || c.status === "cancelled") && (
                      <button type="button" onClick={() => setStatus(c, { status: "treated" })} disabled={isBusy} className={actionBtn}>
                        <CheckCircle2 size={15} /> {t("markTreated")}
                      </button>
                    )}
                    {c.status === "treated" && (
                      <button type="button" onClick={() => setStatus(c, { status: "sent" })} disabled={isBusy} className={actionBtn}>
                        <Send size={15} /> {t("markSent")}
                      </button>
                    )}
                    {c.status !== "cancelled" && Object.keys(c.ledgerIds).length > 0 &&
                      (c.insurerPaid ? (
                        <span className={doneChip}>
                          <CheckCircle2 size={15} /> {t("insurerPaidOn")} <bdi dir="ltr">{c.insurerPaid.date}</bdi>
                        </span>
                      ) : (c.status === "treated" || c.status === "sent") && (
                        <button type="button" onClick={() => insurerPaid(c)} disabled={isBusy} className={actionBtn}>
                          <Banknote size={15} /> {t("markInsurerPaid")} <bdi dir="ltr" className="font-figure">{money(c.totals.approved)}</bdi>
                        </button>
                      ))}
                    {c.totals.patientShare > 0 && c.status !== "cancelled" &&
                      (c.shareCollected ? (
                        <span className={doneChip}>
                          <CheckCircle2 size={15} /> {t("shareCollectedOn")} <bdi dir="ltr">{c.shareCollected.date}</bdi>
                        </span>
                      ) : (c.status === "treated" || c.status === "sent") && (
                        <button type="button" onClick={() => collect(c)} disabled={isBusy} className={actionBtn}>
                          <Banknote size={15} /> {t("collectShare")} <bdi dir="ltr" className="font-figure">{money(c.totals.patientShare)}</bdi>
                        </button>
                      ))}
                    {Object.keys(c.dentists).length > 0 && (
                      <button type="button" onClick={() => reapplyRates(c)} disabled={isBusy} className={actionBtn}>
                        <RefreshCw size={15} /> {t("reapplyRates")}
                      </button>
                    )}
                    {(c.status === "treated" || c.status === "sent") && (
                      <button type="button" onClick={() => setStatus(c, { status: "approved" })} disabled={isBusy} className={`${actionBtn} text-ink-muted`}>
                        <RotateCcw size={15} /> {t("markNotTreated")}
                      </button>
                    )}
                    {isBusy && <Loader2 size={16} className="animate-spin text-ink-muted" />}
                  </div>

                  {/* The services on the paper, one row each. */}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[60rem] border-collapse text-[14px]">
                      <thead>
                        <tr className="border-b border-line text-[12px] font-bold text-ink-muted">
                          <th className="px-5 py-2.5 text-start">{t("colService")}</th>
                          <th className="px-3 py-2.5 text-end">{t("colCount")}</th>
                          <th className="px-3 py-2.5 text-end">{t("colRequested")}</th>
                          <th className="px-3 py-2.5 text-end">{t("colApproved")}</th>
                          <th className="px-3 py-2.5 text-start">{t("colDentist")}</th>
                          <th className="px-3 py-2.5 text-start">{t("colState")}</th>
                          <th className="px-5 py-2.5 text-start">{t("colVisit")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.lines.map((line, i) => {
                          const visit = lineBooking(appointments, c.id, i);
                          const open = c.status !== "cancelled" && lineStatusOf(c, i) !== "Completed";
                          const bookHref = bookLineUrl(patientId, { claimId: c.id, claimLine: i });
                          return (
                            <tr key={`${c.id}-${i}`} className="border-b border-line/50 last:border-b-0">
                              <td className="px-5 py-3 text-[15px] font-bold text-ink">{wording[line.code]?.trim() || line.description}</td>
                              <td className="px-3 py-3 text-end font-figure text-[15px] font-bold tabular-nums text-ink">{line.unitsApproved}</td>
                              <td className="px-3 py-3 text-end font-figure text-[15px] font-bold tabular-nums text-ink-muted">{money(line.grossTotal)}</td>
                              <td className="px-3 py-3 text-end font-figure text-[16px] font-extrabold tabular-nums text-ink">{money(line.approvedAmount)}</td>
                              <td className="px-3 py-2.5">
                                <div className="flex items-center gap-2">
                                  <select
                                    value={c.dentists[i]?.staffId ?? ""}
                                    disabled={isBusy || c.status === "cancelled"}
                                    onChange={(e) => pickDentist(c, i, e.target.value)}
                                    aria-label={t("colDentist")}
                                    className={`${selectCls} min-w-[10rem]`}
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
                                      className={`shrink-0 font-figure text-[14px] font-extrabold tabular-nums ${c.dentists[i].rate === 0 ? "text-red-700" : "text-ink-muted"}`}
                                    >
                                      {c.dentists[i].rate}%
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2.5">
                                <select
                                  value={lineStatusOf(c, i)}
                                  disabled={isBusy || c.status === "cancelled"}
                                  onChange={(e) => pickState(c, i, e.target.value as LineStatus)}
                                  aria-label={t("colState")}
                                  className={`${selectCls} min-w-[8rem]`}
                                >
                                  {LINE_STATUSES.map((s) => (
                                    <option key={s} value={s}>
                                      {t(STATE_KEY[s])}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              {/* The calendar's view of this service: done, booked, or a Book button that opens
                                  the dashboard's booking popup on this patient with this service picked. */}
                              <td className="px-5 py-2.5 text-[14px] font-semibold text-ink-body">
                                {visit.kind === "done" ? (
                                  <span className="inline-flex items-center gap-1.5 font-bold text-emerald-800">
                                    <CheckCircle2 size={15} /> {t("doneOn")} <bdi dir="ltr" className="font-figure">{visit.date}</bdi>
                                  </span>
                                ) : visit.kind === "booked" ? (
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="font-bold text-ink">
                                      {t("bookedOn")} <bdi dir="ltr" className="font-figure tabular-nums">{visit.date} {visit.time}</bdi>
                                    </span>
                                    {visit.doctor && <span className="text-ink-muted">· {visit.doctor}</span>}
                                    {open && (
                                      <Link href={bookHref} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2 text-[12px] font-bold text-ink-muted hover:text-ink">
                                        <CalendarPlus size={13} /> {t("bookAnother")}
                                      </Link>
                                    )}
                                  </div>
                                ) : !open ? (
                                  <span className="text-ink-faint">—</span>
                                ) : (
                                  <Link href={bookHref} className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-[14px] font-bold text-ink-on-accent shadow-sm transition-colors hover:bg-accent-strong">
                                    <CalendarPlus size={16} /> {t("book")}
                                  </Link>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
