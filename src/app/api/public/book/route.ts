import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { clinicId, date, time, doctor, patientName, patientPhone, reason, duration } = body;

    if (!clinicId || !date || !time || !patientName || !patientPhone) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const db = adminDb();

    // 1. Verify Online Booking is enabled
    const settingsSnap = await db.collection("clinics").doc(clinicId).collection("settings").doc("onlineBooking").get();
    if (!settingsSnap.exists || !settingsSnap.data()?.enabled) {
      return NextResponse.json({ error: "Online booking is disabled for this clinic." }, { status: 403 });
    }

    // 2. Verify slot is not already booked (simple check)
    const existingApptsSnap = await db.collection("clinics").doc(clinicId).collection("appointments")
      .where("date", "==", date)
      .where("time", "==", time)
      .get();
      
    if (!existingApptsSnap.empty) {
      return NextResponse.json({ error: "This time slot is no longer available." }, { status: 409 });
    }

    // 3. Find or Create Patient
    const patientsRef = db.collection("clinics").doc(clinicId).collection("patients");
    const existingPatientQuery = await patientsRef.where("phone", "==", patientPhone).limit(1).get();
    
    let patientId = "";
    
    if (existingPatientQuery.empty) {
      // Create new patient
      const newPatientRef = await patientsRef.add({
        name: patientName,
        phone: patientPhone,
        createdAt: FieldValue.serverTimestamp(),
        lastVisit: null,
        notes: "Created via Online Booking",
        nextAppointment: date,
        source: "Online Booking"
      });
      patientId = newPatientRef.id;
    } else {
      patientId = existingPatientQuery.docs[0].id;
    }

    // 4. Create Appointment
    const apptData = {
      patientId,
      patientName,
      patientPhone,
      date,
      time,
      duration: duration || 30,
      doctor: doctor || "Any",
      treatment: reason || "Consultation",
      status: "Pending",
      source: "online",
      notes: "Online Booking Request",
      createdAt: FieldValue.serverTimestamp()
    };

    await db.collection("clinics").doc(clinicId).collection("appointments").add(apptData);

    return NextResponse.json({ success: true, message: "Appointment requested successfully." });
    
  } catch (error: any) {
    console.error("Public Book API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
