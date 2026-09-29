"use client";

/**
 * One settings section, with every check in front of it: signed in, add-on held, allowed to look,
 * allowed to save.
 *
 * Settings renders its sections through this, and so does anywhere else a section is shown — the
 * WhatsApp page's Bot and AI tabs are sections that moved out of Settings, and they must not open
 * any wider there than they did here. One component means one set of gates.
 */

import { Lock, ShieldAlert } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import type { SettingsSection } from "@/config/settingsRegistry";
import { SETTINGS_PANELS } from "@/components/settings/panels";
import { canEditSection, canViewSection, denialMessage } from "@/lib/settingsAccess";
import { isAnyUnlocked, type FeatureKey } from "@/lib/featureCatalog";
import { FeatureLocked } from "@/components/FeatureGate";

export default function SettingsSectionView({ section }: { section: SettingsSection }) {
  const { language } = useLanguage();
  const { user, loading } = useAuth();
  const { clinic, isAdmin, isReadOnly } = useClinic();

  // Auth arrives asynchronously. Deciding before it does rejects the clinic's own admin, which is
  // why the old screen recomputed its gate on every render rather than once on mount.
  if (loading) {
    return <div className="h-40 rounded-3xl bg-surface-muted animate-pulse" aria-hidden="true" />;
  }

  // A section behind an add-on the clinic does not hold says so, with the number to write to —
  // a 404 here read as the page being broken rather than the add-on being off.
  if (section.feature && !isAnyUnlocked(clinic, section.feature as FeatureKey | FeatureKey[])) {
    const first = Array.isArray(section.feature) ? section.feature[0] : section.feature;
    return <FeatureLocked feature={first as FeatureKey} />;
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
  if (!Panel) return null;

  const edit = canEditSection(section, viewer);

  return (
    /* One wrapper for the whole panel: what Sara's tour puts the spotlight on. */
    <div data-tour="settings-panel">
      {!edit.allowed && (
        <p className="mb-6 flex items-start gap-3 rounded-2xl border border-line bg-surface-subtle px-5 py-4 text-sm font-semibold text-ink-body">
          <Lock size={16} className="mt-0.5 shrink-0 text-ink-muted" />
          {denialMessage(edit, language)}
        </p>
      )}
      <Panel canEdit={edit.allowed} />
    </div>
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
