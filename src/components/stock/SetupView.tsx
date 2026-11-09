"use client";

import { useMemo, useState } from "react";
import { Check, Printer } from "lucide-react";
import { CATALOG, CATALOG_GROUPS, CHAIR_DRAWERS, type CatalogGroup } from "@/lib/stock/catalog";
import { stockApi } from "@/lib/stock/api";
import { matches } from "@/lib/stock/math";
import { ProductArt, brandColor } from "./Art";
import { Btn, Card, Eyebrow, Stepper, inputCls, useBusy, type StockCtx } from "./shared";
import { printDrawerLabels } from "./labels";

/**
 * First-time setup, and the place to come back to for more items.
 *
 * Asks for three things: how many chairs, which items the clinic uses, and permission to print
 * labels. Brands, prices and expiry are deliberately not here — they arrive with the first
 * delivery, when the box is in someone's hand.
 */
export function SetupView({ ctx }: { ctx: StockCtx }) {
  const { snap, t, ar, toast, canStructure } = ctx;
  const existingKeys = useMemo(() => new Set(snap.items.map((i) => i.catalogKey).filter(Boolean) as string[]), [snap.items]);
  const existingChairs = useMemo(() => new Set(snap.drawers.map((d) => d.roomCode).filter((c) => /^C\d+$/.test(c))).size, [snap.drawers]);
  const [chairs, setChairs] = useState(Math.max(1, existingChairs || 1));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(existingKeys.size ? existingKeys : CATALOG.filter((c) => c.starter).map((c) => c.key)));
  const [q, setQ] = useState("");
  const { busy, run } = useBusy();
  const [done, setDone] = useState<null | { createdDrawers: number }>(null);

  const groups = Object.keys(CATALOG_GROUPS) as CatalogGroup[];
  const toggle = (key: string) => {
    if (existingKeys.has(key)) return; // already in the cupboard; removing is done from the drawer
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };
  const newCount = [...picked].filter((k) => !existingKeys.has(k)).length;

  const create = () =>
    run(async () => {
      const r = await stockApi.setup(chairs, [...picked]);
      ctx.setSnap(r.snapshot);
      setDone({ createdDrawers: r.createdDrawers });
      toast(t(`Cupboard ready: ${r.snapshot.drawers.length} drawers, ${r.snapshot.items.length} items.`, `الدولاب جاهز: ${r.snapshot.drawers.length} درج، ${r.snapshot.items.length} صنف.`));
    }, (m) => toast(m, "error"));

  const print = () =>
    run(async () => {
      await printDrawerLabels(snap, snap.drawers, window.location.origin);
    }, (m) => toast(m, "error"));

  if (!canStructure) {
    return <Card className="p-6 text-sm text-ink-body">{t("The cupboard has not been set up yet. An admin does that from this page.", "الدولاب لسه متعملوش. الأدمن بيعمله من هنا.")}</Card>;
  }

  return (
    <div className="grid gap-4">
      <div>
        <Eyebrow>{t("Setup · about 20 minutes", "الإعداد · حوالي 20 دقيقة")}</Eyebrow>
        <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink">{t("Rooms, cabinets, drawers. Then fill them from pictures.", "غرف، دواليب، أدراج. وبعدين املاها من الصور.")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-body">
          {t(
            "No prices, no expiry dates, no brands today. Brands and real photos arrive with the first delivery, when the box is in your hand.",
            "من غير أسعار ولا تواريخ صلاحية ولا ماركات النهارده. الماركات والصور الحقيقية بتيجي مع أول توريد، والعلبة في إيدك."
          )}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="grid content-start gap-4">
          <Card className="grid gap-3 p-4">
            <Eyebrow>{t("Step 1 · rooms", "خطوة 1 · الغرف")}</Eyebrow>
            <h3 className="font-display text-base font-bold text-ink">{t("How many chairs?", "كام كرسي؟")}</h3>
            <div className="flex items-center gap-3">
              <Stepper value={chairs} onChange={(n) => setChairs(Math.min(8, Math.max(1, n)))} min={1} />
              <span className="text-xs text-ink-muted">{t("plus Sterilisation and a Store, always", "زائد التعقيم والمخزن دايماً")}</span>
            </div>
          </Card>
          <Card className="grid gap-3 p-4">
            <Eyebrow>{t("Step 2 · the standard map", "خطوة 2 · الخريطة القياسية")}</Eyebrow>
            <h3 className="font-display text-base font-bold text-ink">{t("Each chair gets two cabinets", "كل كرسي له دولابين")}</h3>
            <div className="overflow-hidden rounded-xl border border-line">
              {CHAIR_DRAWERS.map((d) => (
                <div key={d.cabinet + d.number} className="flex items-center gap-3 border-t border-line px-3 py-2 text-[13px] first:border-t-0">
                  <span className="w-9 font-display text-xs font-black text-ink">{d.cabinet}{d.number}</span>
                  <span className="flex-1 text-ink">{ar ? d.nameAr : d.nameEn}</span>
                  <span className="text-[11px] text-ink-muted">{ar ? d.where.ar : d.where.en}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-ink-muted">{t("Surgery, ortho, children and medications get their own drawers on Chair 1 when you pick those items. Rename or move anything later.", "الجراحة والتقويم والأطفال والأدوية بياخدوا أدراج خاصة على كرسي 1 لو اخترت أصنافهم. غيّر الأسماء أو انقل أي حاجة بعدين.")}</p>
          </Card>
          <Card className="grid gap-3 p-4">
            <Eyebrow>{t("Step 4 · labels", "خطوة 4 · الملصقات")}</Eyebrow>
            <h3 className="font-display text-base font-bold text-ink">{t("Print the labels, stick them on", "اطبع الملصقات والزقها")}</h3>
            <p className="text-xs text-ink-muted">{t("Six per A4 page. The QR on each opens that drawer's count on the phone.", "ستة في الصفحة. الـ QR بيفتح عدّ الدرج ده على الموبايل.")}</p>
            <Btn onClick={print} busy={busy} disabled={!snap.drawers.length}>
              <Printer size={15} /> {t("Print all labels", "اطبع كل الملصقات")}
            </Btn>
          </Card>
        </div>

        <Card className="grid content-start gap-3 p-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <Eyebrow>{t("Step 3 · what you stock", "خطوة 3 · إنت بتخزن إيه")}</Eyebrow>
              <h3 className="font-display text-base font-bold text-ink">{t("Tap what the clinic uses", "دوس على اللي العيادة بتستخدمه")}</h3>
            </div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search: فلو, bond, gloves…", "دوّر: فلو، بوند، جلافز…")} className={`${inputCls} max-w-[260px]`} />
          </div>
          <div className="grid gap-4">
            {groups.map((g) => {
              const items = CATALOG.filter((c) => c.group === g && matches([c.en, c.ar, c.syn || ""], q));
              if (!items.length) return null;
              return (
                <div key={g}>
                  <div className="mb-2 flex items-baseline gap-2">
                    <span className="font-display text-[13px] font-bold text-ink">{ar ? CATALOG_GROUPS[g].ar : CATALOG_GROUPS[g].en}</span>
                    <span className="text-[11px] text-ink-muted">{items.filter((c) => picked.has(c.key)).length}/{items.length}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                    {items.map((c) => {
                      const on = picked.has(c.key);
                      const locked = existingKeys.has(c.key);
                      return (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => toggle(c.key)}
                          aria-pressed={on}
                          className={`relative grid gap-1 rounded-xl border p-2 text-start transition-colors ${on ? "border-ink bg-surface-subtle" : "border-line bg-surface hover:border-line"} ${locked ? "opacity-80" : ""}`}
                        >
                          {on ? (
                            <span className="absolute end-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-[#FACC15] text-[#1A1206]">
                              <Check size={12} strokeWidth={3} />
                            </span>
                          ) : null}
                          <ProductArt shape={c.shape} color={brandColor(c.en)} product={c.en.split(" ")[0]} className="h-14 w-full" />
                          <span className="text-[12px] font-semibold leading-tight text-ink">{ar ? c.ar : c.en}</span>
                          <span className="text-[10.5px] text-ink-muted">{ar ? c.en : c.ar}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="sticky bottom-4 mt-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-ink-slab p-3 text-white shadow-lg">
            <div className="text-sm">
              <b className="font-display text-xl">{picked.size}</b> <span className="text-white/70">{t("items", "صنف")}</span>
              {existingKeys.size ? <span className="ms-2 text-white/70">· {newCount} {t("new", "جديد")}</span> : null}
            </div>
            <Btn kind="yellow" onClick={create} busy={busy} disabled={!newCount && existingChairs >= chairs}>
              {existingKeys.size ? t("Add to my cupboard", "ضيف لدولابي") : t("Create my cupboard", "اعمل دولابي")}
            </Btn>
          </div>
          {done ? (
            <p className="text-sm text-ink-body">
              {t(`Done. ${done.createdDrawers} new drawers. `, `تم. ${done.createdDrawers} درج جديد. `)}
              <button type="button" className="font-bold text-ink underline" onClick={() => ctx.go({ tab: "cupboard" })}>
                {t("Open the cupboard →", "افتح الدولاب ←")}
              </button>
            </p>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
