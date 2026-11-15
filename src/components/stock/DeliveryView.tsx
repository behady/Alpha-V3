"use client";

import { useEffect, useRef, useState } from "react";
import { Barcode, Check, Plus, ScanLine, Trash2 } from "lucide-react";
import { CATALOG_BY_KEY, unitLabel } from "@/lib/stock/catalog";
import { stockApi, uploadStockPhoto } from "@/lib/stock/api";
import { normaliseBarcode } from "@/lib/stock/math";
import { deliveryWarnings } from "@/lib/stock/input";
import type { LibraryProduct, StockVariant } from "@/lib/stock/types";
import { StockPicture } from "./Art";
import { Btn, Card, Eyebrow, Field, LinePicture, Ltr, NumberBox, PhotoButton, Pill, Reveal, Stepper, fmtMoney, inputCls, useBusy, variantLabel, type StockCtx } from "./shared";

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
 *
 * Receiving cannot be taken back, so it is two presses: the first reads the delivery back (how
 * many, from whom, how much, and any line left without a price), the second does it.
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
  const [pending, setPending] = useState<null | { barcode: string | null; library: LibraryProduct | null; itemId?: string }>(null);
  const [addManual, setAddManual] = useState(false);
  const [done, setDone] = useState<null | { total: number }>(null);
  const [confirming, setConfirming] = useState(false);

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
    const barcode = normaliseBarcode(code);
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
      setConfirming(false);
      setLines([]);
      setInvoice(null);
      toast(t(`Received. Supplies expense of ${fmtMoney(r.total)} EGP posted to Finance.`, `اتستلم. مصروف مستلزمات ${fmtMoney(r.total)} جنيه اتسجل في المالية.`));
    }, (m) => toast(m, "error"));

  const check = deliveryWarnings(lines, supplier);
  const total = check.total;

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
              <Scanner onCode={(c) => { setScanning(false); void onCode(c); }} onClose={() => setScanning(false)} closeLabel={t("Close", "إغلاق")} noCamera={t("The camera could not be opened. Allow camera access for this site, or type the number printed under the barcode.", "الكاميرا مش بتفتح. اسمح للموقع بالكاميرا، أو اكتب الرقم المطبوع تحت الباركود.")} />
            ) : (
              <Btn kind="dark" onClick={() => setScanning(true)} className="justify-self-center"><ScanLine size={16} /> {t("Scan barcode", "امسح الباركود")}</Btn>
            )}
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void onCode(manualCode); setManualCode(""); }}>
              <input value={manualCode} onChange={(e) => setManualCode(e.target.value)} inputMode="numeric" placeholder={t("or type the barcode number", "أو اكتب رقم الباركود")} className={inputCls} />
              <Btn type="submit" busy={busy} disabled={!manualCode.trim()}><Barcode size={15} /></Btn>
            </form>
          </div>
          <Btn onClick={() => setAddManual(true)} className="justify-self-start"><Plus size={14} /> {t("Add a line without a barcode", "ضيف سطر من غير باركود")}</Btn>
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
                  <span className="block text-[12.5px] text-ink-muted">{item ? (ar ? item.nameAr : item.nameEn) : ""}{item?.per ? <> · <Ltr>{item.per}</Ltr></> : null}</span>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <select value={l.drawerId} onChange={(e) => setLines(lines.map((x) => (x === l ? { ...x, drawerId: e.target.value } : x)))} className="rounded-lg border border-line bg-surface px-2 py-1 text-[12px]">
                      {snap.drawers.map((d) => <option key={d.id} value={d.id}>{d.code} · {ar ? d.nameAr : d.nameEn}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-[12px] text-ink-muted">
                      <NumberBox decimal blankZero placeholder="0" label={t("Price", "السعر")} value={l.price} onChange={(n) => setLines(lines.map((x) => (x === l ? { ...x, price: n } : x)))} className={`w-24 rounded-lg border bg-surface px-2 py-1 text-[12px] text-ink ${l.price > 0 ? "border-line" : "border-red-300"}`} />
                      {t("EGP", "جنيه")} / {unitLabel(item?.unit || "box", 1, ar)}
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
              initialItemId={pending.itemId}
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
              onNew={(itemId) => { setPending({ barcode: null, library: null, itemId }); setAddManual(false); }}
            />
          ) : null}

          <div className="flex items-baseline justify-between border-t border-line pt-3">
            <span className="text-sm text-ink-muted">{t("Total", "الإجمالي")} · {lines.length} {t("lines", "سطر")}</span>
            <b className="font-display text-xl font-black text-ink">{fmtMoney(total)} {t("EGP", "جنيه")}</b>
          </div>
          {confirming && lines.length ? (
            <Reveal>
              <div className="grid gap-2 rounded-2xl border border-[#FACC15] bg-surface-subtle p-3 text-[13.5px] text-ink-body">
                <b className="font-display text-[15px] text-ink">{t("Receive this delivery?", "تستلم التوريد ده؟")}</b>
                <p>
                  {t(
                    `${check.units} unit${check.units === 1 ? "" : "s"} on ${lines.length} line${lines.length === 1 ? "" : "s"} from ${supplier.trim() || "—"}. ${fmtMoney(check.total)} EGP will be posted to Finance as a Supplies expense.`,
                    `${check.units} وحدة في ${lines.length} سطر من ${supplier.trim() || "—"}. هيتسجل ${fmtMoney(check.total)} جنيه مصروف مستلزمات في المالية.`
                  )}
                </p>
                {check.noPrice ? (
                  <p className="font-bold text-red-700">
                    {t(`${check.noPrice} line${check.noPrice === 1 ? " has" : "s have"} no price and will be posted as 0.`, `${check.noPrice} سطر من غير سعر وهيتسجل بصفر.`)}
                  </p>
                ) : null}
                {check.noSupplier ? <p className="font-bold text-red-700">{t("No supplier is written.", "اسم المورّد مش مكتوب.")}</p> : null}
                <p className="text-[12px] text-ink-muted">{t("Check the numbers first: a received delivery cannot be undone from this page.", "راجع الأرقام الأول: التوريد بعد الاستلام مالوش تراجع من الصفحة دي.")}</p>
                <div className="flex flex-wrap gap-2">
                  <Btn kind="yellow" busy={busy} onClick={receive}><Check size={15} /> {t("Yes, receive", "أيوه، استلم")}</Btn>
                  <Btn onClick={() => setConfirming(false)}>{t("Go back and fix", "ارجع أعدّل")}</Btn>
                </div>
              </div>
            </Reveal>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12px] text-ink-muted">{t("Posts to Finance as", "بيتسجل في المالية كـ")} <b>{t("Supplies", "مستلزمات")}</b> · {supplier || "—"}</span>
              <Btn kind="yellow" disabled={!lines.length} onClick={() => setConfirming(true)}><Check size={15} /> {t("Receive delivery", "استلام التوريد")}</Btn>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/**
 * Live barcode reading with the camera, on every phone.
 *
 * Android Chrome reads barcodes natively (`BarcodeDetector`). iPhones and desktop browsers do
 * not, so there the ZXing reader is loaded on demand and does the same job in JavaScript. Both
 * read the 1D codes printed on boxes and the small square GS1 DataMatrix that dental and
 * medical packaging often carries instead.
 */
function Scanner({ onCode, onClose, noCamera, closeLabel }: { onCode: (code: string) => void; onClose: () => void; noCamera: string; closeLabel: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  // The parent passes a fresh function every render; the camera must not restart for that.
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  });
  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer = 0;
    let zxing: { reset: () => void } | null = null;
    const found = (code: string) => {
      if (stopped || !code) return;
      stopped = true;
      onCodeRef.current(code);
    };
    type Detector = { detect: (src: ImageBitmapSource) => Promise<Array<{ rawValue: string }>> };
    type DetectorCtor = new (opts?: { formats?: string[] }) => Detector;
    const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;

    (async () => {
      const v = videoRef.current;
      if (!v) return;
      try {
        if (Native) {
          const detector = new Native({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "data_matrix", "qr_code"] });
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
          if (stopped) {
            stream.getTracks().forEach((tr) => tr.stop());
            return;
          }
          v.srcObject = stream;
          await v.play();
          const tick = async () => {
            if (stopped) return;
            try {
              const codes = await detector.detect(v);
              const hit = codes.find((c) => c.rawValue);
              if (hit) return found(hit.rawValue);
            } catch {
              /* a frame that could not be read */
            }
            timer = window.setTimeout(tick, 250);
          };
          timer = window.setTimeout(tick, 400);
        } else {
          const zx = await import("@zxing/library");
          if (stopped) return;
          const hints = new Map<unknown, unknown>();
          hints.set(zx.DecodeHintType.POSSIBLE_FORMATS, [
            zx.BarcodeFormat.EAN_13,
            zx.BarcodeFormat.EAN_8,
            zx.BarcodeFormat.UPC_A,
            zx.BarcodeFormat.UPC_E,
            zx.BarcodeFormat.CODE_128,
            zx.BarcodeFormat.CODE_39,
            zx.BarcodeFormat.ITF,
            zx.BarcodeFormat.DATA_MATRIX,
            zx.BarcodeFormat.QR_CODE,
          ]);
          hints.set(zx.DecodeHintType.TRY_HARDER, true);
          const reader = new zx.BrowserMultiFormatReader(hints as Map<never, unknown>, 200);
          zxing = reader;
          await reader.decodeFromConstraints({ video: { facingMode: "environment" }, audio: false }, v, (result) => {
            if (result) found(result.getText());
          });
          if (stopped) reader.reset();
        }
      } catch {
        if (!stopped) setError(noCamera);
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
      zxing?.reset();
    };
  }, [noCamera]);
  return (
    <div className="grid gap-2">
      <div className="relative mx-auto aspect-[4/3] w-full max-w-[320px] overflow-hidden rounded-xl bg-ink-slab">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-[16%_12%] rounded-lg border-2 border-white/60" />
        {error ? <p className="absolute inset-x-3 bottom-3 rounded-lg bg-black/70 p-2 text-center text-[12px] text-white">{error}</p> : null}
      </div>
      <Btn onClick={onClose} className="justify-self-center">{closeLabel}</Btn>
    </div>
  );
}

/** Unknown or library barcode: the one-time naming. */
function NewProductForm({ ctx, barcode, library, initialItemId, onCancel, onAdd }: { ctx: StockCtx; barcode: string | null; library: LibraryProduct | null; initialItemId?: string; onCancel: () => void; onAdd: (nv: Line["newVariant"] & object, drawerId: string, price: number) => void }) {
  const { snap, t, ar, toast } = ctx;
  const { busy, run } = useBusy();
  const guessedItem = library?.catalogKey ? snap.items.find((i) => i.catalogKey === library.catalogKey) : undefined;
  // Nothing is picked for the person unless there is a reason to: a list that starts on its
  // first line filed new brands under whatever item happened to be first.
  const [itemId, setItemId] = useState(initialItemId || guessedItem?.id || (snap.items.length === 1 ? snap.items[0].id : ""));
  const [brand, setBrand] = useState(library?.brand || "");
  const [product, setProduct] = useState(library?.product || "");
  const [spec, setSpec] = useState(library?.spec || "");
  const [price, setPrice] = useState(0);
  const [photoUrl, setPhotoUrl] = useState<string | null>(library?.photoUrl || null);
  const item = ctx.items.get(itemId);
  const [drawerId, setDrawerId] = useState(() => snap.lines.find((l) => l.itemId === itemId)?.drawerId || (snap.drawers.length === 1 ? snap.drawers[0].id : ""));
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
              <option value="" disabled>{t("Choose the item…", "اختار الصنف…")}</option>
              {snap.items.map((i) => <option key={i.id} value={i.id}>{ar ? i.nameAr : i.nameEn} · {ar ? i.nameEn : i.nameAr}</option>)}
            </select>
          </Field>
          <Field label={t("Brand", "الماركة")}><input value={brand} onChange={(e) => setBrand(e.target.value)} className={inputCls} placeholder="3M" /></Field>
          <Field label={t("Product", "المنتج")}><input value={product} onChange={(e) => setProduct(e.target.value)} className={inputCls} placeholder={item ? CATALOG_BY_KEY[item.catalogKey || ""]?.en || item.nameEn : ""} /></Field>
          <Field label={t("Shade / size", "اللون / المقاس")}><input value={spec} onChange={(e) => setSpec(e.target.value)} className={inputCls} placeholder="A2" /></Field>
          <Field label={`${t("Price per", "السعر لكل")} ${unitLabel(item?.unit || "box", 1, ar)} (${t("EGP", "جنيه")})`}><NumberBox decimal blankZero value={price} onChange={setPrice} className={inputCls} /></Field>
          <Field label={t("Into drawer", "في درج")}>
            <select value={drawerId} onChange={(e) => setDrawerId(e.target.value)} className={inputCls}>
              <option value="" disabled>{t("Choose the drawer…", "اختار الدرج…")}</option>
              {snap.drawers.map((d) => <option key={d.id} value={d.id}>{d.code} · {ar ? d.nameAr : d.nameEn}</option>)}
            </select>
          </Field>
        </div>
      </div>
      {!itemId || !brand.trim() || !drawerId ? (
        <p className="text-[12.5px] font-semibold text-ink-body">
          {t("Still needed: ", "لسه ناقص: ")}
          {[!itemId ? t("the item", "الصنف") : "", !brand.trim() ? t("the brand", "الماركة") : "", !drawerId ? t("the drawer", "الدرج") : ""].filter(Boolean).join(t(", ", "، "))}
        </p>
      ) : null}
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
  const [itemId, setItemId] = useState(snap.items.length === 1 ? snap.items[0].id : "");
  const variants = snap.variants.filter((v) => v.itemId === itemId && !v.isGeneric);
  const generic = snap.variants.find((v) => v.itemId === itemId && v.isGeneric);
  const drawerFor = (vid?: string) => snap.lines.find((l) => (vid ? l.variantId === vid : l.itemId === itemId))?.drawerId || snap.drawers[0]?.id || "";
  return (
    <div className="grid gap-3 rounded-2xl border border-line p-3">
      <Eyebrow>{t("Add a line", "ضيف سطر")}</Eyebrow>
      <Field label={t("Item", "الصنف")}>
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={inputCls}>
          <option value="" disabled>{t("Choose the item…", "اختار الصنف…")}</option>
          {snap.items.map((i) => <option key={i.id} value={i.id}>{ar ? i.nameAr : i.nameEn}</option>)}
        </select>
      </Field>
      <div className="flex flex-wrap gap-2">
        {variants.map((v) => <Btn key={v.id} onClick={() => onPick(v, drawerFor(v.id))}>{variantLabel(v, ctx.items.get(itemId), ar)}</Btn>)}
        {generic ? <Btn onClick={() => onPick(generic, drawerFor(generic.id))}>{t("No brand (generic)", "من غير ماركة")}</Btn> : null}
        {itemId ? <Btn kind="dark" onClick={() => onNew(itemId)}>{t("New brand…", "ماركة جديدة…")}</Btn> : null}
        <Btn onClick={onCancel}>{t("Cancel", "إلغاء")}</Btn>
      </div>
    </div>
  );
}
