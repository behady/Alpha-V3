"use client";

import NotificationSettings from "@/components/settings/NotificationSettings";
import ClinicInfoHost from "./ClinicInfoHost";

/** Which events raise an alert. Owns `alertPreferences` and touches nothing else. */
export default function AlertsHost({ canEdit }: { canEdit: boolean }) {
  return (
    <ClinicInfoHost
      sectionId="notifications"
      canEdit={canEdit}
      fields={["alertPreferences"]}
      activityLabel="Alert preferences were updated from settings."
    >
      {({ clinicData, setClinicData, handleSaveClinic }) => (
        <NotificationSettings
          clinicData={clinicData}
          setClinicData={setClinicData}
          handleSaveClinic={handleSaveClinic}
        />
      )}
    </ClinicInfoHost>
  );
}
