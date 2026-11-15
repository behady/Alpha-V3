# Stock: the cupboard system

Replaces the unused Inventory page at `/inventory` with a stock module built around the physical
cupboard. Agreed with the owner on 2026-11-09 after three prototypes (artifacts "Stock the
Cupboard", "The Cupboard System", "Alpha Stock Prototype"). Assistant counts weekly.

## The six rules

1. **One home per item, with a code.** Room (C1, C2, ST, SR) → cabinet (A, B) → drawer (1, 2…).
   `C1-A2` is Chair 1, cabinet A, drawer 2. Codes are assigned by the app.
2. **Drawers follow the procedure.** A standard cabinet map ships: per chair, cabinet A holds
   anaesthesia / fillings / root canal / burs, cabinet B holds gloves / impressions / suction.
   Sterilisation and Store rooms always exist.
3. **A printed label on every drawer** with the code, the name in both languages, the item list
   and a QR that deep-links to that drawer's count.  Each drawer, item and brand can carry a photo.
4. **Count what you would order.** Boxes, syringes, packs. Items flagged `tracked` (implants,
   grafts, membranes) are instead used one at a time on a patient with a lot number.
5. **Only three events are logged:** a delivery, a weekly count, an item used on a patient. There
   is no free "adjust stock".
6. **Usage is arithmetic:** previous count + deliveries − this count. Pace = average of the last
   three weeks. Days left = on hand ÷ (pace ÷ 7).

## Brands

A generic **item** ("Flowable composite", فلو) is what the dentist asks for and what usage is
measured on. A **variant** is a brand the clinic buys (3M Filtek Flow A2), with its barcode, photo,
supplier and last price. Stock lines are per variant per drawer. Usage, pace and reorder roll up
to the item. Brands are never asked for at setup; they arrive with the first delivery, by barcode.

A root collection `stock_library/{barcode}` is shared by every clinic: the first clinic to scan a
box gives its photo and name to all the others. Prices and suppliers stay per clinic.

## Data (all under `clinics/{clinicId}/`)

| collection | one doc per | key fields |
|---|---|---|
| `stock_drawers` | drawer | code, roomCode, roomEn/Ar, cabinetLetter, cabinetWhere, number, nameEn/Ar, photoUrl, tracked, order |
| `stock_items` | generic item | nameEn/Ar, unit, per, shape, tracked, catalogKey |
| `stock_variants` | brand under an item | itemId, brand, product, spec, barcode, photoUrl, supplier, lastPrice |
| `stock_lines` | variant in a drawer (`{variantId}__{drawerId}`) | variantId, itemId, drawerId, qty |
| `stock_counts` | one saved walk | date, by, snapshot {lineId: qty}, changes [...] |
| `stock_deliveries` | one delivery | date, supplier, invoiceUrl, lines [{variantId, drawerId, qty, price}], total, ledgerId |
| `stock_uses` | tracked item on a patient | date, variantId, drawerId, patientId, patientName, lot |

Root: `stock_library/{barcode}` — brand, product, spec, photoUrl, catalogKey, shape, unit.

The old `inventory` / `inventory_transactions` / `categories` collections are left untouched.

## Access

Everything goes through `POST /api/stock` (admin SDK), so no Firestore rules change is needed and
nothing can reach another clinic's data. Reads need `access.inventory`; setup and structure need
`inventory.add`; counts, deliveries and patient use need `inventory.edit`. A delivery posts a
`Supplies` expense to the ledger through the same row builder the Finance page uses.

Photos upload from the browser to `clinics/{clinicId}/stock/...` (storage rules already allow
signed-in writes under a clinic). The module sits behind the existing `inventory` add-on switch.

## Screens (`/inventory`, phone first)

Cupboard (map of rooms → cabinets → drawers, days-left per drawer) · Drawer (photo, items,
variants, use on patient) · Count (walk the drawers in code order, pre-filled, change only what
moved, review, save) · Delivery (supplier, invoice photo, barcode scan via `BarcodeDetector` with a
typed fallback, new-product form, receive) · Reports (usage by item/room, days left, shopping list
by supplier with WhatsApp text, purchases, variance, traceability) · Setup (chairs → standard map →
pick items → print labels).

## Out of scope for the first test

Per-treatment recipes, Excel export, Supply Store basket hand-off, picking the implant from the
treatment card (v1 uses "Used on patient" from the drawer).
