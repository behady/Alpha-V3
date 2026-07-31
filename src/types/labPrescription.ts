/**
 * Digital Lab Rx — structured state for DDS-style lab prescriptions (export/PDF-ready).
 * Mirrors common Crown & Bridge, Removable, Implant, and Ortho Rx groupings.
 */

export type LabRxTab = "fixed" | "removable" | "implant" | "ortho";

export interface LabRxHeaderState {
  patientName: string;
  patientDob: string;
  patientAgeDisplay: string;
  patientGender: string;
  orderDate: string;
  dueDate: string;
  doctorName: string;
}

/** Selected on every tab — teeth involved + global notes */
export interface LabRxUniversalSlice {
  teethSelected: string[];
  specialInstructions: string;
}

/** Crown & Bridge / Fixed prosth */
export interface LabRxFixedSlice {
  stumpShade: string;
  finalShade: string;
  /** Mutually exclusive primary restorative material */
  material: string;
  /** Mutually exclusive margin prep style */
  marginDesign: string;
  ponticDesign: string;
  /** Multiple clearance / prep caveats */
  inadequateClearance: string[];
  bridgeConnectorNotes: string;
}

/** Removable prosth */
export interface LabRxRemovableSlice {
  /** Mutually exclusive — labels match DDS intake wording */
  supportType: "" | "Tissue-borne" | "Tooth-borne" | "Combination tissue / tooth-borne";
  frameworkMaterial: string[];
  baseMaterial: string[];
  biteRegistration: string;
  dentureDesign: string[];
  claspsMetal: string[];
  teethShadeOrMoldNotes: string;
}

/** Implant prosth */
export interface LabRxImplantSlice {
  /** One of predefined implant lines or "Other" */
  implantBrand: string;
  implantBrandOther: string;
  abutmentType: string;
  crownRetention: string;
  emergenceProfile: string;
  platformDiameter: string;
  torqueNotes: string;
}

/** Orthodontic appliances */
export interface LabRxOrthoSlice {
  applianceType: string;
  arch: string;
  wireSpecs: string;
  acrylicColorOrTint: string;
  occlusalSplintHardSoft: string;
}

export interface LabPrescriptionState {
  activeTab: LabRxTab;
  header: LabRxHeaderState;
  universal: LabRxUniversalSlice;
  fixed: LabRxFixedSlice;
  removable: LabRxRemovableSlice;
  implant: LabRxImplantSlice;
  ortho: LabRxOrthoSlice;
}

/** Loose patient shape for pre-filling Rx header from EMR */
export interface LabRxPatientInput {
  id?: string;
  name?: string;
  dateOfBirth?: string;
  dob?: string;
  age?: string | number;
  gender?: string;
}

export function calcAgeFromDobIso(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const age = Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
  return String(Math.max(0, age));
}

/** Merge EMR patient + doctor into a fresh Rx state (Clinical Notes / standalone form). */
export function mergePatientIntoLabRxState(patient: LabRxPatientInput, doctorName: string): LabPrescriptionState {
  const base = createInitialLabPrescriptionState();
  const dob =
    typeof patient.dateOfBirth === "string"
      ? patient.dateOfBirth
      : typeof patient.dob === "string"
        ? patient.dob
        : "";
  const age =
    patient.age != null && patient.age !== ""
      ? String(patient.age)
      : calcAgeFromDobIso(dob);
  return {
    ...base,
    header: {
      ...base.header,
      patientName: typeof patient.name === "string" ? patient.name : "",
      patientDob: dob,
      patientAgeDisplay: age,
      patientGender: typeof patient.gender === "string" ? patient.gender : "",
      doctorName,
      orderDate: base.header.orderDate || new Date().toISOString().split("T")[0],
    },
  };
}

export function createInitialLabPrescriptionState(): LabPrescriptionState {
  const today = new Date().toISOString().split("T")[0];
  return {
    activeTab: "fixed",
    header: {
      patientName: "",
      patientDob: "",
      patientAgeDisplay: "",
      patientGender: "",
      orderDate: today,
      dueDate: "",
      doctorName: "",
    },
    universal: {
      teethSelected: [],
      specialInstructions: "",
    },
    fixed: {
      stumpShade: "",
      finalShade: "",
      material: "",
      marginDesign: "",
      ponticDesign: "",
      inadequateClearance: [],
      bridgeConnectorNotes: "",
    },
    removable: {
      supportType: "" as LabRxRemovableSlice["supportType"],
      frameworkMaterial: [],
      baseMaterial: [],
      biteRegistration: "",
      dentureDesign: [],
      claspsMetal: [],
      teethShadeOrMoldNotes: "",
    },
    implant: {
      implantBrand: "",
      implantBrandOther: "",
      abutmentType: "",
      crownRetention: "",
      emergenceProfile: "",
      platformDiameter: "",
      torqueNotes: "",
    },
    ortho: {
      applianceType: "",
      arch: "",
      wireSpecs: "",
      acrylicColorOrTint: "",
      occlusalSplintHardSoft: "",
    },
  };
}
