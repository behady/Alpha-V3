# بطاقات الخصائص — Arabic feature plates

Eighteen PNGs, one per sellable add-on plus a cover, sized **1080 × 1350 at 2× (2160 × 2700)** —
the 4:5 frame Instagram, Facebook and a WhatsApp status all accept without cropping.

| ملف | الخاصية | ملف | الخاصية |
|---|---|---|---|
| `00-cover` | الغلاف — ألفا دنتال | `09-ads-leads` | عملاء الإعلانات |
| `01-whatsapp-auto` | رسائل واتساب التلقائية | `10-lab` | متابعة المعمل |
| `02-whatsapp-bot` | بوت واتساب | `11-ortho` | التقويم |
| `03-clinical-pdfs` | الروشتة على واتساب | `12-inventory` | المخزون |
| `04-ai-assistant` | المساعد الذكي | `13-attendance` | الحضور والرواتب |
| `05-ai-proactive` | التنبيهات الاستباقية | `14-reports` | التقارير |
| `06-ai-embedded` | ملخص الملف | `15-branches` | أكثر من فرع |
| `07-ai-voice` | الملاحظات الصوتية | `16-marketing-content` | المحتوى والخطة |
| `08-online-booking` | الحجز الإلكتروني | `17-marketing-design` | التصميم |

`_contact-sheet.png` is all eighteen on one image, for judging the series rather than a plate.

## To change anything

Everything — the Arabic copy, the diagrams, the contact number — lives in
`scripts/make-feature-cards.mjs`, in the `PLATES` list and the `FIGURES` map. Edit there and
re-run; never retouch a PNG, or the next run silently undoes it.

```bash
node scripts/make-feature-cards.mjs
```

One plate at a time while you iterate: `node scripts/make-feature-cards.mjs --only 07`.

Renders through the Playwright in the npx cache with the installed Chrome (same arrangement as
`scripts/record-promo-clips.mjs`, nothing downloaded). Arabic display type is Noto Kufi Arabic,
body is Cairo, both from Google Fonts at render time; the mono apparatus is GeistMono from the
local canvas-fonts kit.

## Two traps this folder already fell into

- **Never put neutral punctuation next to a number in an Arabic line.** `الأسنان · ١٧ إضافة`
  printed as `١٧٠ إضافة` — the bidi algorithm pulling the dot into the numeral run, not a typo.
  Write the conjunction out, or spell the number.
- **The phone number needs `direction:ltr`.** In an RTL block `0155 155 2440` printed as
  `2440 155 0155`, which looks like a real number and is not one.

The aesthetic the plates hold to is written up in `PHILOSOPHY.md`.
