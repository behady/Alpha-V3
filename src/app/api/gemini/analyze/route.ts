import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function POST(req: Request) {
  try {
    const { images } = await req.json();

    if (!images || images.length === 0) {
      return NextResponse.json({ error: "No images provided for analysis." }, { status: 400 });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

    // Format all uploaded images for Gemini
    const imageParts = images.map((imgBase64: string) => {
      const mimeType = imgBase64.substring(imgBase64.indexOf(":") + 1, imgBase64.indexOf(";"));
      const base64Data = imgBase64.split(",")[1];
      return {
        inlineData: {
          data: base64Data,
          mimeType: mimeType,
        },
      };
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
    let textResult = result.response.text();
    
    // Clean up any accidental markdown the AI might add
    textResult = textResult.replace(/```json/g, '').replace(/```/g, '').trim();
    
    const clinicalData = JSON.parse(textResult);

    return NextResponse.json(clinicalData);

  } catch (error: any) {
    console.error("Auto-Diagnose API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}