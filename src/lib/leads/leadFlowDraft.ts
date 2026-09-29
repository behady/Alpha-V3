import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { createUsageMeter, logAiCreditUsage } from "@/lib/aiCreditLog";
import { adSubjectText, readStoredAd } from "@/lib/bot/adReferral";
import { isLeadGrade, weekKeyOf, type LeadGrade } from "./leadGrade";
import { LEAD_GRADING_DOC, loadLeadGradingSettings, loadThreadForGrading, threadTranscript } from "./gradeLeadServer";

/**
 * The weekly review: the AI watches how the desk graded and answered leads, and writes the
 * clinic's own grading flow as a draft an admin approves.
 *
 * This is the learning loop the owner asked for. Every week it reads the leads the receptionist
 * graded (hot / warm / cold), what she replied, what the AI had guessed, and what actually
 * happened — booked, became a patient, went quiet — and, when the person converted, who they
 * turned out to be (age, gender, area from the patient record). From that it drafts, in the
 * clinic's own words, what makes a lead hot here, what to say to each grade, when to follow up,
 * and what the people who book look like. Nothing takes effect until an admin approves it; each
 * week's draft says what changed from the flow in force.
 *
 * Below the threshold it writes the counts only, so the settings card can say "learning: 6 of
 * 10 graded leads" instead of drafting rules from three examples.
 */

const MODEL = "gemini-flash-latest";
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
export const MIN_STAFF_GRADED = 10;
const MIN_FORCED = 3;
const MAX_LEADS = 300;
const SAMPLE_PER_GRADE = 8;
const TIMEOUT_MS = 60_000;

export const LEAD_FLOWS = "lead_flows";

export interface DraftStats {
  leads: number;
  staffGraded: number;
  aiGraded: number;
  agreed: number;
  agreementPct: number | null;
  byStaffGrade: Record<LeadGrade, number>;
  converted: number;
}

export interface DraftResult extends DraftStats {
  weekKey: string;
  generated: boolean;
  skipped?: string;
}

type LeadRow = Record<string, unknown> & { id: string };

function ageFrom(dob: unknown, now: number): number | null {
  const s = String(dob || "");
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const years = (now - new Date(s.slice(0, 10)).getTime()) / (365.25 * 24 * 3600 * 1000);
  return years > 0 && years < 110 ? Math.floor(years) : null;
}

/** One lead as the model reads it: grades, outcome, who they were, and the chat. */
async function describeLead(clinicId: string, lead: LeadRow, now: number): Promise<string> {
  const phone = String(lead.phone || "");
  const { conv, lines } = phone ? await loadThreadForGrading(clinicId, phone) : { conv: null, lines: [] };
  const ad = readStoredAd(conv?.ad);
  const stage = String(lead.stage || "new");
  const outcome = stage === "won" ? "بقى مريض" : stage === "booked" ? "حجز" : stage === "lost" ? `ضاع (${String(lead.lostReason || "بدون سبب")})` : conv?.outcome === "booked" ? "حجز من المساعد" : "لسه مفتوح";
  let who = "";
  const pid = String(lead.patientId || lead.existingPatientId || "");
  if (pid) {
    const p = (await adminClinicDoc(clinicId, "patients", pid).get().catch(() => null))?.data() || null;
    if (p) {
      const age = ageFrom(p.dateOfBirth, now);
      who = [p.gender ? `النوع: ${String(p.gender)}` : "", age ? `السن: ${age}` : "", p.address ? `المنطقة: ${String(p.address).slice(0, 60)}` : ""].filter(Boolean).join("، ");
    }
  }
  return [
    `- المصدر: ${String(lead.source || "—")}${ad ? ` — إعلان: ${adSubjectText(ad).slice(0, 100)}` : ""}`,
    `  الاهتمام: ${String(lead.interest || "—")}`,
    `  تقييم الاستقبال: ${isLeadGrade(lead.staffGrade) ? lead.staffGrade : "—"} | تقييم المساعد: ${isLeadGrade(lead.aiGrade) ? `${lead.aiGrade} (${String(lead.aiGradeReason || "")})` : "—"}`,
    `  النتيجة: ${outcome}${who ? ` | ${who}` : ""}`,
    lines.length ? `  المحادثة:\n${threadTranscript(lines).split("\n").slice(-10).map((l) => `    ${l}`).join("\n")}` : "  (مفيش محادثة)",
  ].join("\n");
}

export async function draftLeadFlow(clinicId: string, opts: { force?: boolean; now?: number } = {}): Promise<DraftResult> {
  const now = opts.now ?? Date.now();
  const weekKey = weekKeyOf(now);
  const since = Timestamp.fromMillis(now - LOOKBACK_MS);
  const snap = await adminClinicCollection(clinicId, "leads").where("updatedAt", ">=", since).limit(MAX_LEADS).get();
  const rows: LeadRow[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  const staffGraded = rows.filter((r) => isLeadGrade(r.staffGrade));
  const aiGraded = rows.filter((r) => isLeadGrade(r.aiGrade));
  const both = rows.filter((r) => isLeadGrade(r.staffGrade) && isLeadGrade(r.aiGrade));
  const agreed = both.filter((r) => r.staffGrade === r.aiGrade).length;
  const stats: DraftStats = {
    leads: rows.length,
    staffGraded: staffGraded.length,
    aiGraded: aiGraded.length,
    agreed,
    agreementPct: both.length ? Math.round((agreed / both.length) * 100) : null,
    byStaffGrade: {
      hot: staffGraded.filter((r) => r.staffGrade === "hot").length,
      warm: staffGraded.filter((r) => r.staffGrade === "warm").length,
      cold: staffGraded.filter((r) => r.staffGrade === "cold").length,
    },
    converted: rows.filter((r) => r.stage === "won" || r.stage === "booked").length,
  };

  const settingsRef = adminClinicDoc(clinicId, "settings", LEAD_GRADING_DOC);
  const base = { stats, threshold: MIN_STAFF_GRADED, statsAt: FieldValue.serverTimestamp(), statsWeek: weekKey };
  const needed = opts.force ? MIN_FORCED : MIN_STAFF_GRADED;
  if (stats.staffGraded < needed) {
    await settingsRef.set(base, { merge: true });
    return { ...stats, weekKey, generated: false, skipped: "below_threshold" };
  }
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) {
    await settingsRef.set(base, { merge: true });
    return { ...stats, weekKey, generated: false, skipped: "no_api_key" };
  }

  // A balanced sample: the desk's hot, warm and cold, newest first, plus converted leads she
  // never graded — the outcome is a grade too.
  const newest = (a: LeadRow, b: LeadRow) => (Number((b.updatedAt as Timestamp)?.toMillis?.() ?? 0) || 0) - (Number((a.updatedAt as Timestamp)?.toMillis?.() ?? 0) || 0);
  const pick = (g: LeadGrade) => staffGraded.filter((r) => r.staffGrade === g).sort(newest).slice(0, SAMPLE_PER_GRADE);
  const converted = rows.filter((r) => !isLeadGrade(r.staffGrade) && (r.stage === "won" || r.stage === "booked")).sort(newest).slice(0, SAMPLE_PER_GRADE);
  const sample = [...pick("hot"), ...pick("warm"), ...pick("cold"), ...converted];
  const described = await Promise.all(sample.map((r) => describeLead(clinicId, r, now)));

  const settings = await loadLeadGradingSettings(clinicId);
  const current = settings.approvedFlow?.text?.trim() || "";

  const prompt = [
    `الأسبوع ده: ${stats.leads} عميل محتمل، الاستقبال قيّم ${stats.staffGraded} منهم (ساخن ${stats.byStaffGrade.hot} / دافي ${stats.byStaffGrade.warm} / بارد ${stats.byStaffGrade.cold})، والمساعد اتفق مع الاستقبال في ${stats.agreementPct ?? "—"}% من اللي اتقيّموا من الطرفين. ${stats.converted} حجزوا أو بقوا مرضى.`,
    "",
    current ? `الفلو المعتمد حالياً (اللي المساعد شغال بيه):\n${current.slice(0, 3000)}` : "مفيش فلو معتمد لسه — ده أول فلو.",
    "",
    "=== عينة من العملاء (تقييم الاستقبال هو المرجع) ===",
    described.join("\n\n"),
  ].join("\n");

  const meter = createUsageMeter(MODEL);
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          flow: { type: SchemaType.STRING },
          profile: { type: SchemaType.STRING },
          changes: { type: SchemaType.STRING },
        },
        required: ["flow", "profile", "changes"],
      },
      temperature: 0.3,
      maxOutputTokens: 4096,
    },
    systemInstruction: [
      "انت مدير مبيعات بتتعلم من موظفة الاستقبال في عيادة أسنان مصرية. هي بتقيّم العملاء المحتملين ساخن/دافي/بارد وبترد عليهم، وانت بتراقب وبتكتب \"فلو التقييم\" بتاع العيادة دي عشان المساعد الآلي يقيّم زيها بالظبط.",
      "اكتب بالعامية المصرية، في نقاط قصيرة، من غير مقدمة. ممنوع تخترع حاجة مش موجودة في العينة، وممنوع وعود طبية أو خصومات.",
      "flow: (10-16 نقطة) إيه اللي بيخلي العميل ساخن هنا، إيه اللي بيخليه دافي، إيه اللي بيخليه بارد — بأمثلة من كلام العملاء الفعلي؛ وبعدين إيه الرد اللي الاستقبال بتستخدمه ونجح مع كل درجة؛ وإمتى بيتعمل متابعة لكل درجة.",
      "profile: (3-6 نقاط) شكل الناس اللي بتحجز فعلاً في العيادة دي: الخدمة، طريقة الكلام، وقت الكتابة، ولو البيانات موجودة: السن والنوع والمنطقة. لو البيانات دي مش موجودة قول كده صراحة.",
      "changes: جملتين: إيه اللي اتغير عن الفلو المعتمد الحالي وليه (أو 'أول فلو' لو مفيش). لو المساعد كان بيختلف مع الاستقبال في حالات معينة، قول في إيه.",
    ].join("\n"),
  });

  let text = "";
  let profile = "";
  let changes = "";
  try {
    const result = await new Promise<Awaited<ReturnType<typeof model.generateContent>>>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS);
      model.generateContent(prompt).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
    meter.add(result.response);
    const raw = (result.response.text() || "{}").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const parsed = JSON.parse(raw) as { flow?: unknown; profile?: unknown; changes?: unknown };
    text = String(parsed.flow || "").trim().slice(0, 6000);
    profile = String(parsed.profile || "").trim().slice(0, 2000);
    changes = String(parsed.changes || "").trim().slice(0, 1000);
  } catch (e) {
    await settingsRef.set(base, { merge: true });
    return { ...stats, weekKey, generated: false, skipped: `model_failed:${e instanceof Error ? e.message.slice(0, 60) : "error"}` };
  }
  void logAiCreditUsage({ clinicId, feature: "lead_flow_draft", credits: 2, detail: weekKey, usage: meter.snapshot() });
  if (!text) {
    await settingsRef.set(base, { merge: true });
    return { ...stats, weekKey, generated: false, skipped: "empty" };
  }

  await adminClinicDoc(clinicId, LEAD_FLOWS, weekKey).set(
    {
      weekKey,
      status: "pending",
      text,
      profile,
      changes,
      stats,
      sample: sample.length,
      basedOn: settings.approvedFlow?.weekKey || null,
      generatedAt: FieldValue.serverTimestamp(),
      generatedAtMs: now,
    },
    { merge: true }
  );
  await settingsRef.set({ ...base, lastDraftWeek: weekKey, lastDraftAt: FieldValue.serverTimestamp(), pendingWeek: weekKey }, { merge: true });
  return { ...stats, weekKey, generated: true };
}
