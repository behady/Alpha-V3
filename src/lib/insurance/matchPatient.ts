/**
 * Which patient a scanned approval belongs to.
 *
 * The paper names the patient in Latin capitals (`NADER MAGED SALEM`); the clinic's records are in
 * Arabic. Two signals, strongest first:
 *   1. the insurer's own identity — certificate number + dependent code, stored on the patient;
 *   2. the name, compared through a vowel-less Latin skeleton so that transliteration spelling
 *      (MOHAMED / MOHAMMED / محمد) does not matter.
 *
 * A patient whose record holds the same certificate under a DIFFERENT dependent code is a family
 * member, never the patient on the paper — whatever their name looks like. Pure; no I/O.
 */

import { readInsurance } from "../patientInsurance";

export type PatientLite = { id: string; name: string; insurance?: unknown };

export type PatientMatch =
  | { kind: "exact"; patientId: string }
  | { kind: "candidates"; candidates: { patientId: string; name: string; score: number }[] }
  | { kind: "none" };

/** Arabic letter -> Latin letters. Vowel-ish letters are mapped too and dropped afterwards. */
const LETTERS: Record<string, string> = {
  "ا": "a", "أ": "a", "إ": "a", "آ": "a", "ع": "a", "ة": "a",
  "ب": "b", "ت": "t", "ط": "t", "ث": "t", "ج": "g",
  "ح": "h", "ه": "h", "خ": "h", "د": "d", "ض": "d", "ذ": "z", "ز": "z", "ظ": "z", "ر": "r",
  "س": "s", "ص": "s", "ش": "sh", "غ": "gh", "ف": "f", "ق": "k", "ك": "k",
  "ل": "l", "م": "m", "ن": "n", "و": "w", "ؤ": "w", "ي": "y", "ى": "y", "ئ": "y",
  "ء": "",
  // Latin spellings that stand for the same Arabic letter as the one above
  j: "g",
  q: "k",
};

const NOT_A_LETTER = /[^a-z]/g;
const DIACRITICS = /[ً-ْٰـ]/g; // harakat, dagger alif, tatweel

/** One name -> one skeleton token per word: consonants only, doubles collapsed. */
export function latinSkeleton(name: string): string[] {
  const text = String(name ?? "")
    .replace(DIACRITICS, "")
    .toLowerCase()
    // the Latin digraphs that are one Arabic letter: KHALED = خالد, THAMER = ثامر, DHAKI = ذكي
    .replace(/kh/g, "h")
    .replace(/th/g, "t")
    .replace(/dh/g, "z");
  return text
    .split(/\s+/)
    .map((word) =>
      Array.from(word, (ch) => LETTERS[ch] ?? ch)
        .join("")
        .replace(NOT_A_LETTER, "")
        .replace(/[aeiouyw]/g, "")
        .replace(/(.)\1+/g, "$1"),
    )
    .filter(Boolean);
}

/**
 * Words that are written apart in Latin (ABDEL RAHMAN, EL SAYED) and together in Arabic (عبدالرحمن,
 * السيد), in skeleton form: abd, abdel/abdul, el/al, abu/abou.
 */
const PREFIXES = new Set(["bd", "bdl", "l", "b"]);

/** Each prefix word joined onto the word that follows it, so both scripts split the name the same way. */
function mergePrefixes(tokens: string[]): string[] {
  const out: string[] = [];
  let pending = "";
  for (const token of tokens) {
    if (PREFIXES.has(token)) {
      pending += token;
      continue;
    }
    out.push(pending + token);
    pending = "";
  }
  if (pending) out.push(pending);
  return out;
}

function pairedShare(left: string[], right: string[]): number {
  const longest = Math.max(left.length, right.length);
  if (longest === 0) return 0;
  const free = [...right];
  let matched = 0;
  for (const token of left) {
    const at = free.indexOf(token);
    if (at < 0) continue;
    free.splice(at, 1);
    matched++;
  }
  return matched / longest;
}

/** Share of one-to-one matching tokens, 0..1; the better of the plain and the prefix-merged reading. */
function skeletonSimilarity(left: string[], right: string[]): number {
  return Math.max(pairedShare(left, right), pairedShare(mergePrefixes(left), mergePrefixes(right)));
}

/** Matched tokens / the longer name's token count, 0..1. Tokens pair one-to-one on equal skeletons. */
export function nameSimilarity(a: string, b: string): number {
  return skeletonSimilarity(latinSkeleton(a), latinSkeleton(b));
}

const CANDIDATE_FLOOR = 0.5;
const CANDIDATE_LIMIT = 3;

export function matchPatient(
  x: { payerId: string; certificateNumber: string; dependentCode: string; paperPatientName: string },
  patients: PatientLite[],
): PatientMatch {
  const payerId = String(x.payerId ?? "");
  const certificate = String(x.certificateNumber ?? "").trim();
  const dependent = String(x.dependentCode ?? "").trim();
  const paper = latinSkeleton(String(x.paperPatientName ?? ""));
  const scored = (list: PatientLite[]) =>
    list
      .map((p) => {
        const name = String(p.name ?? "");
        return { patientId: p.id, name, score: skeletonSimilarity(paper, latinSkeleton(name)) };
      })
      .sort((p, q) => q.score - p.score || p.name.localeCompare(q.name));

  const sameCertificate: PatientLite[] = [];
  const identical: PatientLite[] = [];
  for (const p of patients) {
    const held = certificate ? readInsurance({ insurance: p.insurance })[payerId] : undefined;
    if (!held || held.certificateNumber !== certificate) continue;
    if (dependent && held.dependentCode === dependent) identical.push(p);
    else sameCertificate.push(p);
  }
  if (identical.length === 1) return { kind: "exact", patientId: identical[0].id };
  // two records claim the same certificate and dependent: let the desk choose by name
  if (identical.length > 1) return { kind: "candidates", candidates: scored(identical) };

  // No dependent code on the paper: the certificate's own family is the likeliest match, so offer it
  // first, whatever the names look like. With a code, those people are other members, never offered.
  const family = new Set(sameCertificate.map((p) => p.id));
  const offered = dependent ? [] : scored(sameCertificate);
  const byName = scored(patients.filter((p) => !family.has(p.id))).filter((c) => c.score >= CANDIDATE_FLOOR);
  const candidates = [...offered, ...byName].slice(0, CANDIDATE_LIMIT);
  return candidates.length ? { kind: "candidates", candidates } : { kind: "none" };
}
