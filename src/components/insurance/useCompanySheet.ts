"use client";

/**
 * The live inputs the company's monthly sheet is worked out from, read in the browser:
 * the treatment cards behind the charges (and every card that continues one) and the months
 * already sent. `companyStatement` does the rest.
 *
 * Everything here is a listener, so a card marked Done, a finish date changed or a Mark as sent on
 * another screen moves the sheet at once. `inputs` stays null until both have answered once.
 */

import { useEffect, useMemo, useState } from "react";
import { documentId, onSnapshot, query, where, type DocumentData, type QueryDocumentSnapshot } from "firebase/firestore";
import { getClinicCollection } from "@/lib/db-utils";
import { toYmd } from "@/lib/reports/patientStats";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import {
  COMPANY_SHEET_START,
  sentDocId,
  type SentMonth,
  type SheetCard,
  type SheetCharge,
  type SheetInputs,
} from "@/lib/insurance/companySheet";

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function chunksOf<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function cardOf(id: string, d: DocumentData): SheetCard {
  return {
    id,
    status: d.status,
    date: d.date,
    completedDate: d.completedDate,
    continuedFromNoteId: d.continuedFromNoteId,
    doctor: d.doctor,
    createdByName: d.createdByName,
    finishLog: d.finishLog,
  };
}

function sentOf(d: QueryDocumentSnapshot<DocumentData>, payerId: string): SentMonth | null {
  const data = d.data();
  if (data.payerId !== payerId) return null; // a payer id that is a prefix of another
  const month = text(data.month);
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const chargeIds = Array.isArray(data.chargeIds) ? data.chargeIds.filter((x): x is string => typeof x === "string") : [];
  const sent: SentMonth = { month, chargeIds };
  const at = (data.sentAt as { toDate?: () => Date } | null | undefined)?.toDate?.();
  if (at) sent.sentAt = ymdInTimeZone(clinicTimeZone(), at); // the clinic's day, not the UTC day
  const by = text(data.sentByName);
  if (by) sent.sentByName = by;
  return sent;
}

/** Live cards and sent months for a company's charges. `charges`: every charge of the company, all branches. */
export function useCompanySheet(
  clinicId: string | null,
  payerId: string,
  charges: readonly SheetCharge[] | null,
): { inputs: SheetInputs | null; failed: boolean } {
  const [cards, setCards] = useState<ReadonlyMap<string, SheetCard>>(new Map());
  // The charge-note key the cards were last fully answered for (so a growing set does not blank `inputs`).
  const [cardsFor, setCardsFor] = useState<string | null>(null);
  const [extra, setExtra] = useState<{ key: string; ids: string[] }>({ key: "", ids: [] });
  // Each answer carries the scope it was read for, so a clinic or company switch shows "not loaded" with no reset in an effect.
  const [sentAt, setSentAt] = useState<{ key: string; sent: readonly SentMonth[] } | null>(null);
  const [failedAt, setFailedAt] = useState<string | null>(null);

  // Only charges from the start month are looked up; the rest never enter the walk.
  const sheetCharges = useMemo(
    () => (charges ? charges.filter((c) => toYmd(c.date) >= `${COMPANY_SHEET_START}-01`) : null),
    [charges],
  );
  const noteKey = useMemo(
    () => (sheetCharges ? [...new Set(sheetCharges.map((c) => text(c.clinicalNoteId)).filter(Boolean))].sort().join(",") : null),
    [sheetCharges],
  );
  const scopeKey = `${clinicId ?? ""}|${payerId}`;

  // Sent months.
  useEffect(() => {
    if (!clinicId) return;
    const stops = [
      onSnapshot(
        query(
          getClinicCollection("settings"),
          where(documentId(), ">=", sentDocId(payerId, "0000-00")),
          where(documentId(), "<=", sentDocId(payerId, "9999-99")),
        ),
        (snap) => setSentAt({ key: scopeKey, sent: snap.docs.flatMap((d) => sentOf(d, payerId) ?? []) }),
        () => setFailedAt(scopeKey),
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, [clinicId, payerId, scopeKey]);

  // Cards: each charge's own card, then every card that continues one we hold, until stable.
  useEffect(() => {
    if (!clinicId || noteKey === null) return;
    const key = `${scopeKey}|${noteKey}`;
    const known = extra.key === key ? extra.ids : [];
    const ids = [...new Set([...(noteKey ? noteKey.split(",") : []), ...known])];
    if (ids.length === 0) return; // nothing to look up: `ready` below needs no cards
    const parts = chunksOf(ids, 30);
    const have = new Set(ids);
    const buckets = new Map<string, SheetCard[]>();
    const answered = new Set<string>();
    const total = parts.length * 2;
    const publish = () => {
      // Nothing is shown until every listener has answered once: a half-read set would flicker patients between lists.
      if (answered.size < total) return;
      const merged = new Map<string, SheetCard>();
      for (const list of buckets.values()) for (const c of list) merged.set(c.id, c);
      setCards(merged);
      setCardsFor(key);
    };
    const stops = parts.flatMap((part, i) => {
      const listen = (bucket: string, q: ReturnType<typeof query>, grow: boolean) =>
        onSnapshot(
          q,
          (snap) => {
            buckets.set(bucket, snap.docs.map((d) => cardOf(d.id, d.data() as DocumentData)));
            answered.add(bucket);
            publish();
            if (grow) {
              const fresh = snap.docs.map((d) => d.id).filter((id) => !have.has(id));
              if (fresh.length) {
                fresh.forEach((id) => have.add(id));
                setExtra((prev) => ({ key, ids: [...new Set([...(prev.key === key ? prev.ids : []), ...fresh])] }));
              }
            }
          },
          () => setFailedAt(scopeKey),
        );
      return [
        listen(`id${i}`, query(getClinicCollection("clinical_notes"), where(documentId(), "in", part)), false),
        listen(`next${i}`, query(getClinicCollection("clinical_notes"), where("continuedFromNoteId", "in", part)), true),
      ];
    });
    return () => stops.forEach((stop) => stop());
    // `extra` is read for its ids only when it belongs to this key; growing it re-subscribes with the larger set.
  }, [clinicId, scopeKey, noteKey, extra]);

  const sent = sentAt?.key === scopeKey ? sentAt.sent : null;
  const failed = failedAt === scopeKey;
  const cardsRead = noteKey === "" || cardsFor === `${scopeKey}|${noteKey}`;
  const ready = sheetCharges !== null && noteKey !== null && cardsRead && sent !== null;
  const inputs = useMemo<SheetInputs | null>(
    () => (ready && charges && sent ? { charges, cards: noteKey === "" ? [] : [...cards.values()], sent } : null),
    [ready, charges, cards, noteKey, sent],
  );
  return { inputs, failed };
}

/**
 * Every procedure charge of one company, live (for screens that do not already hold them).
 * `payerId` null = no company picked: nothing is read. An unreadable ledger is `failed`, not an empty list.
 */
export function useCompanyCharges(payerId: string | null): { charges: SheetCharge[] | null; failed: boolean } {
  const [answer, setAnswer] = useState<{ payerId: string; list: SheetCharge[] | null } | null>(null);
  useEffect(() => {
    if (!payerId) return;
    // Two equality filters: served by the single-field indexes, no composite index needed.
    return onSnapshot(
      query(getClinicCollection("ledger"), where("payerId", "==", payerId), where("type", "==", "procedure")),
      (snap) =>
        setAnswer({
          payerId,
          list: snap.docs
            .map((d) => ({ ...(d.data() as Record<string, unknown>), id: d.id }) as SheetCharge)
            .filter((c) => !["deleted", "cancelled"].includes(String((c as Record<string, unknown>).status || "").toLowerCase())),
        }),
      () => setAnswer({ payerId, list: null }),
    );
  }, [payerId]);
  const mine = payerId && answer?.payerId === payerId ? answer : null;
  return { charges: mine?.list ?? null, failed: mine !== null && mine.list === null };
}
