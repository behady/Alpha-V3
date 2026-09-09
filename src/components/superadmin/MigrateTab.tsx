"use client";

import React, { useMemo, useState } from "react";
import { auth } from "@/lib/firebase";
import {
  AlertTriangle, ArrowRight, CheckCircle2, Copy, Database, FileWarning,
  HardDriveDownload, Images, Loader2, Lock, ShieldCheck, Upload, Users, XCircle,
} from "lucide-react";
import type { Clinic } from "@/types/saas";

/**
 * Migrate one clinic from v2 into this system as a tenant.
 *
 * Normal path: the clinic's Admin presses "Download backup" in their old v2 app and hands the
 * file over; it is uploaded here and this screen does the rest. No Firebase keys travel at all —
 * the file is the thing that moves, and the old system is never touched.
 *
 * Fallback path: the same file input also accepts a service-account key for the old project
 * (auto-detected), for a clinic whose v2 app never got the Backup button. That project is opened
 * strictly read-only.
 *
 * Either way the screen is a numbered sequence rather than one big button: each stage shows what
 * it is about to do and waits, because the operator is the only one who can tell whether the
 * numbers look right for that clinic, and the stages genuinely must run in order — data, then
 * logins, then files.
 */

type BackupFile = {
  format: string;
  projectId: string;
  storageBucket: string;
  clinicName?: string;
  exportedAt?: string;
  docs: { path: string; data: unknown }[];
};

/** Root collections only v3 has. A backup containing them was taken from the wrong system. */
const V3_ONLY_ROOTS = new Set(["clinics", "join_requests", "clinic_secrets"]);

type PlanEntry = {
  name: string;
  action: "copy" | "skip";
  reason?: string;
  count: number;
  known: boolean;
  noConsumer?: string;
};

type StaffPerson = { staffDocId: string; email: string; name: string; role: string };
type StaffResult = { email: string; name: string; role: string; uid: string; created: boolean; resetLink?: string };
type CheckRow = { label: string; status: "ok" | "fail" | "warn" | "info"; detail: string };
type VerifyReport = { counts: CheckRow[]; samples: CheckRow[]; links: CheckRow[]; staff: CheckRow[]; failures: number };

type Stage = "idle" | "running" | "done" | "error";

const IMPORT_CHUNK = 200;

/** Collection path of a backup document: its path minus the final (document id) segment. */
const collectionOf = (path: string) => path.split("/").slice(0, -1).join("/");

export function MigrateTab({ clinics }: { clinics: Clinic[] }) {
  const [clinicId, setClinicId] = useState("");
  /** "new": v3 makes the clinic from the file. "existing": land in a clinic that already exists. */
  const [clinicMode, setClinicMode] = useState<"new" | "existing">("new");
  const [newClinicName, setNewClinicName] = useState("");
  const [createdClinic, setCreatedClinic] = useState<{ clinicId: string; name: string; reused: boolean } | null>(null);
  const [staffOwner, setStaffOwner] = useState<{ email: string; name: string; promoted: boolean } | null>(null);
  const [mode, setMode] = useState<"backup" | "keyfile" | null>(null);
  const [backup, setBackup] = useState<BackupFile | null>(null);
  const [credentials, setCredentials] = useState<Record<string, unknown> | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  /** Set the instant a file is chosen: a large backup takes seconds to read and parse. */
  const [reading, setReading] = useState<{ name: string; size: number } | null>(null);

  const [plan, setPlan] = useState<PlanEntry[] | null>(null);
  const [sourceProject, setSourceProject] = useState("");
  const [reroutedPaths, setReroutedPaths] = useState<string[]>([]);
  const [runId, setRunId] = useState("");
  const [allowUnknown, setAllowUnknown] = useState(false);

  const [copyStage, setCopyStage] = useState<Stage>("idle");
  /**
   * Whether step 2 has actually written. Steps 3-5 used to unlock on any finished copy, practice
   * runs included -- so the files step could scan a clinic whose records were never copied, find
   * nothing, and report "no images" as though that were a fact about the clinic.
   */
  const [copyCommitted, setCopyCommitted] = useState(false);
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
      body: JSON.stringify({ action, clinicId, ...extra }),
    });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || "Something went wrong");
    return json;
  }

  /**
   * One input, two file kinds, told apart by their contents: a backup file declares its format,
   * a service-account key carries a private_key. Auto-detecting removes a choice the operator
   * should not have to understand.
   */
  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    /**
     * Say something immediately. A clinic backup can be tens of megabytes, and on a tablet
     * reading and parsing it takes long enough that a silent screen reads as "nothing happened"
     * — which is exactly what an operator will conclude, and then press again.
     */
    setReading({ name: file.name, size: file.size });
    setFileName("");
    setFileSize(0);
    setError("");

    /**
     * Every way a read can end must clear `reading`. The first version handled only onload and
     * onerror; on a Huawei tablet the Files app can hand over a file the browser then cannot
     * open, which surfaces as onabort or as readAsText() throwing outright — neither was
     * handled, `reading` stayed set, and because the input was disabled while reading, every
     * later tap on "Choose file" did nothing at all. The input is no longer disabled, and the
     * remaining paths are covered anyway.
     */
    const giveUp = (why: string) => {
      setReading(null);
      input.value = "";
      setError(`${why} Try choosing "${file.name}" again from the Files app.`);
    };

    if (file.size === 0) {
      giveUp("That file is empty — the tablet may not have finished downloading it.");
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => giveUp("Could not read that file.");
    reader.onabort = () => giveUp("Reading that file was interrupted.");
    // Parsing blocks the page; a tick lets the "Reading…" line paint first.
    reader.onload = () => setTimeout(() => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (parsed?.format === "alpha-dental-v2-backup") {
          const docs = (parsed.docs || []) as { path: string }[];
          const v3Roots = [...new Set(docs.map((doc) => doc.path.split("/")[0]).filter((root) => V3_ONLY_ROOTS.has(root)))];
          if (v3Roots.length) {
            throw new Error(
              `This file was taken from the NEW system, not a clinic's old one — it contains "${v3Roots.join('", "')}", ` +
                `which only v3 has. Open the clinic's old site, go to /backup, and download from there.`
            );
          }
          setBackup(parsed);
          setCredentials(null);
          setMode("backup");
          setNewClinicName(String(parsed.clinicName || ""));
        } else if (parsed?.private_key || parsed?.privateKey) {
          setCredentials(parsed);
          setBackup(null);
          setMode("keyfile");
        } else {
          throw new Error("unrecognised");
        }
        setFileName(file.name);
        setFileSize(file.size);
        setPlan(null);
        setClinicId("");
        setCreatedClinic(null);
        setClinicMode("new");
        setError("");
      } catch (e) {
        const message = e instanceof Error ? e.message : "";
        setError(
          message.startsWith("This file was taken")
            ? message
            : "That file is neither a clinic backup nor a service account key."
        );
      } finally {
        setReading(null);
        // Choosing the same file again must fire onChange again.
        input.value = "";
      }
    }, 0);

    try {
      reader.readAsText(file);
    } catch {
      giveUp("The tablet would not let the page open that file.");
    }
  }

  async function handleCreateClinic() {
    setBusy("create");
    setError("");
    try {
      const roots = backup ? [...new Set(backup.docs.map((doc) => doc.path.split("/")[0]))] : [];
      const sourceProject =
        backup?.projectId || String((credentials as Record<string, unknown> | null)?.project_id || "");
      const json = await call("create-clinic", { name: newClinicName, sourceProject, collections: roots });
      setCreatedClinic({ clinicId: json.clinicId, name: json.name, reused: Boolean(json.reused) });
      setClinicId(json.clinicId);
      setPlan(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function handleCheck() {
    setBusy("check");
    setError("");
    setPlan(null);
    try {
      if (mode === "backup" && backup) {
        const counts = new Map<string, number>();
        for (const doc of backup.docs) {
          const col = collectionOf(doc.path);
          counts.set(col, (counts.get(col) || 0) + 1);
        }
        const json = await call("plan-backup", {
          collections: [...counts.entries()].map(([path, count]) => ({ path, count })),
        });
        setPlan(json.plan);
        setReroutedPaths(json.reroutedPaths);
        setRunId(json.runId);
        setSourceProject(backup.projectId);
      } else {
        const json = await call("plan", { credentials });
        setPlan(json.plan);
        setSourceProject(json.sourceProject);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  /**
   * Record a finished copy. Deliberately the ONLY place that does so: this existed twice, once
   * per import path, and the backup copy of it forgot to record whether the run had actually
   * written — so a real import kept reporting itself as a practice run and the later steps
   * stayed hidden behind a flag that was never set.
   */
  function finishCopy(commit: boolean, lines: string[], found: string[]) {
    setCopySummary(lines.filter(Boolean));
    setConflicts(found.slice(0, 50));
    setCopyCommitted(commit);
    setCopyStage("done");
  }

  async function handleCopy(commit: boolean) {
    if (!plan) return;
    setCopyStage("running");
    setError("");
    setCopySummary([]);
    setConflicts([]);
    if (commit) setCopyCommitted(false);

    try {
      if (mode === "backup" && backup) {
        const copyable = new Set(plan.filter((entry) => entry.action === "copy").map((entry) => entry.name));
        const docs = backup.docs.filter((doc) => copyable.has(collectionOf(doc.path)));

        const stats = { read: 0, written: 0, conflicts: 0, rerouted: 0, refsRemapped: 0, storageUrls: 0 };
        const allConflicts: string[] = [];

        for (let i = 0; i < docs.length; i += IMPORT_CHUNK) {
          const json = await call("import", {
            docs: docs.slice(i, i + IMPORT_CHUNK),
            commit,
            overwrite: false,
            runId,
            sourceProject: backup.projectId,
          });
          for (const key of Object.keys(stats) as (keyof typeof stats)[]) {
            stats[key] += json.stats[key] || 0;
          }
          allConflicts.push(...(json.conflicts || []));
          setCopyProgress(`${Math.min(i + IMPORT_CHUNK, docs.length).toLocaleString()} of ${docs.length.toLocaleString()} records`);
        }

        finishCopy(
          commit,
          [
            `${stats.read.toLocaleString()} records read from the backup`,
            `${stats.written.toLocaleString()} records ${commit ? "copied in" : "ready to copy"}`,
            stats.rerouted ? `${stats.rerouted} secret moved to protected storage` : "",
          ],
          allConflicts
        );
      } else {
        const collections = plan.filter((entry) => entry.action === "copy").map((entry) => entry.name);
        let state: unknown = null;
        let guard = 0;
        for (;;) {
          if (guard++ > 2000) throw new Error("Stopped after too many steps — tell your developer.");
          const json: { state: { completed: string[]; pending: string[]; stats: Record<string, number>; conflicts: string[] }; done: boolean } =
            await call("copy", { credentials, state, collections, commit, overwrite: false });
          state = json.state;
          const done = json.state.completed.length;
          setCopyProgress(`${done} of ${done + json.state.pending.length} sections — ${json.state.stats.read.toLocaleString()} records read`);
          if (json.done) {
            const stats = json.state.stats;
            finishCopy(
              commit,
              [
                `${stats.read.toLocaleString()} records read`,
                `${stats.written.toLocaleString()} records ${commit ? "copied" : "ready to copy"}`,
                stats.refsRemapped ? `${stats.refsRemapped} internal links repointed` : "",
                stats.storageUrls ? `${stats.storageUrls} photo/x-ray links found (step 4 copies these)` : "",
              ],
              json.state.conflicts || []
            );
            break;
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCopyStage("error");
    }
  }

  function backupStaffArgs() {
    if (!backup) return {};
    return {
      staffDocs: backup.docs
        .filter((doc) => /^staff\/[^/]+$/.test(doc.path))
        .map((doc) => ({ id: doc.path.split("/")[1], data: doc.data })),
      userDocs: backup.docs
        .filter((doc) => /^users\/[^/]+$/.test(doc.path))
        .map((doc) => doc.data),
      sourceProject: backup.projectId,
    };
  }

  async function handleStaffPreview() {
    setBusy("staff");
    setError("");
    try {
      const json =
        mode === "backup"
          ? await call("staff-preview-backup", { ...backupStaffArgs(), adminEmail })
          : await call("staff-preview", { credentials, adminEmail });
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
      const json =
        mode === "backup"
          ? await call("staff-link-backup", { ...backupStaffArgs(), adminEmail, resetLinks: true })
          : await call("staff-link", { credentials, adminEmail, resetLinks: true });
      setStaffResults(json.results);
      setStaffOwner(json.owner || null);
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

        const json =
          mode === "backup"
            ? await call("fetch-files", { state, commit })
            : await call("storage", { credentials, state, commit });
        state = json.state;

        setFilesProgress(
          `${json.state.completed.length} of ${json.state.completed.length + json.state.pending.length} sections — ${json.state.copied} files copied`
        );

        if (json.done) {
          const buckets: string[] = json.state.bucketsSeen || [];
          setFilesSummary([
            json.state.copied === 0 && json.state.alreadyThere === 0
              ? `Looked at ${(json.state.scanned || 0).toLocaleString()} records — no image links found`
              : `${json.state.copied} files ${commit ? "copied" : "ready to copy"}`,
            json.state.alreadyThere ? `${json.state.alreadyThere} already here` : "",
            `${json.state.documentsUpdated} records ${commit ? "updated" : "would be updated"}`,
            buckets.length ? `Images came from: ${buckets.join(", ")}` : "",
            json.state.missing?.length
              ? `${json.state.missing.length} files were already broken in the old system (left alone)`
              : "",
            json.state.needsCredentials?.length
              ? `${json.state.needsCredentials.length} files cannot be fetched from the backup — redo this step with the old project's key file`
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
      if (mode === "backup" && backup) {
        const rerouted = new Set(reroutedPaths);
        const counts = new Map<string, number>();
        const samplesByRoot = new Map<string, { path: string; data: unknown }[]>();

        for (const doc of backup.docs) {
          if (rerouted.has(doc.path) || doc.path.startsWith("users/")) continue;
          const col = collectionOf(doc.path);
          counts.set(col, (counts.get(col) || 0) + 1);

          const root = doc.path.split("/")[0];
          const bucket = samplesByRoot.get(root) || [];
          if (bucket.length < 25) bucket.push(doc);
          samplesByRoot.set(root, bucket);
        }

        const json = await call("verify-backup", {
          counts: [...counts.entries()].map(([path, count]) => ({ path, count })),
          samples: [...samplesByRoot.values()].flat(),
          reroutesPresent: reroutedPaths.filter((path) => backup.docs.some((doc) => doc.path === path)),
        });
        setReport(json.report);
      } else {
        const json = await call("verify", { credentials, sample: 25 });
        setReport(json.report);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const ready = Boolean(clinicId && (backup || credentials));

  /**
   * Collapse the plan to one row per top-level collection for display.
   *
   * A clinic with 40 chat threads produces 40 separate `conversations/<id>/messages` entries,
   * which buried the real content of this screen in a wall of near-identical rows. Grouping is
   * display-only — `plan` itself still drives which documents are copied, matched by their full
   * collection path.
   */
  const planRows = useMemo(() => {
    const groups = new Map<
      string,
      { name: string; count: number; action: "copy" | "skip"; known: boolean; noConsumer?: string; nested: number }
    >();

    for (const entry of plan || []) {
      const root = entry.name.split("/")[0];
      const nested = entry.name.includes("/") ? 1 : 0;
      const group = groups.get(root);
      if (!group) {
        groups.set(root, {
          name: root,
          count: entry.count,
          action: entry.action,
          known: entry.known,
          noConsumer: entry.noConsumer,
          nested,
        });
      } else {
        group.count += entry.count;
        group.nested += nested;
        if (entry.action === "copy") group.action = "copy";
        group.known = group.known && entry.known;
        group.noConsumer = group.noConsumer || entry.noConsumer;
      }
    }

    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [plan]);

  const unknowns = planRows.filter((entry) => entry.action === "copy" && !entry.known);
  const gaps = planRows.filter((entry) => entry.noConsumer && entry.count > 0);
  const blockedByUnknown = unknowns.length > 0 && !allowUnknown;

  return (
    <div className="space-y-6 max-w-5xl">
      <Callout>
        <p className="font-bold text-indigo-950 mb-1">This copies a clinic in. It never changes their old system.</p>
        <p>
          Ask the clinic&apos;s Admin to open <span className="font-mono">/backup</span> in their old
          system, press <em>Download backup</em>, and send you the file. Upload it here and v3 makes
          the clinic from it — no Firebase keys, nothing to set up first. The clinic keeps working in
          the old system the whole time, nothing is written here until you press a button that says
          so, and you can repeat any step safely.
        </p>
      </Callout>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">
          <XCircle size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Step number={1} title="Upload the backup and name the clinic" icon={<Database size={18} />}>
        <label className="block text-xs font-bold text-ink-muted mb-2">
          The clinic&apos;s backup file — or, if there is none, the old project&apos;s key file
        </label>
        <label className="flex items-center gap-3 px-4 py-3 rounded-lg border border-dashed border-line-strong hover:border-indigo-500 cursor-pointer text-sm text-ink-body bg-surface">
          {reading ? <Loader2 size={16} className="animate-spin text-indigo-600" /> : <Upload size={16} />}
          {reading ? (
            <span>
              Reading <span className="font-bold text-ink">{reading.name}</span> ({formatSize(reading.size)})… this can
              take a moment for a big clinic.
            </span>
          ) : fileName ? (
            <span>
              <span className="font-bold text-ink">{fileName}</span> ({formatSize(fileSize)})
            </span>
          ) : (
            "Choose file…"
          )}
          <input type="file" onChange={onFile} className="sr-only" />
        </label>
        {mode === "backup" && backup && (
          <p className="text-xs text-emerald-700 mt-2">
            Backup of <span className="font-bold">{backup.clinicName || "(unnamed clinic)"}</span> from{" "}
            <span className="font-mono">{backup.projectId}</span> — {backup.docs.length.toLocaleString()} records
            {backup.exportedAt ? `, taken ${new Date(backup.exportedAt).toLocaleString()}` : ""}. No keys needed.
          </p>
        )}
        {mode === "keyfile" && (
          <p className="text-xs text-ink-muted mt-2 flex items-start gap-2">
            <Lock size={13} className="mt-0.5 shrink-0" />
            <span>
              Key file detected. The old project is opened read-only; give this account only the
              <em> Viewer</em> roles for Firestore and Storage and it cannot change their data even by
              accident. Used for this session only, never saved.
            </span>
          </p>
        )}

        {(backup || credentials) && (
          <div className="mt-5 space-y-3">
            <label className="block text-xs font-bold text-ink-muted">Where should it go?</label>

            <label className="flex items-start gap-3 p-3 rounded-lg border border-line cursor-pointer">
              <input
                type="radio"
                name="clinicMode"
                checked={clinicMode === "new"}
                onChange={() => {
                  setClinicMode("new");
                  setClinicId(createdClinic?.clinicId || "");
                  setPlan(null);
                }}
                className="mt-1"
              />
              <div className="flex-1">
                <p className="text-sm text-ink font-bold">Make a new clinic from this backup</p>
                <p className="text-xs text-ink-muted mb-2">
                  v3 creates the clinic, then everything goes into it. Uploading the same backup again
                  later finds this same clinic rather than making another.
                </p>
                {clinicMode === "new" && (
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={newClinicName}
                      onChange={(event) => setNewClinicName(event.target.value)}
                      placeholder="Clinic name"
                      disabled={Boolean(createdClinic)}
                      className="flex-1 min-w-[220px] bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink disabled:opacity-60"
                    />
                    {!createdClinic && (
                      <button
                        onClick={handleCreateClinic}
                        disabled={!newClinicName.trim() || busy === "create"}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-bold"
                      >
                        {busy === "create" ? <Loader2 size={16} className="animate-spin" /> : null}
                        Create clinic
                      </button>
                    )}
                  </div>
                )}
                {clinicMode === "new" && createdClinic && (
                  <p className="text-xs text-emerald-700 mt-2">
                    {createdClinic.reused
                      ? `Found the clinic made from this backup before: "${createdClinic.name}"`
                      : `Created "${createdClinic.name}"`}{" "}
                    <span className="font-mono text-ink-muted">({createdClinic.clinicId})</span>
                  </p>
                )}
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 rounded-lg border border-line cursor-pointer">
              <input
                type="radio"
                name="clinicMode"
                checked={clinicMode === "existing"}
                onChange={() => {
                  setClinicMode("existing");
                  setClinicId("");
                  setPlan(null);
                }}
                className="mt-1"
              />
              <div className="flex-1">
                <p className="text-sm text-ink font-bold">Put it into a clinic that already exists</p>
                {clinicMode === "existing" && (
                  <select
                    value={clinicId}
                    onChange={(event) => {
                      setClinicId(event.target.value);
                      setPlan(null);
                    }}
                    className="mt-2 w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink"
                  >
                    <option value="">— pick a clinic —</option>
                    {clinics.map((clinic) => (
                      <option key={clinic.id} value={clinic.id}>
                        {clinic.name} ({clinic.id})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </label>
          </div>
        )}

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
          <p className="text-xs text-ink-muted mb-3">
            {mode === "backup" ? "From the backup of " : "Reading "}
            <span className="font-mono text-ink-body">{sourceProject}</span>. Nothing has been copied
            yet.
          </p>

          <div className="rounded-lg border border-line overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {planRows.map((entry) => (
                  <tr key={entry.name} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 font-mono text-ink-body">
                      {entry.name}
                      {entry.nested > 0 && (
                        <span className="text-ink-muted font-sans"> + {entry.nested} inner list{entry.nested > 1 ? "s" : ""}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-ink-muted tabular-nums">
                      {entry.count.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {entry.action === "skip" ? (
                        <span className="text-ink-muted">handled in step 3</span>
                      ) : !entry.known ? (
                        <span className="text-amber-700">not recognised</span>
                      ) : entry.noConsumer ? (
                        <span className="text-amber-700">no v3 feature reads this</span>
                      ) : (
                        <span className="text-emerald-700">will copy</span>
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
              <label className="flex items-center gap-2 text-amber-900">
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
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-muted hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-sm font-bold"
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

          {copyStage === "done" && !copyCommitted && (
            <Warning icon={<ShieldCheck size={16} />}>
              <p className="font-bold mb-1">That was the practice run — nothing was copied.</p>
              <p>
                The remaining steps stay hidden until the data is really here, because they would
                otherwise run against an empty clinic and report success. Press{" "}
                <em>Copy the data for real</em> when the numbers above look right.
              </p>
            </Warning>
          )}

          {conflicts.length > 0 && (
            <Warning icon={<ShieldCheck size={16} />}>
              <p className="font-bold mb-1">{conflicts.length} records were left alone on purpose.</p>
              <p className="mb-2">
                These already existed here and were not put there by a migration — they look like work
                someone did in v3 after the clinic switched over. They were not overwritten with the
                older copy.
              </p>
              <ul className="font-mono text-xs space-y-0.5 text-amber-800">
                {conflicts.slice(0, 20).map((path) => (
                  <li key={path}>{path.replace(`clinics/${clinicId}/`, "")}</li>
                ))}
                {conflicts.length > 20 && <li>… and {conflicts.length - 20} more</li>}
              </ul>
              <p className="mt-2">
                If these are just the empty records v3 created when you made the clinic, that is normal
                — carry on. If any of them hold real work, deal with that before switching over.
              </p>
            </Warning>
          )}
        </Step>
      )}

      {copyCommitted && (
        <Step number={3} title="Staff logins" icon={<Users size={18} />}>
          <Warning icon={<AlertTriangle size={16} />}>
            <p className="font-bold mb-1">Old passwords will not work.</p>
            <p>
              Firebase will not hand over anyone&apos;s password, so each person gets a link to set a new
              one. Tell the clinic before their first morning on v3, not on it.
            </p>
          </Warning>

          <label className="block text-xs font-bold text-ink-muted mt-4 mb-2">
            Who owns this clinic? (their email becomes the Admin)
          </label>
          <input
            value={adminEmail}
            onChange={(event) => setAdminEmail(event.target.value)}
            placeholder="owner@clinic.com"
            className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink"
          />

          <div className="flex flex-wrap gap-3 mt-4">
            <button
              onClick={handleStaffPreview}
              disabled={busy === "staff"}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-muted hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-sm font-bold"
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

          {staffPeople && !staffResults && adminEmail.trim() &&
            !staffPeople.some((p) => p.email === adminEmail.trim().toLowerCase()) && (
              <Warning icon={<AlertTriangle size={16} />}>
                <p className="font-bold mb-1">
                  Nobody in this clinic uses {adminEmail.trim()}.
                </p>
                <p>
                  The owner has to be one of the people below, so type one of their email addresses
                  exactly. Your own super admin account already reaches every clinic — it does not
                  need to be listed here.
                </p>
              </Warning>
            )}

          {staffPeople && !staffResults && !staffPeople.some((p) => p.role === "Admin") && (
            <Warning icon={<AlertTriangle size={16} />}>
              <p className="font-bold mb-1">Nobody would be an Admin.</p>
              <p>
                None of these people was an Admin in the old system, so no one could manage settings
                or add staff here. Put the owner&apos;s email in the box above first — creating the
                logins is blocked until someone is an Admin.
              </p>
            </Warning>
          )}

          {staffPeople && !staffResults && (
            <div className="mt-4 rounded-lg border border-line overflow-hidden">
              {staffPeople.map((person) => (
                <div key={person.staffDocId} className="flex justify-between px-3 py-2 border-b border-line last:border-0 text-sm">
                  <span className="text-ink-body">{person.name}</span>
                  <span className="text-ink-muted">{person.email}</span>
                  <span className={person.role === "Admin" ? "text-indigo-700 font-bold" : "text-ink-muted"}>
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
              <p className="text-sm text-emerald-700 font-bold mb-2">
                Done. Send each person their own link — privately, not in a group chat.
              </p>
              {staffOwner && (
                <p className="text-xs text-ink-muted mb-3">
                  {staffOwner.promoted
                    ? `${staffOwner.name} (${staffOwner.email}) is now the clinic's owner.`
                    : `${staffOwner.name} is the Admin; the clinic already has an owner, so ownership was left as it is.`}
                </p>
              )}
              <div className="space-y-2">
                {staffResults.map((person) => (
                  <div key={person.uid} className="p-3 rounded-lg bg-surface-subtle border border-line">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-ink font-bold">{person.name}</span>
                      <span className="text-xs text-ink-muted">
                        {person.email} · {person.role} · {person.created ? "new login" : "already existed"}
                      </span>
                    </div>
                    {person.resetLink && (
                      <button
                        onClick={() => navigator.clipboard.writeText(person.resetLink as string)}
                        className="flex items-center gap-1.5 text-xs text-indigo-700 hover:text-indigo-900"
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

      {copyCommitted && (
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
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-muted hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-sm font-bold"
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

      {copyCommitted && (
        <Step number={5} title="Check everything arrived" icon={<CheckCircle2 size={18} />}>
          <p className="text-sm text-ink-muted mb-3">
            Compares the records here against the {mode === "backup" ? "backup file" : "old system"},
            and checks that appointments still find their patients. Run this before you let the clinic
            start working here.
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
                    ? "bg-rose-50 border-rose-200 text-rose-700"
                    : "bg-emerald-50 border-emerald-200 text-emerald-800"
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
          <p className="font-bold text-indigo-950 mb-1">Last thing: leave the old system alone, running.</p>
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

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function Step({ number, title, icon, children }: { number: number; title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface shadow-sm p-5">
      <h3 className="flex items-center gap-3 text-ink font-bold mb-4">
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
    <div className="flex items-start gap-3 p-4 rounded-xl bg-indigo-50 border border-indigo-200 text-sm text-indigo-900">
      <ShieldCheck size={18} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

function Warning({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 p-4 mt-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>{children}</div>
    </div>
  );
}

function Progress({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 mt-4 text-sm text-ink-body">
      <Loader2 size={14} className="animate-spin" />
      {text || "Starting…"}
    </p>
  );
}

function Summary({ lines }: { lines: string[] }) {
  return (
    <ul className="mt-4 space-y-1">
      {lines.map((line) => (
        <li key={line} className="flex items-center gap-2 text-sm text-ink-body">
          <CheckCircle2 size={14} className="text-emerald-700 shrink-0" />
          {line}
        </li>
      ))}
    </ul>
  );
}

function CheckGroup({ title, rows }: { title: string; rows: CheckRow[] }) {
  if (!rows.length) return null;
  const tone = {
    ok: "text-emerald-700",
    fail: "text-rose-700",
    warn: "text-amber-700",
    info: "text-ink-muted",
  };
  return (
    <div>
      <p className="text-xs font-bold text-ink-muted uppercase tracking-wide mb-2">{title}</p>
      <div className="rounded-lg border border-line overflow-hidden">
        {rows.map((row) => (
          <div key={`${title}-${row.label}`} className="flex justify-between gap-4 px-3 py-1.5 border-b border-line last:border-0 text-sm">
            <span className="text-ink-body font-mono text-xs">{row.label}</span>
            <span className={`${tone[row.status]} text-xs text-right`}>{row.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
