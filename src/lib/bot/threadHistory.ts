import { FieldValue } from "firebase-admin/firestore";
import { adminClinicDoc } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";
import { conversationKey } from "./conversation";
import { findStaffByPhone } from "./staffLine";
import { attachPatientIfMissing } from "./thread";
import {
  historyAddress,
  historyLine,
  historyLineId,
  isAlreadyInThread,
  type ExistingLine,
  type HistoryItem,
} from "./threadHistoryPlan";

const PREVIEW_CHARS = 160;
/** Firestore allows 500 writes per batch; a little room for the parent summary. */
const BATCH_LINES = 400;

/**
 * File messages the system did not see happen into the chat threads they belong to.
 *
 * Used for the copy of old chats WhatsApp hands a newly linked phone, for messages that piled up
 * while the gateway was reconnecting, and for each message a receptionist types on the clinic's
 * phone. Nothing is answered and nothing is counted unread: these are the record, not news. The
 * list preview moves only when a filed line is newer than what the chat already shows, so an old
 * copy arriving late never pushes a live conversation down the list.
 *
 * Chats with the clinic's own staff are skipped, as the live inbound path keeps them out of the
 * inbox too.
 */
export async function fileHistoryIntoThreads(
  clinicId: string,
  items: HistoryItem[]
): Promise<{ written: number; addresses: string[] }> {
  const groups = new Map<string, { address: string; items: HistoryItem[] }>();
  for (const item of items) {
    const address = historyAddress(item.from);
    if (!address) continue;
    const key = conversationKey(address);
    if (key === "unknown") continue;
    if (!groups.has(key)) groups.set(key, { address, items: [] });
    groups.get(key)!.items.push(item);
  }

  let written = 0;
  const addresses: string[] = [];
  // A few chats at a time: a history batch spans dozens of chats, and one after another would
  // outlast the gateway's wait for an answer.
  const queue = [...groups.entries()];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const n = await fileOneThread(clinicId, next[0], next[1]);
      if (n > 0) {
        written += n;
        addresses.push(next[1].address);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
  return { written, addresses };
}

/** One chat's share of a batch. Returns how many lines were added. */
async function fileOneThread(clinicId: string, key: string, group: { address: string; items: HistoryItem[] }): Promise<number> {
  const isLid = /@lid$/i.test(group.address);
  if (!isLid && (await findStaffByPhone(clinicId, group.address).catch(() => null))) return 0;

  const parent = adminClinicDoc(clinicId, "whatsapp_conversations", key);
  const list = group.items.slice().sort((a, b) => a.timestamp - b.timestamp);
  const minAt = list[0].timestamp * 1000 - 5 * 60 * 1000;
  const maxAt = list[list.length - 1].timestamp * 1000 + 5 * 60 * 1000;

  const [parentSnap, existingSnap] = await Promise.all([
    parent.get(),
    parent
      .collection("messages")
      .where("at", ">=", minAt)
      .where("at", "<=", maxAt)
      .select("messageId", "waMessageId", "direction", "text", "at")
      .get(),
  ]);
  const existing: ExistingLine[] = existingSnap.docs.map((d) => d.data() as ExistingLine);

  const fresh: HistoryItem[] = [];
  for (const item of list) {
    if (isAlreadyInThread(item, existing)) continue;
    fresh.push(item);
    // The same message twice in one batch is still one line.
    existing.push({ messageId: item.id, direction: item.fromMe ? "out" : "in", text: item.body, at: item.timestamp * 1000 });
  }
  if (!fresh.length) return 0;

  for (let i = 0; i < fresh.length; i += BATCH_LINES) {
    const batch = adminDb().batch();
    for (const item of fresh.slice(i, i + BATCH_LINES)) {
      batch.set(parent.collection("messages").doc(historyLineId(item.id)), {
        ...historyLine(item),
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  const newest = fresh[fresh.length - 1];
  const newestAt = newest.timestamp * 1000;
  const shownAt = Number(parentSnap.data()?.lastAt) || 0;
  if (!parentSnap.exists || newestAt > shownAt) {
    const line = historyLine(newest);
    await parent.set(
      {
        phone: group.address,
        lastText: line.text.replace(/\s+/g, " ").slice(0, PREVIEW_CHARS),
        lastAt: newestAt,
        lastDirection: line.direction,
        lastAuthor: line.author,
        channel: "wapilot",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  if (!isLid) await attachPatientIfMissing(clinicId, key, group.address).catch(() => {});

  return fresh.length;
}
