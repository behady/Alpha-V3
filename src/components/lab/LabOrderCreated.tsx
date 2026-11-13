"use client";

/**
 * The moment after an order is created.
 *
 * Somebody is standing with an impression in one hand and a bag in the other, and the one thing
 * they need is the code to write on it. It used to flash past in a message that closed itself.
 * Now it stays until they say they are done, with the two things that normally come next beside
 * it: the paper for the bag, and the message to the lab.
 */

import { useState } from "react";
import { getDoc } from "firebase/firestore";
import { Check, Loader2, MessageCircle, Printer } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useClinic } from "@/context/ClinicContext";
import { getClinicDoc } from "@/lib/db-utils";
import { LABS_SETTINGS_DOC, findLab, labMessagingNumber, parseLabPaper, type DentalLab } from "@/lib/dentalLabs";
import { workTypeLabel, type LabCase } from "@/lib/labCases";
import { buildLabOrderMessage } from "@/lib/labMessages";
import { loadLabOrderClinic, printLabOrder } from "@/lib/labOrderPrint";
import { openWhatsAppWithText } from "@/lib/whatsappManual";

export default function LabOrderCreated({
  labCase,
  labs,
  onDone,
}: {
  labCase: LabCase;
  labs: DentalLab[];
  onDone: () => void;
}) {
  const { language } = useLanguage();
  const { showToast } = useUI();
  const { clinic } = useClinic();
  const isAr = language === "ar";
  const [printing, setPrinting] = useState(false);

  const labNumber = labMessagingNumber(findLab(labs, labCase.labId));

  const print = async () => {
    setPrinting(true);
    try {
      // The paper size is the clinic's own choice on the Lab page; read it rather than assume one.
      const [settings, header] = await Promise.all([
        getDoc(getClinicDoc("settings", LABS_SETTINGS_DOC)).catch(() => null),
        loadLabOrderClinic(labCase.branchName),
      ]);
      await printLabOrder({
        labCase,
        clinic: header,
        language,
        paper: parseLabPaper(settings?.exists() ? settings.data() : null),
      });
    } catch (err) {
      console.error("Lab order print failed", err);
      showToast(isAr ? "فشلت الطباعة" : "Could not print the order", "error");
    } finally {
      setPrinting(false);
    }
  };

  // Nothing awaited before the window opens: a browser only allows it during the click itself.
  const sendToLab = () => {
    openWhatsAppWithText(labNumber, buildLabOrderMessage(labCase, clinic?.name || "", language));
  };

  const summary = [labCase.patientFirstName, workTypeLabel(labCase.workType, language), labCase.labName]
    .filter(Boolean)
    .join(" · ");

  const ACTION =
    "inline-flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-black text-ink transition-colors hover:bg-surface-subtle disabled:opacity-50 sm:w-auto sm:flex-1";

  return (
    <div className="flex flex-1 flex-col items-center gap-5 overflow-y-auto px-5 py-8 text-center sm:px-7" data-tour="lab-case-created">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-slab text-white">
        <Check size={24} />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-black text-ink-muted">
          {labCase.status === "draft"
            ? isAr ? "اتحفظ الأمر — لسه ماتبعتش" : "Order saved, not sent yet"
            : isAr ? "اتعمل الأمر" : "Order created"}
        </p>
        <p className="text-5xl font-black tracking-tight text-ink tabular-nums" dir="ltr" data-tour="lab-case-created-code">
          {labCase.code}
        </p>
        <p className="text-sm font-bold text-ink">{isAr ? "اكتب الكود ده على الكيس" : "Write this code on the bag"}</p>
        {summary && <p className="text-[12px] font-bold text-ink-muted"><bdi>{summary}</bdi></p>}
      </div>

      <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
        <button type="button" onClick={print} disabled={printing} className={ACTION}>
          {printing ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
          {isAr ? "اطبع الأمر" : "Print the order"}
        </button>
        <button type="button" onClick={sendToLab} disabled={!labNumber} className={ACTION}>
          <MessageCircle size={16} />
          {isAr ? "واتساب للمعمل" : "WhatsApp the lab"}
        </button>
      </div>
      {!labNumber && (
        <p className="max-w-md text-[12px] font-bold text-ink-muted">
          {isAr
            ? `مفيش رقم واتساب لـ ${labCase.labName}. ضيفه من الإعدادات ← المعامل.`
            : `No WhatsApp number for ${labCase.labName}. Add one in Settings → Dental Labs.`}
        </p>
      )}

      <button
        type="button"
        onClick={onDone}
        className="h-12 w-full max-w-md rounded-xl bg-ink-slab px-6 text-sm font-black text-white transition-colors hover:bg-ink"
      >
        {isAr ? "تم" : "Done"}
      </button>
    </div>
  );
}
