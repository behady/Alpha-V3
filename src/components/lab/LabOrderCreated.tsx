"use client";

/**
 * The moment after an order is created.
 *
 * Somebody is standing with an impression in one hand and a bag in the other, and the one thing
 * they need is the code to write on it. It used to flash past in a message that closed itself.
 * Now it stays until they say they are done, with the two things that normally come next beside
 * it: the paper for the bag, and the message to the lab.
 *
 * When the same sitting left more lab work waiting, this is also where the bag is filled: the next
 * order is one tap away, and once there is more than one, the codes are shown together and the
 * paper and the message cover all of them (see labBag.ts).
 */

import { useState } from "react";
import { getDoc } from "firebase/firestore";
import { ArrowLeft, ArrowRight, Check, Loader2, MessageCircle, Printer } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useClinic } from "@/context/ClinicContext";
import { getClinicDoc } from "@/lib/db-utils";
import { LABS_SETTINGS_DOC, findLab, labMessagingNumber, parseLabPaper, type DentalLab } from "@/lib/dentalLabs";
import { workTypeLabel, type LabCase, type LabCaseSeed } from "@/lib/labCases";
import { bagByLab } from "@/lib/labBag";
import { buildLabBagMessage } from "@/lib/labMessages";
import { loadLabOrderClinic, printLabBag } from "@/lib/labOrderPrint";
import { openWhatsAppWithText } from "@/lib/whatsappManual";
import { PalmerList } from "@/components/lab/PalmerMark";

export default function LabOrderCreated({
  labCase,
  earlier = [],
  labs,
  next,
  onNext,
  onDone,
}: {
  labCase: LabCase;
  /** Orders already raised in this sitting, before this one. */
  earlier?: LabCase[];
  labs: DentalLab[];
  /** The next treatment from the same sitting still waiting for its order. */
  next?: LabCaseSeed | null;
  onNext?: () => void;
  onDone: () => void;
}) {
  const { language } = useLanguage();
  const { showToast } = useUI();
  const { clinic } = useClinic();
  const isAr = language === "ar";
  const [printing, setPrinting] = useState(false);

  const bag = [...earlier, labCase];
  const many = bag.length > 1;
  const groups = bagByLab(bag).map((group) => ({
    ...group,
    number: labMessagingNumber(findLab(labs, group.labId)),
  }));
  const unreachable = groups.filter((g) => !g.number).map((g) => g.labName).filter(Boolean);

  const print = async () => {
    setPrinting(true);
    try {
      // The paper size is the clinic's own choice on the Lab page; read it rather than assume one.
      const [settings, header] = await Promise.all([
        getDoc(getClinicDoc("settings", LABS_SETTINGS_DOC)).catch(() => null),
        loadLabOrderClinic(labCase.branchName),
      ]);
      await printLabBag({
        cases: bag,
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
  const sendToLab = (number: string, cases: LabCase[]) => {
    openWhatsAppWithText(number, buildLabBagMessage(cases, clinic?.name || "", language));
  };

  const summary = [labCase.patientFirstName, many ? "" : workTypeLabel(labCase.workType, language), groups.length === 1 ? labCase.labName : ""]
    .filter(Boolean)
    .join(" · ");

  const ACTION =
    "inline-flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-black text-ink transition-colors hover:bg-surface-subtle disabled:opacity-50 sm:w-auto sm:flex-1";
  const Forward = isAr ? ArrowLeft : ArrowRight;

  return (
    <div className="flex flex-1 flex-col items-center gap-5 overflow-y-auto px-5 py-8 text-center sm:px-7" data-tour="lab-case-created">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink-slab text-white">
        <Check size={24} />
      </div>

      {many ? (
        <div className="w-full max-w-md space-y-3">
          <p className="text-sm font-black text-ink-muted">
            {isAr ? (bag.length === 2 ? "الكيس فيه أمرين" : `الكيس فيه ${bag.length} أوامر`) : `${bag.length} orders in this bag`}
          </p>
          <ul className="space-y-2" data-tour="lab-case-created-code">
            {bag.map((c) => (
              <li key={c.id} className="rounded-xl border border-line bg-surface px-4 py-3">
                <p className="text-3xl font-black tracking-tight text-ink tabular-nums" dir="ltr">{c.code}</p>
                <p className="mt-1 flex flex-wrap items-center justify-center gap-x-1.5 text-[12px] font-bold text-ink-muted">
                  <span>{workTypeLabel(c.workType, language)}</span>
                  {c.teeth.length > 0 && <PalmerList teeth={c.teeth} />}
                  {groups.length > 1 && c.labName && <bdi>· {c.labName}</bdi>}
                </p>
              </li>
            ))}
          </ul>
          <p className="text-sm font-bold text-ink">{isAr ? "اكتب الأكواد دي على الكيس" : "Write these codes on the bag"}</p>
          {summary && <p className="text-[12px] font-bold text-ink-muted"><bdi>{summary}</bdi></p>}
        </div>
      ) : (
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
      )}

      {next && onNext && (
        <div className="w-full max-w-md space-y-3 rounded-2xl border border-line bg-surface-subtle p-4" data-tour="lab-case-created-next">
          <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-[13px] font-bold text-ink">
            <span>{isAr ? "فاضل شغل تاني محتاج معمل:" : "More work from this visit needs a lab:"}</span>
            <bdi className="font-black">{next.workDescription || (isAr ? "علاج" : "Treatment")}</bdi>
            {(next.teeth?.length || 0) > 0 && <PalmerList teeth={next.teeth || []} className="font-black" />}
          </p>
          <button
            type="button"
            onClick={onNext}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink-slab px-6 text-sm font-black text-white transition-colors hover:bg-ink"
          >
            {isAr ? "كمّل الأمر اللي بعده" : "Continue to the next order"}
            <Forward size={16} />
          </button>
          <p className="text-[12px] font-bold text-ink-muted">
            {isAr ? "المعمل والميعاد واللون هيتملّوا لوحدهم." : "The lab, the return date and the shade carry over."}
          </p>
        </div>
      )}

      <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" onClick={print} disabled={printing} className={ACTION}>
          {printing ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
          {many ? (isAr ? "اطبع الكيس" : "Print the bag") : isAr ? "اطبع الأمر" : "Print the order"}
        </button>
        {groups.map((group) => (
          <button
            key={group.labId || group.labName}
            type="button"
            onClick={() => sendToLab(group.number, group.cases)}
            disabled={!group.number}
            className={ACTION}
          >
            <MessageCircle size={16} className="shrink-0" />
            {groups.length > 1 ? (
              <span className="truncate">{isAr ? "واتساب" : "WhatsApp"} <bdi>{group.labName}</bdi></span>
            ) : isAr ? "واتساب للمعمل" : "WhatsApp the lab"}
          </button>
        ))}
      </div>
      {unreachable.length > 0 && (
        <p className="max-w-md text-[12px] font-bold text-ink-muted">
          {isAr
            ? `مفيش رقم واتساب لـ ${unreachable.join("، ")}. ضيفه من الإعدادات ← المعامل.`
            : `No WhatsApp number for ${unreachable.join(", ")}. Add one in Settings → Dental Labs.`}
        </p>
      )}

      <button
        type="button"
        onClick={onDone}
        className={
          next && onNext
            ? "h-12 w-full max-w-md shrink-0 rounded-xl border border-line bg-surface px-6 text-sm font-black text-ink transition-colors hover:bg-surface-subtle"
            : "h-12 w-full max-w-md shrink-0 rounded-xl bg-ink-slab px-6 text-sm font-black text-white transition-colors hover:bg-ink"
        }
      >
        {next && onNext ? (isAr ? "تم — الباقي بعدين" : "Done, the rest later") : isAr ? "تم" : "Done"}
      </button>
    </div>
  );
}
