"use client";

import React, { useState } from "react";
import { auth } from "@/lib/firebase";
import {
  AlertTriangle, ArrowRight, CheckCircle2, Copy, Database, FileWarning,
  HardDriveDownload, Images, Loader2, Lock, ShieldCheck, Upload, Users, XCircle,
} from "lucide-react";
import type { Clinic } from "@/types/saas";

/**
 * Migrate one clinic from its own v2 Firebase project into this one.
 *
 * v2 gave every clinic a separate project, so onboarding an existing clinic to the SaaS means
 * copying its whole database in as a tenant. That is a repeated job — every clinic still on v2
 * needs it — so it belongs behind a button rather than in a terminal.
 *
 * The screen is deliberately a numbered sequence rather than one "Migrate" button. Each stage
 * shows what it is about to do and waits, because the operator is the only one who can tell
 * whether the numbers look right for that clinic, and because the steps genuinely have to happen
 * in order: data first, then logins, then files.
 *
 * Nothing here writes to the clinic's existing database — the server opens it read-only. The old
 * system keeps running as the clinic's live system throughout, so a run can be rehearsed as often
 * as needed and a bad run is fixed by clearing the target and going again.
 */

type PlanEntry = {
  name: string;
  action: "copy" | "skip";
  reason?: string;
  target?: string;
  count: number;
  known: boolean;
  noConsumer?: string;
};

type StaffPerson = { staffDocId: string; email: string; name: string; role: string };
type StaffResult = { email: string; name: string; role: string; uid: string; created: boolean; resetLink?: string };
type CheckRow = { label: string; status: "ok" | "fail" | "warn" | "info"; detail: string };
type VerifyReport = { counts: CheckRow[]; samples: CheckRow[]; links: CheckRow[]; staff: CheckRow[]; failures: number };

type Stage = "idle" | "running" | "done" | "error";

export function MigrateTab({ clinics }: { clinics: Clinic[] }) {
  const [clinicId, setClinicId] = useState("");
  const [credentials, setCredentials] = useState<Record<string, unknown> | null>(null);
  const [keyFileName, setKeyFileName] = useState("");

  const [plan, setPlan] = useState<PlanEntry[] | null>(null);
  const [sourceProject, setSourceProject] = useState("");
  const [allowUnknown, setAllowUnknown] = useState(false);

  const [copyStage, setCopyStage] = useState<Stage>("idle");
  const [copyProgress, setCopyProgress] = useState("");
  const [copySummary, setCopySummary] = useState<string[]>([]);
  const [conflicts, setConflicts] = useState<string[]>([]);

  const [staffPeople, setStaffPeople] = useState<StaffPerson[] | null>(null);
  const [staffNoEmail, setStaffNoEmail] = useState<{ name: string }[]>([]);
  const [staffResults, setStaffResults] = useState<StaffResult[] | null>(null);
  const [adminEmail, setAdminEmail] = useState("");

  const [filesStage, setFilesStage] = useState<Stage>("idle");
  const [filesProgress, setFilesProgress] = useState("");
  const [filesSummary, setFilesSummary] = useState<string[]>([]);

  const [report, setReport] = useState<VerifyReport | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function call(action: string, extra: Record<string, unknown> = {}) {
    const token = await auth.currentUser?.getIdToken();
    const response = await fetch("/api/admin/migration", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, clinicId, credentials, ...extra }),
    });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || "Something went wrong");
    return json;
  }

  function onKeyFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setCredentials(JSON.parse(String(reader.result)));
        setKeyFileName(file.name);
        setError("");
      } catch {
        setError("That file is not a valid service account JSON file.");
      }
    };
    reader.readAsText(file);
  }

  async function handleCheck() {
    setBusy("check");
    setError("");
    setPlan(null);
    try {
      const json = await call("plan");
      setPlan(json.plan);
      setSourceProject(json.sourceProject);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  /**
   * Drive the copy loop. The server returns after a time-boxed slice and hands back the state to
   * continue from, so a big clinic is many short requests instead of one that times out.
   */
  async function handleCopy(commit: boolean) {
    if (!plan) return;
    setCopyStage("running");
    setError("");
    setCopySummary([]);
    setConflicts([]);

    try {
      const collections = plan.filter((entry) => entry.action === "copy").map((entry) => entry.name);
      let state: unknown = null;
      let guard = 0;

      for (;;) {
        // A runaway loop here would hammer the API, so cap it well above any real clinic.
        if (guard++ > 2000) throw new Error("Stopped after too many steps — tell your developer.");

        const json: { state: { completed: string[]; pending: string[]; stats: Record<string, number>; conflicts: string[] }; done: boolean } =
          await call("copy", { state, collections, commit, overwrite: false });
        state = json.state;

        const done = json.state.completed.length;
        const total = done + json.state.pending.length;
        setCopyProgress(
          `${done} of ${total} sections — ${json.state.stats.read.toLocaleString()} records read`
        );

        if (json.done) {
          const stats = json.state.stats;
          setCopySummary([
            `${stats.read.toLocaleString()} records read`,
            `${stats.written.toLocaleString()} records ${commit ? "copied" : "ready to copy"}`,
            stats.refsRemapped ? `${stats.refsRemapped} internal links repointed` : "",
            stats.storageUrls ? `${stats.storageUrls} photo/x-ray links found (step 4 copies these)` : "",
          ].filter(Boolean));
          setConflicts(json.state.conflicts || []);
          setCopyStage("done");
          break;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCopyStage("error");
    }
  }

  async function handleStaffPreview() {
    setBusy("staff");
    setError("");
    try {
      const json = await call("staff-preview", { adminEmail });
      setStaffPeople(json.people);
      setStaffNoEmail(json.noEmail || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function handleStaffLink() {
    setBusy("staff-link");
    setError("");
    try {
      const json = await call("staff-link", { adminEmail, resetLinks: true });
      setStaffResults(json.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function handleFiles(commit: boolean) {
    setFilesStage("running");
    setError("");
    setFilesSummary([]);
    try {
      let state: unknown = null;
      let guard = 0;

      for (;;) {
        if (guard++ > 2000) throw new Error("Stopped after too many steps — tell your developer.");

        const json: { state: { completed: string[]; pending: string[]; scanned: number; copied: number; alreadyThere: number; missing: string[]; documentsUpdated: number }; done: boolean } =
          await call("storage", { state, commit });
        state = json.state;

        setFilesProgress(
          `${json.state.completed.length} of ${json.state.completed.length + json.state.pending.length} sections — ${json.state.copied} files copied`
        );

        if (json.done) {
          setFilesSummary([
            `${json.state.copied} files ${commit ? "copied" : "ready to copy"}`,
            json.state.alreadyThere ? `${json.state.alreadyThere} already here` : "",
            `${json.state.documentsUpdated} records ${commit ? "updated" : "would be updated"}`,
            json.state.missing.length
              ? `${json.state.missing.length} files were already missing in the old system (left alone)`
              : "",
          ].filter(Boolean));
          setFilesStage("done");
          break;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setFilesStage("error");
    }
  }

  async function handleVerify() {
    setBusy("verify");
    setError("");
    setReport(null);
    try {
      const json = await call("verify", { sample: 25 });
      setReport(json.report);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const ready = Boolean(clinicId && credentials);
  const unknowns = (plan || []).filter((entry) => entry.action === "copy" && !entry.known);
  const gaps = (plan || []).filter((entry) => entry.noConsumer && entry.count > 0);
  const blockedByUnknown = unknowns.length > 0 && !allowUnknown;

  return (
    <div className="space-y-6 max-w-5xl">
      <Callout>
        <p className="font-bold text-white mb-1">This copies a clinic in. It never changes their old system.</p>
        <p>
          The clinic&apos;s existing database is opened read-only, so they keep working normally in the
          old system while you do this. Nothing is written until you press a button that says so, and
          you can run these steps as many times as you like.
        </p>
      </Callout>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-sm">
          <XCircle size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Step number={1} title="Choose the clinic and the old key file" icon={<Database size={18} />}>
        <label className="block text-xs font-bold text-slate-400 mb-2">Clinic in this system</label>
        <select
          value={clinicId}
          onChange={(event) => {
            setClinicId(event.target.value);
            setPlan(null);
          }}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white mb-4"
        >
          <option value="">— pick a clinic —</option>
          {clinics.map((clinic) => (
            <option key={clinic.id} value={clinic.id}>
              {clinic.name} ({clinic.id})
            </option>
          ))}
        </select>

        <label className="block text-xs font-bold text-slate-400 mb-2">
          The old project&apos;s service account file (.json)
        </label>
        <label className="flex items-center gap-3 px-4 py-3 rounded-lg border border-dashed border-slate-600 hover:border-indigo-500 cursor-pointer text-sm text-slate-300">
          <Upload size={16} />
          {keyFileName || "Choose file…"}
          <input type="file" accept="application/json,.json" onChange={onKeyFile} className="hidden" />
        </label>
        <p className="text-xs text-slate-500 mt-2 flex items-start gap-2">
          <Lock size={13} className="mt-0.5 shrink-0" />
          <span>
            In the clinic&apos;s old Firebase project: Project settings → Service accounts → Generate new
            private key. Give that account only the <em>Viewer</em> roles for Firestore and Storage, and
            it cannot change their data even by accident. The file is used for this session only and is
            never saved anywhere.
          </span>
        </p>

        <button
          onClick={handleCheck}
          disabled={!ready || busy === "check"}
          className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 text-white text-sm font-bold"
        >
          {busy === "check" ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
          Check what is there
        </button>
      </Step>

      {plan && (
        <Step number={2} title="Look at what will move" icon={<HardDriveDownload size={18} />}>
          <p className="text-xs text-slate-400 mb-3">
            Reading <span className="font-mono text-slate-300">{sourceProject}</span>. Nothing has been
            copied yet.
          </p>

          <div className="rounded-lg border border-slate-700 overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {plan.map((entry) => (
                  <tr key={entry.name} className="border-b border-slate-800 last:border-0">
                    <td className="px-3 py-2 font-mono text-slate-300">{entry.name}</td>
                    <td className="px-3 py-2 text-right text-slate-400 tabular-nums">
                      {entry.count.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {entry.action === "skip" ? (
                        <span className="text-slate-500">handled in step 3</span>
                      ) : !entry.known ? (
                        <span className="text-amber-400">not recognised</span>
                      ) : entry.noConsumer ? (
                        <span className="text-amber-400">no v3 feature reads this</span>
                      ) : (
                        <span className="text-emerald-400">will copy</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {gaps.length > 0 && (
            <Warning icon={<FileWarning size={16} />}>
              <p className="font-bold mb-1">Some data has no home in v3 yet.</p>
              <p>
                {gaps.map((entry) => entry.name).join(", ")} will be copied and kept safe, but no screen
                in v3 shows it. If this clinic uses those features, tell them before you switch them
                over — for them a feature is disappearing, not just data.
              </p>
            </Warning>
          )}

          {unknowns.length > 0 && (
            <Warning icon={<AlertTriangle size={16} />}>
              <p className="font-bold mb-1">Something unfamiliar is in this database.</p>
              <p className="mb-2">
                {unknowns.map((entry) => entry.name).join(", ")} — this system has never seen these
                before. It is probably old leftover data, but someone should look before it is copied.
              </p>
              <label className="flex items-center gap-2 text-slate-200">
                <input
                  type="checkbox"
                  checked={allowUnknown}
                  onChange={(event) => setAllowUnknown(event.target.checked)}
                />
                I have checked — copy them anyway
              </label>
            </Warning>
          )}

          <div className="flex flex-wrap gap-3 mt-4">
            <button
              onClick={() => handleCopy(false)}
              disabled={copyStage === "running" || blockedByUnknown}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white text-sm font-bold"
            >
              {copyStage === "running" ? <Loader2 size={16} className="animate-spin" /> : null}
              Practice run (writes nothing)
            </button>
            <button
              onClick={() => handleCopy(true)}
              disabled={copyStage === "running" || blockedByUnknown}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-bold"
            >
              {copyStage === "running" ? <Loader2 size={16} className="animate-spin" /> : null}
              Copy the data for real
            </button>
          </div>

          {copyStage === "running" && <Progress text={copyProgress} />}
          {copyStage === "done" && <Summary lines={copySummary} />}

          {conflicts.length > 0 && (
            <Warning icon={<ShieldCheck size={16} />}>
              <p className="font-bold mb-1">
                {conflicts.length} records were left alone on purpose.
              </p>
              <p>
                These already existed here and were not put there by a migration — they look like work
                someone did in v3 after the clinic switched over. They were not overwritten with the
                older copy.
              </p>
            </Warning>
          )}
        </Step>
      )}

      {copyStage === "done" && (
        <Step number={3} title="Staff logins" icon={<Users size={18} />}>
          <Warning icon={<AlertTriangle size={16} />}>
            <p className="font-bold mb-1">Old passwords will not work.</p>
            <p>
              Firebase will not hand over anyone&apos;s password, so each person gets a link to set a new
              one. Tell the clinic before their first morning on v3, not on it.
            </p>
          </Warning>

          <label className="block text-xs font-bold text-slate-400 mt-4 mb-2">
            Who owns this clinic? (their email becomes the Admin)
          </label>
          <input
            value={adminEmail}
            onChange={(event) => setAdminEmail(event.target.value)}
            placeholder="owner@clinic.com"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
          />

          <div className="flex flex-wrap gap-3 mt-4">
            <button
              onClick={handleStaffPreview}
              disabled={busy === "staff"}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white text-sm font-bold"
            >
              {busy === "staff" ? <Loader2 size={16} className="animate-spin" /> : null}
              Show me the staff list
            </button>
            {staffPeople && (
              <button
                onClick={handleStaffLink}
                disabled={busy === "staff-link"}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-bold"
              >
                {busy === "staff-link" ? <Loader2 size={16} className="animate-spin" /> : null}
                Create their logins
              </button>
            )}
          </div>

          {staffPeople && !staffResults && (
            <div className="mt-4 rounded-lg border border-slate-700 overflow-hidden">
              {staffPeople.map((person) => (
                <div key={person.staffDocId} className="flex justify-between px-3 py-2 border-b border-slate-800 last:border-0 text-sm">
                  <span className="text-slate-300">{person.name}</span>
                  <span className="text-slate-500">{person.email}</span>
                  <span className={person.role === "Admin" ? "text-indigo-400 font-bold" : "text-slate-400"}>
                    {person.role}
                  </span>
                </div>
              ))}
            </div>
          )}

          {staffNoEmail.length > 0 && (
            <Warning icon={<AlertTriangle size={16} />}>
              <p>
                {staffNoEmail.map((person) => person.name).join(", ")} have no email address, so they
                cannot get a login. Their staff record still moved across — add an email in v3 and
                invite them normally.
              </p>
            </Warning>
          )}

          {staffResults && (
            <div className="mt-4">
              <p className="text-sm text-emerald-400 font-bold mb-2">
                Done. Send each person their own link — privately, not in a group chat.
              </p>
              <div className="space-y-2">
                {staffResults.map((person) => (
                  <div key={person.uid} className="p-3 rounded-lg bg-slate-900 border border-slate-700">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-white font-bold">{person.name}</span>
                      <span className="text-xs text-slate-500">
                        {person.email} · {person.role} · {person.created ? "new login" : "already existed"}
                      </span>
                    </div>
                    {person.resetLink && (
                      <button
                        onClick={() => navigator.clipboard.writeText(person.resetLink as string)}
                        className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300"
                      >
                        <Copy size={12} /> Copy password link
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Step>
      )}

      {copyStage === "done" && (
        <Step number={4} title="Photos and x-rays" icon={<Images size={18} />}>
          <Warning icon={<AlertTriangle size={16} />}>
            <p className="font-bold mb-1">Do not skip this one.</p>
            <p>
              The records only store a <em>link</em> to each image, not the image. Until this runs,
              every x-ray still loads from the clinic&apos;s old project — and the day that project is
              deleted, their whole imaging history disappears with it.
            </p>
          </Warning>

          <div className="flex flex-wrap gap-3 mt-4">
            <button
              onClick={() => handleFiles(false)}
              disabled={filesStage === "running"}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white text-sm font-bold"
            >
              {filesStage === "running" ? <Loader2 size={16} className="animate-spin" /> : null}
              Practice run (writes nothing)
            </button>
            <button
              onClick={() => handleFiles(true)}
              disabled={filesStage === "running"}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-bold"
            >
              {filesStage === "running" ? <Loader2 size={16} className="animate-spin" /> : null}
              Copy the files for real
            </button>
          </div>

          {filesStage === "running" && <Progress text={filesProgress} />}
          {filesStage === "done" && <Summary lines={filesSummary} />}
        </Step>
      )}

      {copyStage === "done" && (
        <Step number={5} title="Check everything arrived" icon={<CheckCircle2 size={18} />}>
          <p className="text-sm text-slate-400 mb-3">
            Compares both systems record by record, and checks that appointments still find their
            patients. Run this before you let the clinic start working here.
          </p>
          <button
            onClick={handleVerify}
            disabled={busy === "verify"}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 text-white text-sm font-bold"
          >
            {busy === "verify" ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            Run the checks
          </button>

          {report && (
            <div className="mt-4 space-y-4">
              <div
                className={`p-4 rounded-xl border text-sm font-bold ${
                  report.failures
                    ? "bg-red-500/10 border-red-500/30 text-red-200"
                    : "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                }`}
              >
                {report.failures
                  ? `${report.failures} problems found — do not switch this clinic over yet.`
                  : "Everything checks out."}
              </div>

              <CheckGroup title="Record counts" rows={report.counts} />
              <CheckGroup title="Spot checks" rows={report.samples} />
              <CheckGroup title="Links between records" rows={report.links} />
              <CheckGroup title="Staff logins" rows={report.staff} />
            </div>
          )}
        </Step>
      )}

      {report && report.failures === 0 && (
        <Callout>
          <p className="font-bold text-white mb-1">Last thing: leave the old system alone, running.</p>
          <p>
            Do not delete the clinic&apos;s old Firebase project for at least a few weeks. It is the only
            copy of anything this missed, and deleting it is the one step here with no way back.
          </p>
        </Callout>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ small presentational bits */

function Step({ number, title, icon, children }: { number: number; title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-800/40 p-5">
      <h3 className="flex items-center gap-3 text-white font-bold mb-4">
        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-indigo-500 text-white text-sm">
          {number}
        </span>
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-sm text-indigo-100">
      <ShieldCheck size={18} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

function Warning({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 p-4 mt-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-sm text-amber-100">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>{children}</div>
    </div>
  );
}

function Progress({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 mt-4 text-sm text-slate-300">
      <Loader2 size={14} className="animate-spin" />
      {text || "Starting…"}
    </p>
  );
}

function Summary({ lines }: { lines: string[] }) {
  return (
    <ul className="mt-4 space-y-1">
      {lines.map((line) => (
        <li key={line} className="flex items-center gap-2 text-sm text-slate-300">
          <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
          {line}
        </li>
      ))}
    </ul>
  );
}

function CheckGroup({ title, rows }: { title: string; rows: CheckRow[] }) {
  if (!rows.length) return null;
  const tone = {
    ok: "text-emerald-400",
    fail: "text-red-400",
    warn: "text-amber-400",
    info: "text-slate-500",
  };
  return (
    <div>
      <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">{title}</p>
      <div className="rounded-lg border border-slate-700 overflow-hidden">
        {rows.map((row) => (
          <div key={`${title}-${row.label}`} className="flex justify-between gap-4 px-3 py-1.5 border-b border-slate-800 last:border-0 text-sm">
            <span className="text-slate-300 font-mono text-xs">{row.label}</span>
            <span className={`${tone[row.status]} text-xs text-right`}>{row.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
