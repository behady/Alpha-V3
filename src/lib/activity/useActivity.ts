"use client";

/**
 * Activity log v2, the page's data: one-off reads (`getDocs`), not live listeners. An audit page
 * is read, not watched, and a listener over a 5,000-entry range would re-deliver all of it on
 * every new action anywhere in the clinic. The page has a refresh button instead.
 *
 * Results are kept with the request they answer (`key`), so "loading" is simply "the result on
 * hand is for another request" and no state is set synchronously inside an effect.
 */

import { useCallback, useEffect, useState } from "react";
import {
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from "firebase/firestore";
import { getClinicCollection } from "@/lib/db-utils";
import { useClinic } from "@/context/ClinicContext";
import type { ActivityLogDoc } from "./types";

/** Entries per read. */
export const RANGE_PAGE_SIZE = 500;
/** A date range stops loading here and the page says so. */
export const RANGE_CAP = 5000;
/** Entries per read in a patient's file. */
export const PATIENT_PAGE_SIZE = 200;

type Snap = QueryDocumentSnapshot<DocumentData>;
const toLog = (d: Snap): ActivityLogDoc => ({ id: d.id, ...d.data() }) as ActivityLogDoc;

type RangeResult = { key: string; logs: ActivityLogDoc[]; capped: boolean; error: boolean };

/**
 * Every entry with `start <= timestamp < end`, newest first, read 500 at a time until the range is
 * complete or 5,000 entries are in hand (`capped`). A single-field range: no composite index.
 */
export function useActivityRange(start: Date, end: Date): {
  logs: ActivityLogDoc[];
  loading: boolean;
  capped: boolean;
  error: boolean;
  reload: () => void;
} {
  const { clinicId } = useClinic();
  const [tick, setTick] = useState(0);
  const startMs = start.getTime();
  const endMs = end.getTime();
  const key = `${clinicId ?? ""}|${startMs}|${endMs}|${tick}`;
  const [result, setResult] = useState<RangeResult>({ key: "", logs: [], capped: false, error: false });

  useEffect(() => {
    if (!clinicId) return;
    let cancelled = false;
    (async () => {
      try {
        const col = getClinicCollection("system_logs");
        const logs: ActivityLogDoc[] = [];
        let last: Snap | null = null;
        let capped = false;
        for (;;) {
          const parts = [
            where("timestamp", ">=", new Date(startMs)),
            where("timestamp", "<", new Date(endMs)),
            orderBy("timestamp", "desc"),
          ] as const;
          const q: Query<DocumentData> = last
            ? query(col, ...parts, startAfter(last), limit(RANGE_PAGE_SIZE))
            : query(col, ...parts, limit(RANGE_PAGE_SIZE));
          const snap: QuerySnapshot<DocumentData> = await getDocs(q);
          if (cancelled) return;
          for (const d of snap.docs) logs.push(toLog(d));
          if (snap.docs.length < RANGE_PAGE_SIZE) break;
          if (logs.length >= RANGE_CAP) {
            capped = true;
            break;
          }
          last = snap.docs[snap.docs.length - 1];
        }
        if (!cancelled) setResult({ key, logs: logs.slice(0, RANGE_CAP), capped, error: false });
      } catch (err) {
        console.error("Activity log: could not read the range", err);
        if (!cancelled) setResult({ key, logs: [], capped: false, error: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clinicId, startMs, endMs, key]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const current = result.key === key;
  return {
    // While a new request is in flight the previous answer stays on screen (dimmed by the page),
    // rather than blanking the list on every refresh.
    logs: result.logs,
    loading: !current,
    capped: current && result.capped,
    error: current && result.error,
    reload,
  };
}

type PatientResult = { key: string; logs: ActivityLogDoc[]; cursor: Snap | null; hasOlder: boolean; error: boolean };

/**
 * One patient's entries, newest first, 200 at a time with "load older". Needs the composite index
 * `system_logs (patientId ASC, timestamp DESC)`.
 */
export function usePatientActivity(patientId: string): {
  logs: ActivityLogDoc[];
  loading: boolean;
  hasOlder: boolean;
  loadOlder: () => void;
  error: boolean;
  reload: () => void;
} {
  const { clinicId } = useClinic();
  const [tick, setTick] = useState(0);
  const key = `${clinicId ?? ""}|${patientId}|${tick}`;
  const [result, setResult] = useState<PatientResult>({ key: "", logs: [], cursor: null, hasOlder: false, error: false });
  const [olderBusy, setOlderBusy] = useState(false);

  useEffect(() => {
    if (!clinicId || !patientId) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(
          getClinicCollection("system_logs"),
          where("patientId", "==", patientId),
          orderBy("timestamp", "desc"),
          limit(PATIENT_PAGE_SIZE),
        ));
        if (cancelled) return;
        setResult({
          key,
          logs: snap.docs.map(toLog),
          cursor: snap.docs[snap.docs.length - 1] ?? null,
          hasOlder: snap.docs.length === PATIENT_PAGE_SIZE,
          error: false,
        });
      } catch (err) {
        console.error("Activity log: could not read the patient's entries", err);
        if (!cancelled) setResult({ key, logs: [], cursor: null, hasOlder: false, error: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clinicId, patientId, key]);

  const current = result.key === key;

  const loadOlder = useCallback(() => {
    if (!current || !result.cursor || !result.hasOlder || olderBusy) return;
    const forKey = result.key;
    const cursor = result.cursor;
    setOlderBusy(true);
    (async () => {
      try {
        const snap = await getDocs(query(
          getClinicCollection("system_logs"),
          where("patientId", "==", patientId),
          orderBy("timestamp", "desc"),
          startAfter(cursor),
          limit(PATIENT_PAGE_SIZE),
        ));
        setResult((r) => (r.key !== forKey ? r : {
          ...r,
          logs: [...r.logs, ...snap.docs.map(toLog)],
          cursor: snap.docs[snap.docs.length - 1] ?? r.cursor,
          hasOlder: snap.docs.length === PATIENT_PAGE_SIZE,
        }));
      } catch (err) {
        console.error("Activity log: could not read older entries", err);
        setResult((r) => (r.key !== forKey ? r : { ...r, error: true }));
      } finally {
        setOlderBusy(false);
      }
    })();
  }, [current, result.cursor, result.hasOlder, result.key, olderBusy, patientId]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return {
    logs: current ? result.logs : [],
    loading: !current || olderBusy,
    hasOlder: current && result.hasOlder,
    loadOlder,
    error: current && result.error,
    reload,
  };
}
