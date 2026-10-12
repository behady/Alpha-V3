// What the model returns for one invented AXA Egypt dental claim form (the "Service Claim Reference"
// the Yodawy portal prints once a service is approved and performed), in the structure of the real
// sample: a consultation, an X-ray, a root canal, a post and a composite, all on the same lower-right
// molar, 0% co-pay, everything paid by the insurer. The real paper holds a real patient, so it stays
// outside the repo; every name and number here is made up. Money mixes numbers and printed strings on
// purpose.

export const AXA_RAW = {
  header: {
    approvalNumber: "13200001",
    requestNumber: "13200001",
    dispenseNumber: "9500001",
    claimNumber: "1200001",
    serviceDate: "17/08/2026 09:43:50 PM",
    statusText: "Status completed",
    payerName: "axa",
    paperPatientName: "Example Patient Name",
    paperPatientNameAr: "مثال اسم مريض",
    policyNumber: "2025/12345678/01",
    cardNumber: "51102982A7e0",
    employeeCode: "-",
    copayPercent: "0%",
    providerName: "Dr Example Dentist Clinic - Cairo",
    decisionBy: "Dr.Example Reviewer",
    diagnosis: "K02 - dental caries",
    payerNote: "491133",
    providerNote: "",
    totalPerformed: "2,951.00 EGP",
    discountTotal: "0.00EGP",
    totalNet: "2951.00 EGP",
    overLimit: "0.00 EGP",
    copayTotal: "0.00 EGP",
    byPatient: "0.00 EGP",
    byInsurer: "2951.00 EGP",
    confidence: {
      approvalNumber: 0.96,
      serviceDate: 0.95,
      cardNumber: 0.9,
      policyNumber: 0.93,
      paperPatientName: 0.94,
      byInsurer: 0.95,
      byPatient: 0.95,
    },
  },
  lines: [
    { serviceName: "Dental Consultation", toothNo: "", qty: 1, unitPrice: 96, totalPrice: 96, approvedQty: 1, totalApproved: 96, performedQty: 1, totalPerformed: 96, discount: 0, netAmount: 96, tags: "", confidence: 0.95 },
    { serviceName: "X-Ray Preapical 3 films", toothNo: "LR7", qty: 1, unitPrice: 144, totalPrice: 144, approvedQty: 1, totalApproved: 144, performedQty: 1, totalPerformed: 144, discount: 0, netAmount: 144, tags: "Service Requires Manual Review", confidence: 0.93 },
    { serviceName: "Root Canal Treatment Posterior Teeth (rotary)", toothNo: "LR7", qty: 1, unitPrice: "1,646.00", totalPrice: "1,646.00", approvedQty: 1, totalApproved: "1,646.00", performedQty: 1, totalPerformed: "1,646.00", discount: "0.00", netAmount: "1,646.00", tags: "Service Requires Manual Review", confidence: 0.92 },
    { serviceName: "Post", toothNo: "LR7", qty: 1, unitPrice: 484, totalPrice: 484, approvedQty: 1, totalApproved: 484, performedQty: 1, totalPerformed: 484, discount: 0, netAmount: 484, tags: "Service Requires Manual Review", confidence: 0.94 },
    { serviceName: "Resin Based Composite", toothNo: "LR7", qty: 1, unitPrice: 581, totalPrice: 581, approvedQty: 1, totalApproved: 581, performedQty: 1, totalPerformed: 581, discount: 0, netAmount: 581, tags: "Service Requires Manual Review", confidence: 0.94 },
  ],
};
