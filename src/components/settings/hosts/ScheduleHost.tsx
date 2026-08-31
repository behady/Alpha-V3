"use client";

import { useCallback } from "react";
import ScheduleSettings from "@/components/settings/ScheduleSettings";
import ClinicInfoHost, { readSchedule, type ClinicInfoState } from "./ClinicInfoHost";

/**
 * Opening hours, slot length and days off.
 *
 * The panel works on a flat `schedule` object; the document stores it nested under one key. The
 * bridge below keeps the panel unchanged and confines the shape difference to this file.
 *
 * `configuredAt` is stamped on every save because nothing seeds this document at signup: without
 * it, a clinic that never opened this screen is indistinguishable from one that deliberately set
 * these exact hours, and the booking code has to guess. It is passed as a save-time override
 * rather than written into state first — state has not flushed by the time the save reads it, so
 * a stamp routed that way is always one save behind.
 */
export default function ScheduleHost({ canEdit }: { canEdit: boolean }) {
  return (
    <ClinicInfoHost
      sectionId="clinical"
      canEdit={canEdit}
      fields={["schedule"]}
      activityLabel="Clinic schedule was updated from settings."
    >
      {({ clinicData, setClinicData, save }) => (
        <ScheduleBridge clinicData={clinicData} setClinicData={setClinicData} save={save} />
      )}
    </ClinicInfoHost>
  );
}

function ScheduleBridge({
  clinicData,
  setClinicData,
  save,
}: {
  clinicData: ClinicInfoState;
  setClinicData: React.Dispatch<React.SetStateAction<ClinicInfoState>>;
  save: (overrides?: Record<string, unknown>) => Promise<void>;
}) {
  const schedule = readSchedule(clinicData);

  // Accepts both call styles the panel uses: a plain object and an updater function.
  const setSchedule = useCallback(
    (next: unknown) => {
      setClinicData((prev) => {
        const current = readSchedule(prev);
        const resolved =
          typeof next === "function" ? (next as (s: unknown) => unknown)(current) : next;
        return { ...prev, schedule: { ...current, ...(resolved as object) } };
      });
    },
    [setClinicData]
  );

  const handleSaveClinic = useCallback(
    async (event?: { preventDefault?: () => void }) => {
      event?.preventDefault?.();
      await save({ schedule: { ...schedule, configuredAt: new Date().toISOString() } });
    },
    [save, schedule]
  );

  return (
    <ScheduleSettings
      schedule={schedule}
      setSchedule={setSchedule}
      handleSaveClinic={handleSaveClinic}
    />
  );
}
