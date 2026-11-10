"use client";

import { useState } from "react";
import { ArrowRightLeft, Trash2 } from "lucide-react";
import { UNIT_NAMES, unitLabel } from "@/lib/stock/catalog";
import { stockApi } from "@/lib/stock/api";
import type { StockDrawer, StockLine } from "@/lib/stock/types";
import { Btn, Eyebrow, Field, LinePicture, Ltr, Reveal, Sheet, inputCls, useBusy, variantLabel, type StockCtx } from "./shared";

/**
 * Everything that can be changed about one row of a drawer, in one place: what the item is
 * called, what the brand is, which drawer it lives in, and whether it lives here at all.
 *
 * Renaming the item renames it in every drawer, because it is one item; the sheet says so.
 * Deleting a row that still holds stock asks first and says what it means: those units will
 * read as used at the next count.
 */
export function EditLineSheet({ ctx, line, drawer, startOnDelete = false, onClose }: { ctx: StockCtx; line: StockLine; drawer: StockDrawer; startOnDelete?: boolean; onClose: () => void }) {
  const { snap, t, ar, toast } = ctx;
  const { busy, run } = useBusy();
  const item = ctx.items.get(line.itemId);
  const variant = ctx.variants.get(line.variantId);
  const generic = variant?.isGeneric !== false;

  const [nameEn, setNameEn] = useState(item?.nameEn || "");
  const [nameAr, setNameAr] = useState(item?.nameAr || "");
  const [unit, setUnit] = useState<string>(item?.unit || "box");
  const [per, setPer] = useState(item?.per || "");

  const [brand, setBrand] = useState(generic ? "" : variant?.brand || "");
  const [product, setProduct] = useState(generic ? "" : variant?.product || "");
  const [spec, setSpec] = useState(variant?.spec || "");
  const [barcode, setBarcode] = useState(variant?.barcode || "");
  const [supplier, setSupplier] = useState(variant?.supplier || "");
  const [price, setPrice] = useState(variant?.lastPrice ? String(variant.lastPrice) : "");

  const otherDrawers = snap.drawers.filter((d) => d.id !== drawer.id);
  const [toDrawer, setToDrawer] = useState(otherDrawers[0]?.id || "");
  const [confirmDelete, setConfirmDelete] = useState(startOnDelete);

  const itemChanged = !!item && (nameEn.trim() !== item.nameEn || nameAr.trim() !== item.nameAr || unit !== item.unit || per.trim() !== item.per);
  const variantChanged =
    !!variant &&
    (brand.trim() !== (generic ? "" : variant.brand) ||
      product.trim() !== (generic ? "" : variant.product) ||
      spec.trim() !== variant.spec ||
      barcode.trim() !== (variant.barcode || "") ||
      supplier.trim() !== (variant.supplier || "") ||
      (Number(price) || 0) !== (variant.lastPrice || 0));
  const drawersUsingItem = new Set(snap.lines.filter((l) => l.itemId === line.itemId).map((l) => l.drawerId)).size;

  const save = () =>
    run(async () => {
      if (!nameEn.trim() && !nameAr.trim()) throw new Error(t("The item needs a name.", "الصنف محتاج اسم."));
      let latest = snap;
      if (itemChanged && item) latest = await stockApi.updateItem(item.id, { nameEn: nameEn.trim() || nameAr.trim(), nameAr: nameAr.trim() || nameEn.trim(), unit, per: per.trim() });
      if (variantChanged && variant) {
        if (!generic && !brand.trim()) throw new Error(t("A brand needs a name.", "الماركة محتاجة اسم."));
        latest = await stockApi.updateVariant(variant.id, { brand: brand.trim(), product: product.trim(), spec: spec.trim(), barcode: barcode.trim(), supplier: supplier.trim(), lastPrice: Number(price) || 0 });
      }
      ctx.setSnap(latest);
      toast(t("Saved.", "اتحفظ."));
      onClose();
    }, (m) => toast(m, "error"));

  const move = () =>
    run(async () => {
      ctx.setSnap(await stockApi.moveLine(line.id, toDrawer));
      toast(t(`Moved to ${ctx.drawers.get(toDrawer)?.code}.`, `اتنقل لـ ${ctx.drawers.get(toDrawer)?.code}.`));
      onClose();
    }, (m) => toast(m, "error"));

  const remove = () =>
    run(async () => {
      ctx.setSnap(await stockApi.removeLine(line.id, line.qty > 0));
      toast(t("Deleted from this drawer.", "اتمسح من الدرج."));
      onClose();
    }, (m) => toast(m, "error"));

  return (
    <Sheet title={t("Edit", "تعديل")} onClose={onClose} dir={ar ? "rtl" : "ltr"}>
      <div className="flex items-center gap-3">
        <div className="h-14 w-[72px] shrink-0 overflow-hidden rounded-lg border border-line bg-surface-subtle">
          <LinePicture variant={variant} item={item} />
        </div>
        <div className="min-w-0">
          <b className="block text-[15px] font-bold text-ink">{item ? (ar ? item.nameAr : item.nameEn) : ""}</b>
          <span className="block text-[12px] text-ink-muted">
            {generic ? t("no brand yet", "من غير ماركة") : <Ltr>{variantLabel(variant, item, ar)}</Ltr>} · <Ltr>{drawer.code}</Ltr> · <Ltr>{line.qty}</Ltr> {unitLabel(item?.unit || "box", line.qty, ar)}
          </span>
        </div>
      </div>

      <section className="grid gap-3">
        <Eyebrow>{t("The item", "الصنف")}</Eyebrow>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("Name (Arabic)", "الاسم بالعربي")}><input id="stock-edit-name-ar" value={nameAr} onChange={(e) => setNameAr(e.target.value)} className={inputCls} dir="rtl" /></Field>
          <Field label={t("Name (English)", "الاسم بالإنجليزي")}><input id="stock-edit-name-en" value={nameEn} onChange={(e) => setNameEn(e.target.value)} className={inputCls} dir="ltr" /></Field>
          <Field label={t("Count unit", "وحدة العدّ")}>
            <select id="stock-edit-unit" value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls}>
              {Object.keys(UNIT_NAMES).map((u) => <option key={u} value={u}>{unitLabel(u, 1, ar)}</option>)}
            </select>
          </Field>
          <Field label={t("What one unit holds", "الوحدة فيها إيه")}><input id="stock-edit-per" value={per} onChange={(e) => setPer(e.target.value)} className={inputCls} dir="ltr" placeholder="50 pcs" /></Field>
        </div>
        {drawersUsingItem > 1 ? <p className="text-[12px] text-ink-muted">{t(`This item sits in ${drawersUsingItem} drawers. Its name and unit change in all of them.`, `الصنف ده موجود في ${drawersUsingItem} أدراج. اسمه ووحدته هيتغيروا فيهم كلهم.`)}</p> : null}
      </section>

      <section className="grid gap-3">
        <Eyebrow>{generic ? t("Brand (none yet)", "الماركة (لسه مفيش)") : t("The brand", "الماركة")}</Eyebrow>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("Brand", "الماركة")}><input id="stock-edit-brand" value={brand} onChange={(e) => setBrand(e.target.value)} className={inputCls} dir="ltr" placeholder="3M" /></Field>
          <Field label={t("Product", "المنتج")}><input id="stock-edit-product" value={product} onChange={(e) => setProduct(e.target.value)} className={inputCls} dir="ltr" placeholder="Filtek Z350" /></Field>
          <Field label={t("Shade / size", "اللون / المقاس")}><input id="stock-edit-spec" value={spec} onChange={(e) => setSpec(e.target.value)} className={inputCls} dir="ltr" placeholder="A2" /></Field>
          <Field label={t("Barcode", "الباركود")}><input id="stock-edit-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} className={inputCls} dir="ltr" inputMode="numeric" /></Field>
          <Field label={t("Supplier", "المورّد")}>
            <input id="stock-edit-supplier" list="stock-edit-suppliers" value={supplier} onChange={(e) => setSupplier(e.target.value)} className={inputCls} />
            <datalist id="stock-edit-suppliers">{snap.suppliers.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
          <Field label={`${t("Price per", "السعر لكل")} ${unitLabel(unit, 1, ar)} (EGP)`}><input id="stock-edit-price" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} dir="ltr" /></Field>
        </div>
        {generic ? <p className="text-[12px] text-ink-muted">{t("Type a brand name to turn this row into that brand. Leave it empty to keep it without a brand.", "اكتب اسم الماركة عشان السطر ده يبقى الماركة دي. سيبه فاضي لو مش عايز ماركة.")}</p> : null}
      </section>

      <div className="flex flex-wrap gap-2">
        <Btn kind="dark" busy={busy} disabled={!itemChanged && !variantChanged} onClick={save}>{t("Save changes", "احفظ التعديلات")}</Btn>
        <Btn onClick={onClose}>{t("Cancel", "إلغاء")}</Btn>
      </div>

      {otherDrawers.length ? (
        <section className="grid gap-2 border-t border-line pt-4">
          <Eyebrow>{t("Move to another drawer", "انقل لدرج تاني")}</Eyebrow>
          <div className="flex flex-wrap gap-2">
            <select id="stock-edit-move" value={toDrawer} onChange={(e) => setToDrawer(e.target.value)} className={`${inputCls} min-w-0 flex-1`}>
              {otherDrawers.map((d) => <option key={d.id} value={d.id}>{d.code} · {ar ? d.nameAr : d.nameEn}</option>)}
            </select>
            <Btn busy={busy} disabled={!toDrawer} onClick={move}><ArrowRightLeft size={14} /> {t("Move", "انقل")}</Btn>
          </div>
          <p className="text-[12px] text-ink-muted">{t("It goes with what is on it. Moving is not usage.", "بيتنقل بالكمية اللي عليه. النقل مش استهلاك.")}</p>
        </section>
      ) : null}

      <section className="grid gap-2 border-t border-line pt-4">
        {!confirmDelete ? (
          <button type="button" onClick={() => (line.qty > 0 ? setConfirmDelete(true) : void remove())} disabled={busy} className="inline-flex items-center gap-2 justify-self-start rounded-xl border border-red-200 px-4 py-2.5 font-display text-[13px] font-bold text-red-700 hover:bg-red-50 disabled:opacity-40">
            <Trash2 size={14} /> {t("Delete from this drawer", "امسح من الدرج ده")}
          </button>
        ) : (
          <Reveal>
          <div className="grid gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-900">
            <p>
              {t(
                `This row still has ${line.qty} ${unitLabel(item?.unit || "box", line.qty, false)}. Deleting it writes them off: they will count as used, and the delete is recorded under your name.`,
                `السطر ده لسه عليه ${line.qty} ${unitLabel(item?.unit || "box", line.qty, true)}. لو مسحته هيتحسبوا مستهلكين، والمسح هيتسجل باسمك.`
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void remove()} disabled={busy} className="rounded-xl bg-red-700 px-4 py-2 font-display text-[13px] font-bold text-white disabled:opacity-40">{t("Yes, delete", "أيوه، امسح")}</button>
              <Btn onClick={() => setConfirmDelete(false)}>{t("Keep it", "خلّيه")}</Btn>
            </div>
          </div>
          </Reveal>
        )}
      </section>
    </Sheet>
  );
}
