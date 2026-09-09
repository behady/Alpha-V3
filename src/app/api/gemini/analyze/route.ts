import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { quotaExhaustedMessage, reserveAiCredits } from "@/lib/aiQuota";
import { GEMINI_MODELS, geminiModel, hasGeminiKey } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Orthodontic auto-diagnosis from uploaded records.
 *
 * This route used to take a list of images from anyone on the internet, with no sign-in, no
 * clinic and no meter, and send them to Google on the platform's key. Now it answers to the same
 * three gates as every other AI feature: a signed-in staff member, the clinic's plan, and the
 * clinic's credit pool — three credits, the same as any other call that carries images.
 */
const CREDITS = 3;
const MAX_IMAGES = 6;

export async function POST(req: Request) {
  if (!hasGeminiKey()) return NextResponse.json({ error: "AI is not configured." }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { images?: unknown; clinicId?: string };
  const requestedClinicId = typeof body.clinicId === "string" ? body.clinicId.trim() : "";

  const authz = await requireStaffUser(req, requestedClinicId || undefined);
  if (!authz.ok) return authz.response;

  const images = Array.isArray(body.images)
    ? body.images.filter((s): s is string => typeof s === "string" && s.startsWith("data:image/")).slice(0, MAX_IMAGES)
    : [];
  if (images.length === 0) {
    return NextResponse.json({ error: "No images provided for analysis." }, { status: 400 });
  }

  try {
    const clinicId = requestedClinicId || (await resolveUserClinicId(authz.uid));
    const reservation = await reserveAiCredits(clinicId, CREDITS);
    if (!reservation.ok) {
      if (reservation.reason === "plan") {
        return NextResponse.json({ error: "AI diagnosis is included in the Clinic and Group plans." }, { status: 403 });
      }
      if (reservation.reason === "no_credits") {
        return NextResponse.json({ error: quotaExhaustedMessage(reservation.verdict) }, { status: 429 });
      }
      return NextResponse.json({ error: "Clinic not found." }, { status: 404 });
    }

    const model = geminiModel({ model: GEMINI_MODELS.flash }, { feature: "ortho_analyze" });

    // Format all uploaded images for Gemini
    const imageParts = images.map((imgBase64) => {
      const mimeType = imgBase64.substring(imgBase64.indexOf(":") + 1, imgBase64.indexOf(";"));
      const base64Data = imgBase64.split(",")[1];
      return { inlineData: { data: base64Data, mimeType } };
    });

    const prompt = `
      You are an expert Orthodontist AI. Analyze these patient diagnostic records (X-rays and intraoral photos).
      Estimate the patient's clinical orthodontic condition.
      
      You MUST return your answer as a raw, valid JSON object ONLY. Do not include markdown formatting like \`\`\`json.
      
      Use ONLY these exact string values for the keys:
      - skeletalClass: "Class I", "Class II", "Class III", or ""
      - incisalClass: "Class I", "Class II div 1", "Class II div 2", "Class III", or ""
      - overjet: "Normal", "Increased", "Edge-to-Edge", "Reverse", or ""
      - overbite: "Normal", "Deep", "Open", "Edge-to-Edge", or ""
      - crowding: "None", "Mild", "Moderate", "Severe", or ""
      - spacing: "None", "Mild", "Moderate", "Severe", or ""
      - midline: "Centered", "Shifted Right", "Shifted Left", or ""
      - crossbites (array of strings): "Anterior", "Posterior (Right)", "Posterior (Left)", "Posterior (Bilateral)"

      Example Output:
      {
        "skeletalClass": "Class II",
        "incisalClass": "Class II div 1",
        "overjet": "Increased",
        "overbite": "Deep",
        "crowding": "Mild",
        "spacing": "None",
        "midline": "Centered",
        "crossbites": []
      }
    `;

    const result = await model.generateContent([prompt, ...imageParts]);
    // Clean up any accidental markdown the AI might add
    const textResult = result.response.text().replace(/```json/g, "").replace(/```/g, "").trim();
    const clinicalData = JSON.parse(textResult);

    // Charged only once an answer parsed: a failed analysis costs the clinic nothing.
    await reservation.charge({ feature: "ortho_analyze", userId: authz.uid, detail: `${images.length} images`, usage: model.meter.snapshot() });

    return NextResponse.json(clinicalData);
  } catch (error: unknown) {
    reportServerError("Auto-Diagnose API Error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Analysis failed" }, { status: 500 });
  }
}
