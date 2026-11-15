"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Camera, Check, Loader2, Pencil, Plus, Printer, Search, Trash2, UserRound } from "lucide-react";
import { getDocs, limit, orderBy, query } from "firebase/firestore";
import { getClinicCollection } from "@/lib/db-utils";
import { patientMatchesSearch } from "@/lib/flexibleSearch";
import { CATALOG, CATALOG_GROUPS, unitLabel, type CatalogGroup } from "@/lib/stock/catalog";
import { stockApi, uploadStockPhoto } from "@/lib/stock/api";
import { daysLabel, matches } from "@/lib/stock/math";
import type { StockDrawer, StockItem, StockLine, StockVariant } from "@/lib/stock/types";
import { StockPicture } from "./Art";
import { printDrawerLabels } from "./labels";
import { EditLineSheet } from "./EditLineSheet";
import { Btn, Card, CodeBadge, Eyebrow, Field, LinePicture, Ltr, NumberBox, PhotoButton, PhotoTile, Pill, Reveal, Stepper, fmtDate, fmtMoney, inputCls, linesOfDrawer, shortCode, useBusy, useCountDraft, useOverlay, variantLabel, type StockCtx } from "./shared";

/** The map of rooms, cabinets and drawers — or one drawer, when `drawerCode` is set. */
export function CupboardView({ ctx, drawerCode }: { ctx: StockCtx; drawerCode: string | null }) {
  const drawer = drawerCode ? ctx.snap.drawers.find((d) => d.code === drawerCode) : null;
  if (drawer) return <DrawerDetail key={drawer.id} ctx={ctx} drawer={drawer} />;
  return <CupboardMap ctx={ctx} />;
}

function drawerDays(ctx: StockCtx, drawerId: string): number | null {
  let min: number | null = null;
  for (const l of linesOfDrawer(ctx.snap, drawerId)) {
    const p = ctx.pace.get(l.itemId);
    if (p?.daysLeft != null && (min == null || p.daysLeft < min)) min = p.daysLeft;
  }
  return min;
}

function CupboardMap({ ctx }: { ctx: StockCtx }) {
  const { snap, t, ar, toast } = ctx;
  const { busy, run } = useBusy();
  const rooms = useMemo(() => {
    const map = new Map<string, { code: string; en: string; ar: string; cabinets: Map<string, { letter: string; where: string; drawers: StockDrawer[] }> }>();
    for (const d of snap.drawers) {
      const r = map.get(d.roomCode) || { code: d.roomCode, en: d.roomEn, ar: d.roomAr, cabinets: new Map() };
      const c = r.cabinets.get(d.cabinetLetter) || { letter: d.cabinetLetter, where: d.cabinetWhere, drawers: [] };
      c.drawers.push(d);
      r.cabinets.set(d.cabinetLetter, c);
      map.set(d.roomCode, r);
    }
    return [...map.values()];
  }, [snap.drawers]);

  const units = snap.lines.reduce((a, l) => a + l.qty, 0);
  const low = [...ctx.pace.values()].filter((p) => p.daysLeft != null && p.daysLeft < 14).length;
  const lastCount = snap.counts[snap.counts.length - 1];
  const lastDeliv = snap.deliveries[snap.deliveries.length - 1];
  const countDue = !lastCount || daysBetween(lastCount.date, ctx.today) >= 7;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>{t("The cupboard", "الدولاب")}</Eyebrow>
          <p className="mt-1 max-w-2xl text-sm text-ink-body">{t("Tap a drawer to see its photo and what lives in it. Yellow means something in it runs out within two weeks at the current pace.", "دوس على درج تشوف صورته واللي جواه. الأصفر معناه حاجة فيه هتخلص خلال أسبوعين بالمعدل الحالي.")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ctx.canStructure ? (
            <Btn onClick={() => run(() => printDrawerLabels(snap, snap.drawers, window.location.origin), (m) => toast(m, "error"))} busy={busy}>
              <Printer size={15} /> {t("Print labels", "اطبع الملصقات")}
            </Btn>
          ) : null}
          {ctx.canEdit ? (
            <Btn kind="yellow" onClick={() => ctx.go({ tab: "count" })}>
              {countDue ? t("Start this week's count", "ابدأ عدّ الأسبوع") : t("Count again", "عدّ تاني")}
            </Btn>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label={t("On the shelf", "على الرف")} value={String(units)} sub={`${snap.lines.length} ${t("lines", "سطر")} · ${snap.items.length} ${t("items", "صنف")} · ${snap.drawers.length} ${t("drawers", "درج")}`} />
        <Tile label={t("Running out", "هتخلص")} value={String(low)} sub={t("items under 14 days", "صنف تحت 14 يوم")} yellow={low > 0} />
        <Tile label={t("Weekly count", "العدّ الأسبوعي")} value={countDue ? t("Due", "مستحق") : t("Done", "تم")} sub={lastCount ? `${t("last", "آخر")} ${fmtDate(lastCount.date, ar)} · ${lastCount.byName}` : t("never counted", "لسه ما اتعدّش")} yellow={countDue} />
        <Tile label={t("Last delivery", "آخر توريد")} value={lastDeliv ? fmtDate(lastDeliv.date, ar) : "—"} sub={lastDeliv ? `${lastDeliv.supplier} · ${lastDeliv.lines.length} ${t("lines", "سطر")} · ${fmtMoney(lastDeliv.total)} ${t("EGP", "جنيه")}` : t("none yet", "لسه مفيش")} />
      </div>

      {rooms.map((r) => (
        <Card key={r.code} className="grid gap-3 p-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="rounded-md bg-ink px-2 py-0.5 font-display text-[12px] font-black text-white">{r.code}</span>
            <b className="font-display text-base font-bold text-ink">{ar ? r.ar : r.en}</b>
            <span className="text-xs text-ink-muted">{ar ? r.en : r.ar}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {[...r.cabinets.values()].map((c) => (
              <div key={c.letter} className="overflow-hidden rounded-xl border border-line bg-surface-subtle">
                <div className="flex justify-between px-3 py-2 font-display text-[12px] font-bold text-ink">
                  <span>{t("Cabinet", "دولاب")} {c.letter}</span>
                  <span className="font-semibold text-ink-muted">{c.where}</span>
                </div>
                {c.drawers
                  .sort((a, b) => a.order - b.order)
                  .map((d) => {
                    const lines = linesOfDrawer(snap, d.id);
                    const days = d.tracked ? null : drawerDays(ctx, d.id);
                    const lowHere = days != null && days < 14;
                    return (
                      <div key={d.id} className="grid grid-cols-[44px_64px_1fr] items-center gap-2.5 border-t border-line bg-surface px-3 py-2">
                        <span className="font-display text-[13px] font-black text-ink"><Ltr>{shortCode(d)}</Ltr></span>
                        <DrawerPhoto ctx={ctx} drawer={d} />
                        <button type="button" onClick={() => ctx.go({ tab: "cupboard", drawer: d.code })} className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-2.5 rounded-lg py-1 text-start hover:bg-surface-subtle">
                        <span className="min-w-0">
                          <b className="block truncate text-[13.5px] font-semibold text-ink">{ar ? d.nameAr : d.nameEn}</b>
                          <span className="block text-[12.5px] text-ink-muted">{ar ? d.nameEn : d.nameAr}</span>
                        </span>
                        <span className="text-end text-[12.5px] text-ink-muted">
                          {lines.length} {t("lines", "سطر")}
                          <br />
                          {d.tracked ? <Pill>{t("per patient", "لكل مريض")}</Pill> : lowHere ? <Pill yellow>{daysLabel(days, ar)}</Pill> : <span>{daysLabel(days, ar)}</span>}
                        </span>
                      </button>
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>
        </Card>
      ))}

      {ctx.canStructure ? (
        <Btn onClick={() => ctx.go({ tab: "setup", drawer: null })} className="justify-self-start">
          <Pencil size={14} /> {t("Edit rooms, cabinets and drawers", "عدّل الغرف والدواليب والأدراج")}
        </Btn>
      ) : null}
    </div>
  );
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000);
}

function Tile({ label, value, sub, yellow = false }: { label: string; value: string; sub: string; yellow?: boolean }) {
  return (
    <Card className="p-3.5">
      <Eyebrow>{label}</Eyebrow>
      <div className={`mt-1 inline-block font-display text-2xl font-bold leading-tight ${yellow ? "rounded-lg bg-[#FACC15] px-2 text-[#1A1206]" : "text-ink"}`}>{value}</div>
      <div className="mt-1 text-[12.5px] text-ink-muted">{sub}</div>
    </Card>
  );
}

/** Drawer photo if there is one, otherwise a tray of the drawings of what is inside. */
export function DrawerThumb({ ctx, drawer, large = false }: { ctx: StockCtx; drawer: StockDrawer; large?: boolean }) {
  if (drawer.photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={drawer.photoUrl} alt={drawer.nameEn} className="h-full w-full object-cover" decoding="async" />;
  }
  const lines = linesOfDrawer(ctx.snap, drawer.id).slice(0, large ? 8 : 4);
  return (
    <div className={`grid h-full w-full gap-1 bg-[#E7E2DA] p-1 ${large ? "grid-cols-4" : "grid-cols-4"}`}>
      {lines.map((l) => (
        <div key={l.id} className="overflow-hidden rounded-sm bg-[#F4F1EC]">
          <LinePicture variant={ctx.variants.get(l.variantId)} item={ctx.items.get(l.itemId)} />
        </div>
      ))}
    </div>
  );
}

/**
 * The drawer's own photograph in the list, and the button that takes it.
 *
 * It used to fall back to tiny drawings of the items inside, which read as "this is the photo"
 * and hid the fact that none had been taken. Now it is either the real photo or an obvious
 * camera, and tapping it on a phone opens the camera for that drawer.
 */
function DrawerPhoto({ ctx, drawer }: { ctx: StockCtx; drawer: StockDrawer }) {
  const { t, toast } = ctx;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const take = async (file: File) => {
    setBusy(true);
    try {
      const url = await uploadStockPhoto("drawer", drawer.id, file);
      ctx.setSnap(await stockApi.setPhoto("drawer", drawer.id, url));
      toast(t("Drawer photo saved.", "اتحفظت صورة الدرج."));
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Could not save the photo.", "تعذر حفظ الصورة."), "error");
    } finally {
      setBusy(false);
    }
  };
  const picture = drawer.photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={drawer.photoUrl} alt={drawer.nameEn} className="h-full w-full object-cover" decoding="async" />
  ) : (
    <span className="grid h-full w-full place-items-center text-ink-muted">{busy ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}</span>
  );
  const box = `block h-11 w-16 overflow-hidden rounded-md border bg-surface-subtle ${drawer.photoUrl ? "border-line" : "border-dashed border-line"}`;
  if (!ctx.canEdit) return <span className={box}>{picture}</span>;
  return (
    <button type="button" onClick={() => input.current?.click()} disabled={busy} className={box} aria-label={`${drawer.photoUrl ? t("Retake the photo of", "صوّر تاني") : t("Photograph", "صوّر")} ${drawer.code}`} title={drawer.photoUrl ? t("Tap to retake the drawer photo", "دوس تصوّر الدرج تاني") : t("Tap to photograph this drawer", "دوس تصوّر الدرج ده")}>
      {picture}
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void take(f);
          e.currentTarget.value = "";
        }}
      />
    </button>
  );
}

// --- one drawer ------------------------------------------------------------------------------

function DrawerDetail({ ctx, drawer }: { ctx: StockCtx; drawer: StockDrawer }) {
  const { snap, t, ar, toast } = ctx;
  const { busy, run } = useBusy();
  const [mode, setMode] = useState<null | "item" | "brand" | "edit" | { use: StockLine }>(null);
  const [photoBusy, setPhotoBusy] = useState<string | null>(null);
  // The Edit sheet: the phone's Back button closes it instead of leaving the drawer.
  const [editing, setEditing, closeEditing] = useOverlay<{ lineId: string; del: boolean }>();
  const lines = linesOfDrawer(snap, drawer.id);
  // Quantities typed here but not saved yet. Saving them IS a count — of this drawer, today.
  // They are kept on the device, so leaving the page or a locked phone does not lose them.
  const kept = useCountDraft(`drawer:${drawer.id}`, ctx.today, new Set(lines.map((l) => l.id)));
  const draft = kept.values;
  const typeQty = (line: StockLine, n: number) => {
    const next = { ...draft };
    if (n === line.qty) delete next[line.id];
    else next[line.id] = n;
    kept.set({ values: next, step: 0 });
  };
  const changedCount = lines.filter((l) => draft[l.id] != null && draft[l.id] !== l.qty).length;

  const saveDrawerCount = () =>
    run(async () => {
      const r = await stockApi.saveCount(ctx.today, draft, drawer.id);
      ctx.setSnap(r.snapshot);
      kept.clear();
      toast(t("Saved. This drawer is counted for today.", "اتحفظ. الدرج ده اتعدّ النهارده."));
    }, (m) => toast(m, "error"));

  const setLinePhoto = async (line: StockLine, file: File) => {
    const v = ctx.variants.get(line.variantId);
    // A brand's box gets the photo; while there is no brand yet, the item itself does.
    const kind = v && !v.isGeneric ? "variant" : "item";
    const id = kind === "variant" ? line.variantId : line.itemId;
    setPhotoBusy(line.id);
    try {
      const url = await uploadStockPhoto(kind, id, file);
      ctx.setSnap(await stockApi.setPhoto(kind, id, url));
      toast(t("Photo saved.", "اتحفظت الصورة."));
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Could not save the photo.", "تعذر حفظ الصورة."), "error");
    } finally {
      setPhotoBusy(null);
    }
  };

  const byItem = new Map<string, StockLine[]>();
  for (const l of lines) byItem.set(l.itemId, [...(byItem.get(l.itemId) || []), l]);
  const Back = ar ? ArrowRight : ArrowLeft;

  const setDrawerPhoto = (f: File) =>
    run(async () => {
      const url = await uploadStockPhoto("drawer", drawer.id, f);
      ctx.setSnap(await stockApi.setPhoto("drawer", drawer.id, url));
      toast(t("Drawer photo saved.", "اتحفظت صورة الدرج."));
    }, (m) => toast(m, "error"));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" onClick={() => ctx.go({ tab: "cupboard", drawer: null })} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 font-display text-[13px] font-bold text-ink hover:bg-surface-subtle">
            <Back size={15} /> {t("Cupboard", "الدولاب")}
          </button>
          <h2 className="mt-1 flex flex-wrap items-center gap-3 font-display text-2xl font-bold tracking-tight text-ink">
            <CodeBadge code={drawer.code} big />
            <span>{ar ? drawer.nameAr : drawer.nameEn}</span>
            <span className="hidden text-base font-semibold text-ink-muted sm:inline">{ar ? drawer.nameEn : drawer.nameAr}</span>
          </h2>
          <p className="mt-1 text-sm text-ink-body">
            {ar ? drawer.roomAr : drawer.roomEn} · {t("Cabinet", "دولاب")} {drawer.cabinetLetter}{drawer.cabinetWhere ? `, ${drawer.cabinetWhere}` : ""} · {t("code", "كود")} <b>{drawer.code}</b>
            {drawer.tracked ? <> · <Pill>{t("per patient", "لكل مريض")}</Pill></> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ctx.canStructure ? (
            <Btn onClick={() => run(() => printDrawerLabels(snap, [drawer], window.location.origin), (m) => toast(m, "error"))} busy={busy}>
              <Printer size={15} /> {t("Print label", "اطبع الملصق")}
            </Btn>
          ) : null}
          {ctx.canEdit ? <PhotoButton label={drawer.photoUrl ? t("Retake photo", "صوّر تاني") : t("Photograph the drawer", "صوّر الدرج")} onFile={setDrawerPhoto} busy={busy} /> : null}
          {ctx.canStructure ? <Btn onClick={() => setMode(mode === "edit" ? null : "edit")}>{t("Edit", "تعديل")}</Btn> : null}
        </div>
      </div>

      {mode === "edit" ? <Reveal><EditDrawerForm ctx={ctx} drawer={drawer} onDone={() => setMode(null)} /></Reveal> : null}
      {mode === "item" ? <Reveal><AddItemHere ctx={ctx} drawer={drawer} onDone={() => setMode(null)} /></Reveal> : null}
      {mode === "brand" ? <Reveal><AddBrandHere ctx={ctx} drawer={drawer} onDone={() => setMode(null)} /></Reveal> : null}
      {mode && typeof mode === "object" && "use" in mode ? <Reveal><UseOnPatient ctx={ctx} drawer={drawer} line={mode.use} onDone={() => setMode(null)} /></Reveal> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* On a phone the rows to count come first, and the photo and its note follow them. */}
        <div className="order-last lg:order-none">
          {/* A real photo is worth the space on a phone; the drawn tray is not, so it waits for a wide screen. */}
          <div className={`aspect-[16/10] overflow-hidden rounded-2xl border border-line bg-surface-subtle ${drawer.photoUrl ? "" : "hidden lg:block"}`}>
            <DrawerThumb ctx={ctx} drawer={drawer} large />
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            {drawer.photoUrl
              ? t("The drawer as it looks open. A new assistant matches the picture, not the words.", "الدرج وهو مفتوح. المساعد الجديد بيطابق الصورة مش الكلام.")
              : t("No photo yet. Open the drawer and photograph it once. Tap any item's picture to give it its own photo. Type how many you have and press Save count.", "لسه مفيش صورة. افتح الدرج وصوّره مرة. دوس على صورة أي صنف تحط له صورته. اكتب عندك كام ودوس احفظ العدّ.")}
          </p>
          {drawer.tracked ? (
            <div className="mt-3 border-s-[3px] border-[#FACC15] ps-3 text-[13px] text-ink-body">
              <b className="text-ink">{t("Per-patient drawer.", "درج لكل مريض.")}</b>{" "}
              {t("Implants, grafts and membranes are not counted in boxes. Press “Used on a patient” on the item, with the lot number, and the stock drops by one. Any gap shows in the Variance report.", "الزرعات والجرافت والممبرين مش بتتعدّ بالعلبة. دوس «اتستخدم لمريض» على الصنف ومعاه رقم التشغيلة، والمخزون ينقص واحد. أي فرق بيظهر في تقرير الفروق.")}
            </div>
          ) : null}
        </div>

        <Card>
          {[...byItem.entries()].map(([itemId, ls]) => {
            const item = ctx.items.get(itemId);
            const p = ctx.pace.get(itemId);
            const total = ls.reduce((a, l) => a + l.qty, 0);
            const low = p?.daysLeft != null && p.daysLeft < 14;
            return (
              <div key={itemId} className="grid gap-2 border-t border-line p-3.5 first:border-t-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <b className="text-[14.5px] font-bold text-ink">{item ? (ar ? item.nameAr : item.nameEn) : "?"}</b>
                    <span className="ms-2 text-[13px] text-ink-muted">{item ? (ar ? item.nameEn : item.nameAr) : ""}</span>
                  </div>
                  <span className={`text-[12px] ${low ? "rounded-full bg-[#FACC15] px-2 font-display font-bold text-[#1A1206]" : "text-ink-muted"}`}>
                    {item?.tracked
                      ? `${total} ${t("in this drawer", "في الدرج")}`
                      : `${total} ${unitLabel(item?.unit || "box", total, ar)} ${t("here", "هنا")}${p ? ` · ${daysLabel(p.daysLeft, ar)}` : ""}`}
                  </span>
                </div>
                <div className="grid gap-1.5">
                  {ls.map((l) => {
                    const v = ctx.variants.get(l.variantId);
                    return (
                      <div key={l.id} className={`grid grid-cols-[72px_1fr_auto] items-center gap-3 rounded-xl border p-1.5 ${draft[l.id] != null && draft[l.id] !== l.qty ? "border-[#FACC15] bg-surface-subtle" : "border-line bg-surface"}`}>
                        {ctx.canEdit ? (
                          <PhotoTile variant={v} item={item} busy={photoBusy === l.id} onFile={(f) => void setLinePhoto(l, f)} className="h-14 w-[72px]" />
                        ) : (
                          <div className="h-14 w-[72px] overflow-hidden rounded-lg border border-line bg-surface-subtle">
                            <LinePicture variant={v} item={item} />
                          </div>
                        )}
                        <div className="min-w-0">
                          <b className="block text-[13px] font-semibold leading-snug text-ink">
                            {v?.isGeneric ? (item?.per ? <Ltr>{item.per}</Ltr> : item ? (ar ? item.nameAr : item.nameEn) : "") : <Ltr>{variantLabel(v, item, ar)}</Ltr>}
                          </b>
                          <span className="block text-[12.5px] text-ink-muted">
                            {v?.isGeneric ? t("no brand yet", "من غير ماركة") : item?.per ? <Ltr>{item.per}</Ltr> : null}
                            {v?.barcode ? <span className="hidden sm:inline"> · <Ltr>{v.barcode}</Ltr></span> : null}
                            {v?.lastPrice ? <> · <Ltr>{fmtMoney(v.lastPrice)}</Ltr> {t("EGP", "جنيه")}</> : null}
                            {v?.supplier ? <> · <Ltr>{v.supplier}</Ltr></> : null}
                          </span>
                          {drawer.tracked && ctx.canEdit && l.qty > 0 ? (
                            <button type="button" onClick={() => setMode({ use: l })} className="mt-1 inline-flex items-center gap-1 text-[12px] font-bold text-ink underline">
                              <UserRound size={12} /> {t("Used on a patient", "اتستخدم لمريض")}
                            </button>
                          ) : null}
                        </div>
                        {ctx.canEdit ? (
                          <div className="grid justify-items-end gap-0.5">
                            <Stepper value={draft[l.id] ?? l.qty} onChange={(n) => typeQty(l, n)} changed={draft[l.id] != null && draft[l.id] !== l.qty} />
                            <span className="text-[12px] text-ink-muted">{unitLabel(item?.unit || "box", draft[l.id] ?? l.qty, ar)}</span>
                          </div>
                        ) : (
                          <div className="text-end">
                            <b className="block font-display text-xl font-black leading-none text-ink">{l.qty}</b>
                            <span className="text-[12px] text-ink-muted">{unitLabel(item?.unit || "box", l.qty, ar)}</span>
                          </div>
                        )}
                        {/* Edit and Delete sit on their own line, at opposite ends: as two small words side by side a thumb hit the wrong one. Delete always asks first. */}
                        {ctx.canStructure ? (
                          <div className="col-span-full flex items-center justify-between gap-3 border-t border-line pt-1.5">
                            <button type="button" onClick={() => setEditing({ lineId: l.id, del: false })} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line bg-surface px-4 font-display text-[13px] font-bold text-ink hover:bg-surface-subtle">
                              <Pencil size={14} /> {t("Edit", "تعديل")}
                            </button>
                            <button type="button" onClick={() => setEditing({ lineId: l.id, del: true })} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 font-display text-[13px] font-bold text-red-700 hover:bg-red-50">
                              <Trash2 size={14} /> {t("Delete", "مسح")}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {!lines.length ? <p className="p-4 text-sm text-ink-muted">{t("Nothing lives here yet.", "لسه مفيش حاجة هنا.")}</p> : null}
          {ctx.canStructure ? (
            <div className="flex flex-wrap gap-2 border-t border-line p-3">
              <Btn onClick={() => setMode(mode === "item" ? null : "item")}><Plus size={14} /> {t("Add an item here", "ضيف صنف هنا")}</Btn>
              <Btn onClick={() => setMode(mode === "brand" ? null : "brand")}><Plus size={14} /> {t("Add a brand", "ضيف ماركة")}</Btn>
            </div>
          ) : null}
        </Card>
      </div>

      {editing && lines.find((l) => l.id === editing.lineId) ? (
        <EditLineSheet ctx={ctx} drawer={drawer} line={lines.find((l) => l.id === editing.lineId) as StockLine} startOnDelete={editing.del} onClose={closeEditing} />
      ) : null}

      {changedCount > 0 ? (
        <div className="sticky bottom-24 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-ink-slab p-3 text-white shadow-lg lg:bottom-4">
          <span className="text-sm">
            <b className="font-display text-lg">{changedCount}</b> {t("changed in this drawer", "اتغير في الدرج ده")}
            {kept.restored ? <span className="block text-[12px] text-white/70">{t("Typed earlier and not saved yet.", "اتكتبوا قبل كده ولسه ما اتحفظوش.")}</span> : null}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={kept.clear} className="rounded-xl border border-white/20 px-3 py-2 font-display text-[13px] font-bold text-white/85">
              {t("Undo", "تراجع")}
            </button>
            <Btn kind="yellow" busy={busy} onClick={saveDrawerCount}>
              <Check size={15} /> {t("Save count", "احفظ العدّ")}
            </Btn>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EditDrawerForm({ ctx, drawer, onDone }: { ctx: StockCtx; drawer: StockDrawer; onDone: () => void }) {
  const { t, toast } = ctx;
  const { busy, run } = useBusy();
  const [nameEn, setNameEn] = useState(drawer.nameEn);
  const [nameAr, setNameAr] = useState(drawer.nameAr);
  const [where, setWhere] = useState(drawer.cabinetWhere);
  const [tracked, setTracked] = useState(drawer.tracked);
  return (
    <Card className="grid gap-3 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("Name (English)", "الاسم بالإنجليزي")}><input value={nameEn} onChange={(e) => setNameEn(e.target.value)} className={inputCls} /></Field>
        <Field label={t("Name (Arabic)", "الاسم بالعربي")}><input value={nameAr} onChange={(e) => setNameAr(e.target.value)} className={inputCls} dir="rtl" /></Field>
        <Field label={t("Where is the cabinet", "فين الدولاب")}><input value={where} onChange={(e) => setWhere(e.target.value)} className={inputCls} /></Field>
      </div>
      <label className="flex items-center gap-2 text-[13px] text-ink-body"><input type="checkbox" checked={tracked} onChange={(e) => setTracked(e.target.checked)} /> {t("Items used per patient", "أصناف بتتستخدم لكل مريض")}</label>
      <div className="flex gap-2">
        <Btn kind="dark" busy={busy} onClick={() => run(async () => { ctx.setSnap(await stockApi.renameDrawer(drawer.id, { nameEn, nameAr, cabinetWhere: where, tracked })); onDone(); toast(t("Saved.", "اتحفظ.")); }, (m) => toast(m, "error"))}>{t("Save", "حفظ")}</Btn>
        <Btn onClick={onDone}>{t("Cancel", "إلغاء")}</Btn>
      </div>
    </Card>
  );
}

/** Pick from the catalogue, or type your own; it lands in this drawer. */
function AddItemHere({ ctx, drawer, onDone }: { ctx: StockCtx; drawer: StockDrawer; onDone: () => void }) {
  const { t, ar, toast, snap } = ctx;
  const { busy, run } = useBusy();
  const [q, setQ] = useState("");
  const [own, setOwn] = useState(false);
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [unit, setUnit] = useState("box");
  const [per, setPer] = useState("");
  const [qty, setQty] = useState(0);
  const [photo, setPhoto] = useState<File | null>(null);
  const have = new Set(snap.items.map((i) => i.catalogKey).filter(Boolean));
  const existingHere = new Set(linesOfDrawer(snap, drawer.id).map((l) => l.itemId));
  const hits = CATALOG.filter((c) => matches([c.en, c.ar, c.syn || "", CATALOG_GROUPS[c.group as CatalogGroup].en], q)).slice(0, 24);

  const addCatalog = (key: string) =>
    run(async () => {
      const existing = snap.items.find((i) => i.catalogKey === key);
      if (existing) {
        if (existingHere.has(existing.id)) { toast(t("Already in this drawer.", "موجود في الدرج ده.")); return; }
        const generic = snap.variants.find((v) => v.itemId === existing.id && v.isGeneric) || snap.variants.find((v) => v.itemId === existing.id);
        if (!generic) throw new Error(t("That item has no brand to place.", "الصنف ده مفيش له ماركة."));
        ctx.setSnap(await stockApi.addLine(generic.id, drawer.id));
      } else {
        const r = await stockApi.addItem({ catalogKey: key, nameEn: CATALOG.find((c) => c.key === key)?.en, nameAr: CATALOG.find((c) => c.key === key)?.ar, drawerId: drawer.id, qty: 0 });
        ctx.setSnap(r.snapshot);
      }
      toast(t("Added to this drawer.", "اتضاف للدرج."));
      onDone();
    }, (m) => toast(m, "error"));

  const addOwn = () =>
    run(async () => {
      // One name is enough. The other language borrows it, so nobody has to type English.
      const r = await stockApi.addItem({ nameEn: nameEn.trim() || nameAr.trim(), nameAr: nameAr.trim() || nameEn.trim(), unit, per, drawerId: drawer.id, qty, tracked: drawer.tracked });
      if (photo) {
        const url = await uploadStockPhoto("item", r.itemId, photo);
        ctx.setSnap(await stockApi.setPhoto("item", r.itemId, url));
      } else ctx.setSnap(r.snapshot);
      toast(t("Added to this drawer.", "اتضاف للدرج."));
      onDone();
    }, (m) => toast(m, "error"));

  return (
    <Card className="grid gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>{t("Add an item to", "ضيف صنف لـ")} {drawer.code}</Eyebrow>
        <div className="flex gap-1 rounded-xl border border-line p-0.5 text-[12px] font-bold">
          <button type="button" onClick={() => setOwn(false)} className={`rounded-lg px-3 py-1.5 ${!own ? "bg-ink text-white" : "text-ink-body"}`}>{t("From the catalogue", "من الكتالوج")}</button>
          <button type="button" onClick={() => setOwn(true)} className={`rounded-lg px-3 py-1.5 ${own ? "bg-ink text-white" : "text-ink-body"}`}>{t("My own item", "صنف من عندي")}</button>
        </div>
      </div>
      {!own ? (
        <>
          <label className="flex items-center gap-2 rounded-xl border border-line bg-surface-subtle px-3 py-2">
            <Search size={15} className="text-ink-muted" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search: فلو, bond, gloves…", "دوّر: فلو، بوند، جلافز…")} className="w-full bg-transparent text-[14px] outline-none" />
          </label>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {hits.map((c) => (
              <button key={c.key} type="button" disabled={busy} onClick={() => addCatalog(c.key)} className="grid gap-1 rounded-xl border border-line bg-surface p-2 text-start hover:bg-surface-subtle disabled:opacity-50">
                <StockPicture photoUrl={null} shape={c.shape} product={c.en.split(" ")[0]} className="h-12" />
                <span className="text-[12px] font-semibold leading-tight text-ink">{ar ? c.ar : c.en}</span>
                <span className="text-[12px] text-ink-muted">{have.has(c.key) ? t("in cupboard", "في الدولاب") : ar ? c.en : c.ar}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("Name (Arabic)", "اسم الصنف")}><input autoFocus={ar} value={nameAr} onChange={(e) => setNameAr(e.target.value)} className={inputCls} dir="rtl" /></Field>
          <Field label={t("Name (English)", "الاسم بالإنجليزي (اختياري)")}><input autoFocus={!ar} value={nameEn} onChange={(e) => setNameEn(e.target.value)} className={inputCls} dir="ltr" /></Field>
          <Field label={t("Count unit", "وحدة العدّ")}>
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls}>
              {["box", "syringe", "bottle", "pack", "jar", "bag", "cartridge", "piece", "vial", "set", "roll", "can", "tube", "kit", "strip"].map((u) => <option key={u} value={u}>{unitLabel(u, 1, ar)}</option>)}
            </select>
          </Field>
          <Field label={t("What one unit holds", "الوحدة فيها إيه")}><input value={per} onChange={(e) => setPer(e.target.value)} className={inputCls} placeholder="50 pcs" /></Field>
          <Field label={t("How many now", "كام دلوقتي")}><NumberBox value={qty} onChange={setQty} className={inputCls} /></Field>
          <div className="self-end"><PhotoButton label={photo ? t("Photo attached ✓", "الصورة اتضافت ✓") : t("Photo", "صورة")} onFile={setPhoto} /></div>
          {!nameEn.trim() && !nameAr.trim() ? <p className="text-[12.5px] font-semibold text-ink-body sm:col-span-2">{t("Still needed: the item's name", "لسه ناقص: اسم الصنف")}</p> : null}
          <div className="flex gap-2 sm:col-span-2">
            <Btn kind="dark" busy={busy} disabled={!nameEn.trim() && !nameAr.trim()} onClick={addOwn}>{t("Add", "ضيف")}</Btn>
            <Btn onClick={onDone}>{t("Cancel", "إلغاء")}</Btn>
          </div>
        </div>
      )}
    </Card>
  );
}

/** A brand of an item already in this drawer, added by hand (without a delivery). */
function AddBrandHere({ ctx, drawer, onDone }: { ctx: StockCtx; drawer: StockDrawer; onDone: () => void }) {
  const { t, ar, toast, snap } = ctx;
  const { busy, run } = useBusy();
  const itemIds = [...new Set(linesOfDrawer(snap, drawer.id).map((l) => l.itemId))];
  // With several items in the drawer nothing is picked for the person: a list that starts on its
  // first line files the brand under whatever happens to be first.
  const [itemId, setItemId] = useState(itemIds.length === 1 ? itemIds[0] : "");
  const [brand, setBrand] = useState("");
  const [product, setProduct] = useState("");
  const [spec, setSpec] = useState("");
  const [barcode, setBarcode] = useState("");
  const [qty, setQty] = useState(0);
  const [photo, setPhoto] = useState<File | null>(null);
  return (
    <Card className="grid gap-3 p-4">
      <Eyebrow>{t("Add a brand in", "ضيف ماركة في")} {drawer.code}</Eyebrow>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("Of which item", "لأي صنف")}>
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={inputCls}>
            <option value="" disabled>{t("Choose the item…", "اختار الصنف…")}</option>
            {itemIds.map((id) => { const it = ctx.items.get(id); return <option key={id} value={id}>{it ? (ar ? it.nameAr : it.nameEn) : id}</option>; })}
          </select>
        </Field>
        <Field label={t("Brand", "الماركة")}><input value={brand} onChange={(e) => setBrand(e.target.value)} className={inputCls} placeholder="3M" /></Field>
        <Field label={t("Product", "المنتج")}><input value={product} onChange={(e) => setProduct(e.target.value)} className={inputCls} placeholder="Filtek Z350" /></Field>
        <Field label={t("Shade / size", "اللون / المقاس")}><input value={spec} onChange={(e) => setSpec(e.target.value)} className={inputCls} placeholder="A2" /></Field>
        <Field label={t("Barcode (optional)", "الباركود (اختياري)")}><input value={barcode} onChange={(e) => setBarcode(e.target.value)} className={inputCls} inputMode="numeric" /></Field>
        <Field label={t("How many here now", "كام هنا دلوقتي")}><NumberBox value={qty} onChange={setQty} className={inputCls} /></Field>
      </div>
      {!itemId || !brand.trim() ? (
        <p className="text-[12.5px] font-semibold text-ink-body">
          {t("Still needed: ", "لسه ناقص: ")}
          {[!itemId ? t("the item", "الصنف") : "", !brand.trim() ? t("the brand", "الماركة") : ""].filter(Boolean).join(t(", ", "، "))}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <PhotoButton label={photo ? t("Photo attached ✓", "الصورة اتضافت ✓") : t("Photo of the box", "صورة العلبة")} onFile={setPhoto} />
        <Btn kind="dark" busy={busy} disabled={!itemId || !brand.trim()} onClick={() => run(async () => {
          const r = await stockApi.addVariant({ itemId, brand, product, spec, barcode, drawerId: drawer.id, qty });
          if (photo) { const url = await uploadStockPhoto("variant", r.variantId, photo); ctx.setSnap(await stockApi.setPhoto("variant", r.variantId, url)); } else ctx.setSnap(r.snapshot);
          onDone(); toast(t("Brand added.", "اتضافت الماركة."));
        }, (m) => toast(m, "error"))}>{t("Add", "ضيف")}</Btn>
        <Btn onClick={onDone}>{t("Cancel", "إلغاء")}</Btn>
      </div>
    </Card>
  );
}

type PatientLite = { id: string; name: string; phone: string };

/** A tracked item leaves the drawer for a patient, with its lot number. */
function UseOnPatient({ ctx, drawer, line, onDone }: { ctx: StockCtx; drawer: StockDrawer; line: StockLine; onDone: () => void }) {
  const { t, ar, toast } = ctx;
  const { busy, run } = useBusy();
  const [patients, setPatients] = useState<PatientLite[]>([]);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<PatientLite | null>(null);
  const [lot, setLot] = useState("");
  const v = ctx.variants.get(line.variantId);
  const item = ctx.items.get(line.itemId);

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const snap = await getDocs(query(getClinicCollection("patients"), orderBy("name", "asc"), limit(2500)));
        if (!on) return;
        setPatients(snap.docs.map((d) => ({ id: d.id, name: String(d.data().name || ""), phone: String(d.data().phone || "") })));
      } catch {
        /* the typed name is still accepted */
      }
    })();
    return () => { on = false; };
  }, []);

  const hits = q.trim() ? patients.filter((p) => patientMatchesSearch(q, p.name, p.phone)).slice(0, 8) : [];

  return (
    <Card className="grid gap-3 border-[#FACC15] p-4">
      <Eyebrow>{t("Used on a patient", "اتستخدم لمريض")} · {variantLabel(v, item, ar)}</Eyebrow>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("Patient", "المريض")}>
          {picked ? (
            <div className="flex items-center justify-between rounded-xl border border-line bg-surface-subtle px-3 py-2 text-[14px]"><span>{picked.name}</span><button type="button" className="text-xs underline" onClick={() => setPicked(null)}>{t("change", "غيّر")}</button></div>
          ) : (
            <div className="relative">
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className={inputCls} placeholder={t("Name or phone", "الاسم أو التليفون")} />
              {hits.length ? (
                <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
                  {hits.map((p) => <button key={p.id} type="button" onClick={() => { setPicked(p); setQ(""); }} className="block w-full px-3 py-2 text-start text-[13.5px] hover:bg-surface-subtle"><b>{p.name}</b> <span className="text-ink-muted">{p.phone}</span></button>)}
                </div>
              ) : null}
            </div>
          )}
        </Field>
        <Field label={t("Lot number (from the box)", "رقم التشغيلة (من العلبة)")}><input value={lot} onChange={(e) => setLot(e.target.value)} className={inputCls} /></Field>
      </div>
      <div className="flex gap-2">
        <Btn kind="yellow" busy={busy} disabled={!picked && !q.trim()} onClick={() => run(async () => {
          ctx.setSnap(await stockApi.useOnPatient({ variantId: line.variantId, drawerId: drawer.id, patientId: picked?.id || null, patientName: picked?.name || q.trim(), lot, date: ctx.today }));
          onDone(); toast(t("Recorded. Stock dropped by one.", "اتسجل. المخزون نقص واحد."));
        }, (m) => toast(m, "error"))}>{t("Record", "سجّل")}</Btn>
        <Btn onClick={onDone}>{t("Cancel", "إلغاء")}</Btn>
      </div>
    </Card>
  );
}

export type { StockItem, StockVariant };
