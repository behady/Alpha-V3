"use client";

import { useEffect, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import BookingModal from "@/components/BookingModal";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { auth } from "@/lib/firebase";
import { currentClinicId, getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { saveBooking } from "@/lib/bookingService";
import { parseClinicSchedule, type ClinicScheduleConfig } from "@/lib/clinicSchedule";
import { isDentistStaff } from "@/lib/staffRoles";
import { markCallBooked, callReminderErrorText } from "@/lib/callRemindersApi";
import type { CallReminder } from "@/lib/callReminders";

/**
 * "Book now" from a call: the booking pop-up for that patient, saved the way the dashboard saves
 * one, and only then the call marked booked. Closing the pop-up without saving, or a save that
 * fails, leaves the call open.
 */

async function sendOwnerAlert(alertKey: string, message: string) {
  try {
    const u = auth.currentUser;
    if (!u) return;
    await fetch("/api/whatsapp/owner-alert", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await u.getIdToken()}` },
      body: JSON.stringify({ alertKey, message, clinicId: currentClinicId() }),
    });
  } catch (e) {
    console.warn("Owner WhatsApp alert", e);
  }
}

export default function CallBookingHost({ reminder, onClose }: { reminder: CallReminder | null; onClose: () => void }) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const { showToast } = useUI();
  const isAr = language === "ar";
  const [doctors, setDoctors] = useState<{ id: string; name: string }[]>([]);
  const [services, setServices] = useState<Record<string, unknown>[]>([]);
  const [config, setConfig] = useState<ClinicScheduleConfig | undefined>(undefined);

  // Read only while a booking is open; the card itself never needs them.
  useEffect(() => {
    if (!reminder) return;
    const offStaff = onSnapshot(getClinicCollection("staff"), (snap) =>
      setDoctors(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as { id: string; name?: string; role?: string; isDentist?: boolean })
          .filter((s) => isDentistStaff(s))
          .map((s) => ({ id: s.id, name: String(s.name || "") })),
      ),
    );
    const offServices = onSnapshot(getClinicCollection("services"), (snap) => setServices(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    const offConfig = onSnapshot(getClinicDoc("settings", "clinic_info"), (snap) => {
      if (snap.exists()) setConfig(parseClinicSchedule(snap.data() as Record<string, unknown>));
    });
    return () => {
      offStaff();
      offServices();
      offConfig();
    };
  }, [reminder]);

  if (!reminder) return null;

  // Typed as the dashboard's own save handler is: the pop-up's payload is what saveBooking takes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onSave = async (data: any) => {
    try {
      const saved = await saveBooking(
        data,
        { uid: user?.uid || "", name: user?.name || "System", role: user?.role || "", language: language as "en" | "ar" },
        sendOwnerAlert,
      );
      // The patient can be changed inside the pop-up; a booking for someone else does not close
      // this patient's call.
      if (String(data.patientId) === reminder.patientId || String(saved.patientId) === reminder.patientId) {
        try {
          await markCallBooked(reminder.id, saved.appointmentId, String(data.date || ""));
          showToast(isAr ? "الميعاد اتحجز والمكالمة اتقفلت" : "Booked, and the call is closed", "success");
        } catch (e) {
        // The visit is booked either way; say so, and that the call is still open.
          showToast(`${isAr ? "الميعاد اتحجز، بس المكالمة لسه مفتوحة:" : "Booked, but the call is still open:"} ${callReminderErrorText(e, isAr)}`, "error");
        }
      } else {
        showToast(isAr ? "الميعاد اتحجز لمريض تاني، والمكالمة لسه مفتوحة" : "Booked for another patient; this call is still open", "success");
      }
      onClose();
    } catch (error) {
      console.error("Booking from a call failed:", error);
      showToast(isAr ? "الحجز ما اتحفظش" : "The booking was not saved", "error");
    }
  };

  return (
    <BookingModal
      isOpen={true}
      inlineDesktop={false}
      wide
      onClose={onClose}
      onSave={onSave}
      patients={[{ id: reminder.patientId, name: reminder.patientName, phone: reminder.patientPhone }]}
      doctors={doctors}
      servicesList={services}
      settingsConfig={config}
      preSelectedPatient={{ id: reminder.patientId, name: reminder.patientName }}
      preSelectedBranchId={reminder.branchId || undefined}
    />
  );
}
