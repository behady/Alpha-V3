/**
 * Imports a clinic's existing patient list (an Excel sheet) as patient profiles.
 *
 *   node scripts/import-patients-xlsx.mjs --list-clinics
 *   node scripts/import-patients-xlsx.mjs --file "<sheet.xlsx>" --clinic <id>            # dry run
 *   node scripts/import-patients-xlsx.mjs --file "<sheet.xlsx>" --clinic <id> --apply    # write
 *   ... --report <path.xlsx>   (default: <sheet>.import-report.xlsx next to the sheet)
 *   ... --tag <batch>          (default: the sheet's file name; part of every document id)
 *
 * THE SHEET
 *
 * Built for the layout clinics keep on plain Excel: one row per patient with a file number,
 * a name, a phone, an age, and whatever else the receptionist had a column for. Columns are
 * found by their header text (Arabic or English), so column order does not matter:
 *   file number  رقم الملف / file / id          name     الاسم / name
 *   phone        التلفون / تليفون / phone / mobile      age      العمر / السن / age
 *   occupation   المهنة / المهن / occupation / job      phone 2  التلفون 2 / phone 2
 * Any other non-empty column (e.g. "Field1") is kept as a note on the patient.
 *
 * WHAT IT WRITES, AND WHY THAT SHAPE
 *
 * The same fields NewPatientModal writes, so an imported profile is indistinguishable from a
 * typed one: `fileId`, `name`, `phone` (E.164, through the app's own normaliser), `dateOfBirth`,
 * `status`, `createdAt`, `teethData: {}`. Plus:
 *   - `fileId` is the clinic's OWN file number, not a fresh PT-xxxx. Their paper files and the
 *     receptionist's memory are indexed by that number; renumbering would cut the thread.
 *     The clinic's counter is raised past the highest imported number so the next typed-in
 *     patient does not collide.
 *   - `age` (a number, as the sheet had it) when there is no birth date. The patient page shows
 *     `age` whenever `dateOfBirth` is blank. It is a snapshot — `ageRecordedAt` says of when.
 *   - `notes`: occupation, second phone, extra columns, and any phone that could not be read
 *     as a number. Nothing from the sheet is thrown away; what has no field goes here.
 *   - `legacyId` + `importBatch`, and a DETERMINISTIC document id (`<tag>-<legacyId>`), so a
 *     second run of the same sheet skips what is already there instead of duplicating it.
 *
 * Blank rows (a file number with nothing else) and rows marked ملغي (cancelled) are skipped
 * and listed in the report. Duplicate file numbers and shared phones are imported as they are
 * — families share a phone and receptionists reuse numbers — but flagged in the report.
 *
 * Runs with the admin SDK, so Firestore rules do not apply: the clinic id is the only thing
 * standing between this and the wrong tenant. --list-clinics first, then --clinic.
 */

import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import XLSX from "xlsx";
import { normalizeToE164AssumingCountry } from "../src/lib/phoneNumber.ts";

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1] || null;
};

const APPLY = has("--apply");
const LIST = has("--list-clinics");
const FILE = valueOf("--file");
const CLINIC = valueOf("--clinic");
const COUNTRY = valueOf("--country") || "+20";

function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) throw new Error("Missing .env.local — run this from the project root.");
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}

function adminDb() {
  if (getApps().length === 0) {
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "")
      .replace(/^["']|["']$/g, "")
      .replace(/\\n/g, "\n")
      .trim();
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
        privateKey,
      }),
    });
  }
  // The database is literally NAMED "default" — not the unnamed "(default)" one.
  return getFirestore(getApps()[0], "default");
}

// ---------- column detection ----------

const HEADERS = {
  // Order matters: a named file-number column beats a bare "ID", which is usually the sheet's
  // own running serial. Patterns are tried in order across every header before moving on.
  file: [/رقم\s*الملف/, /^file/i, /^no\.?$/i, /^id$/i],
  name: [/الاسم|اسم/, /^name/i, /patient/i],
  phone: [/^(ال)?ت(ل|لي)فون\s*$/, /^(ال)?موبايل/, /^phone$/i, /^mobile$/i, /^tel$/i],
  phone2: [/ت(ل|لي)فون\s*2/, /phone\s*2/i, /mobile\s*2/i],
  age: [/العمر|السن/, /^age/i],
  occupation: [/المهن/, /occupation|^job/i],
};

function detectColumns(headerRow) {
  const cols = {};
  const used = new Set();
  const titles = headerRow.map((h) => String(h ?? "").trim());
  for (const [field, patterns] of Object.entries(HEADERS)) {
    outer: for (const p of patterns) {
      for (let i = 0; i < titles.length; i++) {
        if (used.has(i) || !titles[i]) continue;
        if (p.test(titles[i])) {
          cols[field] = i;
          used.add(i);
          break outer;
        }
      }
    }
  }
  // The sheet's running serial ("ID") is a second id-shaped column; the file number wins.
  if (cols.file != null) {
    const serial = titles.findIndex((t, i) => !used.has(i) && /^id$/i.test(t));
    if (serial !== -1) {
      cols.serial = serial;
      used.add(serial);
    }
  }
  cols.extra = titles.map((t, i) => (t && !used.has(i) ? i : -1)).filter((i) => i !== -1);
  return { cols, titles };
}

// ---------- row mapping ----------

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const foldDigits = (s) =>
  String(s ?? "").replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) - (d < "۰" ? 0x0660 : 0x06f0)) % 10));

const clean = (v) => (v == null ? "" : String(v).trim());
const isCancelled = (s) => /ملغي|ملغى|cancel/i.test(s);

/**
 * Phones in these sheets lost their leading zero (Excel's doing: "01113318892" stored as a number
 * prints as 1113318892) — the app's "assume the clinic's country" normaliser already repairs
 * that. What it cannot know is whether the digits form a REAL number for that country, so for
 * Egypt the national part must be a 10-digit mobile starting with 1 or an 8–9 digit landline.
 */
function readPhone(raw, country) {
  const text = clean(foldDigits(raw));
  if (!text || isCancelled(text)) return { e164: "", raw: text, ok: !text };
  const e164 = normalizeToE164AssumingCountry(text, country);
  if (!e164) return { e164: "", raw: text, ok: false };
  if (e164.startsWith("+20")) {
    const national = e164.slice(3);
    const mobile = /^1[0125]\d{8}$/.test(national);
    const landline = /^[2-9]\d{7,8}$/.test(national);
    if (!mobile && !landline) return { e164: "", raw: text, ok: false };
  }
  return { e164, raw: text, ok: true };
}

/** "25" → age 25; "29/05/2019" → birth date; "13.5" stays as typed; anything else → note. */
function readAge(raw) {
  const text = clean(foldDigits(raw));
  if (!text || isCancelled(text)) return {};
  if (/^\d{1,3}$/.test(text)) return { age: Number(text) };
  if (/^\d{1,3}\.\d$/.test(text)) return { age: Number(text) };
  const dmy = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) return { dateOfBirth: `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` };
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return { dateOfBirth: raw.toISOString().slice(0, 10) };
  return { note: `العمر كما في الشيت: ${text}` };
}

function mapRow(row, cols, titles, country, batch) {
  const get = (f) => (cols[f] == null ? undefined : row[cols[f]]);
  const serial = clean(get("serial"));
  const file = clean(foldDigits(get("file")));
  const name = clean(get("name")).replace(/\s+/g, " ");
  const problems = [];

  if (!name || (/^[\d\s]+$/.test(name) && !clean(get("phone")))) return { skip: file || serial ? "blank row" : "empty", file, serial, name };
  if (isCancelled(name)) return { skip: "cancelled (ملغي)", file, serial, name };

  const phone = readPhone(get("phone"), country);
  const phone2 = readPhone(get("phone2"), country);
  const ageInfo = readAge(get("age"));
  const occupation = clean(get("occupation"));

  const notes = [];
  if (occupation) notes.push(`المهنة: ${occupation}`);
  // Excel mangled the first number but the second is fine: the second becomes THE phone (so
  // reminders reach someone) and the unreadable one is kept in the notes for the receptionist.
  let phoneE164 = phone.e164;
  if (!phone.e164 && phone2.e164) {
    phoneE164 = phone2.e164;
    if (phone.raw) notes.push(`رقم التليفون الأول في الشيت غير مقروء: ${phone.raw}`);
  } else if (phone2.raw) {
    notes.push(`تليفون 2: ${phone2.e164 || phone2.raw}`);
  }
  if (!phone.ok && !phoneE164) {
    notes.push(`رقم التليفون في الشيت غير مقروء: ${phone.raw}`);
    problems.push(`phone unreadable: ${phone.raw}`);
  }
  if (!phone2.ok) problems.push(`phone 2 unreadable: ${phone2.raw}`);
  if (ageInfo.note) {
    notes.push(ageInfo.note);
    problems.push(`age unreadable: ${clean(get("age"))}`);
  }
  for (const i of cols.extra) {
    const v = clean(row[i]);
    const label = /^(field\s*\d+|column\s*\d+|__EMPTY.*)$/i.test(titles[i]) ? "ملاحظة من الشيت" : titles[i];
    if (v) notes.push(`${label}: ${v}`);
  }
  if (!phone.raw && !phoneE164) problems.push("no phone");
  if (!file) problems.push("no file number");

  const legacyId = serial || file || name;
  const doc = {
    fileId: file,
    name,
    phone: phoneE164,
    address: "",
    dateOfBirth: ageInfo.dateOfBirth || "",
    ...(ageInfo.age != null ? { age: ageInfo.age, ageRecordedAt: new Date().toISOString().slice(0, 10) } : {}),
    referral: "",
    medicalHistory: "",
    allergies: "",
    notes: notes.join("\n"),
    status: "Active",
    legacyId,
    importBatch: batch,
    teethData: {},
  };
  return { id: `${batch}-${legacyId}`.replace(/[^\w\-]/g, "_"), doc, problems, file, serial, name };
}

// ---------- duplicates ----------

const skeleton = (name) =>
  String(name || "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[ً-ْ]/g, "")
    .replace(/\s+/g, " ").trim();

/**
 * The same file number typed twice is almost always the same patient entered twice (one row
 * with the short name and no age, a fuller one later). When the two rows agree on the phone or
 * on the name, they are folded into one profile that keeps the fuller name and whatever the
 * other row had that this one lacked. Two different people on one number stay two profiles.
 */
function mergeDuplicateFiles(imported) {
  const byFile = new Map();
  for (const r of imported) if (r.file) byFile.set(r.file, [...(byFile.get(r.file) || []), r]);
  const dropped = new Set();
  const merges = [];
  for (const group of byFile.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      const a = group[i];
      if (dropped.has(a)) continue;
      for (let j = i + 1; j < group.length; j++) {
        const b = group[j];
        if (dropped.has(b)) continue;
        const samePhone = Boolean(a.doc.phone) && a.doc.phone === b.doc.phone;
        const [na, nb] = [skeleton(a.name), skeleton(b.name)];
        const sameName = na === nb;
        const prefixName = na.startsWith(nb) || nb.startsWith(na);
        const agesAgree = a.doc.age == null || b.doc.age == null || a.doc.age === b.doc.age;
        if (!samePhone && !sameName && !(prefixName && agesAgree)) continue;
        const richness = (r) => r.name.length + (r.doc.phone ? 1 : 0) + (r.doc.age != null ? 1 : 0);
        const [keep, drop] = richness(b) > richness(a) ? [b, a] : [a, b];
        if (!keep.doc.phone && drop.doc.phone) keep.doc.phone = drop.doc.phone;
        if (keep.doc.age == null && drop.doc.age != null) {
          keep.doc.age = drop.doc.age;
          keep.doc.ageRecordedAt = drop.doc.ageRecordedAt;
        }
        if (!keep.doc.dateOfBirth && drop.doc.dateOfBirth) keep.doc.dateOfBirth = drop.doc.dateOfBirth;
        const unreadable = "رقم التليفون في الشيت غير مقروء";
        const extraNotes = drop.doc.notes.split("\n").filter((n) => n && !keep.doc.notes.includes(n) && !n.startsWith(unreadable));
        keep.doc.notes = [...keep.doc.notes.split("\n"), ...extraNotes]
          .filter((n) => n && !(keep.doc.phone && n.startsWith(unreadable)))
          .join("\n");
        if (keep.doc.phone) keep.problems = keep.problems.filter((x) => !x.startsWith("phone unreadable") && x !== "no phone");
        merges.push({ file: keep.file, kept: keep.name, dropped: drop.name, serial: drop.serial });
        dropped.add(drop);
        if (drop === a) break;
      }
    }
  }
  return { rows: imported.filter((r) => !dropped.has(r)), merges };
}

/** Same name on the same phone under two different file numbers: imported both, but worth a look. */
function possibleDuplicates(imported) {
  const groups = new Map();
  for (const r of imported) {
    if (!r.doc.phone) continue;
    const k = `${skeleton(r.name)}|${r.doc.phone}`;
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  return [...groups.values()].filter((g) => g.length > 1 && new Set(g.map((r) => r.file)).size > 1);
}

// ---------- report ----------

function writeReport(reportPath, { imported, skipped, dupFiles, dupPhones, existingPhones, merges, possibles }) {
  const wb = XLSX.utils.book_new();
  const sheet = (name, rows, header) => {
    const ws = XLSX.utils.json_to_sheet(rows, { header });
    ws["!cols"] = header.map((h) => ({ wch: Math.max(14, h.length + 4) }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  sheet(
    "Imported",
    imported.map((r) => ({
      "File #": r.file,
      Name: r.name,
      Phone: r.doc.phone,
      Age: r.doc.age ?? "",
      "Birth date": r.doc.dateOfBirth,
      Notes: r.doc.notes,
      Flags: r.problems.join("; "),
      Status: r.existed ? "already in system" : "imported",
    })),
    ["File #", "Name", "Phone", "Age", "Birth date", "Notes", "Flags", "Status"]
  );
  sheet(
    "Needs a look",
    imported
      .filter((r) => r.problems.length)
      .map((r) => ({ "File #": r.file, Name: r.name, Problem: r.problems.join("; "), Notes: r.doc.notes })),
    ["File #", "Name", "Problem", "Notes"]
  );
  sheet(
    "Skipped rows",
    skipped.map((r) => ({ Serial: r.serial, "File #": r.file, Name: r.name || "", Why: r.skip })),
    ["Serial", "File #", "Name", "Why"]
  );
  sheet(
    "Merged twice-typed rows",
    merges.map((m) => ({ "File #": m.file, "Kept as": m.kept, "Folded in": m.dropped, "Sheet row": m.serial })),
    ["File #", "Kept as", "Folded in", "Sheet row"]
  );
  sheet(
    "Possible duplicates",
    possibles.map((g) => ({ Name: g[0].name, Phone: g[0].doc.phone, "File numbers": g.map((r) => r.file).join(" | ") })),
    ["Name", "Phone", "File numbers"]
  );
  sheet(
    "Same file number",
    dupFiles.map(([file, names]) => ({ "File #": file, Patients: names.join(" | ") })),
    ["File #", "Patients"]
  );
  sheet(
    "Shared phone",
    dupPhones.map(([phone, names]) => ({ Phone: phone, Patients: names.join(" | ") })),
    ["Phone", "Patients"]
  );
  sheet(
    "Phone already in clinic",
    existingPhones.map((r) => ({ Phone: r.phone, "Sheet patient": r.name, "Existing patient": r.existing })),
    ["Phone", "Sheet patient", "Existing patient"]
  );
  XLSX.writeFile(wb, reportPath);
}

// ---------- main ----------

async function listClinics(db) {
  const snap = await db.collection("clinics").get();
  for (const d of snap.docs) {
    const x = d.data();
    const [count, info, counters] = await Promise.all([
      db.collection(`clinics/${d.id}/patients`).count().get(),
      db.doc(`clinics/${d.id}/settings/clinic_info`).get(),
      db.doc(`clinics/${d.id}/settings/counters`).get(),
    ]);
    console.log(
      `${d.id}  ${x.name || x.clinicName || info.data()?.name || "(no name)"}  owner=${x.ownerEmail || x.ownerId || ""}` +
        `  patients=${count.data().count}  counter=${counters.data()?.patientId ?? "-"}`
    );
  }
}

async function main() {
  loadEnvLocal();
  const db = adminDb();
  if (LIST) return listClinics(db);
  if (!FILE || !CLINIC) throw new Error("Usage: --file <sheet> --clinic <id> [--apply] [--report <path>] [--tag <batch>]");
  if (!fs.existsSync(FILE)) throw new Error(`No such file: ${FILE}`);

  const clinicSnap = await db.doc(`clinics/${CLINIC}`).get();
  if (!clinicSnap.exists) throw new Error(`Clinic ${CLINIC} does not exist.`);
  const clinicName = clinicSnap.data().name || clinicSnap.data().clinicName || CLINIC;

  const batch = (valueOf("--tag") || path.basename(FILE).replace(/\.[^.]+$/, "")).replace(/[^\w\-]/g, "_").toLowerCase();
  const reportPath = valueOf("--report") || FILE.replace(/\.[^.]+$/, "") + ".import-report.xlsx";

  const wb = XLSX.readFile(FILE, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const { cols, titles } = detectColumns(rows[0] || []);
  console.log(`Sheet "${wb.SheetNames[0]}": ${rows.length - 1} rows. Columns:`, Object.fromEntries(Object.entries(cols).filter(([k]) => k !== "extra").map(([k, v]) => [k, titles[v]])), "extra:", cols.extra.map((i) => titles[i]));
  if (cols.name == null) throw new Error("Could not find a name column.");

  const mapped = [];
  const skipped = [];
  for (const row of rows.slice(1)) {
    if (!row || row.every((c) => c == null || String(c).trim() === "")) continue;
    const r = mapRow(row, cols, titles, COUNTRY, batch);
    if (r.skip) skipped.push(r);
    else mapped.push(r);
  }
  const { rows: imported, merges } = mergeDuplicateFiles(mapped);
  const possibles = possibleDuplicates(imported);

  // Flags: file numbers used twice, phones shared inside the sheet, phones already in the clinic.
  const byFile = new Map();
  const byPhone = new Map();
  for (const r of imported) {
    if (r.file) byFile.set(r.file, [...(byFile.get(r.file) || []), r.name]);
    if (r.doc.phone) byPhone.set(r.doc.phone, [...(byPhone.get(r.doc.phone) || []), r.name]);
  }
  const dupFiles = [...byFile].filter(([, n]) => n.length > 1);
  const dupPhones = [...byPhone].filter(([, n]) => n.length > 1);

  const col = db.collection(`clinics/${CLINIC}/patients`);
  const existingSnap = await col.get();
  const existingByPhone = new Map();
  const existingIds = new Set();
  for (const d of existingSnap.docs) {
    existingIds.add(d.id);
    const p = d.data().phone;
    if (p) existingByPhone.set(p, d.data().name || d.id);
  }
  const existingPhones = [];
  for (const r of imported) {
    r.existed = existingIds.has(r.id);
    if (!r.existed && r.doc.phone && existingByPhone.has(r.doc.phone)) {
      existingPhones.push({ phone: r.doc.phone, name: r.name, existing: existingByPhone.get(r.doc.phone) });
    }
  }

  const toWrite = imported.filter((r) => !r.existed);
  const maxFile = Math.max(0, ...imported.map((r) => Number(r.file)).filter((n) => Number.isFinite(n)));
  const countersRef = db.doc(`clinics/${CLINIC}/settings/counters`);
  const counterNow = (await countersRef.get()).data()?.patientId ?? null;

  console.log(`\nClinic: ${clinicName} (${CLINIC}) — ${existingSnap.size} patients already there`);
  console.log(`Rows with a patient: ${mapped.length}   skipped: ${skipped.length}   twice-typed rows folded: ${merges.length}   profiles: ${imported.length}   already imported earlier: ${imported.length - toWrite.length}`);
  console.log(`With a usable phone: ${imported.filter((r) => r.doc.phone).length}   with an age: ${imported.filter((r) => r.doc.age != null).length}   with notes: ${imported.filter((r) => r.doc.notes).length}`);
  console.log(`Flagged for a look: ${imported.filter((r) => r.problems.length).length}   same file # on two people: ${dupFiles.length}   possible duplicates: ${possibles.length}   shared phone (families): ${dupPhones.length}   phone already in clinic: ${existingPhones.length}`);
  console.log(`Highest file number: ${maxFile}   clinic counter now: ${counterNow ?? "unset"}`);

  writeReport(reportPath, { imported, skipped, dupFiles, dupPhones, existingPhones, merges, possibles });
  console.log(`Report: ${reportPath}`);

  if (!APPLY) {
    console.log("\nDry run — nothing written. Add --apply to import.");
    return;
  }

  const writer = db.bulkWriter();
  let written = 0;
  for (const r of toWrite) {
    writer.create(col.doc(r.id), { ...r.doc, createdAt: FieldValue.serverTimestamp() }).then(() => written++);
  }
  await writer.close();
  if (maxFile > (counterNow ?? 0)) await countersRef.set({ patientId: maxFile }, { merge: true });
  console.log(`\nWrote ${written} patients. Counter → ${Math.max(maxFile, counterNow ?? 0)} (next typed-in patient gets PT-${Math.max(maxFile, counterNow ?? 0) + 1}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
