"use client";

/**
 * Section id → the panel that renders it, loaded on demand.
 *
 * Kept apart from the registry so the registry stays pure data that a test can read without
 * pulling React in. This file is the only place the two meet.
 *
 * Every entry is a `dynamic()` import, which is the whole of finding 10: all twenty-odd panels
 * used to be imported at the top of one page, so opening Theme on a phone downloaded the
 * WhatsApp panel (1,503 lines), the SMS panel (752) and the whole price-list editor (793) to
 * change a colour. Now a section's code arrives when that section is opened.
 *
 * `ssr: false` throughout: every panel subscribes to Firestore from the browser and reads the
 * signed-in user out of context, so there is nothing meaningful to render on the server.
 */

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import {
  Bell,
  Building2,
  CalendarClock,
  ClipboardList,
  Fingerprint,
  FlaskConical,
  Globe,
  History,
  MapPinned,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  Palette,
  Pill,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
  UserCircle,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * The icon for each section. Here rather than in the registry because the registry is pure data
 * that a test reads without React — importing an icon library into it would break that.
 */
export const SETTINGS_ICONS: Record<string, LucideIcon> = {
  general: UserCircle,          // your own record, not the team list
  appearance: Palette,
  interface: SlidersHorizontal, // preferences, not a screen
  clinic_profile: Building2,    // the clinic itself
  clinical: CalendarClock,      // working hours
  locations: MapPinned,         // the places it works from
  labs: FlaskConical,
  services: Tag,                // a price list is a list of prices
  prescriptions: Pill,
  visit_reasons: ClipboardList, // what reception picks from when booking
  sources: Megaphone,           // how a patient heard about the clinic
  attendance: Fingerprint,      // clocking in
  online_booking: Globe,        // a public page on the internet
  recall: RotateCcw,
  users: Users,
  join_requests: UserPlus,      // people asking to become users
  notifications: Bell,
  whatsapp: MessageCircle,
  sms: MessagesSquare,
  logs: History,                // what happened, in order
  ai_credits: Sparkles,
  recently_deleted: Trash2,
};

/** What every panel receives. Most ignore it; the ones that can be read-only do not. */
export interface SettingsPanelProps {
  /** False when the viewer may look but not save — an admin-only section, or an expired clinic. */
  canEdit: boolean;
}

const loading = () => (
  <div className="space-y-4" aria-hidden="true">
    <div className="h-8 w-48 rounded-xl bg-surface-muted animate-pulse" />
    <div className="h-40 rounded-3xl bg-surface-muted animate-pulse" />
    <div className="h-24 rounded-3xl bg-surface-muted animate-pulse" />
  </div>
);

const panel = <P,>(loader: () => Promise<{ default: ComponentType<P> }>) =>
  dynamic(loader, { ssr: false, loading });

export const SETTINGS_PANELS: Record<string, ComponentType<SettingsPanelProps>> = {
  // --- Personal ---
  general: panel(() => import("@/components/settings/UserProfile")),
  appearance: panel(() => import("@/components/settings/AppearanceSettings")),
  interface: panel(() => import("@/components/settings/InterfaceSettings")),

  // --- Clinic ---
  clinical: panel(() => import("@/components/settings/hosts/ScheduleHost")),
  locations: panel(() => import("@/components/settings/LocationsSettings")),
  labs: panel(() => import("@/components/settings/DentalLabsSettings")),
  services: panel(() => import("@/components/settings/hosts/PricesHost")),
  prescriptions: panel(() => import("@/components/settings/PrescriptionSettings")),
  visit_reasons: panel(() => import("@/components/settings/VisitReasonsSettings")),
  sources: panel(() => import("@/components/settings/PatientSourcesSettings")),
  attendance: panel(() => import("@/components/settings/hosts/AttendanceHost")),
  online_booking: panel(() => import("@/components/settings/OnlineBookingSettings")),
  recall: panel(() => import("@/components/settings/RecallSettings")),

  // --- People ---
  users: panel(() => import("@/components/settings/hosts/UsersHost")),
  join_requests: panel(() => import("@/components/settings/JoinRequests")),

  // --- System ---
  notifications: panel(() => import("@/components/settings/hosts/AlertsHost")),
  whatsapp: panel(() => import("@/components/settings/WhatsAppSettings")),
  sms: panel(() => import("@/components/settings/SmsSettings")),
  logs: panel(() => import("@/components/settings/ActivityLogs")),
  ai_credits: panel(() => import("@/components/settings/AiCreditsSettings")),
  recently_deleted: panel(() => import("@/components/settings/RecentlyDeleted")),
};

/**
 * `clinic_profile` is deliberately absent: it has its own page at /settings/clinic, which is on
 * the assistant's allowed-routes list and is linked from a help article. The sidebar links there
 * rather than rendering it inline.
 */
export const SECTIONS_WITHOUT_PANELS = ["clinic_profile"] as const;
