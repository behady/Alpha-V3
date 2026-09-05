"use client";

import DentistHomeSettings from "@/components/settings/DentistHomeSettings";
import ClinicInfoHost from "./ClinicInfoHost";

/**
 * The dentists' home-screen switches. Owns `dentistHome` on clinic_info and touches nothing else.
 */
export default function DentistsHost({ canEdit }: { canEdit: boolean }) {
  return (
    <ClinicInfoHost
      sectionId="dentists"
      canEdit={canEdit}
      fields={["dentistHome"]}
      activityLabel="Dentist home-screen settings were updated from settings."
    >
      {({ clinicData, setClinicData, handleSaveClinic, saving, isDirty, discard }) => (
        <DentistHomeSettings
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
