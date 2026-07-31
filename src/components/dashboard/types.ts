import { RefObject } from "react";
import type { ClinicScheduleConfig } from "@/lib/clinicSchedule";

export interface DashboardViewProps {
  language: string;
  isRTL: boolean;
  user: any;
  appointments: any[];
  loading: boolean;
  currentTime: Date;
  patientsList: any[];
  doctorsList: any[];
  servicesList: any[];
  activeModal: 'patient' | 'booking' | 'payment' | null;
  paymentPatient: { id: string; name: string } | null;
  preSelectedTime: string;
  preSelectedPatient: { id: string; name: string } | null;
  preSelectedDoctor: string;
  config: ClinicScheduleConfig;
  selectedAppointment: any;
  appointmentToEdit: any;
  scheduleViewDate: string;
  scheduleDateInputRef: RefObject<HTMLInputElement | null>;
  historyDrawerPatientId: string;
  historyDrawerPatientName: string;
  dailyIncome: number | null;
  summaryStats: {
    confirmed: number;
    checkedIn: number;
    inChair: number;
    completed: number;
    checkingOut: number;
    delayed: number;
    canceled: number;
  };
  isScheduleToday: boolean;
  isAppointmentLate: (appt: any) => boolean;
  lateApptToPrompt: any;
  showDelayPrompt: boolean;
  delayedAppointmentData: any;
  prescriptionFinderOpen: boolean;

  // Setters & Handlers
  setActiveModal: (modal: 'patient' | 'booking' | 'payment' | null) => void;
  setPaymentPatient: (val: { id: string; name: string } | null) => void;
  setPreSelectedTime: (val: string) => void;
  setPreSelectedPatient: (val: { id: string; name: string } | null) => void;
  setPreSelectedDoctor: (val: string) => void;
  setAppointmentToEdit: (val: any) => void;
  setScheduleViewDate: (val: string) => void;
  setPrescriptionFinderOpen: (val: boolean) => void;
  setHistoryDrawerPatientId: (val: string) => void;
  setHistoryDrawerPatientName: (val: string) => void;
  setLateApptToPrompt: (val: any) => void;
  setShowDelayPrompt: (val: boolean) => void;
  setInlineSaving: (val: boolean) => void;
  
  handleSelectAppointmentWrapper: (apt: any) => void;
  handleStatusChange: (id: string, newStatus: string) => void;
  handleWaitingMoodChange: (id: string, mood: string) => void;
  handleDeleteAppointment: (e: React.MouseEvent | null, id: string) => void;
  handleSaveBooking: (booking: any) => Promise<void>;
  handleRatingChange: (id: string, rating: number) => void;
  handleLateAction: (action: "delay" | "cancel" | "check_in" | "wait", newDate?: string, newTime?: string) => Promise<void>;
  showToast: (msg: string, type?: 'success'|'error') => void;
}
