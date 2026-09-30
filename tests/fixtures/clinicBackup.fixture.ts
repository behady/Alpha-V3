// A small clinic for the Excel backup tests. Every case the builder must get right is here once:
// a paid and an unpaid treatment, the placeholder-zero payment shape, a deleted payment, an
// expense, a patient with no ledger rows at all, an appointment with a status nobody defined,
// a remade lab case, an inactive price list, and punches across two months.

import type { ClinicBackupData } from "../../src/lib/backup/types";

const AMIRA = "pat-amira";
const OMAR = "pat-omar";
const EMPTY = "pat-empty";

export const TODAY = "2026-09-30";

export const fixture: ClinicBackupData = {
  clinic: { id: "clinic-1", name: "عيادة ألفا", timeZone: "Africa/Cairo" },
  generatedAt: "2026-09-30T10:15:00.000Z",
  generatedBy: "Ahmed Tarek",

  patients: [
    {
      id: OMAR, fileId: "PT-2", name: "Omar Ali", phone: "01000000002", gender: "Male",
      dateOfBirth: "1990-05-01", address: "Nasr City", branchName: "Downtown", source: "Facebook",
      medicalHistory: "Diabetic", allergies: "Penicillin", status: "Active", createdAt: "2026-08-01",
    },
    {
      id: AMIRA, fileId: "PT-1", name: "أميرة سعيد", phone: "01000000001", gender: "Female",
      dateOfBirth: "1985-02-14", address: "المعادي", branchName: "Downtown", source: "Walk-in",
      medicalHistory: "", allergies: "", status: "Active", createdAt: "2026-07-15",
    },
    // Missing fields on purpose: the loader hands "" for absent strings, and the sheet must show
    // an empty cell, never "undefined".
    {
      id: EMPTY, fileId: "PT-3", name: "No Rows", phone: "", gender: "", dateOfBirth: "", address: "",
      branchName: "", source: "", medicalHistory: "", allergies: "", status: "", createdAt: "",
    },
  ],

  appointments: [
    { id: "apt-2", date: "2026-09-10", time: "11:00", patientId: AMIRA, patientName: "أميرة سعيد", patientPhone: "01000000001", doctor: "Dr. Sara", treatment: "Crown", status: "Completed", duration: 60, branchName: "Downtown", roomName: "Room 1", source: "phone", cost: 3000, notes: "" },
    { id: "apt-1", date: "2026-09-01", time: "10:00", patientId: AMIRA, patientName: "أميرة سعيد", patientPhone: "01000000001", doctor: "Dr. Sara", treatment: "Consultation", status: "Completed", duration: 30, branchName: "Downtown", roomName: "", source: "", cost: null, notes: "First visit" },
    { id: "apt-odd", date: "2026-09-20", time: "09:30", patientId: OMAR, patientName: "Omar Ali", patientPhone: "01000000002", doctor: "Dr. Sara", treatment: "Filling", status: "Weird Status", duration: 45, branchName: "", roomName: "", source: "", cost: null, notes: "" },
    { id: "apt-3", date: "2026-10-05", time: "14:00", patientId: OMAR, patientName: "Omar Ali", patientPhone: "01000000002", doctor: "Dr. Sara", treatment: "Follow-up", status: "Scheduled", duration: 30, branchName: "", roomName: "", source: "", cost: null, notes: "" },
  ],

  ledger: [
    // Amira: one crown charged 3000, paid 1000 then 350 (the placeholder-zero shape); a 500 that
    // was deleted and must not count; total paid 1350, owed 1650.
    { id: "proc-crown", type: "procedure", date: "2026-09-10", description: "Crown (T: 14)", category: "Treatment", method: "Cash", patientId: AMIRA, patientName: "أميرة سعيد", doctorId: "staff-sara", doctorName: "Dr. Sara", amount: 3000, paid: 1350, cost: 3000, discountAmount: 200, labFee: 600, doctorCommissionAmount: 0, clinicProfit: 0, payerName: "Private", status: "", notes: "" },
    { id: "pay-1", type: "payment", date: "2026-09-10", description: "Payment", category: "Treatment Payment", method: "Cash", patientId: AMIRA, patientName: "أميرة سعيد", doctorId: "staff-sara", doctorName: "Dr. Sara", amount: 1000, paid: 1000, cost: 0, discountAmount: 0, labFee: 600, doctorCommissionAmount: 120, clinicProfit: 280, payerName: "Private", status: "", notes: "" },
    { id: "pay-placeholder", type: "payment", date: "2026-09-15", description: "Payment", category: "Treatment Payment", method: "InstaPay", patientId: AMIRA, patientName: "أميرة سعيد", doctorId: "staff-sara", doctorName: "Dr. Sara", amount: 0, paid: 350, cost: 0, discountAmount: 0, labFee: 0, doctorCommissionAmount: 105, clinicProfit: 245, payerName: "Private", status: "", notes: "" },
    { id: "pay-deleted", type: "payment", date: "2026-09-16", description: "Payment", category: "Treatment Payment", method: "Cash", patientId: AMIRA, patientName: "أميرة سعيد", doctorId: "staff-sara", doctorName: "Dr. Sara", amount: 500, paid: 500, cost: 0, discountAmount: 0, labFee: 0, doctorCommissionAmount: 0, clinicProfit: 0, payerName: "Private", status: "deleted", notes: "entered twice" },
    // Omar: an unpaid filling.
    { id: "proc-filling", type: "procedure", date: "2026-09-20", description: "Filling (T: 36)", category: "Treatment", method: "Cash", patientId: OMAR, patientName: "Omar Ali", doctorId: "staff-sara", doctorName: "Dr. Sara", amount: 800, paid: 0, cost: 800, discountAmount: 0, labFee: 0, doctorCommissionAmount: 0, clinicProfit: 0, payerName: "", status: "", notes: "" },
    // Clinic money with no patient.
    { id: "inc-1", type: "income", date: "2026-09-02", description: "Sold old chair", category: "Other", method: "Cash", patientId: "", patientName: "", doctorId: "", doctorName: "", amount: 2000, paid: 2000, cost: 0, discountAmount: 0, labFee: 0, doctorCommissionAmount: 0, clinicProfit: 2000, payerName: "", status: "", notes: "" },
    { id: "exp-1", type: "expense", date: "2026-09-03", description: "Gloves", category: "Supplies", method: "Cash", patientId: "", patientName: "", doctorId: "", doctorName: "", amount: 640, paid: 0, cost: 640, discountAmount: 0, labFee: 0, doctorCommissionAmount: 0, clinicProfit: 0, payerName: "", status: "", notes: "3 boxes" },
  ],

  labs: [
    { id: "lab-madina", name: "Madina Lab" },
    { id: "lab-nile", name: "Nile Dental Lab" },
  ],
  labCases: [
    { id: "case-1", code: "MAD-0001", codeNumber: 1, branchCode: "MAD", branchId: "b1", branchName: "Downtown", patientId: AMIRA, patientName: "أميرة سعيد", doctorId: "staff-sara", doctorName: "Dr. Sara", labId: "lab-madina", labName: "Madina Lab", workType: "zirconia", teeth: [14, 15], units: 2, bodyShade: "A2", material: "Zirconia", agreedPrice: 1200, sentVia: "driver", status: "fitted", needsTryIn: false, sentAt: "2026-09-05", dueDate: "2026-09-09", receivedAt: "2026-09-09", fittedAt: "2026-09-10" },
    { id: "case-2", code: "NIL-0001", codeNumber: 1, branchCode: "NIL", branchId: "b1", branchName: "Downtown", patientId: OMAR, patientName: "Omar Ali", labId: "lab-nile", labName: "Nile Dental Lab", workType: "emax", teeth: [21], units: 1, agreedPrice: 900, sentVia: "digital", status: "at_lab", needsTryIn: false, sentAt: "2026-09-25", dueDate: "2026-10-02" },
    { id: "case-3", code: "MAD-0001-R2", codeNumber: 1, branchCode: "MAD", branchId: "b1", branchName: "Downtown", patientId: AMIRA, patientName: "أميرة سعيد", labId: "lab-madina", labName: "Madina Lab", workType: "zirconia", teeth: [14, 15], units: 2, agreedPrice: 0, sentVia: "driver", status: "back", needsTryIn: false, sentAt: "2026-09-12", receivedAt: "2026-09-18", remakeOfId: "case-1", remakeOfCode: "MAD-0001", remakeReason: "Shade mismatch", remakeFault: "lab", remakeRound: 2 },
  ],
  labPayments: [
    { id: "lp-1", labId: "lab-madina", labName: "Madina Lab", amount: 700, date: "2026-09-11", method: "cash" },
    { id: "lp-2", labId: "lab-nile", labName: "Nile Dental Lab", amount: 100, date: "2026-09-26", method: "transfer", reference: "TRX-9", note: "advance" },
  ],

  staff: [
    {
      id: "staff-sara", uid: "uid-sara", name: "Dr. Sara", role: "Dentist", baseSalary: 8000, commissionPercentage: 30, overtimeMultiplier: 1.5,
      registeredDeviceId: "dev-1",
      schedule: { 0: { active: true, start: "10:00", end: "18:00" }, 1: { active: true, start: "10:00", end: "18:00" }, 2: { active: false, start: "", end: "" } },
      email: "sara@example.com", phone: "01000000009", active: true, isDentist: true,
    },
    {
      id: "staff-mona", uid: "uid-mona", name: "Mona", role: "Receptionist", baseSalary: 4000, commissionPercentage: 0, overtimeMultiplier: 1,
      registeredDeviceId: null, schedule: null, email: "", phone: "", active: false, isDentist: false,
    },
  ],

  services: [
    { id: "svc-crown", name: "Crown", category: "Prosthodontics", pricingMode: "per_tooth", requiresLab: true, estimatedLabFee: 600, price: 3000, prices: { "list-axa": 2500 } },
    { id: "svc-filling", name: "Filling", category: "Restorative", pricingMode: "per_tooth", requiresLab: false, estimatedLabFee: null, price: 800, prices: {} },
    { id: "svc-consult", name: "Consultation", category: "", pricingMode: "flat", requiresLab: false, estimatedLabFee: null, price: 200, prices: { "list-standard": 150, "list-axa": 0 } },
  ],
  priceLists: [
    { id: "list-standard", name: "Standard", generalDiscountPercent: 0, active: true, isDefault: true },
    { id: "list-axa", name: "AXA", nameAr: "أكسا", generalDiscountPercent: 10, active: false, isDefault: false },
  ],

  punches: [
    // August: one shift.
    { id: "p-1", userId: "uid-sara", staffId: "staff-sara", userName: "Dr. Sara", date: "2026-08-30", checkIn: new Date("2026-08-30T07:05:00.000Z"), checkOut: new Date("2026-08-30T15:00:00.000Z"), durationMinutes: 475, status: "completed", overtimeStatus: "", checkInDistanceM: 10, checkInAccuracyM: 20, deviceId: "dev-1" },
    // September: Sara works Sun 6th and Mon 7th (her scheduled days), Mona one open shift.
    { id: "p-2", userId: "uid-sara", staffId: "staff-sara", userName: "Dr. Sara", date: "2026-09-06", checkIn: new Date("2026-09-06T07:05:00.000Z"), checkOut: new Date("2026-09-06T15:00:00.000Z"), durationMinutes: 475, status: "completed", overtimeStatus: "", checkInDistanceM: 10, checkInAccuracyM: 20, deviceId: "dev-1" },
    { id: "p-3", userId: "uid-sara", staffId: "staff-sara", userName: "Dr. Sara", date: "2026-09-07", checkIn: new Date("2026-09-07T07:30:00.000Z"), checkOut: new Date("2026-09-07T16:30:00.000Z"), durationMinutes: 540, status: "completed", overtimeStatus: "pending", checkInDistanceM: 10, checkInAccuracyM: 20, deviceId: "dev-1" },
    { id: "p-4", userId: "uid-mona", staffId: "staff-mona", userName: "Mona", date: "2026-09-07", checkIn: new Date("2026-09-07T08:00:00.000Z"), checkOut: null, durationMinutes: 0, status: "open", overtimeStatus: "", checkInDistanceM: null, checkInAccuracyM: null, deviceId: null },
  ],
};
