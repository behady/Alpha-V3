const fs = require('fs');
const path = 'c:/Users/PC/Downloads/alpha-dental-system-main/alpha-dental-system-main/src/components/BookingModal.tsx';
let content = fs.readFileSync(path, 'utf8');

// Remove ServiceBillingSection import
content = content.replace(/import ServiceBillingSection.*?;/g, '');

// Replace ServiceBillingSection JSX with treatment input
const billingSectionRegex = /\{selectedPatient && \([\s\S]*?<ServiceBillingSection[\s\S]*?\/>\s*\)\}/g;
const treatmentInput = `{selectedPatient && (
  <div className="border-t border-slate-100 bg-slate-50/50 p-6">
    <label className="mb-2 block text-sm font-black uppercase tracking-wider text-indigo-900/40">
      {language === "ar" ? "السبب الرئيسي للزيارة" : "Primary Reason for Visit"}
    </label>
    <div className="relative group">
      <ClipboardList size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-primary-500" />
      <input
        type="text"
        placeholder={language === "ar" ? "مثال: استشارة، تنظيف، الخ" : "e.g., Consultation, Cleaning, etc."}
        value={treatment}
        onChange={(e) => setTreatment(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm font-bold text-slate-700 outline-none transition-all focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 placeholder:font-medium placeholder:text-slate-400"
      />
    </div>
  </div>
)}`;
content = content.replace(billingSectionRegex, treatmentInput);

// Remove unused states
content = content.replace(/const \[selectedServices.*?\] = useState.*?;/g, '');
content = content.replace(/const \[discountDistribution.*?\] = useState.*?;/g, '');
content = content.replace(/const \[discountMode.*?\] = useState.*?;/g, '');
content = content.replace(/const \[discountInput.*?\] = useState.*?;/g, '');
content = content.replace(/const \[patientProcedures.*?\] = useState.*?;/g, '');
content = content.replace(/const \[isLoadingProcedures.*?\] = useState.*?;/g, '');
content = content.replace(/const \[linkMode.*?\] = useState.*?;/g, '');
content = content.replace(/const \[extraPaidProcedure.*?\] = useState.*?;/g, '');
content = content.replace(/const \[selectedProcedureId.*?\] = useState.*?;/g, '');

// Add treatment state right after visitNotes
content = content.replace(/(const \[visitNotes.*?\] = useState.*?;)/, '$1\n  const [treatment, setTreatment] = useState(editAppointment?.treatment || "");');

// Remove complex displayTreatment calculation and just use treatment
const displayTreatmentRegex = /let displayTreatment = "";[\s\S]*?displayTreatment =[\s\S]*?computedServiceName \|\| existingLabel \|\| "";\s*\}/g;
content = content.replace(displayTreatmentRegex, '');

// In the payload, set treatment: treatment.trim() instead of displayTreatment
content = content.replace(/treatment: displayTreatment,/g, 'treatment: treatment.trim(),');

// Also in the payload, remove pricing/discount/services logic and set them to null/0/[]
content = content.replace(/cost: effectiveCost,/g, 'cost: editAppointment ? (editAppointment.cost || 0) : 0,');
content = content.replace(/clinicalNoteId: linkMode === "existing".*?,/g, 'clinicalNoteId: editAppointment ? editAppointment.clinicalNoteId : null,');
content = content.replace(/newProcedureName: linkMode === "new".*?,/g, 'newProcedureName: null,');
content = content.replace(/listPrice: chargeForVisit.*?,/g, 'listPrice: editAppointment ? (editAppointment.listPrice || 0) : 0,');
content = content.replace(/discountMode: chargeForVisit.*?,/g, 'discountMode: editAppointment ? editAppointment.discountMode : "none",');
content = content.replace(/discountPercent: chargeForVisit.*?,/g, 'discountPercent: editAppointment ? editAppointment.discountPercent : null,');
content = content.replace(/discountFixed: chargeForVisit.*?,/g, 'discountFixed: editAppointment ? editAppointment.discountFixed : null,');
content = content.replace(/discountAmount: chargeForVisit.*?,/g, 'discountAmount: editAppointment ? (editAppointment.discountAmount || 0) : 0,');
content = content.replace(/discountDistribution: chargeForVisit.*?,/g, 'discountDistribution: editAppointment ? editAppointment.discountDistribution : "total",');
content = content.replace(/services: chargeForVisit \? selectedServices\.map\([\s\S]*?\)\) : \[\],/g, 'services: editAppointment ? editAppointment.services : [],');

fs.writeFileSync(path, content, 'utf8');
console.log("BookingModal updated");
