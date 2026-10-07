// What the model returns for one invented NextCare dental approval, in the structure of the real
// sample (NextCare on behalf of Misr Insurance: two services refused, a composite on two lower-right
// teeth and an X-ray approved). The real paper holds a real patient, so it stays outside the repo;
// every name and number here is made up. Money mixes numbers and printed strings on purpose.

export const NEXTCARE_RAW = {
  header: {
    approvalNumber: "C0099887766/1",
    approvalDate: "04-Jul-2026",
    validUntil: "04-Aug-2026",
    insurerName: "Misr Insurance",
    providerName: "Dr Example Dentist Cairo - HO",
    paperPatientName: "Example Patient Name",
    paperPatientNameAr: "مثال اسم مريض",
    policyNumber: "4100",
    contractName: "EXAMPLE",
    productName: "EXAMPLE Spouses B",
    cardNumber: "ab12-cd34-ef56-7890",
    beneficiaryCode: "EXAMPLE-12345678",
    policyEndDate: "01-Jan-2027",
    diagnosis: "K02.9 Dental caries, unspecified",
    conditions: "L.R 4-6\nrefer back if exceeds 1673.25 le\nfor zirconium crown send separate approval\nL.R 4-5-6",
    approvedPriceTotal: "1,673.25",
    patientShareTotal: 0,
    insuranceShareTotal: "1,673.25",
    confidence: {
      approvalNumber: 0.97,
      approvalDate: 0.96,
      validUntil: 0.95,
      cardNumber: 0.94,
      paperPatientName: 0.93,
      approvedPriceTotal: 0.95,
      patientShareTotal: 0.95,
      insuranceShareTotal: 0.95,
    },
  },
  lines: [
    { code: "DE-1", description: "Dental Consultation - كشف اسنان", unitsRequested: 1, unitsApproved: 0, unitPrice: 34.5, approvedPrice: 0, patientShare: 0, insuranceShare: 0, reason: "Not authorized", confidence: 0.9 },
    { code: "Den-27", description: "Zirconia Crown - طربوش زركونيا", unitsRequested: 3, unitsApproved: 0, unitPrice: "3,450.0", approvedPrice: 0, patientShare: 0, insuranceShare: null, reason: "Not authorized", confidence: 0.88 },
    { code: "Den-14", description: "Composite Filling - حشو كمبوزيت", unitsRequested: 2, unitsApproved: 2, unitPrice: 805, approvedPrice: "1,610.0", patientShare: 0, insuranceShare: 1610, reason: "", confidence: 0.95 },
    { code: "Den-1", description: "Dental Radiology - الأشعة اسنان", unitsRequested: 1, unitsApproved: 1, unitPrice: 63.25, approvedPrice: 63.25, patientShare: 0, insuranceShare: 63.25, reason: "", confidence: 0.95 },
    { code: "", description: "المجموع", unitsRequested: null, unitsApproved: null, unitPrice: null, approvedPrice: 1673.25, patientShare: 0, insuranceShare: 1673.25, reason: "", confidence: 0.9 },
  ],
};
