"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Pencil, Plus, Printer, Search, Trash2, UserRound } from "lucide-react";
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
import { Btn, Card, CodeBadge, Eyebrow, Field, LinePicture, Ltr, PhotoButton, PhotoTile, Pill, Reveal, Stepper, fmtDate, inputCls, linesOfDrawer, useBusy, variantLabel, type StockCtx } from "./shared";

/** The map of rooms, cabinets and drawers — or one drawer, when `drawerCode` is set. */
export function CupboardView({ ctx, drawerCode }: { ctx: StockCtx; drawerCode: string | null }) {
  const drawer = drawerCode ? ctx.snap.drawers.find((d) => d.code === drawerCode) : null;
  if (drawer) return <DrawerDetail ctx={ctx} drawer={drawer} />;
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
  const [adding, setAdding] = useState(false);
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
        <Tile label={t("Last delivery", "آخر توريد")} value={lastDeliv ? fmtDate(lastDeliv.date, ar) : "—"} sub={lastDeliv ? `${lastDeliv.supplier} · ${lastDeliv.lines.length} ${t("lines", "سطر")} · ${Math.round(lastDeliv.total).toLocaleString()} EGP` : t("none yet", "لسه مفيش")} />
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
                  .sort((a, b) => a.number - b.number)
                  .map((d) => {
                    const lines = linesOfDrawer(snap, d.id);
                    const days = d.tracked ? null : drawerDays(ctx, d.id);
                    const lowHere = days != null && days < 14;
                    return (
                      <button key={d.id} type="button" onClick={() => ctx.go({ tab: "cupboard", drawer: d.code })} className="grid w-full grid-cols-[40px_60px_1fr_auto] items-center gap-2.5 border-t border-line bg-surface px-3 py-2 text-start hover:bg-surface-subtle">
                        <span className="font-display text-[13px] font-black text-ink">{d.cabinetLetter}{d.number}</span>
                        <span className="h-10 w-[60px] overflow-hidden rounded-md border border-line bg-surface-subtle">
                          <DrawerThumb ctx={ctx} drawer={d} />
                        </span>
                        <span className="min-w-0">
                          <b className="block truncate text-[13.5px] font-semibold text-ink">{ar ? d.nameAr : d.nameEn}</b>
                          <span className="block text-[11.5px] text-ink-muted">{ar ? d.nameEn : d.nameAr}</span>
                        </span>
                        <span className="text-end text-[11.5px] text-ink-muted">
                          {lines.length} {t("lines", "سطر")}
                          <br />
                          {d.tracked ? <Pill>{t("per patient", "لكل مريض")}</Pill> : lowHere ? <Pill yellow>{daysLabel(days, ar)}</Pill> : <span>{daysLabel(days, ar)}</span>}
                        </span>
                      </button>
                    );
                  })}
              </div>
            ))}
          </div>
        </Card>
      ))}

      {ctx.canStructure ? (
        adding ? (
          <AddDrawerForm ctx={ctx} onDone={() => setAdding(false)} />
        ) : (
          <Btn onClick={() => setAdding(true)} className="justify-self-start">
            <Plus size={15} /> {t("Add a drawer or shelf", "ضيف درج أو رف")}
          </Btn>
        )
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
      <div className="mt-1 text-[11.5px] text-ink-muted">{sub}</div>
    </Card>
  );
}

/** Drawer photo if there is one, otherwise a tray of the drawings of what is inside. */
export function DrawerThumb({ ctx, drawer, large = false }: { ctx: StockCtx; drawer: StockDrawer; large?: boolean }) {
  if (drawer.photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={drawer.photoUrl} alt={drawer.nameEn} className="h-full w-full object-cover" loading="lazy" />;
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

function AddDrawerForm({ ctx, onDone }: { ctx: StockCtx; onDone: () => void }) {
  const { t, toast, snap } = ctx;
  const { busy, run } = useBusy();
  const rooms = [...new Map(snap.drawers.map((d) => [d.roomCode, d])).values()];
  const [roomCode, setRoomCode] = useState(rooms[0]?.roomCode || "C1");
  const [roomEn, setRoomEn] = useState(rooms[0]?.roomEn || "Chair 1");
  const [letter, setLetter] = useState("A");
  const [number, setNumber] = useState(1);
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [tracked, setTracked] = useState(false);
  return (
    <Card className="grid gap-3 p-4">
      <Eyebrow>{t("New drawer or shelf", "درج أو رف جديد")}</Eyebrow>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("Room code", "كود الغرفة")}>
          <input list="stock-rooms" value={roomCode} onChange={(e) => { setRoomCode(e.target.value.toUpperCase()); const r = rooms.find((x) => x.roomCode === e.target.value.toUpperCase()); if (r) setRoomEn(r.roomEn); }} className={inputCls} placeholder="C1" />
          <datalist id="stock-rooms">{rooms.map((r) => <option key={r.roomCode} value={r.roomCode}>{r.roomEn}</option>)}</datalist>
        </Field>
        <Field label={t("Room name", "اسم الغرفة")}><input value={roomEn} onChange={(e) => setRoomEn(e.target.value)} className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("Cabinet", "الدولاب")}><input value={letter} onChange={(e) => setLetter(e.target.value.toUpperCase().slice(0, 1))} className={inputCls} /></Field>
          <Field label={t("Drawer no.", "رقم الدرج")}><input type="number" min={1} value={number} onChange={(e) => setNumber(Math.max(1, Number(e.target.value) || 1))} className={inputCls} /></Field>
        </div>
        <Field label={t("Name (English)", "الاسم بالإنجليزي")}><input value={nameEn} onChange={(e) => setNameEn(e.target.value)} className={inputCls} /></Field>
        <Field label={t("Name (Arabic)", "الاسم بالعربي")}><input value={nameAr} onChange={(e) => setNameAr(e.target.value)} className={inputCls} dir="rtl" /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-[13px] text-ink-body"><input type="checkbox" checked={tracked} onChange={(e) => setTracked(e.target.checked)} /> {t("Items used per patient (implants, grafts)", "أصناف بتتستخدم لكل مريض (زرعات)")}</label>
      </div>
      <div className="flex gap-2">
        <Btn kind="dark" busy={busy} disabled={!nameEn.trim()} onClick={() => run(async () => { ctx.setSnap(await stockApi.saveDrawer({ roomCode, roomEn, roomAr: roomEn, cabinetLetter: letter, number, nameEn, nameAr, tracked })); onDone(); toast(t("Drawer added.", "اتضاف الدرج.")); }, (m) => toast(m, "error"))}>{t("Add", "ضيف")}</Btn>
        <Btn onClick={onDone}>{t("Cancel", "إلغاء")}</Btn>
      </div>
    </Card>
  );
}

// --- one drawer ------------------------------------------------------------------------------

function DrawerDetail({ ctx, drawer }: { ctx: StockCtx; drawer: StockDrawer }) {
  const { snap, t, ar, toast } = ctx;
  const { busy, run } = useBusy();
  const [mode, setMode] = useState<null | "item" | "brand" | "edit" | { use: StockLine }>(null);
  // Quantities typed here but not saved yet. Saving them IS a count — of this drawer, today.
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [photoBusy, setPhotoBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<null | { lineId: string; del: boolean }>(null);
  const lines = linesOfDrawer(snap, drawer.id);
  const changedCount = lines.filter((l) => draft[l.id] != null && draft[l.id] !== l.qty).length;

  const saveDrawerCount = () =>
    run(async () => {
      const r = await stockApi.saveCount(ctx.today, draft);
      ctx.setSnap(r.snapshot);
      setDraft({});
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

  const removeFromDrawer = (line: StockLine) =>
    run(async () => {
      ctx.setSnap(await stockApi.removeLine(line.id));
      toast(t("Removed from this drawer.", "اتشال من الدرج."));
    }, (m) => toast(m, "error"));
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
          <button type="button" onClick={() => ctx.go({ tab: "cupboard", drawer: null })} className="inline-flex items-center gap-1 text-[12.5px] text-ink-muted hover:text-ink">
            <Back size={14} /> {t("Cupboard", "الدولاب")}
          </button>
          <h2 className="mt-1 flex flex-wrap items-center gap-3 font-display text-2xl font-bold tracking-tight text-ink">
            <CodeBadge code={drawer.code} big />
            <span>{ar ? drawer.nameAr : drawer.nameEn}</span>
            <span className="text-base font-semibold text-ink-muted">{ar ? drawer.nameEn : drawer.nameAr}</span>
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
        <div>
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
                          <span className="block text-[11.5px] text-ink-muted">
                            {v?.isGeneric ? t("no brand yet", "من غير ماركة") : item?.per ? <Ltr>{item.per}</Ltr> : null}
                            {v?.barcode ? <> · <Ltr>{v.barcode}</Ltr></> : null}
                            {v?.lastPrice ? <> · <Ltr>{Math.round(v.lastPrice).toLocaleString()} EGP</Ltr></> : null}
                            {v?.supplier ? <> · <Ltr>{v.supplier}</Ltr></> : null}
                          </span>
                          {drawer.tracked && ctx.canEdit && l.qty > 0 ? (
                            <button type="button" onClick={() => setMode({ use: l })} className="mt-1 inline-flex items-center gap-1 text-[12px] font-bold text-ink underline">
                              <UserRound size={12} /> {t("Used on a patient", "اتستخدم لمريض")}
                            </button>
                          ) : null}
                          {ctx.canStructure ? (
                            <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                              <button type="button" onClick={() => setEditing({ lineId: l.id, del: false })} className="inline-flex items-center gap-1 text-[12px] font-bold text-ink hover:underline">
                                <Pencil size={12} /> {t("Edit", "تعديل")}
                              </button>
                              <button type="button" onClick={() => (l.qty > 0 ? setEditing({ lineId: l.id, del: true }) : void removeFromDrawer(l))} className="inline-flex items-center gap-1 text-[12px] font-bold text-red-700 hover:underline">
                                <Trash2 size={12} /> {t("Delete", "مسح")}
                              </button>
                            </span>
                          ) : null}
                        </div>
                        {ctx.canEdit ? (
                          <div className="grid justify-items-end gap-0.5">
                            <Stepper value={draft[l.id] ?? l.qty} onChange={(n) => setDraft({ ...draft, [l.id]: n })} changed={draft[l.id] != null && draft[l.id] !== l.qty} />
                            <span className="text-[11px] text-ink-muted">{unitLabel(item?.unit || "box", draft[l.id] ?? l.qty, ar)}</span>
                          </div>
                        ) : (
                          <div className="text-end">
                            <b className="block font-display text-xl font-black leading-none text-ink">{l.qty}</b>
                            <span className="text-[11px] text-ink-muted">{unitLabel(item?.unit || "box", l.qty, ar)}</span>
                          </div>
                        )}
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
        <EditLineSheet ctx={ctx} drawer={drawer} line={lines.find((l) => l.id === editing.lineId) as StockLine} startOnDelete={editing.del} onClose={() => setEditing(null)} />
      ) : null}

      {changedCount > 0 ? (
        <div className="sticky bottom-24 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-ink-slab p-3 text-white shadow-lg lg:bottom-4">
          <span className="text-sm">
            <b className="font-display text-lg">{changedCount}</b> {t("changed in this drawer", "اتغير في الدرج ده")}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setDraft({})} className="rounded-xl border border-white/20 px-3 py-2 font-display text-[13px] font-bold text-white/85">
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
        <Btn kind="dark" busy={busy} onClick={() => run(async () => { ctx.setSnap(await stockApi.saveDrawer({ id: drawer.id, roomCode: drawer.roomCode, roomEn: drawer.roomEn, roomAr: drawer.roomAr, cabinetLetter: drawer.cabinetLetter, cabinetWhere: where, number: drawer.number, nameEn, nameAr, tracked })); onDone(); toast(t("Saved.", "اتحفظ.")); }, (m) => toast(m, "error"))}>{t("Save", "حفظ")}</Btn>
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
      const r = await stockApi.addItem({ nameEn, nameAr: nameAr || nameEn, unit, per, drawerId: drawer.id, qty, tracked: drawer.tracked });
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
                <span className="text-[10.5px] text-ink-muted">{have.has(c.key) ? t("in cupboard", "في الدولاب") : ar ? c.en : c.ar}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("Name (English)", "الاسم بالإنجليزي")}><input value={nameEn} onChange={(e) => setNameEn(e.target.value)} className={inputCls} /></Field>
          <Field label={t("Name (Arabic)", "الاسم بالعربي")}><input value={nameAr} onChange={(e) => setNameAr(e.target.value)} className={inputCls} dir="rtl" /></Field>
          <Field label={t("Count unit", "وحدة العدّ")}>
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls}>
              {["box", "syringe", "bottle", "pack", "jar", "bag", "cartridge", "piece", "vial", "set", "roll", "can", "tube", "kit", "strip"].map((u) => <option key={u} value={u}>{unitLabel(u, 1, ar)}</option>)}
            </select>
          </Field>
          <Field label={t("What one unit holds", "الوحدة فيها إيه")}><input value={per} onChange={(e) => setPer(e.target.value)} className={inputCls} placeholder="50 pcs" /></Field>
          <Field label={t("How many now", "كام دلوقتي")}><input type="number" min={0} value={qty} onChange={(e) => setQty(Math.max(0, Number(e.target.value) || 0))} className={inputCls} /></Field>
          <div className="self-end"><PhotoButton label={photo ? t("Photo attached ✓", "الصورة اتضافت ✓") : t("Photo", "صورة")} onFile={setPhoto} /></div>
          <div className="flex gap-2 sm:col-span-2">
            <Btn kind="dark" busy={busy} disabled={!nameEn.trim()} onClick={addOwn}>{t("Add", "ضيف")}</Btn>
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
  const [itemId, setItemId] = useState(itemIds[0] || "");
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
            {itemIds.map((id) => { const it = ctx.items.get(id); return <option key={id} value={id}>{it ? (ar ? it.nameAr : it.nameEn) : id}</option>; })}
          </select>
        </Field>
        <Field label={t("Brand", "الماركة")}><input value={brand} onChange={(e) => setBrand(e.target.value)} className={inputCls} placeholder="3M" /></Field>
        <Field label={t("Product", "المنتج")}><input value={product} onChange={(e) => setProduct(e.target.value)} className={inputCls} placeholder="Filtek Z350" /></Field>
        <Field label={t("Shade / size", "اللون / المقاس")}><input value={spec} onChange={(e) => setSpec(e.target.value)} className={inputCls} placeholder="A2" /></Field>
        <Field label={t("Barcode (optional)", "الباركود (اختياري)")}><input value={barcode} onChange={(e) => setBarcode(e.target.value)} className={inputCls} inputMode="numeric" /></Field>
        <Field label={t("How many here now", "كام هنا دلوقتي")}><input type="number" min={0} value={qty} onChange={(e) => setQty(Math.max(0, Number(e.target.value) || 0))} className={inputCls} /></Field>
      </div>
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
