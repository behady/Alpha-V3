import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { conversationKey } from "@/lib/bot/conversation";
import { clinicHasFeature } from "@/lib/clinicFeatures";
import { createUsageMeter, logAiCreditUsage } from "@/lib/aiCreditLog";
import { adSubjectText, readStoredAd } from "@/lib/bot/adReferral";
import { gradeAgreement, isLeadGrade, rulesGrade, signalsFromThread, type LeadGrade, type LeadGradeFields } from "./leadGrade";

/**
 * Grading one lead on the server: the free rule score every time, the model when it is worth it.
 *
 * Called after every inbound WhatsApp message (from both webhooks), by the nightly sweep, and
 * by the weekly review. The model is consulted only when there is something new to read — the
 * conversation moved since it last looked — and at most once per lead per day, so a person who
 * writes back three days later is re-graded (the user's requirement) without a chatty lead
 * costing a credit per message. Rules run regardless, which is what lets a grade cool off on
 * silence with no model call at all.
 *
 * Before the clinic approves a grading flow the AI grade is written but not shown; the weekly
 * review reads it to say how often it agreed with the desk. See lib/leads/leadGrade.ts.
 */

const MODEL = "gemini-flash-latest";
const OPEN_STAGES = ["new", "contacted"];
const THREAD_LINES = 24;
const MODEL_TIMEOUT_MS = 20_000;

export const LEAD_GRADING_DOC = "lead_grading";

export interface ApprovedFlow {
  text: string;
  weekKey: string;
  approvedAtMs: number;
  approvedBy?: string;
}

export interface LeadGradingSettings {
  /** The clinic's switch. Default on: the AI watches from day one, silently. */
  enabled: boolean;
  approvedFlow: ApprovedFlow | null;
}

export async function loadLeadGradingSettings(clinicId: string): Promise<LeadGradingSettings> {
  const snap = await adminClinicDoc(clinicId, "settings", LEAD_GRADING_DOC).get().catch(() => null);
  const d = (snap?.data() || {}) as Record<string, unknown>;
  const f = d.approvedFlow && typeof d.approvedFlow === "object" ? (d.approvedFlow as Record<string, unknown>) : null;
  const approvedFlow = f && typeof f.text === "string" && f.text.trim()
    ? { text: String(f.text), weekKey: String(f.weekKey || ""), approvedAtMs: Number(f.approvedAtMs) || 0, approvedBy: typeof f.approvedBy === "string" ? f.approvedBy : undefined }
    : null;
  return { enabled: d.enabled !== false, approvedFlow };
}

function e164(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

/** The most recent open lead for this phone, or the most recent lead at all when none is open. */
export async function findLeadByPhone(clinicId: string, phone: string) {
  const p = e164(phone);
  if (p.length < 8) return null;
  const snap = await adminClinicCollection(clinicId, "leads").where("phone", "==", p).limit(10).get();
  if (snap.empty) return null;
  const docs = snap.docs.sort((a, b) => (Number(b.data()?.updatedAt?.toMillis?.() ?? 0) || 0) - (Number(a.data()?.updatedAt?.toMillis?.() ?? 0) || 0));
  return docs.find((d) => OPEN_STAGES.includes(String(d.data()?.stage || ""))) ?? docs[0];
}

export interface ThreadLine {
  author: string;
  text: string;
  atMs: number;
}

/** The conversation behind a lead: its summary doc and the last lines of the thread. */
export async function loadThreadForGrading(clinicId: string, phone: string): Promise<{ conv: Record<string, unknown> | null; lines: ThreadLine[] }> {
  const key = conversationKey(phone);
  const ref = adminClinicDoc(clinicId, "whatsapp_conversations", key);
  const [convSnap, msgSnap] = await Promise.all([
    ref.get().catch(() => null),
    ref.collection("messages").orderBy("at", "desc").limit(THREAD_LINES).get().catch(() => null),
  ]);
  const conv = convSnap?.exists ? ((convSnap.data() || {}) as Record<string, unknown>) : null;
  const lines: ThreadLine[] = (msgSnap?.docs ?? [])
    .map((d) => d.data() || {})
    .filter((m) => m.author !== "system")
    .map((m) => ({ author: String(m.author || ""), text: String(m.text || "").replace(/\s+/g, " ").trim(), atMs: Number(m.at?.toMillis?.() ?? m.at ?? 0) || 0 }))
    .reverse();
  return { conv, lines };
}

/** Lines the model reads: who said what, shortest form. */
export function threadTranscript(lines: ThreadLine[]): string {
  return lines
    .filter((l) => l.text)
    .slice(-THREAD_LINES)
    .map((l) => `${l.author === "patient" ? "العميل" : l.author === "staff" ? "الاستقبال" : "المساعد"}: ${l.text.slice(0, 220)}`)
    .join("\n");
}

export interface GradeResult {
  leadId: string;
  grade: LeadGrade;
  by: "rules" | "model";
  score: number;
  reason: string;
  modelSkipped?: string;
}

function startOfTodayMs(now: number): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Grade one lead document. Writes the AI fields on it and returns what was decided.
 *
 * `allowModel` false keeps it to the rules (the nightly sweep over hundreds of leads).
 */
export async function gradeLead(
  clinicId: string,
  leadSnap: FirebaseFirestore.DocumentSnapshot,
  opts: { trigger: "inbound" | "nightly" | "weekly" | "manual"; allowModel?: boolean; now?: number; settings?: LeadGradingSettings } = { trigger: "manual" }
): Promise<GradeResult | null> {
  const lead = (leadSnap.data() || {}) as Record<string, unknown> & LeadGradeFields;
  const phone = String(lead.phone || "");
  const now = opts.now ?? Date.now();
  const settings = opts.settings ?? (await loadLeadGradingSettings(clinicId));
  if (!settings.enabled) return null;

  const { conv, lines } = phone ? await loadThreadForGrading(clinicId, phone) : { conv: null, lines: [] };
  const ad = readStoredAd(conv?.ad) || (lead.meta && typeof lead.meta === "object" && (lead.meta as { adName?: string }).adName ? { headline: String((lead.meta as { adName?: string }).adName) } : null);
  const patientTexts = lines.filter((l) => l.author === "patient").map((l) => l.text);
  // A form lead with no chat still has what they typed into the form: the interest and the notes.
  if (!patientTexts.length && typeof lead.lastQuestion === "string" && lead.lastQuestion.trim()) patientTexts.push(lead.lastQuestion);
  const lastInbound = Number(conv?.lastInboundAt) || (lines.filter((l) => l.author === "patient").at(-1)?.atMs ?? 0) || 0;
  const signals = signalsFromThread({
    patientTexts,
    adText: adSubjectText(ad),
    interest: typeof lead.interest === "string" ? lead.interest : "",
    lastInboundAtMs: lastInbound || null,
    now,
    fromAd: Boolean(ad) || /meta|facebook|instagram|ads?/i.test(String(lead.source || "")),
    existingPatient: Boolean(lead.existingPatientId),
    staffReplied: lines.some((l) => l.author === "staff"),
    stage: String(lead.stage || ""),
  });
  const rules = rulesGrade(signals);

  let grade: LeadGrade = rules.grade;
  let by: "rules" | "model" = "rules";
  let score = rules.score;
  let reason = rules.reasons.slice(0, 3).join("، ");
  let modelSkipped: string | undefined;

  const threadAt = Number(conv?.lastMessageAt) || lastInbound || 0;
  const threadMoved = threadAt > (Number(lead.aiGradeThreadAt) || 0);
  const modelToday = (Number(lead.aiGradeModelAtMs) || 0) >= startOfTodayMs(now);
  const wantModel = opts.allowModel !== false && !signals.booked && patientTexts.length > 0 && lines.length > 0;
  if (!wantModel) modelSkipped = signals.booked ? "booked" : "no_thread";
  else if (!threadMoved) modelSkipped = "thread_unchanged";
  else if (modelToday) modelSkipped = "daily_cap";
  else if (!(await clinicHasFeature(clinicId, "aiChat"))) modelSkipped = "plan";
  else if (!process.env.GEMINI_API_KEY) modelSkipped = "no_api_key";
  else {
    const m = await askModel({ clinicId, lead, signals, rules, transcript: threadTranscript(lines), flow: settings.approvedFlow?.text || "", adText: adSubjectText(ad) }).catch((e) => ({ error: e instanceof Error ? e.message : "failed" }));
    if ("grade" in m) {
      grade = m.grade;
      by = "model";
      score = m.score;
      reason = m.reason;
    } else {
      modelSkipped = `model_failed:${m.error.slice(0, 60)}`;
    }
  }

  // A model verdict older than this thread stays until the model reads again; only the rules
  // move on silence — and only downward, so a stale "hot" cools but a fresh model "cold" never
  // warms up because a keyword rule liked the ad.
  if (by === "rules" && lead.aiGradeBy === "model" && isLeadGrade(lead.aiGrade) && !threadMoved) {
    const order: LeadGrade[] = ["hot", "warm", "cold"];
    if (order.indexOf(rules.grade) <= order.indexOf(lead.aiGrade)) {
      grade = lead.aiGrade;
      score = Number(lead.aiGradeScore) || score;
      reason = String(lead.aiGradeReason || reason);
      by = "model";
    }
  }

  const next: LeadGradeFields = { ...lead, aiGrade: grade };
  const patch: Record<string, unknown> = {
    aiGrade: grade,
    aiGradeReason: reason.slice(0, 200),
    aiGradeScore: score,
    aiGradeBy: by,
    aiGradeAtMs: now,
    aiGradeThreadAt: threadAt,
    aiGradeAgree: gradeAgreement(next),
    aiGradeSignals: signals,
    aiGradeTrigger: opts.trigger,
  };
  if (by === "model" && modelSkipped === undefined && threadMoved) patch.aiGradeModelAtMs = now;
  await leadSnap.ref.set(patch, { merge: true });
  return { leadId: leadSnap.id, grade, by, score, reason, modelSkipped };
}

async function askModel(args: {
  clinicId: string;
  lead: Record<string, unknown>;
  signals: ReturnType<typeof signalsFromThread>;
  rules: ReturnType<typeof rulesGrade>;
  transcript: string;
  flow: string;
  adText: string;
}): Promise<{ grade: LeadGrade; score: number; reason: string } | { error: string }> {
  const apiKey = process.env.GEMINI_API_KEY || "";
  const meter = createUsageMeter(MODEL);
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          grade: { type: SchemaType.STRING, enum: ["hot", "warm", "cold"], format: "enum" },
          score: { type: SchemaType.INTEGER },
          reason: { type: SchemaType.STRING },
        },
        required: ["grade", "score", "reason"],
      },
      temperature: 0.2,
      maxOutputTokens: 400,
      ...({ thinkingConfig: { thinkingBudget: 0 } } as Record<string, unknown>),
    },
    systemInstruction: [
      "انت مدير مبيعات في عيادة أسنان في مصر. شغلتك تقيّم عميل محتمل من محادثة واتساب: هل هو hot (هيحجز قريب جداً أو محتاج علاج دلوقتي)، warm (مهتم بجد بس لسه مقررش)، ولا cold (بيسأل وخلاص أو رفض أو ساكت).",
      "قيّم من الكلام الموجود بس. متخترعش حاجة. score رقم من 0 لـ 100. reason جملة واحدة قصيرة بالعامية المصرية تقول ليه، بتقتبس من كلام العميل لو ينفع.",
      args.flow.trim()
        ? `\nقواعد العيادة دي نفسها للتقييم (اعتمدها قبل أي حاجة تانية):\n${args.flow.trim().slice(0, 3000)}`
        : "\nمفيش قواعد خاصة للعيادة دي لسه: اعتمد على الحس التجاري العام (ألم = ساخن، طلب ميعاد = ساخن، خدمة محددة = دافي على الأقل، سعر بس من غير خدمة = بارد، 'هفكر' أو 'مش دلوقتي' = بارد).",
    ].join("\n"),
  });
  const facts = [
    `المصدر: ${String(args.lead.source || "—")}${args.adText ? ` — إعلان: ${args.adText.slice(0, 160)}` : ""}`,
    `الاهتمام المسجّل: ${String(args.lead.interest || "—")}`,
    `المرحلة: ${String(args.lead.stage || "new")}${args.lead.existingPatientId ? " (مريض قديم عندنا)" : ""}`,
    `تقييم القواعد الآلية: ${args.rules.grade} (${args.rules.score}) — ${args.rules.reasons.join("، ") || "—"}`,
    args.signals.hoursSinceLastInbound !== null ? `آخر رسالة من العميل من ${Math.round(args.signals.hoursSinceLastInbound)} ساعة` : "العميل مكتبش حاجة لسه",
    "",
    "المحادثة:",
    args.transcript || "(مفيش محادثة — بيانات الفورم بس)",
  ].join("\n");
  try {
    const result = await withTimeout(model.generateContent(facts), MODEL_TIMEOUT_MS);
    meter.add(result.response);
    const text = (result.response.text() || "{}").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const parsed = JSON.parse(text) as { grade?: unknown; score?: unknown; reason?: unknown };
    void logAiCreditUsage({ clinicId: args.clinicId, feature: "lead_grade", credits: 1, detail: String(args.lead.phone || ""), usage: meter.snapshot() });
    if (!isLeadGrade(parsed.grade)) return { error: "bad_shape" };
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
    return { grade: parsed.grade, score, reason: String(parsed.reason || "").replace(/\s+/g, " ").trim().slice(0, 200) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "failed" };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Grade whichever lead belongs to this phone, a moment after a message arrived.
 *
 * The short wait is for the bot's own lead write: `upsertBotLead` is fired without being awaited
 * on the reply path, so the lead for a brand-new number may still be in flight when the
 * webhook hands over here.
 */
export async function gradeLeadByPhone(clinicId: string, phone: string, opts: { trigger: "inbound" | "manual"; delayMs?: number } = { trigger: "manual" }): Promise<GradeResult | null> {
  try {
    if (opts.delayMs) await sleep(opts.delayMs);
    const settings = await loadLeadGradingSettings(clinicId);
    if (!settings.enabled) return null;
    const lead = await findLeadByPhone(clinicId, phone);
    if (!lead) return null;
    return await gradeLead(clinicId, lead, { trigger: opts.trigger, settings });
  } catch (e) {
    console.warn("[leadGrade] grading failed:", e);
    return null;
  }
}

/** The stage names a grade for booked/won is skipped on: nothing to grade once they are in. */
export function isOpenStage(stage: unknown): boolean {
  return OPEN_STAGES.includes(String(stage || ""));
}

