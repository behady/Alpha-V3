import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { conversationKey } from "@/lib/bot/conversation";
import { adminDb } from "@/lib/firebaseAdmin";
import { notifyEvent } from "@/lib/notificationCatalog";
import { readAlertPreferences, readClinicMembers } from "@/lib/notificationDelivery";
import { sendStaffReport } from "@/lib/reports/sendStaffReport";
import { sendStaffWhatsApp } from "@/lib/staffWhatsapp";
import {
  askAssistantForStaff,
  clearStaffPending,
  confirmPrompt,
  decideStaffPending,
  loadStaffPending,
  staffDecision,
} from "@/lib/bot/staffAssistant";
import { normalizeToE164AssumingCountry } from "@/lib/phoneNumber";

/**
 * The staff line: what happens when the clinic's own people write to the clinic's number.
 *
 * Until this existed the bot treated the owner as whichever patient shared his phone, greeted him
 * by that patient's name, and offered to book him a check-up. The numbers a clinic enters on
 * Settings → Alerts & reports (and the owner number on Settings → WhatsApp) are the clinic's
 * people, so a message from one of them is answered as staff: by name and role, never through the
 * patient pipeline, with no opt-out footer and no handoff row.
 *
 * What it can do today is small and deliberate: send the reports on request. "Ask me anything
 * about the clinic" is milestone 4, and it must go through the assistant's own permission model —
 * the same one the in-app assistant uses — not a prompt bolted onto the patient bot.
 */

export interface StaffSender {
  uid: string;
  role: string;
  name: string;
}

/** Typed numbers ("01551552440") against WhatsApp's ("201551552440"): both become +20…. */
export function samePhone(a: string, b: string): boolean {
  const x = normalizeToE164AssumingCountry(a);
  const y = normalizeToE164AssumingCountry(b);
  return Boolean(x) && x === y;
}

/** The clinic member this phone belongs to, or null. Phones come from the recipients block only. */
export async function findStaffByPhone(clinicId: string, phone: string): Promise<StaffSender | null> {
  if (!phone) return null;
  const prefs = await readAlertPreferences(clinicId);
  const members = await readClinicMembers(clinicId);
  const roleOf = new Map(members.map((m) => [m.uid, m.role]));

  let uid = "";
  for (const [id, p] of Object.entries(prefs.people || {})) {
    // Any row the page saved counts, member or not: the platform admin looking after a clinic
    // gets a row of their own there and is nobody's patient.
    if (p?.phone && samePhone(p.phone, phone)) {
      uid = id;
      break;
    }
  }
  if (!uid) {
    // The owner's fallback number on Settings → WhatsApp is the owner.
    try {
      const wa = await adminDb().doc(`clinics/${clinicId}/settings/whatsapp`).get();
      const ownerNumber = String(wa.data()?.ownerNumber || "");
      if (ownerNumber && samePhone(ownerNumber, phone)) {
        uid = members.find((m) => m.role === "Owner")?.uid || "";
      }
    } catch {
      /* no fallback number */
    }
  }
  if (!uid) return null;

  let name = "";
  try {
    const staffSnap = await adminClinicCollection(clinicId, "staff").where("uid", "==", uid).limit(1).get();
    name = String(staffSnap.docs[0]?.data()?.name || "").trim();
    if (!name) {
      const userSnap = await adminDb().collection("users").doc(uid).get();
      name = String(userSnap.data()?.name || "").trim();
    }
  } catch {
    /* unnamed is fine */
  }
  return { uid, role: roleOf.get(uid) || "Admin", name };
}

export type StaffIntent = "evening" | "morning" | "summary" | "help" | "ask";

/**
 * What a staff member asked for.
 *
 * A word or two that names a report sends that report. A greeting, or "help", sends the menu.
 * Anything longer is a question for the assistant — "كام مريض جه النهارده؟" contains "النهارده",
 * but it is a question, not a request for the morning schedule, and the assistant can answer it.
 */
export function staffIntent(text: string): StaffIntent {
  const t = text.trim().toLowerCase().replace(/[؟?!.،,]+$/g, "").trim();
  if (!t) return "help";
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 2 && /^(hi+|hello|hey|help|menu|start|السلام عليكم|سلام|ازيك|إزيك|أهلا|اهلا|مرحبا|صباح الخير|مساء الخير|مساعدة|القايمة|القائمة|ابدأ)$/.test(t)) return "help";
  // The shortcuts are the bare word and nothing else. "تقرير الأطباء" is a request for a doctors'
  // report the assistant should build, not the close-out; a shortcut that fires on a substring is
  // exactly the scripted feel the owner complained about.
  if (/^(تقرير|التقرير|اقفال|إقفال|الاقفال|الإقفال|report|close-out|closeout)$/.test(t)) return "evening";
  if (/^(ملخص|الملخص|summary)$/.test(t)) return "summary";
  if (/^(النهارده|النهاردة|اليوم|مواعيد النهارده|today|schedule|today's schedule)$/.test(t)) return "morning";
  return "ask";
}

export function staffLanguage(text: string): "ar" | "en" {
  return /[؀-ۿ]/.test(text) ? "ar" : "en";
}

const ROLE_AR: Record<string, string> = { Owner: "المالك", Admin: "مدير", Dentist: "دكتور", Receptionist: "استقبال", Assistant: "مساعد" };

/** The line's own greeting: who you are to the system, and the three words it understands. */
export function staffHelpText(sender: StaffSender, clinicName: string, language: "ar" | "en"): string {
  const name = sender.name || (language === "ar" ? "يا فندم" : "there");
  if (language === "ar") {
    return [
      `أهلاً ${name} 👋`,
      `ده خط الفريق في *${clinicName}*. إنت متسجل عندنا كـ${ROLE_AR[sender.role] || sender.role}، مش كمريض.`,
      "التنبيهات والتقارير اللي فعّلتها من الإعدادات ← التنبيهات والتقارير بتوصلك هنا.",
      "",
      "اكتب كلمة وأبعتلك:",
      "• *تقرير* — إقفال اليوم",
      "• *النهارده* — مواعيد اليوم",
      "• *ملخص* — اليوم في تلات سطور",
      "",
      "أو اسألني أي سؤال عن العيادة بكلامك — مين محجوز بكرة، كام اتحصّل الأسبوع ده، رصيد مريض معين.",
      "وأقدر أنفّذ: احجز، انقل ميعاد، سجّل دفعة، ابعت رسالة لمريض — بأكّد معاك بـ نعم/لا قبل أي خطوة.",
    ].join("\n");
  }
  return [
    `Hello ${name} 👋`,
    `This is the team line at *${clinicName}*. You are registered as ${sender.role}, not as a patient.`,
    "The alerts and reports you switched on under Settings → Alerts & reports arrive here.",
    "",
    "Send one word and I will send it back:",
    "• *report* — the day's close-out",
    "• *today* — today's appointments",
    "• *summary* — the day in three lines",
    "",
    "Or just ask me anything about the clinic in your own words — who is booked tomorrow, what came in this week, a patient's balance.",
    "I can also act: book, move an appointment, record a payment, message a patient — I confirm with you (yes/no) before every step.",
  ].join("\n");
}

async function clinicName(clinicId: string): Promise<string> {
  try {
    const snap = await adminDb().collection("clinics").doc(clinicId).get();
    return String(snap.data()?.name || "").trim() || "Alpha Dental";
  } catch {
    return "Alpha Dental";
  }
}

export type StaffLineOutcome = { status: "replied"; text: string; handoff: false; reason: string } | { status: "skipped"; reason: string };

/**
 * Whether to answer this message at all, from when the line last spoke to this person.
 *
 * The owner's own number turned out to run a bot of its own (his new gateway), which answered the
 * evening report as if a patient had written, and the staff line answered THAT — two machines
 * politely replying to each other. A person cannot read a report and type a reply in eight
 * seconds, and no person needs more than five answers in two minutes; anything faster is a machine
 * and is left unanswered. Pure, so the arithmetic is pinned by a test.
 */
export function staffThrottle(replyTimesMs: number[], now: number): { allow: boolean; reason?: "echo" | "burst" } {
  const recent = replyTimesMs.filter((t) => now - t < 2 * 60 * 1000);
  const last = Math.max(0, ...replyTimesMs);
  if (last && now - last < 8_000) return { allow: false, reason: "echo" };
  if (recent.length >= 5) return { allow: false, reason: "burst" };
  return { allow: true };
}

async function readReplyTimes(clinicId: string, uid: string): Promise<number[]> {
  try {
    const snap = await adminClinicDoc(clinicId, "staff_line", uid).get();
    const raw = snap.data()?.replyTimesMs;
    return Array.isArray(raw) ? raw.map((x) => Number(x)).filter((x) => Number.isFinite(x)) : [];
  } catch {
    return [];
  }
}

async function noteReply(clinicId: string, uid: string, times: number[]): Promise<void> {
  await adminClinicDoc(clinicId, "staff_line", uid)
    .set({ replyTimesMs: [...times, Date.now()].slice(-10) }, { merge: true })
    .catch(() => {});
}

/**
 * Answer a staff member. Reports go through the same sender as the scheduled ones, redacted by
 * role the same way; the greeting goes out over the clinic's own gateway.
 */
export async function respondToStaffMessage(args: {
  clinicId: string;
  to: string;
  text: string;
  sender: StaffSender;
  /** The transcript, when the message was a voice note: the reply opens by echoing it. */
  heard?: string;
}): Promise<StaffLineOutcome> {
  const { clinicId, to, text, sender } = args;
  const echo = args.heard ? `🎙️ "${args.heard.slice(0, 200)}"\n\n` : "";

  const replyTimes = await readReplyTimes(clinicId, sender.uid);
  const gate = staffThrottle(replyTimes, Date.now());
  if (!gate.allow) return { status: "skipped", reason: `staff_${gate.reason}` };
  // Every send below counts as one reply; recorded once here rather than at each return.
  void noteReply(clinicId, sender.uid, replyTimes);
  const intent = staffIntent(text);
  const language = staffLanguage(text);

  // A staged action first: the person's next word decides it. Anything that is not a yes or a no
  // drops the staged action — a new question is a change of mind — and is answered on its own.
  const pending = await loadStaffPending(clinicId, sender.uid);
  if (pending) {
    const decision = staffDecision(text);
    if (decision) {
      const result = await decideStaffPending({ clinicId, uid: sender.uid, name: sender.name, actionId: pending.id, decision });
      const reply = !result.ok
        ? (language === "ar" ? `معرفتش أنفّذ: ${result.error}` : `Could not do that: ${result.error}`)
        : result.status === "rejected"
          ? (language === "ar" ? "تمام، اتلغت." : "Cancelled.")
          : result.manual
            ? `${result.message}\n\n${language === "ar" ? "مفيش واتساب متوصّل للمرضى، فالرسالة دي محتاجة تتبعت يدوي:" : "No patient gateway is connected, so this needs to be sent by hand:"}\n${result.manual.phone}\n${result.manual.text}`
            : `✅ ${result.message}`;
      const sent = await sendStaffWhatsApp({ clinicId, to, text: reply });
      return sent.sent ? { status: "replied", text: reply, handoff: false, reason: `staff_${decision}` } : { status: "skipped", reason: "staff_send_failed" };
    }
    await clearStaffPending(clinicId, sender.uid);
  }

  if (intent === "evening" || intent === "morning" || intent === "summary") {
    const eventId =
      intent === "evening" ? "eveningDigest" : intent === "summary" ? "ownerSummary" : sender.role === "Dentist" ? "morningBriefDentist" : "morningBriefClinic";
    const event = notifyEvent(eventId);
    if (event) {
      // Asked for by name, so the clinic's switch for that report does not apply — but the role
      // ceiling does: a receptionist asking for "report" gets the diary and no money.
      const result = await sendStaffReport({ clinicId, event, uids: [sender.uid], onDemand: true });
      if (result.whatsapped > 0) return { status: "replied", text: `[${eventId}]`, handoff: false, reason: `staff_${intent}` };
      const sorry =
        language === "ar"
          ? "مفيش حاجة تتقال عن النهارده لسه — مفيش مواعيد ولا تحصيل اتسجل."
          : "Nothing to report yet today — no appointments or payments recorded.";
      const sent = await sendStaffWhatsApp({ clinicId, to, text: sorry });
      return sent.sent ? { status: "replied", text: sorry, handoff: false, reason: `staff_${intent}_empty` } : { status: "skipped", reason: "staff_send_failed" };
    }
  }

  if (intent === "ask") {
    const answer = await askAssistantForStaff({ clinicId, uid: sender.uid, name: sender.name, question: text });
    if (answer.ok) {
      // A staged action becomes the card, in words, with the question under it.
      const reply = echo + (answer.pending
        ? [answer.reply, "", `📋 *${answer.pending.title}*`, ...answer.pending.lines, "", confirmPrompt(language)].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trim()
        : answer.reply);
      const sent = await sendStaffWhatsApp({ clinicId, to, text: reply });
      return sent.sent ? { status: "replied", text: reply, handoff: false, reason: answer.pending ? "staff_staged" : "staff_ask" } : { status: "skipped", reason: "staff_send_failed" };
    }
    console.warn(`staff line: assistant failed for ${sender.uid}: ${answer.reason}${answer.error ? ` — ${answer.error}` : ""}`);
    const sorry =
      language === "ar"
        ? "معرفتش أجاوب على ده دلوقتي. جرّب تاني بعد شوية، أو اسأل من المساعد جوه البرنامج."
        : "I could not answer that just now. Try again in a moment, or ask the assistant inside the app.";
    const sent = await sendStaffWhatsApp({ clinicId, to, text: `${sorry}\n\n${staffHelpText(sender, await clinicName(clinicId), language)}` });
    return sent.sent ? { status: "replied", text: sorry, handoff: false, reason: "staff_ask_failed" } : { status: "skipped", reason: "staff_send_failed" };
  }

  const help = staffHelpText(sender, await clinicName(clinicId), language);
  const sent = await sendStaffWhatsApp({ clinicId, to, text: help });
  return sent.sent ? { status: "replied", text: help, handoff: false, reason: "staff_help" } : { status: "skipped", reason: "staff_send_failed" };
}

/**
 * A staff member's chat is not a patient conversation, so it is kept out of the Chats inbox.
 *
 * The inbound webhooks call this BEFORE writing the message into the thread: nothing about the
 * owner's exchange with his own clinic is recorded where the front desk reads. The conversation
 * document may already exist from before the number was registered (the owner was answered as a
 * patient once); it is flagged so the inbox hides it and its handoff, if any, is closed so the
 * SLA job stops paging staff about "a patient waiting" who is the owner.
 *
 * Returns true when the message was handled here and the caller must not treat it as a patient's.
 */
export async function interceptStaffInbound(args: {
  clinicId: string;
  phone: string;
  text: string;
  /** What arrived when there was no text: "audio", "image", "document"… */
  media?: string;
  /** Turns a voice note into words. Supplied by the webhook, which knows its gateway's media API. */
  transcribe?: () => Promise<string>;
}): Promise<boolean> {
  const { clinicId, phone, media, transcribe } = args;
  if (!phone) return false;
  const sender = await findStaffByPhone(clinicId, phone).catch(() => null);
  if (!sender) return false;
  await adminClinicDoc(clinicId, "whatsapp_conversations", conversationKey(phone))
    .set({ staffLine: true, needsHuman: false, staffLineAt: FieldValue.serverTimestamp() }, { merge: true })
    .catch(() => {});

  // The owner talks to his clinic the way he talks to his staff: in voice notes. Transcribed
  // before anything reads the message, and echoed back so he knows what was heard.
  let text = String(args.text || "").trim();
  let heard = "";
  if (!text && media === "audio" && transcribe) {
    heard = (await transcribe().catch(() => "")).trim();
    text = heard;
  }
  if (!text) {
    const note =
      media === "audio"
        ? "مسمعتش الرسالة الصوتية كويس — ممكن تعيدها أو تكتبها؟\nI could not make out the voice note — could you resend it or type it?"
        : "أقدر أقرأ كلام ورسايل صوتية بس هنا. ابعت سؤالك مكتوب أو صوت.\nI can read text and voice notes here. Send your question as text or a voice note.";
    await sendStaffWhatsApp({ clinicId, to: phone, text: note });
    return true;
  }
  await respondToStaffMessage({ clinicId, to: phone, text, sender, heard: heard || undefined });
  return true;
}
