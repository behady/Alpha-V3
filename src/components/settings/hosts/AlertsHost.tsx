"use client";

import NotificationSettings from "@/components/settings/NotificationSettings";
import ClinicInfoHost from "./ClinicInfoHost";

/**
 * Which events raise an alert. Owns `alertPreferences` and touches nothing else.
 *
 * The dirty state was tracked by the host and never handed down, so the panel's Save button
 * looked the same whether or not anything had changed — the same gap the schedule screen had.
 */
export default function AlertsHost({ canEdit }: { canEdit: boolean }) {
  return (
    <ClinicInfoHost
      sectionId="notifications"
      canEdit={canEdit}
      fields={["alertPreferences"]}
      activityLabel="Alert preferences were updated from settings."
    >
      {({ clinicData, setClinicData, handleSaveClinic, saving, isDirty, discard }) => (
        <NotificationSettings
          clinicData={clinicData}
          setClinicData={setClinicData}
          handleSaveClinic={handleSaveClinic}
          saving={saving}
          isDirty={isDirty}
          discard={discard}
        />
      )}
    </ClinicInfoHost>
  );
}
