"use client";

import { Download, FileDown } from "lucide-react";
import Protect from "@/components/Protect";

type Props = {
  onCsv: () => void;
  onPdf: () => void;
  csvLabel?: string;
  pdfLabel?: string;
  disabled?: boolean;
};

export default function ReportExportActions({
  onCsv,
  onPdf,
  csvLabel = "CSV",
  pdfLabel = "PDF",
  disabled = false,
}: Props) {
  return (
    <Protect permission="reports.export">
      <div className="flex items-center gap-1 shrink-0 no-print">
        <button
          type="button"
          disabled={disabled}
          onClick={onCsv}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 disabled:opacity-50"
        >
          <Download size={12} /> {csvLabel}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onPdf}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-[#60d297] text-white hover:text-white border border-[#60d297] hover:bg-[#4eb37f] disabled:opacity-50"
        >
          <FileDown size={12} /> {pdfLabel}
        </button>
      </div>
    </Protect>
  );
}
