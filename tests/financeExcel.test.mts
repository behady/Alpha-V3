// The Finance page's Excel report and the payment method words on its rows.
//
// The failures that matter: the file's totals disagreeing with its rows, an expense counted as
// money in, or "Visa"/"Card"/"InstaPay" spellings showing up as different methods.
//
// Run with tsx: npm run test:finance-excel
import assert from "node:assert/strict";
import XLSX from "xlsx-js-style";
import { paymentMethodLabel } from "../src/lib/dailySheet";
import { financeFileName, financeWorkbook, type FinanceXlsxRow } from "../src/lib/financeLedgerXlsx";

let checks = 0;
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

// --- 1. Method words ------------------------------------------------------------------------------
{
  eq(["Cash", "cash", "Visa", "Card", "Instapay", "InstaPay", "Insurance", "Bank transfer", "", undefined].map((m) => paymentMethodLabel(m)),
    ["Cash", "Cash", "Visa", "Visa", "InstaPay", "InstaPay", "Insurance", "Transfer", "", ""], "spellings folded; nothing recorded is empty");
  eq(["Cash", "Visa", "InstaPay", "Insurance"].map((m) => paymentMethodLabel(m, true)), ["كاش", "فيزا", "انستاباي", "تأمين"], "Arabic");
  eq(paymentMethodLabel("Vodafone Cash"), "Wallet", "a wallet app");
  eq(paymentMethodLabel("Cheque"), "Cheque", "anything else as written");
}

// --- 2. The workbook, read back from the bytes -----------------------------------------------------
const row = (over: Partial<FinanceXlsxRow>): FinanceXlsxRow => ({
  date: "2026-10-12", direction: "in", details: "", category: "", patient: "", dentist: "",
  rate: null, commission: null, commissionPaid: null, commissionPending: null, clinicNet: null, method: "", amount: 0, ...over,
});
{
  const wb = XLSX.read(
    XLSX.write(
      financeWorkbook({
        rows: [
          row({ details: "Payment for Composite", patient: "Theivendrman", dentist: "Ahmed Roshdy", rate: 40, commission: 200, commissionPaid: 0, commissionPending: 200, clinicNet: 500, method: "Visa", amount: 500 }),
          row({ details: "Scaling", patient: "Iris", method: "Cash", amount: 300 }),
          row({ direction: "out", details: "Gloves", category: "Supplies", method: "Cash", amount: 120 }),
        ],
        byMethod: [{ label: "Visa", amount: 500 }, { label: "Cash", amount: 300 }],
        start: "2026-10-12",
        end: "2026-10-12",
        branchName: "Maadi",
        isAr: false,
      }),
      { type: "buffer", bookType: "xlsx" },
    ),
    { type: "buffer", cellFormula: true },
  );
  const ws = wb.Sheets[wb.SheetNames[0]];
  eq(ws.A1.v, "Finance — Maadi", "title names the branch");
  eq(["A4", "E4", "F4", "G4", "H4", "K4", "L4", "M4"].map((c) => ws[c].v), ["Date", "Patient", "Dentist", "Dentist %", "Commission", "Clinic net", "Method", "Amount"], "the screen's columns");
  eq([ws.B5.v, ws.E5.v, ws.G5.v, ws.H5.v, ws.K5.v, ws.L5.v, ws.M5.v], ["In", "Theivendrman", "40%", 200, 500, "Visa", 500], "a payment line with its dentist and method");
  eq([ws.B7.v, ws.D7.v, ws.M7.v], ["Out", "Supplies", -120], "an expense is money out, negative");
  eq([ws.M9.f, ws.M9.v], ['SUMIF(M5:M7,">0")', 800], "total in");
  eq([ws.M10.f, ws.M10.v], ['-SUMIF(M5:M7,"<0")', 120], "total out");
  eq([ws.M11.f, ws.M11.v], ["SUM(M5:M7)", 680], "net");
  eq([ws.L14.v, ws.M14.v, ws.L15.v, ws.M15.v], ["Visa", 500, "Cash", 300], "money in by method");
  eq(Boolean(wb.Workbook?.Views?.[0]?.RTL), false, "English reads left to right");

  const ar = XLSX.read(XLSX.write(financeWorkbook({ rows: [], byMethod: [], start: "2026-10-01", end: "2026-10-31", isAr: true }), { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
  const wsAr = ar.Sheets[ar.SheetNames[0]];
  eq(Boolean(ar.Workbook?.Views?.[0]?.RTL), true, "Arabic reads right to left");
  eq([wsAr.L4.v, wsAr.A5.v], ["طريقة الدفع", "مفيش حركة في الفترة دي."], "Arabic headers; an empty period says so");
  eq(financeFileName("2026-10-01", "2026-10-31"), "finance-2026-10-01-to-2026-10-31.xlsx", "file name");
}

console.log(`finance excel: ${checks} checks passed`);
