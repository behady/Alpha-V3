// src/app/api/support/ticket/route.ts
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { FieldValue } from "firebase-admin/firestore";
import nodemailer from "nodemailer";

/**
 * Where a support ticket actually goes.
 *
 * The assistant only COMPOSES tickets — a draft card in the chat that the user reads and sends.
 * This route is what the Send button calls, so nothing reaches the support team that a person
 * did not look at first.
 *
 * Two destinations, deliberately in this order:
 *
 *  1. Firestore, root collection `support_tickets` — always. This is the record of truth, written
 *     with the Admin SDK; no client can read or forge it through the rules. A ticket must never
 *     depend on SMTP being up.
 *  2. Email — only when the four SUPPORT_SMTP_* variables and SUPPORT_INBOX_EMAIL are configured.
 *     Configured and failing is reported honestly in the response; not configured at all is not a
 *     failure, it is a clinic that reads its tickets in the database.
 *
 * The screenshot is a data-URL JPEG captured client-side at the moment of sending. It is capped
 * hard here because it travels inside a Firestore document (1 MiB limit) — an oversized one is
 * dropped from storage but still attached to the email, and the ticket says so.
 */

export const maxDuration = 60;

/** Firestore documents cap at ~1 MiB; leave room for the text fields. */
const MAX_STORED_SCREENSHOT_CHARS = 650_000;
/** Beyond this the upload is refused outright — something is wrong with the capture. */
const MAX_SCREENSHOT_CHARS = 4_000_000;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
    if (!clinicId) return NextResponse.json({ error: "clinicId is required." }, { status: 400 });

    const authz = await requireStaffUser(req, clinicId);
    if (!authz.ok) return authz.response;

    const kind = body?.kind === "feature" ? "feature" : body?.kind === "bug" ? "bug" : "";
    const title = String(body?.title || "").trim().slice(0, 200);
    const description = String(body?.description || "").trim().slice(0, 4000);
    const steps = String(body?.steps || "").trim().slice(0, 3000);
    const contactNumber = String(body?.contactNumber || "").trim().slice(0, 40);
    const route = String(body?.route || "").trim().slice(0, 300);
    const userAgent = String(body?.userAgent || "").trim().slice(0, 300);
    const userName = String(body?.userName || "").trim().slice(0, 120);

    if (!kind) return NextResponse.json({ error: "kind must be 'bug' or 'feature'." }, { status: 400 });
    if (!title || !description) {
      return NextResponse.json({ error: "title and description are required." }, { status: 400 });
    }
    // The one field the assistant is told to collect in conversation. A ticket the team cannot
    // call back on is half a ticket.
    if (!contactNumber) {
      return NextResponse.json({ error: "contactNumber is required." }, { status: 400 });
    }

    const errors: { at: string; message: string }[] = Array.isArray(body?.errors)
      ? body.errors.slice(0, 20).map((e: any) => ({
          at: String(e?.at || "").slice(0, 40),
          message: String(e?.message || "").slice(0, 500),
        }))
      : [];

    let screenshot = typeof body?.screenshot === "string" ? body.screenshot : "";
    if (screenshot && !screenshot.startsWith("data:image/")) screenshot = "";
    if (screenshot.length > MAX_SCREENSHOT_CHARS) {
      return NextResponse.json({ error: "Screenshot too large." }, { status: 413 });
    }
    const screenshotStored = !!screenshot && screenshot.length <= MAX_STORED_SCREENSHOT_CHARS;

    const db = adminDb();

    // The clinic's display name goes on the ticket so the team never has to translate an id by
    // hand. Read server-side rather than trusted from the body.
    let clinicName = "";
    try {
      const clinicSnap = await db.collection("clinics").doc(clinicId).get();
      clinicName = clinicSnap.exists ? String((clinicSnap.data() as any)?.name || "") : "";
    } catch {
      /* the ticket still files without it */
    }

    const ref = db.collection("support_tickets").doc();
    await ref.set({
      id: ref.id,
      kind,
      status: "new",
      title,
      description,
      steps,
      contactNumber,
      clinicId,
      clinicName,
      reportedByUid: authz.uid,
      reportedByName: userName,
      reportedByRole: authz.role,
      route,
      userAgent,
      errors,
      // Dropped (not resized) when oversized: a second client-side re-encode could be added
      // later, but a ticket must never fail on its attachment.
      screenshot: screenshotStored ? screenshot : "",
      screenshotOmitted: !!screenshot && !screenshotStored,
      createdAt: FieldValue.serverTimestamp(),
    });

    // --- Email leg, strictly best-effort ---
    let emailSent = false;
    let emailConfigured = false;
    const host = process.env.SUPPORT_SMTP_HOST || "";
    const user = process.env.SUPPORT_SMTP_USER || "";
    const pass = process.env.SUPPORT_SMTP_PASS || "";
    const inbox = process.env.SUPPORT_INBOX_EMAIL || "";
    if (host && user && pass && inbox) {
      emailConfigured = true;
      try {
        const transporter = nodemailer.createTransport({
          host,
          port: Number(process.env.SUPPORT_SMTP_PORT || 465),
          secure: Number(process.env.SUPPORT_SMTP_PORT || 465) === 465,
          auth: { user, pass },
        });

        const esc = (s: string) =>
          s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const label = kind === "bug" ? "BUG" : "FEATURE REQUEST";
        const errorLines = errors.length
          ? errors.map((e) => `<li><code>${esc(e.at)}</code> — ${esc(e.message)}</li>`).join("")
          : "<li>(none captured)</li>";

        await transporter.sendMail({
          from: `"Alpha Support Bot" <${user}>`,
          to: inbox,
          subject: `[${label}] ${title} — ${clinicName || clinicId}`,
          html:
            `<h2>${esc(title)}</h2>` +
            `<p><b>Type:</b> ${label}<br/>` +
            `<b>Clinic:</b> ${esc(clinicName || "(unnamed)")} (<code>${esc(clinicId)}</code>)<br/>` +
            `<b>Reported by:</b> ${esc(userName || "(unknown)")} (${esc(authz.role || "?")})<br/>` +
            `<b>Contact number:</b> ${esc(contactNumber)}<br/>` +
            `<b>Screen:</b> ${esc(route || "(unknown)")}<br/>` +
            `<b>Browser:</b> ${esc(userAgent || "(unknown)")}<br/>` +
            `<b>Ticket id:</b> ${ref.id}</p>` +
            `<h3>Description</h3><p>${esc(description).replace(/\n/g, "<br/>")}</p>` +
            (steps ? `<h3>Steps to reproduce</h3><p>${esc(steps).replace(/\n/g, "<br/>")}</p>` : "") +
            `<h3>Recent JavaScript errors</h3><ul>${errorLines}</ul>` +
            (screenshot ? "<p>Screenshot attached.</p>" : "<p>No screenshot attached.</p>"),
          attachments: screenshot
            ? [{
                filename: "screenshot.jpg",
                content: screenshot.split(",")[1] || "",
                encoding: "base64",
              }]
            : [],
        });
        emailSent = true;
      } catch (e) {
        // The ticket is already stored; a mail failure downgrades the outcome, never voids it.
        console.error("Support ticket email failed:", e);
      }
    }

    await ref.set({ emailSent, emailConfigured }, { merge: true });

    return NextResponse.json({ ok: true, ticketId: ref.id, emailSent, emailConfigured });
  } catch (error: any) {
    console.error("API Error (/api/support/ticket):", error?.stack || error);
    return NextResponse.json({ error: error?.message || "Unknown server error" }, { status: 500 });
  }
}
