"use client";

/**
 * One person's preferences, as a list of questions rather than six pages of tiles.
 *
 * Every choice here used to be a grid of cards two hundred pixels tall — three across, seven times
 * over, each one repeating the same border-and-icon markup — so a page holding eight small
 * decisions ran to four screens and gave "should the appointments link show on a phone" exactly
 * as much room as "how does the clinical editor open". They are rows now: the question on the
 * left, the answers as a segmented control on the right, and one line underneath saying what the
 * answer you picked actually does. Only the chosen option's explanation is on screen, because the
 * other two are answers to a question you have already settled.
 *
 * The old tiles were painted in `primary-*`, a fixed slate that no theme can reach, which made
 * this the one screen in the product where choosing a theme provably changed nothing: the selected
 * tile stayed grey-blue on every preset. Selection carries the clinic's accent now, so the setting
 * next door can be seen working from here.
 */

import {
  AlertTriangle,
  AlignJustify,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Calendar,
  CalendarDays,
  CalendarOff,
  LayoutList,
  ListOrdered,
  Monitor,
  MonitorSmartphone,
  MoveVertical,
  PanelRight,
  PencilLine,
  Rows3,
  Sparkles,
  SquareTerminal,
  UserCircle,
  type LucideIcon,
} from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useSettingsText } from "@/lib/useSettingsText";
import { useUI } from "@/context/UIContext";

/** One answer to one preference question. */
type Choice<T extends string> = {
  value: T;
  label: string;
  icon: LucideIcon;
  /** What picking this actually does. Shown only while it is the current answer. */
  hint?: string;
};

/**
 * A question, its answers, and what the current answer means.
 *
 * The hint moves with the selection rather than sitting under every option at once. Three
 * permanent explanations of three mutually exclusive choices is two explanations of roads not
 * taken, and it was most of this page's length.
 */
function PreferenceRow<T extends string>({
  icon: Icon,
  label,
  description,
  value,
  onChange,
  choices,
  note,
}: {
  icon: LucideIcon;
  label: string;
  description?: string;
  value: T;
  onChange: (next: T) => void;
  choices: Choice<T>[];
  /** A consequence worth stating in its own right — shown under the row when present. */
  note?: string;
}) {
  const chosen = choices.find((c) => c.value === value);

  return (
    <div className="border-t border-line py-5 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
        <div className="min-w-0 lg:max-w-md">
          <p className="flex items-center gap-2 text-sm font-black text-ink">
            <Icon size={15} className="shrink-0 text-ink-muted" />
            {label}
          </p>
          {description && (
            <p className="mt-1 text-xs font-medium leading-relaxed text-ink-muted">{description}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-1 self-start rounded-2xl border border-line bg-surface-subtle p-1">
          {choices.map((choice) => {
            const ChoiceIcon = choice.icon;
            const active = choice.value === value;
            return (
              <button
                key={choice.value}
                type="button"
                onClick={() => onChange(choice.value)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-bold transition-all ${
                  active
                    ? "bg-accent text-ink-on-accent shadow-sm"
                    : "text-ink-body hover:bg-surface hover:text-ink"
                }`}
              >
                <ChoiceIcon size={14} className="shrink-0" />
                {choice.label}
              </button>
            );
          })}
        </div>
      </div>

      {chosen?.hint && (
        <p className="mt-2.5 text-[11px] font-semibold leading-relaxed text-ink-muted lg:mt-3">
          {chosen.hint}
        </p>
      )}

      {note && (
        <p className="mt-2.5 rounded-xl border border-warn/25 bg-warn-tint px-4 py-3 text-[11px] font-bold leading-relaxed text-warn">
          {note}
        </p>
      )}
    </div>
  );
}

/** The same row, for a question with only two answers and no explaining to do. */
function ToggleRow({
  icon: Icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-t border-line py-5 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-black text-ink">
          <Icon size={15} className="shrink-0 text-ink-muted" />
          {label}
        </p>
        {description && (
          <p className="mt-1 max-w-xl text-xs font-medium leading-relaxed text-ink-muted">
            {description}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-accent" : "bg-surface-muted"
        }`}
      >
        {/* Positioned on the logical inline-start edge, not translated along a physical axis:
            `translate-x-7` moves the knob right in Arabic too, where "on" is the left end. */}
        <span
          className={`absolute top-1 h-6 w-6 rounded-full bg-surface shadow-sm transition-all ${
            checked ? "start-7" : "start-1"
          }`}
        />
      </button>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">
        {title}
      </h3>
      <div className="rounded-2xl border border-line bg-surface px-5 py-1">{children}</div>
    </section>
  );
}

export default function InterfaceSettings() {
  const { isRTL } = useLanguage();
  const {
    clinicalEditorMode, setClinicalEditorMode,
    appointmentEditorMode, setAppointmentEditorMode,
    appointmentPanelMode, setAppointmentPanelMode,
    appointmentsVisibility, setAppointmentsVisibility,
    latePatientTrackerEnabled, setLatePatientTrackerEnabled,
    clinicalNoteSort, setClinicalNoteSort,
    clinicalNoteGrouping, setClinicalNoteGrouping,
    clinicalNoteDensity, setClinicalNoteDensity,
  } = useUI();

  const txt = useSettingsText("interface");

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 pb-4" dir={isRTL ? "rtl" : "ltr"}>
      {/* The one thing about this page that is not obvious from looking at it: none of these
          choices belong to the browser or to the clinic. They are the reader's, and they travel. */}
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
              <UserCircle size={12} />
              {txt.title}
            </p>
            <p className="max-w-xl text-[15px] font-bold leading-relaxed text-white sm:text-base">
              {txt.followsYou}
            </p>
          </div>

          <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-white/12 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-white sm:self-auto">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {txt.savedInstantly}
          </span>
        </div>
      </div>

      <Group title={txt.groupWhereOpens}>
        <PreferenceRow
          icon={SquareTerminal}
          label={txt.clinicalEditorLabel}
          description={txt.clinicalEditorDesc}
          value={clinicalEditorMode}
          onChange={setClinicalEditorMode}
          choices={[
            { value: "modal", label: txt.modal, icon: SquareTerminal, hint: txt.modalHint },
            { value: "drawer", label: txt.drawer, icon: PanelRight, hint: txt.drawerHint },
            { value: "inline", label: txt.inline, icon: LayoutList, hint: txt.inlineHint },
          ]}
        />

        <PreferenceRow
          icon={Calendar}
          label={txt.appointmentEditorLabel}
          description={txt.appointmentEditorDesc}
          value={appointmentEditorMode}
          onChange={setAppointmentEditorMode}
          choices={[
            { value: "modal", label: txt.modal, icon: SquareTerminal, hint: txt.modalHint },
            { value: "drawer", label: txt.drawer, icon: PanelRight, hint: txt.drawerHint },
          ]}
        />

        <PreferenceRow
          icon={PanelRight}
          label={txt.panelModeLabel}
          description={txt.panelModeDesc}
          value={appointmentPanelMode}
          onChange={setAppointmentPanelMode}
          choices={[
            { value: "editor", label: txt.panelEditor, icon: PencilLine, hint: txt.panelEditorHint },
            { value: "avatar", label: txt.panelAvatar, icon: Sparkles, hint: txt.panelAvatarHint },
          ]}
        />
      </Group>

      <Group title={txt.groupClinicalNote}>
        <PreferenceRow
          icon={ListOrdered}
          label={txt.noteSortLabel}
          description={txt.noteSortDesc}
          value={clinicalNoteSort}
          onChange={setClinicalNoteSort}
          choices={[
            { value: "newest", label: txt.sortNewest, icon: ArrowDownWideNarrow, hint: txt.sortNewestHint },
            { value: "oldest", label: txt.sortOldest, icon: ArrowUpNarrowWide, hint: txt.sortOldestHint },
            { value: "manual", label: txt.sortManual, icon: MoveVertical, hint: txt.sortManualHint },
          ]}
          // The only choice on this page that is not private. Stated where it is chosen rather
          // than in a paragraph at the top nobody reads twice.
          note={clinicalNoteSort === "manual" ? txt.sortManualNote : undefined}
        />

        <PreferenceRow
          icon={CalendarDays}
          label={txt.noteGroupingLabel}
          description={txt.noteGroupingDesc}
          value={clinicalNoteGrouping}
          onChange={setClinicalNoteGrouping}
          choices={[
            { value: "flat", label: txt.groupingFlat, icon: Rows3, hint: txt.groupingFlatHint },
            { value: "visit", label: txt.groupingVisit, icon: CalendarDays, hint: txt.groupingVisitHint },
          ]}
        />

        <PreferenceRow
          icon={LayoutList}
          label={txt.noteDensityLabel}
          description={txt.noteDensityDesc}
          value={clinicalNoteDensity}
          onChange={setClinicalNoteDensity}
          choices={[
            { value: "detailed", label: txt.densityDetailed, icon: LayoutList, hint: txt.densityDetailedHint },
            { value: "compact", label: txt.densityCompact, icon: AlignJustify, hint: txt.densityCompactHint },
          ]}
        />
      </Group>

      <Group title={txt.groupAppointmentsPage}>
        <PreferenceRow
          icon={Calendar}
          label={txt.visibilityLabel}
          description={txt.visibilityDesc}
          value={appointmentsVisibility}
          onChange={setAppointmentsVisibility}
          choices={[
            { value: "all", label: txt.visibilityAll, icon: MonitorSmartphone, hint: txt.visibilityAllHint },
            { value: "desktop", label: txt.visibilityDesktop, icon: Monitor, hint: txt.visibilityDesktopHint },
            { value: "hidden", label: txt.visibilityHidden, icon: CalendarOff, hint: txt.visibilityHiddenHint },
          ]}
        />

        <ToggleRow
          icon={AlertTriangle}
          label={txt.lateAlertLabel}
          description={txt.lateAlertDesc}
          checked={latePatientTrackerEnabled}
          onChange={setLatePatientTrackerEnabled}
        />
      </Group>
    </div>
  );
}
