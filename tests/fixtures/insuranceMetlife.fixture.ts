// What the model returns for one invented MetLife Egypt dental pre-approval, in the structure of the real
// sample (five lines, 1,260 requested and approved, nothing for the patient to pay). The real paper holds a
// real patient, so it stays outside the repo; every name and number here is made up. Money is a mix of
// numbers and printed strings ("1,260.0") on purpose: the reader has to cope with both.

export const SAMPLE_RAW = {
  header: {
    approvalNumber: "D6000001",
    approvalDate: "03/10/2026",
    policyNumber: "6481234567 - EXAMPLE TRAVEL",
    certificateNumber: "987",
    dependentCode: "1",
    paperPatientName: "EXAMPLE PATIENT NAME",
    providerCode: "DNC0001 - DR. EXAMPLE - DENTAL",
    statusText: "AUTO APPROVED",
    diagnosisCode: "525.9-Dental",
    estimatedCost: "1,260.0",
    requestedTotal: "1,260.0",
    approvedTotal: "1,260.0",
    patientShareTotal: "0.0",
    collectNote: "0.0",
    terminationDate: "9999-12-31",
    comment: "",
    confidence: {
      approvalNumber: 0.98,
      approvalDate: 0.97,
      policyNumber: 0.95,
      certificateNumber: 0.96,
      dependentCode: 0.96,
      paperPatientName: 0.93,
      providerCode: 0.95,
      statusText: 0.99,
      requestedTotal: 0.94,
      approvedTotal: 0.94,
      patientShareTotal: 0.92,
      collectNote: 0.9,
    },
  },
  lines: [
    { code: "D0120", description: "PERIODIC ORAL EVALUATION", unitsRequested: 1, grossPerUnit: 60, grossTotal: 60, unitsApproved: 1, patientShare: 0, approvedAmount: 60, comment: "", confidence: 0.95 },
    { code: "D0270", description: "BITEWING - SINGLE FILM", unitsRequested: 1, grossPerUnit: 60, grossTotal: 60, unitsApproved: 1, patientShare: 0, approvedAmount: 60, comment: "", confidence: 0.95 },
    { code: "D2650", description: "INLAY - RESIN-BASED COMPOSITE", unitsRequested: 1, grossPerUnit: 600, grossTotal: 600, unitsApproved: 1, patientShare: 0, approvedAmount: 600, comment: "", confidence: 0.94 },
    { code: "D3120", description: "PULP CAP - INDIRECT", unitsRequested: 1, grossPerUnit: 300, grossTotal: 300, unitsApproved: 1, patientShare: 0, approvedAmount: 300, comment: "", confidence: 0.94 },
    { code: "D4220", description: "GINGIVAL CURETTAGE", unitsRequested: 1, grossPerUnit: 240, grossTotal: 240, unitsApproved: 1, patientShare: 0, approvedAmount: 240, comment: "", confidence: 0.93 },
  ],
};
