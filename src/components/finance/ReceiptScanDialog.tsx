"use client";

import { useRef, useState } from "react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Camera, FileUp, Loader2, Plus, Save, Trash2, X, AlertTriangle, ExternalLink } from "lucide-react";
import { storage } from "@/lib/firebase";
import { useClinic } from "@/context/ClinicContext";
import { useUI } from "@/context/UIContext";
import { localYmd } from "@/lib/clinicDate";
import { expenseReceiptPath } from "@/lib/storagePaths";
import { categoryLabel } from "@/lib/expenseCategories";
import { MoneyApiError, createReceiptEntries, scanReceipt } from "@/lib/moneyApi";
import { linesMatchTotal, newReceiptId, RECEIPT_CATEGORY_IDS, RECEIPT_MAX_BYTES, RECEIPT_MAX_LINES } from "@/lib/receiptScan";

/**
 * Finance → Scan receipt.
 *
 * Photo or PDF → Storage (this clinic's `expense_receipts/{receiptId}/`) → the AI reads it → a
 * review sheet, one line per expense category → "Save all", which writes every line in one
 * all-or-nothing call. Nothing reaches the ledger until a person presses Save; if the reading
 * fails, the same sheet opens empty with the photo still attached, so it can be typed by hand.
 */

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic";
const TYPES: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" };
const METHODS = [
  { id: "Cash", en: "Cash", ar: "كاش" },
  { id: "Card", en: "Card", ar: "كارت" },
  { id: "InstaPay", en: "InstaPay", ar: "إنستاباي" },
  { id: "Bank transfer", en: "Bank transfer", ar: "تحويل بنكي" },
  { id: "Other", en: "Other", ar: "أخرى" },
];

type Line = { key: string; category: string; description: string; amount: string };
type Upload = { receiptId: string; path: string; url: string; isPdf: boolean };

const contentTypeOf = (file: File) => file.type || TYPES[file.name.split(".").pop()?.toLowerCase() || ""] || "";
const lineKey = () => Math.random().toString(36).slice(2);
const blankLine = (): Line => ({ key: lineKey(), category: "Supplies", description: "", amount: "" });

export default function ReceiptScanDialog({
  language,
  onClose,
  requireBranchForMoney,
}: {
  language: string;
  onClose: () => void;
  /** The Finance page's branch rule: under "All branches" it asks which branch first; null = cancelled. */
  requireBranchForMoney: () => Promise<string | null | undefined>;
}) {
  const ar = language === "ar";
  const { clinicId } = useClinic();
  const { showToast } = useUI();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<"pick" | "working" | "review">("pick");
  const [busyText, setBusyText] = useState("");
  const [error, setError] = useState("");
  const [upload, setUpload] = useState<Upload | null>(null);
  const [supplier, setSupplier] = useState("");
  const [date, setDate] = useState(localYmd());
  const [method, setMethod] = useState("Cash");
  const [printedTotal, setPrintedTotal] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);

  const read = async (up: Upload) => {
    setStage("working");
    setBusyText(ar ? "بنقرا الفاتورة…" : "Reading the receipt…");
    setError("");
    try {
      const { scan } = await scanReceipt({ receiptId: up.receiptId, path: up.path, language: ar ? "ar" : "en" });
      setSupplier(scan.supplier);
      if (scan.date) setDate(scan.date);
      setPrintedTotal(scan.total);
      setWarnings(scan.warnings);
      setLines(scan.lines.map((l) => ({ key: lineKey(), category: l.category, description: l.description, amount: String(l.amount) })));
      setStage("review");
    } catch (err) {
      setError(err instanceof MoneyApiError ? err.message : ar ? "مقدرناش نقرا الفاتورة." : "The receipt could not be read.");
      setStage("pick");
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file || !clinicId) return;
    const contentType = contentTypeOf(file);
    if (!Object.values(TYPES).includes(contentType)) {
      setError(ar ? "ارفع صورة أو PDF." : "Upload a photo or a PDF.");
      return;
    }
    if (file.size > RECEIPT_MAX_BYTES) {
      setError(ar ? "الملف أكبر من 8 ميجا." : "The file is larger than 8 MB.");
      return;
    }
    setStage("working");
    setBusyText(ar ? "بنرفع الصورة…" : "Uploading…");
    setError("");
    try {
      const receiptId = newReceiptId();
      const path = expenseReceiptPath(clinicId, receiptId, file.name);
      await uploadBytes(ref(storage, path), file, { contentType });
      const url = await getDownloadURL(ref(storage, path));
      const up = { receiptId, path, url, isPdf: contentType === "application/pdf" };
      setUpload(up);
      await read(up);
    } catch (err) {
      console.error("Receipt upload failed", err);
      setError(ar ? "الرفع فشل. جرّب تاني." : "Upload failed. Try again.");
      setStage("pick");
    }
  };

  /** The reading failed or was wrong: the same sheet, empty, with the photo still attached. */
  const typeByHand = () => {
    setLines([blankLine()]);
    setWarnings([]);
    setPrintedTotal(0);
    setError("");
    setStage("review");
  };

  const patchLine = (key: string, change: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...change } : l)));
  const amounts = lines.map((l) => Number(l.amount) || 0);
  const sum = Math.round(amounts.reduce((s, a) => s + a, 0) * 100) / 100;
  const mismatch = printedTotal > 0 && !linesMatchTotal(amounts.map((amount) => ({ amount })), printedTotal);
  const canSave = !!upload && lines.length > 0 && lines.every((l) => (Number(l.amount) || 0) > 0 && RECEIPT_CATEGORY_IDS.includes(l.category)) && !saving;

  const save = async () => {
    if (!upload || !canSave) return;
    setSaving(true);
    try {
      const branchId = await requireBranchForMoney();
      if (branchId === null) return;
      const who = supplier.trim();
      const { total } = await createReceiptEntries({
        receiptId: upload.receiptId,
        receiptPath: upload.path,
        receiptImageUrl: upload.url,
        date,
        method,
        lines: lines.map((l) => {
          const what = l.description.trim();
          return {
            category: l.category,
            amount: Number(l.amount),
            description: (who && what ? `${who} — ${what}` : who || what || categoryLabel(l.category, ar)).slice(0, 200),
          };
        }),
        ...(branchId ? { branchId } : {}),
      });
      showToast(ar ? `اتسجّل ${lines.length} مصروف (${total} ج.م)` : `Saved ${lines.length} expense${lines.length === 1 ? "" : "s"} (${total} EGP)`, "success");
      onClose();
    } catch (err) {
      showToast(err instanceof MoneyApiError ? err.message : ar ? "الحفظ فشل" : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const field = "w-full px-3 py-2 bg-surface-subtle border border-slate-200/60 rounded-lg text-xs max-lg:text-base font-semibold text-ink outline-none focus:border-accent-soft";
  const label = "text-[9px] font-bold text-ink-muted uppercase tracking-wider ps-1";

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-[1.5rem] shadow-2xl border border-slate-100">
        <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h2 className="text-base font-bold text-slate-900 tracking-tight">{ar ? "قراءة فاتورة مصروفات" : "Scan a receipt"}</h2>
          <button onClick={onClose} aria-label={ar ? "إغلاق" : "Close"} className="max-lg:grid max-lg:size-10 max-lg:place-items-center p-1.5 bg-slate-100 hover:bg-red-50 rounded-full text-slate-400 hover:text-red-500">
            <X size={16} />
          </button>
        </div>

        {stage === "pick" && (
          <div className="p-5 space-y-4">
            <p className="text-xs font-semibold text-ink-muted">
              {ar
                ? "صوّر الفاتورة أو ارفعها. الذكاء الاصطناعي هيقسّمها حسب نوع المصروف، وانت تراجع قبل الحفظ. كل فاتورة بنقطة ذكاء اصطناعي واحدة."
                : "Photograph or upload the receipt. The AI splits it by expense type and you check it before saving. Each receipt uses 1 AI credit."}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => cameraRef.current?.click()} className="flex flex-col items-center gap-2 py-5 rounded-xl border border-slate-200 hover:border-accent-soft bg-surface-subtle font-bold text-xs text-ink">
                <Camera size={22} />
                {ar ? "صوّر" : "Take photo"}
              </button>
              <button type="button" onClick={() => fileRef.current?.click()} className="flex flex-col items-center gap-2 py-5 rounded-xl border border-slate-200 hover:border-accent-soft bg-surface-subtle font-bold text-xs text-ink">
                <FileUp size={22} />
                {ar ? "ارفع ملف" : "Upload file"}
              </button>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-100 p-3 space-y-2">
                <p className="text-xs font-semibold text-red-700">{error}</p>
                {upload && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void read(upload)} className="px-3 py-1.5 rounded-lg bg-white border border-red-200 text-[11px] font-bold text-red-700">
                      {ar ? "جرّب تاني" : "Try again"}
                    </button>
                    <button type="button" onClick={typeByHand} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-ink">
                      {ar ? "اكتبها بإيدك" : "Type it by hand"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {stage === "working" && (
          <div className="p-10 flex flex-col items-center gap-3 text-ink-muted">
            <Loader2 className="animate-spin" size={28} />
            <p className="text-xs font-bold">{busyText}</p>
          </div>
        )}

        {stage === "review" && upload && (
          <div className="p-5 space-y-4">
            <a href={upload.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-slate-200 p-2 hover:border-accent-soft">
              {upload.isPdf ? (
                <span className="grid size-14 place-items-center rounded-lg bg-surface-muted text-[10px] font-black text-ink-muted">PDF</span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={upload.url} alt="" className="size-14 rounded-lg object-cover" />
              )}
              <span className="flex-1 text-xs font-bold text-ink">{ar ? "الفاتورة الأصلية" : "Original receipt"}</span>
              <ExternalLink size={14} className="text-ink-muted" />
            </a>

            {warnings.length > 0 && (
              <ul className="rounded-lg bg-amber-50 border border-amber-100 p-3 space-y-1">
                {warnings.map((w) => (
                  <li key={w} className="flex gap-2 text-[11px] font-semibold text-amber-800">
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                    {w}
                  </li>
                ))}
              </ul>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2 space-y-1">
                <label className={label}>{ar ? "المورد" : "Supplier"}</label>
                <input value={supplier} onChange={(e) => setSupplier(e.target.value)} className={field} />
              </div>
              <div className="space-y-1">
                <label className={label}>{ar ? "التاريخ" : "Date"}</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
              </div>
              <div className="space-y-1">
                <label className={label}>{ar ? "طريقة الدفع" : "Paid by"}</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)} className={field}>
                  {METHODS.map((m) => (
                    <option key={m.id} value={m.id}>{ar ? m.ar : m.en}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <p className={label}>{ar ? "المصروفات (سطر لكل نوع)" : "Expenses (one line per type)"}</p>
              {lines.map((l) => (
                <div key={l.key} className="rounded-xl border border-slate-200 p-2.5 space-y-2">
                  <div className="flex gap-2">
                    <select value={l.category} onChange={(e) => patchLine(l.key, { category: e.target.value })} className={`${field} flex-1`}>
                      {RECEIPT_CATEGORY_IDS.map((id) => (
                        <option key={id} value={id}>{categoryLabel(id, ar)}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={l.amount}
                      onChange={(e) => patchLine(l.key, { amount: e.target.value })}
                      placeholder="0.00"
                      aria-label={ar ? "المبلغ" : "Amount"}
                      className={`${field} w-28 tabular-nums`}
                    />
                    <button
                      type="button"
                      onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                      aria-label={ar ? "احذف السطر" : "Remove line"}
                      className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <input
                    value={l.description}
                    onChange={(e) => patchLine(l.key, { description: e.target.value })}
                    placeholder={ar ? "إيه اللي اتشرى" : "What was bought"}
                    className={field}
                  />
                </div>
              ))}
              {lines.length < RECEIPT_MAX_LINES && (
                <button type="button" onClick={() => setLines((prev) => [...prev, blankLine()])} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-ink-muted hover:text-ink">
                  <Plus size={14} />
                  {ar ? "سطر جديد" : "Add line"}
                </button>
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg bg-surface-muted px-3 py-2 text-xs font-bold text-ink">
              <span>{ar ? "الإجمالي" : "Total"}</span>
              <span className="tabular-nums">{sum.toLocaleString()} {ar ? "ج.م" : "EGP"}</span>
            </div>
            {mismatch && (
              <p className="flex gap-2 text-[11px] font-semibold text-amber-700">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                {ar
                  ? `إجمالي الفاتورة ${printedTotal.toLocaleString()} ج.م ومجموع السطور ${sum.toLocaleString()}. راجع المبالغ.`
                  : `The receipt says ${printedTotal.toLocaleString()} EGP but the lines add up to ${sum.toLocaleString()}. Check the amounts.`}
              </p>
            )}

            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSave}
              className="w-full py-3 bg-accent text-ink-on-accent rounded-lg font-bold text-xs hover:bg-accent-strong active:scale-95 shadow-sm flex justify-center items-center gap-1.5 disabled:opacity-50 disabled:active:scale-100"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {ar ? `احفظ ${lines.length} مصروف` : `Save ${lines.length} expense${lines.length === 1 ? "" : "s"}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
