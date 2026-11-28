import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { reportServerError } from "@/lib/server/reportError";
import {
  DAILY_COLLECTION,
  MONTHLY_COLLECTION,
  RETENTION_DAYS,
  dailyDocId,
  isEmptyBeat,
  monthlyDocId,
  sanitizeBeat,
  usageDay,
} from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One minute of somebody's use of the app, added to their day and their month.
 *
 * Through the server for the usual reason: these collections are not in firestore.rules, so no
 * browser can read or write them at all — the only door is this route, which takes WHO from the
 * token and never from the body, and takes the name, email and role from the person's own
 * profile. The body supplies only counts, and lib/usage clamps those.
 *
 * Two writes per beat, both increments: the day document (deleted after two months by
 * /api/automation/usage-cleanup) and the month document, which is the summary that stays.
 *
 * Never a failure to the caller. The app must not notice whether counting worked.
 */
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return NextResponse.json({ ok: false }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
    if (!clinicId || clinicId.includes("/") || clinicId.length > 64) return NextResponse.json({ ok: true, written: 0 });

    const beat = sanitizeBeat(body);
    if (isEmptyBeat(beat)) return NextResponse.json({ ok: true, written: 0 });

    const decoded = await adminAuth().verifyIdToken(token);
    const profile = (await adminDb().collection("users").doc(decoded.uid).get()).data() || {};
    // A role IN THIS CLINIC, or nothing is kept: a superadmin visiting is support, not use, and
    // a body naming somebody else's clinic is simply ignored.
    const role = (profile.clinicRoles || {})[clinicId];
    if (typeof role !== "string" || !role || role === "Patient") return NextResponse.json({ ok: true, written: 0 });

    const now = new Date();
    const day = usageDay(now);
    const month = day.slice(0, 7);
    const who = {
      clinicId,
      uid: decoded.uid,
      name: String(profile.name || decoded.name || "").slice(0, 80),
      email: String(profile.email || decoded.email || "").slice(0, 120),
      phone: String(profile.phone || profile.phoneNumber || decoded.phone_number || "").slice(0, 30),
      role: role.slice(0, 30),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const pages: Record<string, Record<string, FieldValue>> = {};
    for (const [key, p] of Object.entries(beat.pages)) {
      pages[key] = {
        sec: FieldValue.increment(p.sec),
        opens: FieldValue.increment(p.opens),
        taps: FieldValue.increment(p.taps),
        phoneSec: FieldValue.increment(p.phoneSec),
      };
    }
    const hits: Record<string, Record<string, FieldValue>> = {};
    for (const [key, targets] of Object.entries(beat.hits)) {
      hits[key] = {};
      for (const [target, n] of Object.entries(targets)) hits[key][target] = FieldValue.increment(n);
    }

    const db = adminDb();
    const batch = db.batch();
    batch.set(
      db.collection(DAILY_COLLECTION).doc(dailyDocId(clinicId, decoded.uid, day)),
      {
        ...who,
        day,
        // Read by the nightly cleanup, and usable as a Firestore TTL field if one is ever set up.
        expireAt: Timestamp.fromMillis(now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
        pages,
        hits,
      },
      { merge: true }
    );
    batch.set(
      db.collection(MONTHLY_COLLECTION).doc(monthlyDocId(clinicId, decoded.uid, month)),
      { ...who, month, days: { [String(Number(day.slice(8, 10)))]: true }, pages, hits },
      { merge: true }
    );
    await batch.commit();

    return NextResponse.json({ ok: true, written: 2 });
  } catch (error) {
    reportServerError("Usage beat failed:", error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
