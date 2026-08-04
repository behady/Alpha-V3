// src/app/api/gemini/route.ts
import { NextResponse } from "next/server";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { sendWhatsApp } from "@/lib/whatsapp";
import { mergeWhatsAppTemplate } from "@/lib/whatsappTemplateMerge";
import { resolveWhatsappTemplateForPatient } from "@/lib/whatsappDefaultBodies";
import { pickPatientPhone } from "@/lib/patientPhone";
import { DIAGNOSIS_OPTIONS } from "@/lib/diagnosisCatalog";
import { hasFeature, getAiCreditLimit } from "@/lib/subscriptions";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { requireStaffUser } from "@/lib/apiStaffAuth";

/**
 * Collections the AI is permitted to touch.
 *
 * The collection name in db_read/db_write/db_delete comes from the model, and the model's context
 * includes untrusted text (patient names, note bodies). Without an allowlist, a crafted value in
 * any patient field could steer it at data it should never reach. Everything here is clinic-scoped
 * at access time, so this list can only ever address the caller's own tenant.
 */
const AI_READABLE_COLLECTIONS = new Set([
  "patients",
  "appointments",
  "tickets",
  "services",
  "ledger",
  "clinical_notes",
  "inventory",
  "inventory_transactions",
  "lab_orders",
  "staff",
  "expenses",
]);

/** Deleting financial or clinical history is not something a chat turn should be able to do. */
const AI_DELETABLE_COLLECTIONS = new Set(["appointments", "tickets", "ledger", "inventory_transactions"]);

function assertCollectionAllowed(collection: string, mode: "read" | "write" | "delete"): void {
  const name = String(collection || "").trim();
  if (!AI_READABLE_COLLECTIONS.has(name)) {
    throw new Error(`The assistant is not permitted to access the "${name}" collection.`);
  }
  if (mode === "delete" && !AI_DELETABLE_COLLECTIONS.has(name)) {
    throw new Error(`Records in "${name}" cannot be deleted by the assistant. Please delete it from that page directly.`);
  }
}

const ALPHA_DATABASE_SCHEMAS = `CRITICAL DATABASE SCHEMAS (Strictly use these exact fields):
1. patients: name(REQ, full string), phone(REQ, E.164 +20...), address, dateOfBirth, gender, referral, medicalHistory, status, teethData (odontogram chart). NEVER drop user-provided fields!
2. appointments: patientId(REQ), patientName, treatment, doctor, date, time(hh:mm AM/PM), duration, status, notes
3. tickets: patientId(REQ), patientName, patientPhone, reason(REQ), serviceName, preferredDate, preferredTimeSlot, status, source
4. services (READ-ONLY): name, price, requiresLab, estimatedLabFee. ALWAYS db_read this before guessing prices!
5. ledger:
 - procedure: patientId(REQ), patientName, type="procedure", category, amount, cost, unitCost, unitsCount, pricingFormula, description, doctorName, date
 - payment: patientId(REQ), patientName, type="payment", paid, method, description, date
6. clinical_notes: patientId(REQ), date, doctor, procedure, tooth, cost, unitCost, unitsCount, pricingFormula, note, status, ledgerId
7. inventory: name, category, quantity, minStock, unit, expiryDate
8. lab_orders: patientId(REQ), patientName, labName, type, shade, teeth, sendDate, dueDate, status, cost

CRITICAL WORKFLOW (ADD SERVICE):
find patient -> read 'services' -> db_write 'clinical_notes' -> db_write 'ledger' (type: procedure) -> db_update clinical_note with ledgerId. MUST sync financials!

ODONTOGRAM WORKFLOW (X-Rays & Clinical Diagnosis):
- If the user provides an X-ray, photo, or verbal diagnosis for a specific tooth, you MUST log it to the odontogram.
- Step 1: Use 'get_diagnosis_catalog' to fetch the exact allowed status IDs.
- Step 2: STRICTLY differentiate between "Existing Findings" (what is currently in the mouth) and "Proposed Treatments". The odontogram is ONLY for current findings (e.g., previous endo, existing caries). DO NOT log proposed treatments (like "needs a crown") as a status.
- Step 3: If the image is blurry, or you are unsure about a restoration (e.g., distinguishing a large radiopaque filling from a full crown), you MUST stop and ask the user to confirm before proceeding.
- Step 4: Use 'update_odontogram' to save the verified status IDs and notes to the patient's record.

CONTINUOUS LEARNING & MEMORY:
- If the user explicitly corrects your behavior, tells you a new clinic rule (e.g., "Dr. Ahmed doesn't work Tuesdays"), or tells you to remember something, you MUST autonomously call the 'learn_fact' tool to save it permanently. Do not just say "I will remember that", you MUST actually use the tool.`;



export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY || "";
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing.");

    const genAI = new GoogleGenerativeAI(apiKey);
    const db = adminDb();
    const body = await req.json();

    const { prompt, image, history, userName, systemInstruction, clinicId } = body;
    const currentDate = new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" });

    // A clinicId is mandatory. Every tool below is scoped by it, and the previous `if (clinicId)`
    // guard meant a request that simply omitted it skipped the plan check and the credit meter
    // entirely.
    if (!clinicId || typeof clinicId !== "string") {
      return NextResponse.json({ error: "clinicId is required." }, { status: 400 });
    }

    // This endpoint reads and writes patient records, so it must prove who is calling. It
    // previously trusted clinicId and userId straight from the request body with no token at all.
    const authz = await requireStaffUser(req, clinicId);
    if (!authz.ok) return authz.response;

    // Identity comes from the verified token, never the body — otherwise a caller could attribute
    // their actions and learned facts to any colleague.
    const userId = authz.uid;

    // Images cost more to process, so they draw more credits.
    const requiredCredits = image ? 3 : 1;

    // Set by the quota check below, invoked only once the turn has produced a real result.
    let chargeCredits: (() => Promise<void>) | null = null;

    // Hybrid Subscription & Monthly Credit Limit Check
    {
      try {
        const clinicSnap = await db.collection("clinics").doc(clinicId).get();
        if (clinicSnap.exists) {
          const clinicData = { id: clinicSnap.id, ...clinicSnap.data() } as any;

          if (!hasFeature(clinicData, "aiChat")) {
            return NextResponse.json(
              { error: "AI Assistant is available exclusively on Pro & Premium plans. Please upgrade your subscription tier." },
              { status: 403 }
            );
          }

          const monthKey = new Date().toISOString().slice(0, 7);
          const usageRef = db.collection("clinics").doc(clinicId).collection("ai_usage").doc(monthKey);
          const usageSnap = await usageRef.get();
          const currentUsed = usageSnap.exists ? (Number(usageSnap.data()?.creditsUsed) || 0) : 0;
          const limit = getAiCreditLimit(clinicData);

          if (limit > 0 && (currentUsed + requiredCredits) > limit) {
            return NextResponse.json(
              { error: `Monthly AI credits limit reached (${currentUsed} / ${limit} credits used). Resets on the 1st of next month.` },
              { status: 429 }
            );
          }

          // Deliberately NOT charged here. Billing on entry means a clinic pays for requests that
          // error out or time out, which is the kind of charge that generates support tickets.
          // chargeCredits() runs once the turn has actually produced something.
          chargeCredits = async () => {
            await usageRef.set(
              {
                monthKey,
                creditsUsed: FieldValue.increment(requiredCredits),
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          };
        }
      } catch (err) {
        // Fail closed: this block enforces both the plan gate and the spend cap, so swallowing an
        // error here would hand out unmetered AI to anyone whose clinic doc happened to fail a read.
        console.error("AI usage quota check failed:", err);
        return NextResponse.json(
          { error: "Could not verify your AI plan or usage. Please try again." },
          { status: 503 }
        );
      }
    }

    // Learned rules are clinic-scoped. They were previously read from a root `ai_preferences`
    // collection, which meant one clinic's pricing rules and staff schedules would surface in
    // every other clinic's assistant. (A hardcoded braces price used to live here for the same
    // reason — removed, since it was one clinic's rule applied to all tenants.)
    let userPreferences = "";
    if (userId && clinicId) {
      try {
        const prefDoc = await adminClinicDoc(clinicId, "ai_preferences", userId).get();
        const facts = prefDoc.exists ? prefDoc.data()?.facts : null;
        if (Array.isArray(facts) && facts.length > 0) {
          userPreferences = facts.map((f: string, i: number) => `${i + 1}. ${f}`).join("\n");
        }
      } catch (e) {
        console.error("Failed to load clinic AI preferences.", e);
      }
    }
    if (!userPreferences) userPreferences = "(No custom rules saved yet.)";

    let formattedHistory: any[] = [];
    if (history && Array.isArray(history)) {
        // To save API costs in this SaaS, cap the history to the most recent 6 messages
        const recentHistory = history.slice(-6);
        
        formattedHistory = recentHistory.map((msg: any) => ({
            role: msg.role === 'assistant' || msg.role === 'model' ? 'model' : 'user',
            parts: [{ text: msg.content || msg.parts?.[0]?.text || "" }]
        }));
        
        // Gemini requires history to start with 'user' — strip leading model messages
        while (formattedHistory.length > 0 && formattedHistory[0].role === 'model') {
            formattedHistory.shift();
        }
        // Gemini requires history to end with 'model' — strip trailing user messages
        while (formattedHistory.length > 0 && formattedHistory[formattedHistory.length - 1].role === 'user') {
            formattedHistory.pop();
        }
    }

    const functionDeclarations = [
      {
        name: "db_read",
        description: "Fetches records from a Firebase collection. You can filter securely using whereField/whereOperator/whereValue. To filter by a specific date range, use startDate and endDate (e.g. for 'this month').",
        parameters: { 
          type: SchemaType.OBJECT, 
          properties: { 
            collection: { type: SchemaType.STRING, description: "e.g., 'patients', 'appointments', 'ledger'" }, 
            limit: { type: SchemaType.INTEGER },
            whereField: { type: SchemaType.STRING },
            whereOperator: { type: SchemaType.STRING, description: "Must be '==' or '>' or '<'" },
            whereValue: { type: SchemaType.STRING },
            startDate: { type: SchemaType.STRING, description: "Optional start date in YYYY-MM-DD format to filter by the 'date' field." },
            endDate: { type: SchemaType.STRING, description: "Optional end date in YYYY-MM-DD format to filter by the 'date' field." }
          }, 
          required: ["collection"] 
        },
      },
      {
        name: "find_patient",
        description: "Fuzzy searches the patients collection by name or phone. ALWAYS use this instead of db_read to find a patient, because it handles partial and case-insensitive matching.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            searchQuery: { type: SchemaType.STRING, description: "The name or phone number to search for (e.g., 'ben')." }
          },
          required: ["searchQuery"]
        }
      },
      {
        name: "db_write",
        description: "Creates a new record in a specific collection.",
        parameters: { 
          type: SchemaType.OBJECT, 
          properties: { 
            collection: { type: SchemaType.STRING }, 
            dataJson: { type: SchemaType.STRING, description: "A strict JSON string of the record data." } 
          }, 
          required: ["collection", "dataJson"] 
        },
      },
      {
        name: "db_update",
        description: "Updates an existing record by its document ID.",
        parameters: { 
          type: SchemaType.OBJECT, 
          properties: { 
            collection: { type: SchemaType.STRING }, 
            documentId: { type: SchemaType.STRING }, 
            dataJson: { type: SchemaType.STRING, description: "JSON string of the fields to update." } 
          }, 
          required: ["collection", "documentId", "dataJson"] 
        },
      },
      {
        name: "db_delete",
        description: "Permanently deletes a record from the database using its document ID.",
        parameters: { 
          type: SchemaType.OBJECT, 
          properties: { 
            collection: { type: SchemaType.STRING }, 
            documentId: { type: SchemaType.STRING } 
          }, 
          required: ["collection", "documentId"] 
        },
      },
      {
        name: "trigger_whatsapp_appointment",
        description: "Sends the official, templated automated WhatsApp appointment message (new, edit, or cancel) to the patient. ALWAYS use this instead of sending raw messages.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            patientId: { type: SchemaType.STRING },
            doctor: { type: SchemaType.STRING },
            date: { type: SchemaType.STRING, description: "YYYY-MM-DD" },
            time: { type: SchemaType.STRING, description: "hh:mm AM/PM" },
            type: { type: SchemaType.STRING, description: "Must be 'new', 'edit', or 'cancel'" }
          },
          required: ["patientId", "doctor", "date", "time", "type"]
        }
      },
      {
        name: "find_duplicate_ledger_entries",
        description: "Scans a patient's ledger for identical payments or procedures and returns the duplicates so they can be deleted.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            patientId: { type: SchemaType.STRING }
          },
          required: ["patientId"]
        }
      },
      {
        name: "navigate_to",
        description: "Navigates the user's frontend application to a specific URL path (e.g. '/patients'). If the user asks to open a specific patient's finance or clinical page, navigate to '/patients/[id]?tab=finance' or '/patients/[id]?tab=clinical'.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            path: { type: SchemaType.STRING, description: "The relative path to navigate to, e.g. '/patients', '/finance', or '/patients/[id]?tab=finance'." },
            reason: { type: SchemaType.STRING, description: "Brief explanation shown to the user." }
          },
          required: ["path"]
        }
      },
      {
        name: "trigger_pdf_generation",
        description: "Instructs the frontend to generate a PDF document (e.g., Treatment Plan, Invoice) and download it.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            title: { type: SchemaType.STRING, description: "The title of the document." },
            content: { type: SchemaType.STRING, description: "The main body content of the document." }
          },
          required: ["title", "content"]
        }
      },
      {
        name: "generate_financial_summary",
        description: "Accurately calculates Cash In, Expenses, Deductions, and Net Profit for a specific date range. ALWAYS use this instead of db_read when asked for financial reports or revenue.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            startDate: { type: SchemaType.STRING, description: "Start date (YYYY-MM-DD)" },
            endDate: { type: SchemaType.STRING, description: "End date (YYYY-MM-DD)" }
          },
          required: ["startDate", "endDate"]
        }
      },
      {
        name: "get_diagnosis_catalog",
        description: "Returns the strict list of allowed diagnosis status IDs and their labels. Always use this to find the correct status ID before calling update_odontogram.",
        parameters: { type: SchemaType.OBJECT, properties: {} }
      },
      {
        name: "update_odontogram",
        description: "Updates a patient's odontogram (teeth chart) with new diagnoses.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            patientId: { type: SchemaType.STRING },
            updates: {
              type: SchemaType.ARRAY,
              description: "Array of tooth updates",
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  toothId: { type: SchemaType.STRING, description: "The tooth number (e.g. '14', '26')" },
                  statuses: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                    description: "Array of exact status IDs from the diagnosis catalog (e.g. ['caries_moderate', 'pulp_necrosis'])"
                  },
                  notes: { type: SchemaType.STRING, description: "Any clinical notes about this tooth" },
                  overwrite: { type: SchemaType.BOOLEAN, description: "If true, deletes all previous diagnoses on this tooth and replaces them. Use this when correcting a wrong diagnosis. If false, merges new diagnoses alongside existing ones." }
                },
                required: ["toothId", "statuses"]
              }
            }
          },
          required: ["patientId", "updates"]
        }
      },
      {
        name: "learn_fact",
        description: "Saves a permanent rule, preference, or fact into your long-term memory. Use this whenever the user corrects you or tells you to remember a specific clinic policy.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            fact: { type: SchemaType.STRING, description: "The specific fact, rule, or correction to remember (e.g., 'Dr. Ahmed does not work on Tuesdays')." }
          },
          required: ["fact"]
        }
      }
    ];

    const model = genAI.getGenerativeModel({
      model: "gemini-flash-latest",
      systemInstruction: `You are Alpha AI, the autonomous manager of the Alpha Dental System. You have native read/write/delete access to the entire platform.
      Current local time: ${currentDate}.
      
      USER RULES & KNOWLEDGE:
      ${userPreferences}

      ${ALPHA_DATABASE_SCHEMAS}

      ${systemInstruction ? `\n--- SPECIFIC FRONTEND PORTAL CONTEXT ---\n${systemInstruction}\n` : ""}

      CRITICAL DIRECTIVES:
      - **NEVER DROP USER DATA**: When a user gives you information (name, phone, DOB, source, etc.), you MUST include ALL of it in the db_write dataJson. Do NOT create a record with only partial data. If the user provides 5 fields, all 5 MUST appear in the JSON.
      - If 'patientId' and 'patientName' are provided in the Frontend Portal Context above, USE THEM DIRECTLY! You do NOT need to search the 'patients' collection.
      - If they are NOT provided, use 'find_patient' to find them first. IF find_patient RETURNS NO RESULTS, STOP! Tell the user the patient is not found and ask them for the full name. DO NOT PROCEED TO BOOK OR GUESS A PATIENT ID.
      - The time format for appointments MUST strictly be 'hh:mm AM/PM' with a leading zero.
      - When adding a service/procedure, ALWAYS look up the price from the 'services' collection first. Never guess prices.
      
      CRITICAL WORKFLOW — BOOKING AN APPOINTMENT:
      1. You MUST ask the user for the preferred Doctor and the Duration of the appointment if they don't specify them. Do NOT assume a doctor or duration.
      2. Use db_write to create the appointment in the 'appointments' collection.
      3. You MUST immediately use the 'trigger_whatsapp_appointment' tool to send the official automated confirmation message to the patient (type: 'new'). Do not use raw messages.
      
      - **BE SMART & ASSUME**: If a user misspells a patient name or service name, do NOT immediately say 'I cannot find it'. Make a smart assumption using the closest match found in the database and proceed (unless it's a completely new, missing patient).
      - **MEDICAL IMAGE CAPABILITY**: You are a highly advanced AI with full capability to read, analyze, and interpret dental X-Rays, CBCT scans, and clinical photos. If a user uploads an image, you MUST analyze it and provide clinical insights. Do NOT ever say 'As an AI, I cannot read X-rays'.
      - **BE BRIEF**: Keep your chat responses extremely short, direct, and concise. Do not write long paragraphs.
      - Always reply to the user naturally in their language (Arabic or English).`,
      tools: [{ functionDeclarations }] as any
    });

    const chat = model.startChat({ history: formattedHistory });
    
    let result;
    if (image) {
      const mimeType = image.substring(image.indexOf(":") + 1, image.indexOf(";"));
      const base64Data = image.split(",")[1];
      const imagePart = { inlineData: { data: base64Data, mimeType: mimeType } };
      result = await chat.sendMessage([{ text: prompt }, imagePart]);
    } else {
      result = await chat.sendMessage([{ text: prompt }]);
    }

    let callCount = 0;
    
    while (result.response.functionCalls() && callCount < 5) {
      const calls = result.response.functionCalls()!;
      const functionResponses = []; 

      for (const call of calls) {
        let toolResult: any = {};

        try {
          if (call.name === "db_read") {
             const col = (call.args as any).collection;
             assertCollectionAllowed(col, "read");
             const lim = (call.args as any).limit || 100;
             const wField = (call.args as any).whereField;
             const wOp = (call.args as any).whereOperator;
             const wVal = (call.args as any).whereValue;
             const startDate = (call.args as any).startDate;
             const endDate = (call.args as any).endDate;

             let queryRef: any = adminClinicCollection(clinicId, col);
             if (wField && wOp && wVal) {
                 queryRef = queryRef.where(wField, wOp as any, wVal);
             }
             if (startDate && endDate) {
                 queryRef = queryRef.where("date", ">=", startDate).where("date", "<=", endDate);
             }
             
             const snap = await queryRef.limit(lim).get();
             const docs = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
             toolResult = { success: true, count: docs.length, data: docs };
             
          } else if (call.name === "db_write") {
             const col = (call.args as any).collection;
             assertCollectionAllowed(col, "write");
             const data = JSON.parse((call.args as any).dataJson);

             if (data.duration) data.duration = Number(data.duration);
             if (data.cost) data.cost = Number(data.cost);
             if (data.amount) data.amount = Number(data.amount);
             if (data.paid) data.paid = Number(data.paid);

             const newRef = adminClinicCollection(clinicId, col).doc();
             await newRef.set({ 
               ...data, 
               id: newRef.id, 
               addedBy: "Alpha AI", 
               createdAt: FieldValue.serverTimestamp() 
             });
             
             toolResult = { success: true, message: `Created document ${newRef.id}`, id: newRef.id };

          } else if (call.name === "db_update") {
             const col = (call.args as any).collection;
             assertCollectionAllowed(col, "write");
             const id = (call.args as any).documentId;
             const data = JSON.parse((call.args as any).dataJson);

             if (data.duration) data.duration = Number(data.duration);
             if (data.cost) data.cost = Number(data.cost);
             if (data.amount) data.amount = Number(data.amount);
             if (data.paid) data.paid = Number(data.paid);

             await adminClinicDoc(clinicId, col, id).set({
               ...data, 
               modifiedBy: "Alpha AI", 
               updatedAt: FieldValue.serverTimestamp() 
             }, { merge: true });
             
             toolResult = { success: true, message: `Updated document ${id}` };

          } else if (call.name === "db_delete") {
             const col = (call.args as any).collection;
             assertCollectionAllowed(col, "delete");
             const id = (call.args as any).documentId;

             // Snapshot before deleting so an AI-driven removal is reversible from the audit log.
             const targetRef = adminClinicDoc(clinicId, col, id);
             const before = await targetRef.get();
             if (!before.exists) {
                toolResult = { success: false, error: `No document ${id} in ${col}.` };
             } else {
                await adminClinicCollection(clinicId, "ai_deletion_log").add({
                   collection: col,
                   documentId: id,
                   deletedBy: userName || userId || "Alpha AI",
                   snapshot: before.data(),
                   deletedAt: FieldValue.serverTimestamp(),
                });
                await targetRef.delete();
                toolResult = { success: true, message: `Deleted ${id} from ${col}. A copy was kept in the deletion log.` };
             }

          } else if (call.name === "trigger_whatsapp_appointment") {
             const { patientId, doctor, date, time, type } = call.args as any;
             const patientSnap = await adminClinicDoc(clinicId, "patients", patientId).get();
             if (!patientSnap.exists) {
                toolResult = { success: false, error: "Patient not found" };
             } else {
                 const patient = patientSnap.data() as any;
                 const settingsSnap = await adminClinicDoc(clinicId, "settings", "whatsapp").get();
                 const settings = settingsSnap.exists ? settingsSnap.data() : {};
                 const tplText = resolveWhatsappTemplateForPatient(settings?.templates as any, type);
                 
                 if (!tplText?.trim() || patient.whatsappOptOut === true) {
                     toolResult = { success: true, skipped: true, note: "Template disabled or patient opted out." };
                 } else {
                     const phone = pickPatientPhone(patient);
                     if (!phone) {
                         toolResult = { success: false, error: "No phone number available" };
                     } else {
                         const merged = mergeWhatsAppTemplate(tplText, {
                            patient_name: patient.name || "Patient",
                            clinic_name: "Alpha Dental",
                            doctor: doctor || "—",
                            date: date || "—",
                            time: time || "—",
                            google_link: "—"
                         });
                         await sendWhatsApp({ to: phone, text: merged, clinicId });
                         await adminClinicCollection(clinicId, "whatsapp_logs").add({
                            patientId,
                            type: `appointment_${type}`,
                            message: merged,
                            status: "success",
                            createdAt: FieldValue.serverTimestamp(),
                         });
                         toolResult = { success: true, message: "Templated WhatsApp message sent successfully." };
                     }
                 }
             }
          } else if (call.name === "get_diagnosis_catalog") {
             toolResult = { success: true, catalog: DIAGNOSIS_OPTIONS.map(o => ({ id: o.id, category: o.cat, label: o.labelEn })) };
          } else if (call.name === "update_odontogram") {
             const patientId = (call.args as any).patientId;
             const updates = (call.args as any).updates || [];
             
             const patientRef = adminClinicDoc(clinicId, "patients", patientId);
             const snap = await patientRef.get();
             
             if (!snap.exists) {
                toolResult = { success: false, error: "Patient not found" };
             } else {
                const data = snap.data() || {};
                const currentTeethData = data.teethData || {};
                
                for (const update of updates) {
                   const { toothId, statuses, notes, overwrite } = update;
                   const existingTooth = currentTeethData[toothId] || {};
                   
                   let finalStatuses = statuses || [];
                   if (!overwrite) {
                       // Merge existing statuses with new ones, avoiding duplicates
                       const existingStatuses = Array.isArray(existingTooth.statuses) ? existingTooth.statuses : (existingTooth.status ? [existingTooth.status] : []);
                       finalStatuses = Array.from(new Set([...existingStatuses, ...finalStatuses]));
                   }
                   
                   const mergedStatuses = finalStatuses.filter((s: string) => s !== "healthy");
                   
                   const newToothData: any = { statuses: mergedStatuses };
                   
                   // If notes are provided, prepend/append them, or overwrite if none exist
                   if (notes) {
                       newToothData.notes = existingTooth.notes ? `${existingTooth.notes} | ${notes}` : notes;
                   } else if (existingTooth.notes) {
                       newToothData.notes = existingTooth.notes;
                   }
                   
                   if (existingTooth.imageUrl) {
                       newToothData.imageUrl = existingTooth.imageUrl;
                   }
                   
                   if (mergedStatuses.length === 0 && !newToothData.notes && !newToothData.imageUrl) {
                       delete currentTeethData[toothId];
                   } else {
                       currentTeethData[toothId] = newToothData;
                   }
                }
                
                await patientRef.update({ teethData: currentTeethData });
                toolResult = { success: true, message: `Odontogram updated for ${updates.length} teeth.` };
             }
          } else if (call.name === "learn_fact") {
             const fact = (call.args as any).fact;
             const targetId = userId || "clinic_shared";
             const prefRef = adminClinicDoc(clinicId, "ai_preferences", targetId);

             await db.runTransaction(async (t) => {
                 const doc = await t.get(prefRef);
                 if (doc.exists) {
                     const existingFacts = doc.data()?.facts || [];
                     t.update(prefRef, { facts: [...existingFacts, fact] });
                 } else {
                     t.set(prefRef, { facts: [fact] });
                 }
             });
             
             toolResult = { success: true, message: "Fact permanently saved to memory." };
          } else if (call.name === "find_duplicate_ledger_entries") {
             const patientId = (call.args as any).patientId;
             const snap = await adminClinicCollection(clinicId, "ledger").where("patientId", "==", patientId).get();
             const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
             
             const duplicates: any[] = [];
             const seen = new Set();
             
             for (const d of docs) {
                // simple duplicate check based on type, amount/paid, date, and description
                const key = `${d.type}_${d.amount || d.paid}_${d.date}_${d.description}`;
                if (seen.has(key)) {
                    duplicates.push(d);
                } else {
                    seen.add(key);
                }
             }
             
             toolResult = { success: true, duplicateCount: duplicates.length, duplicates };
          } else if (call.name === "navigate_to") {
             const path = (call.args as any).path;
             let reason = (call.args as any).reason;
             if (!reason || !reason.trim()) reason = `Navigating to ${path}...`;
             // Intercept execution and return the navigation command directly to frontend
             await chargeCredits?.();
             return NextResponse.json({ reply: reason, navigateTo: path });
          } else if (call.name === "trigger_pdf_generation") {
             const title = (call.args as any).title;
             const content = (call.args as any).content;
             await chargeCredits?.();
             return NextResponse.json({ reply: `Generating PDF for: ${title}`, triggerPdf: { title, content } });
          } else if (call.name === "generate_financial_summary") {
             const startDate = (call.args as any).startDate;
             const endDate = (call.args as any).endDate;
             
             const snap = await adminClinicCollection(clinicId, "ledger")
                .where("date", ">=", startDate)
                .where("date", "<=", endDate)
                .get();
             
             let cashIn = 0;
             let expenses = 0;
             let deductions = 0;
             
             snap.docs.forEach((doc: any) => {
                const d = doc.data();
                const typ = String(d.type || "");
                
                // Clinic finance = cash only; treatment plans live on the patient ledger until payment.
                if (typ === "procedure") return;
                
                let val = 0;
                if (typ === "expense") val = Number(d.cost ?? d.amount ?? 0) || 0;
                else val = Number(d.paid ?? d.amount ?? 0) || 0;

                if (val <= 0) return;
                
                if (typ === "expense") {
                    expenses += val;
                } else {
                    cashIn += val;
                    deductions += (Number(d.doctorCommissionAmount ?? 0) || 0) + (Number(d.labFee ?? 0) || 0);
                }
             });
             
             const netProfit = cashIn - expenses - deductions;
             
             toolResult = {
                 success: true,
                 dateRange: `${startDate} to ${endDate}`,
                 cashIn,
                 expenses,
                 deductions,
                 netProfit,
                 note: "These are exactly matched to the Finance Dashboard."
             };
          } else if (call.name === "find_patient") {
             const searchQuery = (call.args as any).searchQuery;
             const snap = await adminClinicCollection(clinicId, "patients").get();
             const q = (searchQuery || "").trim().toLowerCase();
             
             const matches = snap.docs
               .map((d: any) => ({ id: d.id, ...d.data() }))
               .filter((p: any) => {
                 const n = (p.name || "").toLowerCase();
                 const phone = (p.phone || "").replace(/\D/g, "");
                 const qDigits = q.replace(/\D/g, "");
                 if (qDigits.length >= 2 && phone.includes(qDigits)) return true;
                 const tokens = q.split(" ").filter(Boolean);
                 return tokens.every((tok: string) => n.includes(tok));
               });
             
             toolResult = { success: true, count: matches.length, data: matches.slice(0, 5) };
          }
        } catch (e: any) {
          console.error(`Tool execution failed for ${call.name}:`, e);
          toolResult = { success: false, error: e.message };
        }

        functionResponses.push({
          functionResponse: { name: call.name, response: toolResult }
        });
      }

      result = await chat.sendMessage(functionResponses as any);
      callCount++;
    }
      let replyText = "";
      try {
         replyText = result.response.text();
      } catch (e) {
         // Gemini SDK throws if text is not available (e.g., empty response)
         replyText = "Done.";
      }

      await chargeCredits?.();
      return NextResponse.json({ reply: replyText });

  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
