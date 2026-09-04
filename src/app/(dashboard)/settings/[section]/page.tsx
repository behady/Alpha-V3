"use client";

/**
 * One settings section.
 *
 * Every section route resolves through here: the registry says which panel to load and who may
 * open it, and this file is the only thing that renders one. There is no per-section page file
 * to forget to guard.
 *
 * The access check is the same function the sidebar uses, so a section that is hidden from the
 * menu cannot be opened by typing its address either. That mattered: hiding a tab's button used
 * to hide nothing at all — typing ?tab=services, ?tab=users or ?tab=locations opened that panel
 * for anyone who could reach Settings, and the clinic's prices, staff list and messaging
 * configuration were all readable that way.
 */

import { useParams } from "next/navigation";
import Link from "next/link";
import { Lock, SearchX, ShieldAlert } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { SETTINGS_SECTIONS } from "@/config/settingsRegistry";
import { SETTINGS_PANELS } from "@/components/settings/panels";
import { canEditSection, canViewSection, denialMessage } from "@/lib/settingsAccess";
import { hasFeature } from "@/lib/subscriptions";

export default function SettingsSectionPage() {
  const params = useParams<{ section: string }>();
  const { language } = useLanguage();
  const { user, loading } = useAuth();
  const { clinic, isAdmin, isReadOnly } = useClinic();

  const segment = typeof params?.section === "string" ? params.section : "";
  const section = SETTINGS_SECTIONS.find((s) => s.route === `/settings/${segment}`);

  // Auth arrives asynchronously. Deciding before it does rejects the clinic's own admin, which is
  // why the old screen recomputed its gate on every render rather than once on mount.
  if (loading) {
    return <div className="h-40 rounded-3xl bg-surface-muted animate-pulse" aria-hidden="true" />;
  }

  if (!section) return <NotFound />;

  if (section.feature && !hasFeature(clinic, section.feature as Parameters<typeof hasFeature>[1])) {
    return <NotFound />;
  }

  const viewer = { isAdmin, isReadOnly, role: user?.role, permissions: user?.permissions };
  const view = canViewSection(section, viewer);
  if (!view.allowed) {
    return (
      <Blocked
        title={language === "ar" ? "هذا القسم مقفل" : "This section is locked"}
        message={denialMessage(view, language)}
      />
    );
  }

  const Panel = SETTINGS_PANELS[section.id];
  if (!Panel) return <NotFound />;

  const edit = canEditSection(section, viewer);

  return (
    <>
      {!edit.allowed && (
        <p className="mb-6 flex items-start gap-3 rounded-2xl border border-line bg-surface-subtle px-5 py-4 text-sm font-semibold text-ink-body">
          <Lock size={16} className="mt-0.5 shrink-0 text-ink-muted" />
          {denialMessage(edit, language)}
        </p>
      )}
      <Panel canEdit={edit.allowed} />
    </>
  );
}

function Blocked({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in">
      <div className="w-20 h-20 bg-surface-muted text-ink-muted rounded-[1.75rem] flex items-center justify-center mb-6">
        <ShieldAlert size={34} />
      </div>
      <h2 className="text-2xl font-black text-ink mb-2 tracking-tight">{title}</h2>
      <p className="max-w-md text-sm font-semibold text-ink-muted">{message}</p>
    </div>
  );
}

function NotFound() {
  const { language } = useLanguage();
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in">
      <div className="w-20 h-20 bg-surface-muted text-ink-muted rounded-[1.75rem] flex items-center justify-center mb-6">
        <SearchX size={34} />
      </div>
      <h2 className="text-2xl font-black text-ink mb-2 tracking-tight">
        {language === "ar" ? "لا يوجد قسم هنا" : "No settings section here"}
      </h2>
      <p className="max-w-md text-sm font-semibold text-ink-muted mb-6">
        {language === "ar"
          ? "الرابط قد يكون قديماً. اختر قسماً من القائمة."
          : "That link may be out of date. Pick a section from the list."}
      </p>
      <Link
        href="/settings"
        className="rounded-2xl bg-accent px-6 py-3 text-sm font-bold text-ink-on-accent transition-all active:scale-95"
      >
        {language === "ar" ? "كل الإعدادات" : "All settings"}
      </Link>
    </div>
  );
}
