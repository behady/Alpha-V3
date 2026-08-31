"use client";

import AttendanceSettings from "@/components/settings/AttendanceSettings";
import ClinicInfoHost from "./ClinicInfoHost";

/** Geofence for clocking in. Saves the three attendance fields and nothing else. */
export default function AttendanceHost({ canEdit }: { canEdit: boolean }) {
  return (
    <ClinicInfoHost
      sectionId="attendance"
      canEdit={canEdit}
      fields={["attendanceLat", "attendanceLng", "attendanceRadius"]}
      activityLabel="Attendance location was updated from settings."
    >
      {({ clinicData, setClinicData, handleSaveClinic }) => (
        <AttendanceSettings
          clinicData={clinicData}
          setClinicData={setClinicData}
          handleSaveClinic={handleSaveClinic}
        />
      )}
    </ClinicInfoHost>
  );
}
