import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { hasFeature, getAiCreditLimit } from "@/lib/subscriptions";
import { fetchPatientAiContext, patientContextBlock } from "@/lib/aiPatientContext";
import { logAiCreditUsage, createUsageMeter } from "@/lib/aiCreditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

/**
 * The open diagnostic discussion: the dentist and the AI examine one patient together.
 * The AI reads photos, asks for the clinical tests only a person at the chair can do
 * (cold test, percussion, probing), requests specific additional photos, and works toward
 * a diagnosis the dentist can hand to treatment planning.
 *
 * Deliberately read-only: it never writes to the odontogram or any record. Its output is a
 * conversation, and the dentist decides what becomes part of the chart.
 */
export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY || "";
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing.");

    const body = await req.json().catch(() => ({}));
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
    const patientId = typeof body?.patientId === "string" ? body.patientId.trim() : "";
    const message = typeof body?.message === "string" ? body.message.trim().slice(0, 4000) : "";
    const language = body?.language === "ar" ? "ar" : "en";
    const summarize = body?.summarize === true;

    // Powerful (default) runs on the fast model; Super runs on the deeper Pro model with a
    // longer memory window, and costs triple the credits. The mode comes from the dentist's
    // toggle, but the price is decided HERE — a client cannot ask for Super at Powerful rates.
    const superMode = body?.mode === "super";
    const modelName = superMode ? "gemini-pro-latest" : "gemini-flash-latest";
    const maxHistory = superMode ? 30 : 14;

    if (!clinicId || !patientId) {
      return NextResponse.json({ ok: false, error: "clinicId and patientId are required." }, { status: 400 });
    }
    if (!message && !summarize) {
      return NextResponse.json({ ok: false, error: "message is required." }, { status: 400 });
    }

    const authz = await requireStaffUser(req, clinicId);
    if (!authz.ok) return authz.response;

    // Images: data URLs sent from the browser, plus gallery URLs the server fetches itself
    // (the patient's own Firebase Storage links — fetched here so browser CORS never matters).
    const imagesBase64: string[] = Array.isArray(body?.imagesBase64)
      ? body.imagesBase64.filter((s: unknown) => typeof s === "string" && (s as string).startsWith("data:image/")).slice(0, MAX_IMAGES)
      : [];
    const imageUrls: string[] = Array.isArray(body?.imageUrls)
      ? body.imageUrls.filter((s: unknown) => typeof s === "string" && /^https:\/\/firebasestorage\.googleapis\.com\//.test(s as string)).slice(0, MAX_IMAGES)
      : [];

    const hasImages = imagesBase64.length > 0 || imageUrls.length > 0;
    const requiredCredits = (hasImages ? 3 : 1) * (superMode ? 3 : 1);

    const db = adminDb();

    // Same plan gate and credit meter as the chat assistant — fail closed, charge on success.
    let chargeCredits: (() => Promise<void>) | null = null;
    try {
      const clinicSnap = await db.collection("clinics").doc(clinicId).get();
      if (!clinicSnap.exists) {
        return NextResponse.json({ ok: false, error: "Clinic not found." }, { status: 404 });
      }
      const clinicData = { id: clinicSnap.id, ...clinicSnap.data() } as any;
      if (!hasFeature(clinicData, "aiChat")) {
        return NextResponse.json(
          { ok: false, error: "The AI diagnosis assistant is available exclusively on Pro & Premium plans." },
          { status: 403 }
        );
      }
      const monthKey = new Date().toISOString().slice(0, 7);
      const usageRef = db.collection("clinics").doc(clinicId).collection("ai_usage").doc(monthKey);
      const usageSnap = await usageRef.get();
      const currentUsed = usageSnap.exists ? (Number(usageSnap.data()?.creditsUsed) || 0) : 0;
      const limit = getAiCreditLimit(clinicData);
      if (limit > 0 && currentUsed + requiredCredits > limit) {
        return NextResponse.json(
          { ok: false, error: `Monthly AI credits limit reached (${currentUsed} / ${limit} credits used).` },
          { status: 429 }
        );
      }
      chargeCredits = async () => {
        await usageRef.set(
          { monthKey, creditsUsed: FieldValue.increment(requiredCredits), updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      };
    } catch (err) {
      reportServerError("Diagnosis chat quota check failed:", err);
      return NextResponse.json(
        { ok: false, error: "Could not verify your AI plan or usage. Please try again." },
        { status: 503 }
      );
    }

    const ctx = await fetchPatientAiContext(clinicId, patientId);
    if (!ctx) {
      return NextResponse.json({ ok: false, error: "Patient not found." }, { status: 404 });
    }

    const langInstruction =
      language === "ar"
        ? "Reply in Egyptian-friendly formal Arabic (clinical terms may stay in English where that is how dentists say them)."
        : "Reply in clear, professional English.";

    const systemInstruction = `You are an experienced dental diagnostician sitting chairside with a colleague (the dentist) inside the Alpha Dental System. Together you are working up ONE patient toward a precise diagnosis that will feed a treatment plan. This is an open clinical discussion between professionals.

HOW YOU WORK:
- You cannot touch the patient. The dentist is your hands: ask them to perform specific chairside tests and report back — cold test (and whether pain lingers after removal), heat test, electric pulp test, percussion (vertical and lateral), palpation of the sulcus, probing (is there a catch? bleeding? pocket depths in mm and where), mobility grade, bite test on a Tooth Slooth, transillumination. Ask only the tests that discriminate between YOUR current differentials — never a checklist for its own sake.
- Ask for SPECIFIC photos when they would change your thinking, with exact instructions: which tooth/quadrant, which view (occlusal, buccal, lingual), dry the tooth first, retract the cheek, use good light. X-rays too when indicated (periapical of which tooth, bitewing of which side). The clinic's Android app uploads photos straight into this patient's gallery, and the dentist can attach them here — so phrase requests as "if possible, take it with the phone app and attach it".
- When a photo or x-ray is attached, READ IT CAREFULLY. Describe what you actually see per tooth (FDI notation), separating observation ("distal radiolucency on 36 approaching the pulp") from interpretation ("suggests deep caries — irreversible pulpitis is on the table"). If image quality prevents a call, say exactly what is wrong with it and ask for a retake with concrete instructions.
- NEVER invent findings. When evidence is thin, give a working diagnosis with its confidence level and name what would confirm it — do not present a guess as settled. It is always acceptable to conclude "clinical examination cannot settle this; a periapical x-ray / CBCT / referral is needed".
- The patient's charted data below is reference, not gospel: if an image contradicts the chart, say so.

PACE — A PATIENT IS IN THE CHAIR (this outranks thoroughness):
- CONVERGE FAST. For a straightforward presentation, give your assessment in your FIRST reply: working diagnosis per tooth with confidence, and at most ONE follow-up request — the single test or photo whose answer would most change the diagnosis or the treatment. Classic deep caries with cold sensitivity does not need a full battery.
- Ask for something ONLY if its answer changes what you would do. "Nice to know" is not a reason. Never re-request a view or test already given, declined, or impractical.
- Extra photos are the exception, not the reflex: request a complementary view only when it is genuinely decisive, one at a time, and say why in one clause.
- When the picture is already adequate, SAY SO and stop asking: "This is enough to plan — ready for the treatment plan, or shall we confirm X first?" Let the dentist choose to dig deeper.
- Reserve the full meticulous workup (multiple views, batteries of tests) for genuinely ambiguous, multi-tooth, or high-stakes cases — and even then, gather it in ONE batched request, not a drip of questions over many turns.
- End every reply with one line of where things stand: the working diagnosis and whether it is enough to plan.
- Keep replies SHORT — a few sentences or a tight list. No essays, no repeated recaps of the whole case.

DATA-ENTRY FORMS (so the dentist forgets nothing):
- When — and only when — you genuinely need THREE OR MORE findings at once (the batched workup of a complex case), END your reply with a fill-in form instead of prose questions. The app renders it as real input fields inside the chat. For one or two questions, just ask in prose.
- Emit it as a fenced code block tagged form, containing STRICT JSON only:
\`\`\`form
{"title":"Chairside findings","fields":[{"id":"mob_11","label":"Mobility grade — tooth 11","type":"choice","options":["0","I","II","III"]},{"id":"smoker","label":"Does the patient smoke?","type":"yesno"},{"id":"pocket_16","label":"Deepest pocket on 16","type":"number","unit":"mm"}]}
\`\`\`
- Field types: "choice" (with 2-6 options), "yesno", "number" (optional "unit"), "text". One finding per field — a grade per tooth is one field per tooth. 3 to 6 fields, each one whose answer changes management; at most ONE form per reply, always at the very end.
- The prose above the form carries your reasoning and photo requests; the form carries the data entry. Do not repeat the form's questions in the prose.
- Write the form title and labels in the dentist's language.
${superMode
  ? `
SUPER MODE — the dentist explicitly chose the exhaustive workup for this case: be maximally meticulous. Chase down every differential, request the complementary views and complete test batteries you would in an academic case review, and do not settle for a working diagnosis while a discriminating test remains undone. The PACE rules above are relaxed for this discussion; still batch requests into forms rather than dripping questions.`
  : ""}
- ${langInstruction}

${patientContextBlock(ctx)}`;

    const summarizePrompt =
      language === "ar"
        ? "اعمل ملخص تشخيصي نهائي للمناقشة دي عشان يتبعت لتخطيط العلاج: لكل سنة (بترقيم FDI) اكتب التشخيص والدليل عليه ومستوى التأكد، واذكر أي حاجة لسه محتاجة تأكيد. من غير أسعار ومن غير خطة علاج — التشخيص بس. خليه مختصر ومنظم."
        : "Write the final diagnostic summary of this discussion, to be handed to treatment planning: for each tooth (FDI), the diagnosis, the evidence behind it, and the confidence level; note anything still unconfirmed. No prices and no treatment plan — diagnosis only. Keep it tight and structured.";

    // History travels as plain text turns; images ride only on the current turn (same policy as
    // the chat assistant — resending every historical image would triple the cost of every turn).
    const historyRaw = Array.isArray(body?.history) ? body.history.slice(-maxHistory) : [];
    const contents: any[] = historyRaw
      .map((m: any) => ({
        role: m?.role === "assistant" ? "model" : "user",
        parts: [{ text: String(m?.content || "").slice(0, 4000) }],
      }))
      .filter((m: any) => m.parts[0].text);
    while (contents.length > 0 && contents[0].role === "model") contents.shift();

    const parts: any[] = [{ text: summarize ? summarizePrompt : message }];

    for (const dataUrl of imagesBase64) {
      const comma = dataUrl.indexOf(",");
      const header = dataUrl.slice(0, comma);
      const mimeType = header.substring(header.indexOf(":") + 1, header.indexOf(";")) || "image/jpeg";
      const base64 = dataUrl.slice(comma + 1);
      if (base64.length * 0.75 > MAX_IMAGE_BYTES) continue;
      parts.push({ inlineData: { data: base64, mimeType } });
    }

    for (const url of imageUrls) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const mimeType = res.headers.get("content-type") || "image/jpeg";
        if (!mimeType.startsWith("image/")) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_IMAGE_BYTES) continue;
        parts.push({ inlineData: { data: buf.toString("base64"), mimeType } });
      } catch {
        /* a broken link is skipped, not fatal */
      }
    }

    contents.push({ role: "user", parts });

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction,
    });

    const meter = createUsageMeter(modelName);
    const result = await model.generateContent({ contents });
    meter.add(result.response);
    const reply = result.response.text().trim();

    if (!reply) {
      return NextResponse.json({ ok: false, error: "The AI returned an empty reply. Please try again." }, { status: 502 });
    }

    await chargeCredits?.();
    await logAiCreditUsage({
      clinicId,
      feature: "diagnosis_chat",
      credits: requiredCredits,
      userId: authz.uid,
      patientId,
      patientName: String((ctx.patient as any).name || ""),
      detail: [summarize ? "diagnosis summary" : hasImages ? "with photos" : "", superMode ? "super mode" : ""]
        .filter(Boolean)
        .join(" · "),
      usage: meter.snapshot(),
    });

    return NextResponse.json({ ok: true, reply });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Diagnosis chat failed";
    reportServerError("[DiagnosisChat] failed", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
