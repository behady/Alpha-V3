"use client";

import { useEffect, useRef, useState } from "react";
import { Barcode, Check, ScanLine, Trash2 } from "lucide-react";
import { CATALOG_BY_KEY, unitLabel } from "@/lib/stock/catalog";
import { stockApi, uploadStockPhoto } from "@/lib/stock/api";
import type { LibraryProduct, StockVariant } from "@/lib/stock/types";
import { StockPicture } from "./Art";
import { Btn, Card, Eyebrow, Field, LinePicture, PhotoButton, Pill, Stepper, fmtMoney, inputCls, useBusy, variantLabel, type StockCtx } from "./shared";

type Line = {
  key: string;
  variantId: string | null;
  newVariant: { itemId: string; brand: string; product: string; spec: string; barcode: string | null; photoUrl: string | null } | null;
  drawerId: string;
  qty: number;
  price: number;
  tag: "known" | "library" | "new" | "manual";
};

/**
 * A delivery. Scan a barcode: known to the clinic → a line; known to the platform → a line with
 * the photo and name already there; unknown → one form, once, for everyone. Receive posts the
 * Supplies expense and adds the quantities to the drawers.
 */
export function DeliveryView({ ctx }: { ctx: StockCtx }) {
  const { snap, t, ar, toast } = ctx;
  const { busy, run } = useBusy();
  const [supplier, setSupplier] = useState(snap.suppliers[0] || "");
  const [date, setDate] = useState(ctx.today);
  const [invoice, setInvoice] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [scanning, setScanning] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [pending, setPending] = useState<null | { barcode: string | null; library: LibraryProduct | null }>(null);
  const [addManual, setAddManual] = useState(false);
  const [done, setDone] = useState<null | { total: number }>(null);

  if (!ctx.canEdit) return <Card className="p-6 text-sm text-ink-body">{t("Receiving a delivery needs the “edit inventory” permission.", "استلام التوريد محتاج صلاحية تعديل المخزون.")}</Card>;

  const defaultDrawerFor = (itemId: string, variantId?: string): string => {
    const byVariant = variantId ? snap.lines.find((l) => l.variantId === variantId) : null;
    if (byVariant) return byVariant.drawerId;
    const store = snap.lines.find((l) => l.itemId === itemId && ctx.drawers.get(l.drawerId)?.roomCode === "SR");
    if (store) return store.drawerId;
    const any = snap.lines.find((l) => l.itemId === itemId);
    return any?.drawerId || snap.drawers[0]?.id || "";
  };

  const onCode = async (code: string) => {
    const barcode = code.replace(/\s+/g, "");
    if (!barcode) return;
    await run(async () => {
      const r = await stockApi.lookupBarcode(barcode);
      if (r.variant) {
        const v = r.variant;
        setLines((ls) => {
          const existing = ls.find((l) => l.variantId === v.id);
          if (existing) return ls.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l));
          return [...ls, { key: `${Date.now()}`, variantId: v.id, newVariant: null, drawerId: defaultDrawerFor(v.itemId, v.id), qty: 1, price: v.lastPrice || 0, tag: "known" }];
        });
        toast(t(`${v.brand} ${v.product} recognised.`, `اتعرف على ${v.brand} ${v.product}.`));
      } else {
        setPending({ barcode, library: r.library });
        toast(r.library ? t("Known on the platform, new to this clinic. Photo and name came with the barcode.", "معروف على المنصة، جديد على العيادة. الصورة والاسم جم مع الباركود.") : t("Barcode not on the platform yet. One photo and a name, once, for everyone.", "الباركود مش على المنصة لسه. صورة واسم مرة واحدة، للكل."));
      }
    }, (m) => toast(m, "error"));
  };

  const receive = () =>
    run(async () => {
      const r = await stockApi.receiveDelivery({
        date,
        supplier,
        invoiceUrl: invoice,
        lines: lines.map((l) => ({ variantId: l.variantId, newVariant: l.newVariant, drawerId: l.drawerId, qty: l.qty, price: l.price })),
      });
      ctx.setSnap(r.snapshot);
      setDone({ total: r.total });
      setLines([]);
      setInvoice(null);
      toast(t(`Received. Supplies expense of ${fmtMoney(r.total)} EGP posted to Finance.`, `اتستلم. مصروف مستلزمات ${fmtMoney(r.total)} جنيه اتسجل في المالية.`));
    }, (m) => toast(m, "error"));

  const total = lines.reduce((a, l) => a + l.qty * l.price, 0);

  if (done) {
    return (
      <Card className="grid gap-3 p-6">
        <Eyebrow>{t("Delivery", "توريد")}</Eyebrow>
        <h2 className="font-display text-2xl font-bold text-ink">{t("Received.", "اتستلم.")}</h2>
        <p className="text-sm text-ink-body">{t(`Stock is up in the drawers you chose. ${fmtMoney(done.total)} EGP is in Finance under Supplies, dated ${date}.`, `المخزون زاد في الأدراج اللي اخترتها. ${fmtMoney(done.total)} جنيه في المالية تحت مستلزمات بتاريخ ${date}.`)}</p>
        <div className="flex gap-2">
          <Btn kind="dark" onClick={() => setDone(null)}>{t("Another delivery", "توريد تاني")}</Btn>
          <Btn onClick={() => ctx.go({ tab: "cupboard", drawer: null })}>{t("Back to the cupboard", "ارجع للدولاب")}</Btn>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <div>
        <Eyebrow>{t("Delivery", "توريد")}</Eyebrow>
        <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink">{t("A box arrived. Scan it.", "وصلت علبة. امسحها.")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-body">{t("Each barcode becomes a line with the product photo. When you press Receive, stock goes up and a Supplies expense posts to Finance.", "كل باركود بيبقى سطر بصورة المنتج. لما تدوس استلام، المخزون بيزيد ومصروف مستلزمات بيتسجل في المالية.")}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card className="grid content-start gap-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Supplier", "المورّد")}>
              <input list="stock-suppliers" value={supplier} onChange={(e) => setSupplier(e.target.value)} className={inputCls} />
              <datalist id="stock-suppliers">{snap.suppliers.map((s) => <option key={s} value={s} />)}</datalist>
            </Field>
            <Field label={t("Date", "التاريخ")}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
          </div>
          <div className="flex items-center gap-2">
            <PhotoButton label={invoice ? t("Invoice attached ✓", "الفاتورة اتضافت ✓") : t("Photograph the invoice", "صوّر الفاتورة")} busy={busy} onFile={(f) => run(async () => { setInvoice(await uploadStockPhoto("invoice", date.replace(/-/g, ""), f)); }, (m) => toast(m, "error"))} />
          </div>
          <div className="grid gap-3 rounded-2xl border border-dashed border-line bg-surface-subtle p-3">
            {scanning ? (
              <Scanner onCode={(c) => { setScanning(false); void onCode(c); }} onClose={() => setScanning(false)} unsupported={t("This phone's browser cannot read barcodes live. Type the number under the barcode instead.", "متصفح الموبايل ده مش بيقرأ الباركود مباشرة. اكتب الرقم اللي تحت الباركود.")} />
            ) : (
              <Btn kind="dark" onClick={() => setScanning(true)} className="justify-self-center"><ScanLine size={16} /> {t("Scan barcode", "امسح الباركود")}</Btn>
            )}
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void onCode(manualCode); setManualCode(""); }}>
              <input value={manualCode} onChange={(e) => setManualCode(e.target.value)} inputMode="numeric" placeholder={t("or type the barcode number", "أو اكتب رقم الباركود")} className={inputCls} />
              <Btn type="submit" busy={busy} disabled={!manualCode.trim()}><Barcode size={15} /></Btn>
            </form>
          </div>
          <button type="button" onClick={() => setAddManual(true)} className="text-start text-[12.5px] font-bold text-ink underline">{t("Add a line without a barcode", "ضيف سطر من غير باركود")}</button>
        </Card>

        <Card className="grid content-start gap-3 p-4">
          <h3 className="font-display text-[15px] font-bold text-ink">{t("Lines", "السطور")}</h3>
          {!lines.length ? <p className="text-sm text-ink-muted">{t("Nothing scanned yet.", "لسه مفيش حاجة اتمسحت.")}</p> : null}
          {lines.map((l) => {
            const v = l.variantId ? ctx.variants.get(l.variantId) : undefined;
            const itemId = v?.itemId || l.newVariant?.itemId || "";
            const item = ctx.items.get(itemId);
            return (
              <div key={l.key} className="grid grid-cols-[56px_1fr] gap-3 rounded-xl border border-line p-2 sm:grid-cols-[56px_1fr_auto]">
                <div className="h-11 w-14 overflow-hidden rounded-lg border border-line bg-surface-subtle">
                  {v ? <LinePicture variant={v} item={item} /> : <StockPicture photoUrl={l.newVariant?.photoUrl} shape={item?.shape || "box"} brand={l.newVariant?.brand} product={l.newVariant?.product} spec={l.newVariant?.spec} />}
                </div>
                <div className="min-w-0">
                  <b className="block truncate text-[13.5px] font-semibold text-ink">
                    {v ? variantLabel(v, item, ar) : [l.newVariant?.brand, l.newVariant?.product, l.newVariant?.spec].filter(Boolean).join(" · ")}{" "}
                    {l.tag === "library" ? <Pill>{t("new to clinic", "جديد على العيادة")}</Pill> : l.tag === "new" ? <Pill>{t("new product", "منتج جديد")}</Pill> : null}
                  </b>
                  <span className="block text-[11.5px] text-ink-muted">{item ? (ar ? item.nameAr : item.nameEn) : ""} · {item?.per}</span>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <select value={l.drawerId} onChange={(e) => setLines(lines.map((x) => (x === l ? { ...x, drawerId: e.target.value } : x)))} className="rounded-lg border border-line bg-surface px-2 py-1 text-[12px]">
                      {snap.drawers.map((d) => <option key={d.id} value={d.id}>{d.code} · {ar ? d.nameAr : d.nameEn}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-[12px] text-ink-muted">
                      <input type="number" min={0} value={l.price} onChange={(e) => setLines(lines.map((x) => (x === l ? { ...x, price: Math.max(0, Number(e.target.value) || 0) } : x)))} className="w-24 rounded-lg border border-line bg-surface px-2 py-1 text-[12px] text-ink" />
                      EGP / {unitLabel(item?.unit || "box", 1, ar)}
                    </label>
                    <button type="button" onClick={() => setLines(lines.filter((x) => x !== l))} className="ms-auto text-ink-muted hover:text-red-600" aria-label={t("Remove", "شيل")}><Trash2 size={15} /></button>
                  </div>
                </div>
                <div className="sm:self-center"><Stepper value={l.qty} min={1} onChange={(n) => setLines(lines.map((x) => (x === l ? { ...x, qty: n } : x)))} /></div>
              </div>
            );
          })}

          {pending ? (
            <NewProductForm
              ctx={ctx}
              barcode={pending.barcode}
              library={pending.library}
              onCancel={() => setPending(null)}
              onAdd={(nv, drawerId, price) => {
                setLines([...lines, { key: `${Date.now()}`, variantId: null, newVariant: nv, drawerId, qty: 1, price, tag: pending.library ? "library" : "new" }]);
                setPending(null);
              }}
            />
          ) : null}
          {addManual ? (
            <ManualLine
              ctx={ctx}
              onCancel={() => setAddManual(false)}
              onPick={(v, drawerId) => { setLines([...lines, { key: `${Date.now()}`, variantId: v.id, newVariant: null, drawerId, qty: 1, price: v.lastPrice || 0, tag: "manual" }]); setAddManual(false); }}
              onNew={(itemId) => { setPending({ barcode: null, library: null }); setAddManual(false); void itemId; }}
            />
          ) : null}

          <div className="flex items-baseline justify-between border-t border-line pt-3">
            <span className="text-sm text-ink-muted">{t("Total", "الإجمالي")} · {lines.length} {t("lines", "سطر")}</span>
            <b className="font-display text-xl font-black text-ink">{fmtMoney(total)} EGP</b>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12px] text-ink-muted">{t("Posts to Finance as", "بيتسجل في المالية كـ")} <b>{t("Supplies", "مستلزمات")}</b> · {supplier || "—"}</span>
            <Btn kind="yellow" busy={busy} disabled={!lines.length} onClick={receive}><Check size={15} /> {t("Receive delivery", "استلام التوريد")}</Btn>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** Live barcode reading with the camera, where the browser supports it. */
function Scanner({ onCode, onClose, unsupported }: { onCode: (code: string) => void; onClose: () => void; unsupported: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  type Detector = { detect: (src: ImageBitmapSource) => Promise<Array<{ rawValue: string }>> };
  type DetectorCtor = new (opts?: { formats?: string[] }) => Detector;
  const Ctor = typeof window !== "undefined" ? (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector : undefined;
  const [error, setError] = useState(Ctor ? "" : unsupported);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    if (!Ctor) return;
    const detector = new Ctor({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped) return;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(v);
            const hit = codes.find((c) => c.rawValue);
            if (hit) {
              stopped = true;
              onCode(hit.rawValue);
              return;
            }
          } catch {
            /* a frame that could not be read */
          }
          timer = window.setTimeout(tick, 250);
        };
        timer = window.setTimeout(tick, 400);
      } catch {
        setError("Camera not available.");
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [onCode, Ctor]);
  return (
    <div className="grid gap-2">
      <div className="relative mx-auto aspect-[4/3] w-full max-w-[320px] overflow-hidden rounded-xl bg-ink-slab">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-[16%_12%] rounded-lg border-2 border-white/60" />
        {error ? <p className="absolute inset-x-3 bottom-3 rounded-lg bg-black/70 p-2 text-center text-[12px] text-white">{error}</p> : null}
      </div>
      <Btn onClick={onClose} className="justify-self-center">{"Close"}</Btn>
    </div>
  );
}

/** Unknown or library barcode: the one-time naming. */
function NewProductForm({ ctx, barcode, library, onCancel, onAdd }: { ctx: StockCtx; barcode: string | null; library: LibraryProduct | null; onCancel: () => void; onAdd: (nv: Line["newVariant"] & object, drawerId: string, price: number) => void }) {
  const { snap, t, ar, toast } = ctx;
  const { busy, run } = useBusy();
  const guessedItem = library?.catalogKey ? snap.items.find((i) => i.catalogKey === library.catalogKey) : undefined;
  const [itemId, setItemId] = useState(guessedItem?.id || snap.items[0]?.id || "");
  const [brand, setBrand] = useState(library?.brand || "");
  const [product, setProduct] = useState(library?.product || "");
  const [spec, setSpec] = useState(library?.spec || "");
  const [price, setPrice] = useState(0);
  const [photoUrl, setPhotoUrl] = useState<string | null>(library?.photoUrl || null);
  const item = ctx.items.get(itemId);
  const [drawerId, setDrawerId] = useState(() => snap.lines.find((l) => l.itemId === itemId)?.drawerId || snap.drawers[0]?.id || "");
  return (
    <div className="grid gap-3 rounded-2xl border border-[#FACC15] p-3">
      <Eyebrow>{barcode ? `${t("Barcode", "باركود")} ${barcode}` : t("New product", "منتج جديد")} · {library ? t("known on the platform", "معروف على المنصة") : t("tell the platform once", "عرّف المنصة مرة واحدة")}</Eyebrow>
      <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
        <div className="grid gap-2">
          <div className="h-[90px] w-full overflow-hidden rounded-xl border border-line bg-surface-subtle">
            <StockPicture photoUrl={photoUrl} shape={item?.shape || "box"} brand={brand} product={product} spec={spec} />
          </div>
          <PhotoButton compact busy={busy} label={photoUrl ? t("Retake", "صوّر تاني") : t("Photo of the box", "صورة العلبة")} onFile={(f) => run(async () => { setPhotoUrl(await uploadStockPhoto("variant", barcode || `new-${Date.now()}`, f)); }, (m) => toast(m, "error"))} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label={t("Which item is it?", "ده أي صنف؟")}>
            <select value={itemId} onChange={(e) => { setItemId(e.target.value); const d = snap.lines.find((l) => l.itemId === e.target.value)?.drawerId; if (d) setDrawerId(d); }} className={inputCls}>
              {snap.items.map((i) => <option key={i.id} value={i.id}>{ar ? i.nameAr : i.nameEn} · {ar ? i.nameEn : i.nameAr}</option>)}
            </select>
          </Field>
          <Field label={t("Brand", "الماركة")}><input value={brand} onChange={(e) => setBrand(e.target.value)} className={inputCls} placeholder="3M" /></Field>
          <Field label={t("Product", "المنتج")}><input value={product} onChange={(e) => setProduct(e.target.value)} className={inputCls} placeholder={item ? CATALOG_BY_KEY[item.catalogKey || ""]?.en || item.nameEn : ""} /></Field>
          <Field label={t("Shade / size", "اللون / المقاس")}><input value={spec} onChange={(e) => setSpec(e.target.value)} className={inputCls} placeholder="A2" /></Field>
          <Field label={`${t("Price per", "السعر لكل")} ${unitLabel(item?.unit || "box", 1, ar)} (EGP)`}><input type="number" min={0} value={price || ""} onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))} className={inputCls} /></Field>
          <Field label={t("Into drawer", "في درج")}>
            <select value={drawerId} onChange={(e) => setDrawerId(e.target.value)} className={inputCls}>{snap.drawers.map((d) => <option key={d.id} value={d.id}>{d.code} · {ar ? d.nameAr : d.nameEn}</option>)}</select>
          </Field>
        </div>
      </div>
      <div className="flex gap-2">
        <Btn kind="yellow" disabled={!itemId || !brand.trim() || !drawerId} onClick={() => onAdd({ itemId, brand: brand.trim(), product: product.trim(), spec: spec.trim(), barcode, photoUrl }, drawerId, price)}>{t("Add product", "ضيف المنتج")}</Btn>
        <Btn onClick={onCancel}>{t("Cancel", "إلغاء")}</Btn>
      </div>
    </div>
  );
}

/** A line for a brand the clinic already has, or a jump to the new-product form. */
function ManualLine({ ctx, onCancel, onPick, onNew }: { ctx: StockCtx; onCancel: () => void; onPick: (v: StockVariant, drawerId: string) => void; onNew: (itemId: string) => void }) {
  const { snap, t, ar } = ctx;
  const [itemId, setItemId] = useState(snap.items[0]?.id || "");
  const variants = snap.variants.filter((v) => v.itemId === itemId && !v.isGeneric);
  const generic = snap.variants.find((v) => v.itemId === itemId && v.isGeneric);
  const drawerFor = (vid?: string) => snap.lines.find((l) => (vid ? l.variantId === vid : l.itemId === itemId))?.drawerId || snap.drawers[0]?.id || "";
  return (
    <div className="grid gap-3 rounded-2xl border border-line p-3">
      <Eyebrow>{t("Add a line", "ضيف سطر")}</Eyebrow>
      <Field label={t("Item", "الصنف")}>
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={inputCls}>{snap.items.map((i) => <option key={i.id} value={i.id}>{ar ? i.nameAr : i.nameEn}</option>)}</select>
      </Field>
      <div className="flex flex-wrap gap-2">
        {variants.map((v) => <Btn key={v.id} onClick={() => onPick(v, drawerFor(v.id))}>{variantLabel(v, ctx.items.get(itemId), ar)}</Btn>)}
        {generic ? <Btn onClick={() => onPick(generic, drawerFor(generic.id))}>{t("No brand (generic)", "من غير ماركة")}</Btn> : null}
        <Btn kind="dark" onClick={() => onNew(itemId)}>{t("New brand…", "ماركة جديدة…")}</Btn>
        <Btn onClick={onCancel}>{t("Cancel", "إلغاء")}</Btn>
      </div>
    </div>
  );
}
