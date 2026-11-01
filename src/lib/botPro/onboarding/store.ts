/**
 * Where the onboarding of the Pro bot keeps its state, and the one seam every orchestrator uses to
 * reach it. Server-only collections, written with the admin SDK:
 *
 *   clinics/{id}/pro_onboarding/state            scan progress, the draft layer, the chat counters
 *   clinics/{id}/pro_onboarding/state/findings   one doc per scanned batch of chats
 *   clinics/{id}/pro_onboarding/state/chat       the owner <-> AI conversation
 *   clinics/{id}/pro_layers/{versionId}          saved layer versions
 *
 * `readState` is a tolerant parse (a half-written or hand-edited doc must not crash a route).
 * `firestoreOnboardingStore` is thin on purpose; tests inject their own OnboardingStore.
 *
 * Run: npm run test:pro-onboarding
 */
import type { CollectionReference, DocumentData, DocumentReference, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";
import { phoneKeysOf } from "../person";
import { EMPTY_LAYER, sanitizeLayer, type ClinicLayer, type ReplaySummary } from "../layer";
import type { ChunkFindings, RawConversation } from "./transcript";

export type ScanStatus = "idle" | "running" | "summarizing" | "done" | "failed";

export type OnboardingState = {
  scan: {
    status: ScanStatus;
    queue: string[];
    total: number;
    done: number;
    chatsRead: number;
    lockUntil: number;
    startedAt?: number;
    finishedAt?: number;
    error?: string;
  };
  learned: string[];
  questions: string[];
  draft: ClinicLayer;
  /** The draft as it was before the last change (owner chat, a save or a rescan): one step of undo. */
  previousDraft: ClinicLayer | null;
  liveVersion: string | null;
  nextVersion: number;
  chatDay: string;
  chatCount: number;
  usage: { calls: number; inTok: number; outTok: number };
};

export type LayerVersion = {
  id: string;
  version: number;
  layer: ClinicLayer;
  createdAt: number;
  createdBy: string;
  test: ReplaySummary;
};

export const EMPTY_STATE: OnboardingState = {
  scan: { status: "idle", queue: [], total: 0, done: 0, chatsRead: 0, lockUntil: 0 },
  learned: [],
  questions: [],
  draft: { ...EMPTY_LAYER },
  previousDraft: null,
  liveVersion: null,
  nextVersion: 1,
  chatDay: "",
  chatCount: 0,
  usage: { calls: 0, inTok: 0, outTok: 0 },
};

const STATUSES: readonly ScanStatus[] = ["idle", "running", "summarizing", "done", "failed"];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** A tolerant parse of the saved state: anything missing or the wrong type falls back to empty. */
export function readState(raw: unknown): OnboardingState {
  const r = isObj(raw) ? raw : {};
  const s = isObj(r.scan) ? r.scan : {};
  const u = isObj(r.usage) ? r.usage : {};
  const scan: OnboardingState["scan"] = {
    status: STATUSES.includes(s.status as ScanStatus) ? (s.status as ScanStatus) : "idle",
    queue: strings(s.queue),
    total: num(s.total, 0),
    done: num(s.done, 0),
    chatsRead: num(s.chatsRead, 0),
    lockUntil: num(s.lockUntil, 0),
    ...(typeof s.startedAt === "number" && Number.isFinite(s.startedAt) && s.startedAt > 0 ? { startedAt: s.startedAt } : {}),
    ...(typeof s.finishedAt === "number" && Number.isFinite(s.finishedAt) && s.finishedAt > 0 ? { finishedAt: s.finishedAt } : {}),
    ...(typeof s.error === "string" && s.error ? { error: s.error } : {}),
  };
  return {
    scan,
    learned: strings(r.learned),
    questions: strings(r.questions),
    draft: sanitizeLayer(r.draft).layer,
    previousDraft: isObj(r.previousDraft) ? sanitizeLayer(r.previousDraft).layer : null,
    liveVersion: typeof r.liveVersion === "string" && r.liveVersion ? r.liveVersion : null,
    nextVersion: typeof r.nextVersion === "number" && Number.isInteger(r.nextVersion) && r.nextVersion >= 1 ? r.nextVersion : EMPTY_STATE.nextVersion,
    chatDay: typeof r.chatDay === "string" ? r.chatDay : "",
    chatCount: num(r.chatCount, 0),
    usage: { calls: num(u.calls, 0), inTok: num(u.inTok, 0), outTok: num(u.outTok, 0) },
  };
}

/** Milliseconds from a Firestore Timestamp, a number or an ISO string; null when unreadable. */
export function toMs(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  if (isObj(v) && typeof (v as { toMillis?: unknown }).toMillis === "function") {
    const t = (v as { toMillis: () => number }).toMillis();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

// ---- paths ------------------------------------------------------------------------------------

export function onboardingStateRef(clinicId: string): DocumentReference<DocumentData> {
  return adminClinicDoc(clinicId, "pro_onboarding", "state");
}
export function findingsCol(clinicId: string): CollectionReference<DocumentData> {
  return onboardingStateRef(clinicId).collection("findings");
}
export function chatCol(clinicId: string): CollectionReference<DocumentData> {
  return onboardingStateRef(clinicId).collection("chat");
}
export function layerRef(clinicId: string, versionId: string): DocumentReference<DocumentData> {
  return adminClinicDoc(clinicId, "pro_layers", versionId);
}

// ---- the seam ---------------------------------------------------------------------------------

export interface OnboardingStore {
  getState(): Promise<OnboardingState>;
  /** Merge into the state doc. Keys may be dotted ("scan.status"); undefined values are dropped. */
  patchState(p: Partial<OnboardingState> | Record<string, unknown>): Promise<void>;
  /** Take the scan lock for `ms` if nobody holds it at `now`. One transaction, so two callers cannot both win. */
  tryLock(ms: number, now: number): Promise<boolean>;
  unlock(): Promise<void>;
  /** Newest first by lastAt, without rehearsal (play_) threads and without chats with the clinic's own staff. */
  recentConversationKeys(max: number): Promise<string[]>;
  loadConversation(key: string): Promise<RawConversation | null>;
  saveFindings(n: number, f: ChunkFindings): Promise<void>;
  allFindings(): Promise<ChunkFindings[]>;
  /** Delete every findings doc (a new scan starts from nothing). */
  clearFindings(): Promise<void>;
  addChat(role: "ai" | "owner", text: string): Promise<void>;
  /** Oldest first. `at` (ms) is filled by the Firestore store; test fakes may leave it out. */
  recentChat(max: number): Promise<Array<{ role: "ai" | "owner"; text: string; at?: number }>>;
  listVersions(): Promise<LayerVersion[]>;
  /** Take the next version number: read nextVersion and move it on, in one transaction. */
  allocateVersion(): Promise<number>;
  /** Create the version doc; false (nothing written) when a doc with that id already exists. */
  saveVersion(v: LayerVersion): Promise<boolean>;
  /** Set liveVersion to `id` only if it still is `expected`, in one transaction; false when it moved. */
  makeLiveIf(expected: string | null, id: string): Promise<boolean>;
}

/** Firestore's "a document with that id already exists" (gRPC ALREADY_EXISTS), from create(). */
export function isAlreadyExists(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === 6 || code === "already-exists" || code === "ALREADY_EXISTS";
}

const isPlain = (v: unknown): v is Record<string, unknown> => {
  if (!v || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** Firestore rejects undefined anywhere in a write; drop it from plain objects and arrays. */
function clean(v: unknown): unknown {
  if (Array.isArray(v)) return v.filter((x) => x !== undefined).map(clean);
  if (!isPlain(v)) return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = clean(x);
  return out;
}

/** {"scan.status": "x"} becomes {scan: {status: "x"}}: set-with-merge does not read dotted paths. */
function nested(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(p)) {
    if (value === undefined) continue;
    const parts = key.split(".");
    let at = out;
    for (const part of parts.slice(0, -1)) {
      if (!isPlain(at[part])) at[part] = {};
      at = at[part] as Record<string, unknown>;
    }
    at[parts[parts.length - 1]] = clean(value);
  }
  return out;
}

const SCAN_PAGE = 200;
/** Never read more than this many conversation docs looking for `max` usable ones. */
const SCAN_CAP = 3000;

/** Appointment phone shapes receptionists type (the same set person.ts looks up). */
function phoneVariants(phone: string): string[] {
  if (/@lid$/i.test(phone)) return [];
  const key = phoneKeysOf({ phone })[0] ?? "";
  if (key.length < 7) return [];
  const digits = phone.replace(/\D/g, "");
  return [...new Set([`+${digits}`, digits, `0${key}`, key, `+20${key}`, `20${key}`])].filter((v) => v.replace(/\D/g, "").length >= 7);
}

export function firestoreOnboardingStore(clinicId: string): OnboardingStore {
  const stateRef = onboardingStateRef(clinicId);

  return {
    async getState() {
      const snap = await stateRef.get();
      return readState(snap.exists ? snap.data() : undefined);
    },

    async patchState(p) {
      await stateRef.set(nested(p as Record<string, unknown>), { merge: true });
    },

    async tryLock(ms, now) {
      return adminDb().runTransaction(async (tx) => {
        const snap = await tx.get(stateRef);
        const held = Number((snap.data()?.scan as { lockUntil?: unknown } | undefined)?.lockUntil) || 0;
        if (held > now) return false;
        tx.set(stateRef, { scan: { lockUntil: now + ms } }, { merge: true });
        return true;
      });
    },

    async unlock() {
      await stateRef.set({ scan: { lockUntil: 0 } }, { merge: true });
    },

    async recentConversationKeys(max) {
      const keys: string[] = [];
      const convs = adminClinicCollection(clinicId, "whatsapp_conversations");
      let cursor: QueryDocumentSnapshot | null = null;
      let scanned = 0;
      while (keys.length < max && scanned < SCAN_CAP) {
        let q = convs.orderBy("lastAt", "desc").limit(SCAN_PAGE);
        if (cursor) q = q.startAfter(cursor);
        const snap = await q.get();
        if (snap.empty) break;
        for (const d of snap.docs) {
          if (d.id.startsWith("play_") || d.data().staffLine === true) continue;
          keys.push(d.id);
          if (keys.length >= max) break;
        }
        scanned += snap.size;
        if (snap.size < SCAN_PAGE) break;
        cursor = snap.docs[snap.docs.length - 1];
      }
      return keys;
    },

    async loadConversation(key) {
      const ref = adminClinicDoc(clinicId, "whatsapp_conversations", key);
      const [snap, msgSnap] = await Promise.all([ref.get(), ref.collection("messages").orderBy("at", "desc").limit(60).get()]);
      if (!snap.exists) return null;
      const data = snap.data() || {};
      const patientId = typeof data.patientId === "string" && data.patientId ? data.patientId : undefined;
      const phone = typeof data.phone === "string" && data.phone ? data.phone : undefined;
      const messages = msgSnap.docs
        .map((d) => d.data() || {})
        .map((m) => ({ author: String(m.author ?? ""), text: String(m.text ?? ""), at: Number(m.at) || 0 }))
        .reverse();

      const appts = adminClinicCollection(clinicId, "appointments");
      let docs: QueryDocumentSnapshot[] = [];
      try {
        if (patientId) {
          docs = (await appts.where("patientId", "==", patientId).get()).docs;
        } else if (phone) {
          const variants = phoneVariants(phone);
          if (variants.length) docs = (await appts.where("patientPhone", "in", variants).get()).docs;
        }
      } catch {
        docs = []; // no appointments read means "unknown"; the chat is still worth reading
      }
      const appointmentsCreatedAt = docs.map((d) => toMs(d.data()?.createdAt)).filter((t): t is number => t !== null);

      return { key, ...(patientId ? { patientId } : {}), ...(phone ? { phone } : {}), messages, appointmentsCreatedAt };
    },

    async saveFindings(n, f) {
      await findingsCol(clinicId).doc(String(n).padStart(4, "0")).set(clean({ ...f, n, savedAt: Date.now() }) as Record<string, unknown>);
    },

    async allFindings() {
      const snap = await findingsCol(clinicId).orderBy("n").get();
      return snap.docs.map((d) => {
        const x = d.data() || {};
        return {
          faq: strings(x.faq),
          answers: strings(x.answers),
          selling: strings(x.selling),
          facts: strings(x.facts),
          handoffs: strings(x.handoffs),
          avoid: strings(x.avoid),
          chats: num(x.chats, 0),
          booked: num(x.booked, 0),
        };
      });
    },

    async clearFindings() {
      const col = findingsCol(clinicId);
      for (;;) {
        const snap = await col.limit(400).get();
        if (snap.empty) return;
        const batch = adminDb().batch();
        for (const d of snap.docs) batch.delete(d.ref);
        await batch.commit();
        if (snap.size < 400) return;
      }
    },

    async addChat(role, text) {
      await chatCol(clinicId).add({ role, text, at: Date.now() });
    },

    async recentChat(max) {
      const snap = await chatCol(clinicId).orderBy("at", "desc").limit(max).get();
      return snap.docs
        .map((d) => d.data() || {})
        .map((x) => ({ role: (x.role === "owner" ? "owner" : "ai") as "ai" | "owner", text: String(x.text ?? ""), at: num(x.at, 0) }))
        .reverse();
    },

    async listVersions() {
      const snap = await adminClinicCollection(clinicId, "pro_layers").orderBy("version", "desc").get();
      return snap.docs.map((d) => {
        const x = d.data() || {};
        return {
          id: d.id,
          version: num(x.version, 0),
          layer: sanitizeLayer(x.layer).layer,
          createdAt: num(x.createdAt, 0),
          createdBy: String(x.createdBy ?? ""),
          test: x.test as ReplaySummary,
        };
      });
    },

    async allocateVersion() {
      return adminDb().runTransaction(async (tx) => {
        const snap = await tx.get(stateRef);
        const n = readState(snap.exists ? snap.data() : undefined).nextVersion;
        tx.set(stateRef, { nextVersion: n + 1 }, { merge: true });
        return n;
      });
    },

    async saveVersion(v) {
      try {
        // create(), not set(): a version id is never overwritten, whatever raced to it.
        await layerRef(clinicId, v.id).create(
          clean({ version: v.version, layer: v.layer, createdAt: v.createdAt, createdBy: v.createdBy, test: v.test }) as Record<string, unknown>,
        );
        return true;
      } catch (e) {
        if (isAlreadyExists(e)) return false;
        throw e;
      }
    },

    async makeLiveIf(expected, id) {
      return adminDb().runTransaction(async (tx) => {
        const snap = await tx.get(stateRef);
        if (readState(snap.exists ? snap.data() : undefined).liveVersion !== expected) return false;
        tx.set(stateRef, { liveVersion: id }, { merge: true });
        return true;
      });
    },
  };
}
