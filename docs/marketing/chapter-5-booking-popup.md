# Chapter 5 — The Booking Pop-up

A training video for reception and the doctors: book a visit, add the service, take the money,
all inside the new booking pop-up. English voiceover, burned-in Arabic subtitles. Demo clinic,
Arabic UI, 1920x1080. Beats match `CHAPTERS.popup` in `scripts/promo-chapters.mjs` one-to-one,
by number.

The pop-up is the default appointment editor (Settings → واجهة الاستخدام → محرر المواعيد →
نافذة منبثقة). This setting is saved per account. If the recording account has it on شريط جانبي
(side drawer), the chapter opens the drawer instead and every beat after 1 misses. Switch it back
before the take.

Every take writes to the demo clinic: Ziad's appointment at the chapter's slot (run
`promo-clean-bookings.mjs` between takes), plus one Composite Filling charge and a payment of
the same amount on his account. Those two cancel out, so his balance stays as the seed left it.

## Recording it

```
node scripts/promo-clean-bookings.mjs
node scripts/record-promo-clips.mjs --chapter popup --out rec/popup --profile-from rec/<an earlier take>
node scripts/make-promo-voice.mjs --script docs/marketing/chapter-5-booking-popup.md --out vo/popup
python scripts/make-promo-subs.py --vo vo/popup --out subs/popup
node scripts/assemble-promo.mjs --rec rec/popup --vo vo/popup --subs subs/popup --out out/5-booking-popup.mp4
```

The recorder lists any click that did not land at the end of the take ("N action(s) did not
land"). Anything listed there means re-probing that label with `promo-probe-ui.mjs`. Don't
assemble that take.

## popup

| # | Time | Screen | Narration (EN, spoken) | Subtitle (AR, on screen) |
|---|------|--------|------------------------|---------------------------|
| 0 | 0:00 | The desk | This is the new booking pop-up. One window where you book the visit, add what the dentist will do, and take the money — without going anywhere else. | ده الشباك الجديد للحجز. شباك واحد تحجز فيه الزيارة، وتضيف الدكتور هيعمل إيه، وتحصّل الفلوس — من غير ما تروح أي حتة تانية. |
| 1 | 0:10 | Click an empty slot | Someone calls for an appointment. Click the empty slot you want, and the pop-up opens with that time already filled in. Four tabs across the top: Appointment, Service, Payment and Insurance. | حد بيتصل عايز ميعاد. دوس على الخانة الفاضية اللي عايزها، والشباك يفتح والوقت متسجل لوحده. فوق فيه أربع تابات: الموعد، الخدمة، الدفع، والتأمين. |
| 2 | 0:23 | Search and pick the patient | Type the first letters of the name, or the phone number, and pick the file. His past visits appear down the side. A first-time patient? Tick New patient and type the name and phone right here — there's no separate form. | اكتب أول حروف من الاسم، أو رقم الموبايل، واختار الملف. زياراته اللي فاتت بتظهر على الجنب. مريض أول مرة؟ علّم على «مريض جديد» واكتب الاسم والموبايل هنا على طول — مفيش فورم تاني. |
| 3 | 0:38 | Dentist and session time | Now the dentist — each one shows how many free times they have that day — and how long the session is. | دلوقتي الدكتور — وكل دكتور قدامه عنده كام ميعاد فاضي اليوم ده — ومدة الجلسة. |
| 4 | 0:47 | Branch, room, the day and the times | The branch and the room. Underneath, the next two weeks and that day's times: free ones in white, booked ones in red. If you pick a red one, it asks you before it double-books. | الفرع والأوضة. وتحت، الأسبوعين الجايين ومواعيد اليوم: الفاضي أبيض، والمحجوز أحمر. ولو اخترت واحد أحمر، بيسألك الأول قبل ما يحجز مرتين. |
| 5 | 1:00 | Reason and visit notes | The reason for the visit, and a note if there's something the dentist should know before he walks in. | سبب الزيارة، وملاحظة لو فيه حاجة الدكتور لازم يعرفها قبل ما يدخل. |
| 6 | 1:09 | Service tab → Add procedure | Second tab: Service — what the dentist will do at this visit. Add procedure, type the first letters, and pick it from your price list. The price comes in by itself. | التاب التاني: الخدمة — الدكتور هيعمل إيه في الزيارة دي. «إضافة إجراء»، اكتب أول حروف، واختارها من قايمة أسعارك. السعر بينزل لوحده. |
| 7 | 1:22 | Teeth off the chart → Confirm procedure | Then the teeth, clicked straight off the chart. If the service is priced per tooth, it multiplies the total for you. Confirm procedure, and it's on the visit. Add as many as you need. | وبعدين الأسنان، بتدوس عليها من الرسم على طول. لو الخدمة بسعر للسنة، بيضرب الإجمالي لوحده. «تأكيد الإجراء»، واتضافت على الزيارة. وتضيف قد ما انت عايز. |
| 8 | 1:36 | Payment tab → Confirm booking & take payment | Third tab: Payment. It already shows what this visit will cost. Press Confirm booking and take payment: the appointment is saved with its services, and the pop-up stays open, right here, on the money. | التاب التالت: الدفع. بيوريك الزيارة دي هتتحسب بكام. دوس «أكّد الحجز وحصّل دلوقتي»: الميعاد بيتحفظ بخدماته، والشباك بيفضل فاتح هنا على الفلوس. |
| 9 | 1:50 | Collect → Cash → Confirm | Now collect. Press Collect next to the treatment — the amount is already what's left on it, so if he's paying part, just change it. Cash, card or InstaPay. Confirm. | دلوقتي التحصيل. دوس «تحصيل» جنب العلاج — المبلغ متكتب لوحده باللي باقي عليه، ولو هيدفع جزء، غيّره وخلاص. كاش، فيزا، أو انستاباي. «تأكيد». |
| 10 | 2:03 | Paid / remaining | And it's recorded — on this visit, against this treatment. Paid and remaining update straight away, and the payment is on his account in the patient file too. | واتسجلت — على الزيارة دي، وعلى العلاج ده بالظبط. المدفوع والباقي بيتحدّثوا على طول، والدفعة على حسابه في ملف المريض كمان. |
| 11 | 2:14 | Close → the visit on the diary | Close it, and the visit is on the diary. Click it any time and the same pop-up opens, on the same tabs. And on the phone, it's the same pop-up, full screen. | اقفله، والزيارة على الجدول. دوس عليها في أي وقت ويفتحلك نفس الشباك، بنفس التابات. وعلى الموبايل، هو نفس الشباك، بالشاشة كلها. |
