# Alpha Dental — the full walkthrough

English voiceover, burned-in Arabic subtitles, 1920x1080. Twelve parts, joined with title cards.
Each `## wN` section below is one part; its rows match `WALKTHROUGH.wN.beats` in
`scripts/walkthrough-chapters.mjs` by number. Build one part with
`make-promo-voice.mjs --script docs/marketing/walkthrough.md --section w3`.

Parts 0–5 run on a clinic created on camera (`عيادة الأمل للأسنان`). Parts 6–12 run on the demo
clinic, and the narration says why: some screens only mean something after a couple of months.

Nothing in this video creates a login account or analyses an x-ray: the create-account form is
filled and stopped, the invite link is what actually gets demonstrated, and the x-ray upload
dialog is shown with the reading narrated.

## w0a

| # | Time | Screen | Narration (EN, spoken) | Subtitle (AR, on screen) |
|---|------|--------|------------------------|---------------------------|
| 0 | 0:00 | Login page | This is where it starts. One button — sign in with Google. No forms, no verification emails, no password to forget. Your Gmail is your account. | من هنا بنبدأ: زرار واحد، تسجيل الدخول بجوجل. مفيش فورم، ولا إيميل تأكيد، ولا باسورد تنساه. الجيميل بتاعك هو حسابك. |

## w0b

| # | Time | Screen | Narration (EN, spoken) | Subtitle (AR, on screen) |
|---|------|--------|------------------------|---------------------------|
| 0 | 0:00 | Clinic switcher → add clinic | Once you're in, you name your clinic. I'm already signed in, so I'll open the clinic menu and add a new one — it's the same screen a new sign-up lands on. | أول ما تدخل، بتسمّي عيادتك. أنا داخل خلاص، فهفتح قايمة العيادات وأضيف واحدة جديدة — نفس الشاشة اللي بتقابل أي حد بيسجّل. |
| 1 | 0:11 | Typing the name | Just the name. Everything else comes after, and none of it is required to start working. | الاسم وبس. كل حاجة تانية بتيجي بعدين، ومفيش حاجة منها لازمة عشان تبدأ شغل. |
| 2 | 0:17 | Create | And it's created. A few seconds, and you own a clinic on the system. | وخلاص اتعملت. كام ثانية، وبقى عندك عيادة على النظام. |
| 3 | 0:23 | Setup — hours | It asks the things it genuinely needs: when you open, when you close, how long a slot is, which day you're off. This is what the diary is built from. | بيسأل على اللي محتاجه بجد: بتفتح إمتى، بتقفل إمتى، الخانة قد إيه، وأجازتك يوم إيه. ده اللي الجدول بيتبني عليه. |
| 4 | 0:34 | Setup — the rest | Prices, team, WhatsApp — each one is a step you can do now or skip and come back to. I'll skip, because I'd rather show you them properly. | الأسعار، الفريق، الواتساب — كل واحدة خطوة تعملها دلوقتي أو تعدّيها وترجعلها. هعدّيها، عشان أوريهالك صح. |
| 5 | 0:44 | Sara's card | And this is Sara. She's the guide built into the system — she'll walk any new user through each screen, step by step, in Arabic. | ودي سارة. هي الدليل اللي جوه النظام — بتمشي أي مستخدم جديد على كل شاشة، خطوة خطوة، بالعربي. |
| 6 | 0:54 | Closing Sara | I'm going to close her for today, because that's my job in this video. But she's there for your staff on their first day, and you don't have to train anyone. | هقفلها النهاردة، عشان ده شغلي في الفيديو ده. بس هي موجودة لموظفينك في أول يوم، ومش هتحتاج تدرّب حد. |

## w1

| # | Time | Screen | Narration (EN, spoken) | Subtitle (AR, on screen) |
|---|------|--------|------------------------|---------------------------|
| 0 | 0:00 | Users page | The team. Every person who logs in, with their role — dentist, reception, assistant, manager. And what they can see and do is yours to decide, per person. | الفريق. كل حد بيدخل النظام، ودوره — دكتور، استقبال، مساعد، مدير. واللي يشوفه ويعمله انت اللي بتقرره، لكل واحد لوحده. |
| 1 | 0:11 | Create-account form | Two ways to add someone. The first: you create their login yourself — name, email, a password, and the role. I'll fill it, but I won't submit — this one's a real account. | طريقتين تضيف بيها حد. الأولى: تعمله الحساب بنفسك — الاسم، الإيميل، باسورد، والدور. هملاه بس مش هبعته — ده حساب حقيقي. |
| 2 | 0:24 | Invite link | The second, and the one I'd use: pick the role, make a link, send it on WhatsApp. They sign in with their own Google, and they're on your team with exactly that role — nothing more. | التانية، واللي أنا هستخدمها: تختار الدور، تعمل لينك، وتبعته على الواتساب. يدخل بجوجل بتاعه، ويلاقي نفسه في فريقك بالدور ده بالظبط — ولا حاجة زيادة. |
| 3 | 0:37 | Permissions | And this is the part owners care about. Every switch, per person: can they see the money, can they delete, can they touch settings. The owner sees everything. Everyone else sees what you let them. | ودي الحتة اللي أصحاب العيادات بيهتموا بيها. كل مفتاح، لكل واحد: يشوف الفلوس ولا لأ، يمسح ولا لأ، يلمس الإعدادات ولا لأ. صاحب العيادة بيشوف كل حاجة. الباقي بيشوفوا اللي انت سامح بيه. |

## w2

| # | Time | Screen | Narration (EN, spoken) | Subtitle (AR, on screen) |
|---|------|--------|------------------------|---------------------------|
| 0 | 0:00 | The desk, day view | This is the desk — the screen the clinic lives on. Today's income, how many booked, how many confirmed, and the day itself, by the hour. I've added a few patients so it isn't empty. | دي شاشة المكتب — الشاشة اللي العيادة عايشة عليها. دخل النهاردة، كام حجز، كام مؤكد، واليوم نفسه بالساعة. ضفت كام مريض عشان متبقاش فاضية. |
| 1 | 0:12 | Week view | One click, the whole week. Every dentist, every room. The white space is what you sell — every gap is a chair that could have been full. | كليك واحدة، الأسبوع كله. كل دكتور، كل أوضة. الفاضي هو اللي بتبيعه — كل فراغ ده كرسي كان ممكن يبقى مليان. |
| 2 | 0:22 | Back to day | And back to today. Everything from here on happens on this one screen. | ونرجع للنهاردة. كل اللي جاي بيحصل على الشاشة دي. |

## w3

| # | Time | Screen | Narration (EN, spoken) | Subtitle (AR, on screen) |
|---|------|--------|------------------------|---------------------------|
| 0 | 0:00 | New patient form | Someone calls. New patient — right here on the desk. Name, phone, where they live, and how they found you. That last one matters later, in the reports. | حد بيتصل. مريض جديد — من هنا على طول. الاسم، التليفون، ساكن فين، وعرفك منين. الأخيرة دي مهمة بعدين، في التقارير. |
| 1 | 0:12 | Saved | Saved, with a file number. The phone is what WhatsApp will use, so it's checked as you type. | اتحفظ، برقم ملف. التليفون هو اللي الواتساب هيستخدمه، فبيتراجع وانت بتكتب. |
| 2 | 0:19 | Click the gap | Now the appointment. I click the empty slot I want — the time is already filled in from where I clicked. Type the first letters of the name, and the file comes up. | دلوقتي الميعاد. بدوس على الخانة الفاضية اللي أنا عايزها — الوقت متسجل لوحده من مكان الضغطة. أكتب أول حروف من الاسم، والملف يطلع. |
| 3 | 0:31 | The setter | Dentist, how long you need, the room. Confirm. And if you ever double-book by accident, it asks you first — it won't let it happen quietly. | الدكتور، المدة، الأوضة. تأكيد. ولو في يوم حجزت مرتين في نفس الوقت بالغلط، بيسألك الأول — مش هيسيبها تحصل في صمت. |
| 4 | 0:44 | The editor | And once it's on the day, click it and everything's editable in place: status, time, dentist, notes. Check-in, in the chair, done — all one click. | ولما يبقى على اليوم، دوس عليه وكل حاجة تتعدل في مكانها: الحالة، الوقت، الدكتور، الملاحظات. وصل، على الكرسي، خلص — كله ضغطة واحدة. |

## w4

| # | Time | Screen | Narration (EN, spoken) | Subtitle (AR, on screen) |
|---|------|--------|------------------------|---------------------------|
| 0 | 0:00 | Quick pay | He's paying at the desk. Quick pay: find the patient, the amount, confirm. Cash, and it's on his account — and, if you switch it on, a receipt goes to his WhatsApp. | بيدفع على المكتب. دفع سريع: دوّر على المريض، المبلغ، تأكيد. كاش، واتسجل على حسابه — ولو مفعّلها، إيصال بيروحله على الواتساب. |
| 1 | 0:13 | The file | Now his file. Everything about him on one screen, and the tabs are the questions a dentist actually asks: what did we do, what did we agree, what does he owe, what's the history. | دلوقتي ملفه. كل حاجة عنه في شاشة واحدة، والتابات هي الأسئلة اللي الدكتور بيسألها فعلاً: عملنا إيه، اتفقنا على إيه، عليه كام، وتاريخه إيه. |
| 2 | 0:26 | Add a procedure | Let's record today's work. New procedure — the dentist, and the treatment: composite filling. | نسجّل شغل النهاردة. إجراء جديد — الدكتور، والعلاج: حشو كومبوزيت. |
| 3 | 0:34 | Pick the teeth | And the teeth, off the chart. Not typed — clicked. Fourteen, fifteen, sixteen. Three teeth, one line, priced per tooth or as one job, and it's saved to his history and his account at once. | والأسنان، من الرسم. مش بتتكتب — بتتداس. أربعتاشر، خمستاشر، ستاشر. تلات سنان، سطر واحد، بسعر لكل سنة أو كشغلانة واحدة، واتحفظ في تاريخه وحسابه في نفس اللحظة. |
| 4 | 0:50 | AI treatment plan | Treatment plan. You can build it by hand — or ask the AI to draft one from the chart and the notes, priced from your own list. You edit, the patient approves, and that plan is what the money is measured against. | خطة العلاج. تعملها بإيدك — أو تطلب من الذكاء الاصطناعي يعمل مسودة من الرسم والملاحظات، بأسعارك انت. انت تعدّل، والمريض يوافق، والخطة دي هي اللي الفلوس بتتحسب عليها. |
| 5 | 1:06 | X-ray upload | X-rays and photos live in the file too. And when you upload an x-ray, there's a button that reads it — the AI marks what it sees, tooth by tooth, with a severity, and writes it up. It's a second pair of eyes, not a diagnosis; the dentist still decides. | الأشعة والصور في الملف برضه. ولما ترفع أشعة، فيه زرار بيقراها — الذكاء الاصطناعي بيعلّم اللي شايفه، سنة سنة، بدرجة خطورة، وبيكتب تقرير. ده عين تانية، مش تشخيص؛ الدكتور هو اللي بيقرر. |
| 6 | 1:22 | The ledger tab | The money tab. Every charge, every payment, for this one patient — and against each payment, who took it and when. When someone says "I paid the girl at the desk", you're not asking around. | تاب الفلوس. كل حساب وكل دفعة، للمريض ده — وقدام كل دفعة، مين استلمها وإمتى. لما حد يقولك «أنا دفعت للبنت اللي على المكتب»، مش هتسأل حد. |
| 7 | 1:36 | Finance page | And all of it rolls up here — the finance page. Today, this month, any range. By dentist, if you split the takings. What came in, what went out, and the net. | وده كله بيتجمّع هنا — صفحة الحسابات. النهاردة، الشهر، أي فترة. بالدكتور، لو بتقسّموا. اللي دخل، واللي خرج، والصافي. |
| 8 | 1:48 | Recording an expense | Expenses go in the same place. Rent, the lab bill, electricity — description, amount, done. So the net you see is a real number, not just what came in. | المصروفات بتتسجل في نفس المكان. الإيجار، فاتورة المعمل، الكهرباء — الوصف، المبلغ، خلاص. فالصافي اللي بتشوفه رقم حقيقي، مش بس اللي دخل. |

## w5

| # | Time | Screen | Narration (EN, spoken) | Subtitle (AR, on screen) |
|---|------|--------|------------------------|---------------------------|
| 0 | 0:00 | Public booking page | Now the other side. This is your clinic's booking page — a link you put on Facebook, in your bio, on WhatsApp. No app to install. The patient picks a branch. | دلوقتي الناحية التانية. دي صفحة الحجز بتاعة عيادتك — لينك تحطه على فيسبوك، في البايو، على الواتساب. مفيش أبلكيشن يتنزّل. المريض بيختار الفرع. |
| 1 | 0:11 | Day and time | A day, and a time — and it only shows what's actually free, straight from your diary. Nobody double-books through here. | يوم، ووقت — وبيوريه الفاضي بس، من جدولك على طول. محدش بيحجز مرتين من هنا. |
| 2 | 0:21 | Name and phone | Name, phone, what it's about. Confirm. That's the patient's whole experience. | الاسم، التليفون، الحكاية إيه. تأكيد. ده كل اللي المريض بيشوفه. |
| 3 | 0:30 | Back on the desk | And here it is on your desk, in the right slot, without anyone at the clinic lifting a finger. Two in the morning, a Friday, doesn't matter. | وأهي على مكتبك، في الخانة الصح، من غير ما حد في العيادة يعمل حاجة. الساعة ٢ بالليل، يوم جمعة، مش فارقة. |

## w6

| # | Time | Screen | Narration (EN, spoken) | Subtitle (AR, on screen) |
|---|------|--------|------------------------|---------------------------|
| 0 | 0:00 | The chats queue | From here on I'm switching to a clinic that's been running for a couple of months — because WhatsApp, reports and the lab only mean something once there's history. This is the WhatsApp inbox. Every message to the clinic, one queue, not on anyone's personal phone. | من هنا هنقل لعيادة شغالة بقالها شهرين — لأن الواتساب والتقارير والمعمل مبيبقالهمش معنى غير لما يبقى فيه تاريخ. ده صندوق الواتساب. كل رسالة للعيادة، في طابور واحد، مش على موبايل حد. |
| 1 | 0:15 | The handoff | She asked about pain after a filling. The assistant didn't guess — it handed her to a person, and told her so. | سألت عن وجع بعد الحشو. المساعد ما خمّنش — حوّلها لبني آدم، وقالها كده. |
| 2 | 0:24 | Bot booked it | He asked a price. It answered from your price list, offered what was free, and booked him. Nobody at the clinic touched it. | سأل عن سعر. رد عليه من قايمة أسعارك، عرض الفاضي، وحجزله. محدش في العيادة لمسها. |
| 3 | 0:34 | The reminder | The reminder went out the day before by itself. He wrote one word — "confirm" — and the appointment turned green on your desk. | التذكير راح قبلها بيوم لوحده. كتب كلمة واحدة — «تأكيد» — والميعاد بقى أخضر على مكتبك. |
| 4 | 0:44 | The triggers | And every one of these is a switch you control. New booking, a change, a cancellation, the reminder, the payment receipt, check-in, a review request, recalling people who disappeared. On, off, and the wording is yours. | وكل واحدة من دول مفتاح انت اللي بتتحكم فيه. حجز جديد، تعديل، إلغاء، التذكير، إيصال الدفع، تسجيل الوصول، طلب التقييم، استرجاع اللي غابوا. شغّال، مقفول، والصياغة بتاعتك. |
| 5 | 0:59 | Owner alerts | And the owner gets their own alerts — a booking, a cancellation, a payment — on their own phone, as it happens. | وصاحب العيادة ليه تنبيهاته هو — حجز، إلغاء، دفعة — على موبايله، لحظة ما تحصل. |

## w7

| # | Time | Screen | Narration (EN, spoken) | Subtitle (AR, on screen) |
|---|------|--------|------------------------|---------------------------|
| 0 | 0:00 | Who answers | Now, the thing people confuse: the bot and the AI are not the same product. You choose who answers. Nobody. The bot alone — menus and ready answers, no AI, no credits, ever. The bot plus the AI. Or the AI for everything. | دلوقتي الحاجة اللي الناس بتلخبط فيها: البوت والذكاء الاصطناعي مش حاجة واحدة. انت بتختار مين يرد. محدش. البوت لوحده — قوائم وردود جاهزة، من غير ذكاء اصطناعي ومن غير كريدت خالص. البوت والذكاء. أو الذكاء في كل حاجة. |
| 1 | 0:17 | Ready answers | The bot is your sticky notes. Prices, parking, instalments, what you don't do. You write it once, it's free forever, and it never invents a word. | البوت ده الورق اللاصق بتاعك. الأسعار، الجراج، التقسيط، واللي مش بتعملوه. تكتبها مرة، ببلاش للأبد، ومش بيخترع كلمة. |
| 2 | 0:29 | Coaching | The AI is a hire. You brief it like a new employee — and this is where it sells: end every answer by offering an appointment, mention the instalments when they say it's expensive, name two times instead of asking when. It only sees what the bot couldn't answer, and it costs a credit per reply. | الذكاء الاصطناعي ده موظف بتعيّنه. بتبرّفه زي موظف جديد — وهنا بيبيع: كل رد ينتهي بعرض ميعاد، افتكر التقسيط لو قال غالي، اقترح ميعادين بدل ما تسأله إمتى. مبيشوفش غير اللي البوت معرفش يرد عليه، وبيكلّف كريدت للرد. |
| 3 | 0:47 | The clinical switch | And you decide how far it goes. Flip this, and it answers a symptom the way a dentist would — then offers the appointment — instead of "someone will call you". Off, and every clinical question goes to a person. Your call. | وانت اللي بتحدد يوصل لفين. افتح ده، يرد على العرض زي ما الدكتور هيرد — وبعدين يعرض الميعاد — بدل «حد هيكلمك». اقفله، وكل سؤال طبي يروح لبني آدم. قرارك انت. |

## w8

| # | Time | Screen | Narration (EN, spoken) | Subtitle (AR, on screen) |
|---|------|--------|------------------------|---------------------------|
| 0 | 0:00 | Inventory | Stock. Every consumable, by category and by branch, with what's on the shelf and what it cost. | المخزون. كل مستهلك، بالتصنيف وبالفرع، واللي على الرف وسعره. |
| 1 | 0:08 | Low filter | One tap: what's running low. Each item has its own reorder line, and the AI brief mentions these before you find out the hard way. | ضغطة واحدة: اللي قرّب يخلص. كل صنف ليه حد إعادة الطلب بتاعه، والملخص الذكي بيقولك عليهم قبل ما تعرف بالطريقة الصعبة. |
| 2 | 0:18 | Add item | Adding one is a name, a unit, a quantity and a threshold. Counting in and out is plus and minus on the row. | تضيف صنف: اسم، ووحدة، وكمية، وحد أدنى. والعد داخل وخارج زايد وناقص على السطر. |

## w9

| # | Time | Screen | Narration (EN, spoken) | Subtitle (AR, on screen) |
|---|------|--------|------------------------|---------------------------|
| 0 | 0:00 | Lab board | The lab. Every case that left the building: which lab, what work, which tooth, the shade, when it went, when it's due. | المعمل. كل حالة خرجت من العيادة: أنهي معمل، شغل إيه، أنهي سنة، اللون، راحت إمتى، ومتوقعة إمتى. |
| 1 | 0:11 | Late | And the ones that are late — the board tells you, you don't have to remember. Each case has a code that's printed on the bag and sent to the lab on WhatsApp. | واللي اتأخرت — البورد بيقولك، مش انت اللي تفتكر. كل حالة ليها كود بيتطبع على الكيس ويتبعت للمعمل على الواتساب. |
| 2 | 0:22 | New order | A new order is raised from the treatment itself, with the patient, the teeth and the dentist already filled in. | الأمر الجديد بيتعمل من العلاج نفسه، والمريض والأسنان والدكتور متسجلين لوحدهم. |
| 3 | 0:30 | Lab accounts | And the accounts: what each lab has delivered, what you've paid, what you owe them. The lab bill stops being a surprise. | والحسابات: كل معمل سلّم إيه، ودفعتله كام، وعليك كام. فاتورة المعمل مبقتش مفاجأة. |

## w10

| # | Time | Screen | Narration (EN, spoken) | Subtitle (AR, on screen) |
|---|------|--------|------------------------|---------------------------|
| 0 | 0:00 | Reports overview | Reports. Pick a range and it tells you how the clinic is really doing — revenue, patients seen, what each service brought in. | التقارير. اختار فترة وهيقولك العيادة ماشية إزاي بجد — الدخل، المرضى اللي اتكشفوا، وكل خدمة جابت كام. |
| 1 | 0:11 | Dentists | By dentist: who did what, and what it was worth. If you split takings, this is the number you split. | بالدكتور: مين عمل إيه، وكان يساوي كام. لو بتقسّموا، ده الرقم اللي بتقسّموه. |
| 2 | 0:20 | Sources | By source: where your patients come from. Remember the "how did they find you" field on the new-patient form — this is why. Facebook, Google, walk-ins, referrals — and how much each one is worth. | بالمصدر: مرضاك جايين منين. فاكر خانة «عرفك منين» في فورم المريض الجديد؟ عشان كده. فيسبوك، جوجل، اللي بيعدّوا، اللي اتحوّلوا — وكل واحد يساوي كام. |
| 3 | 0:33 | Funnel | And the marketing funnel, if you run ads: leads in, bookings out, money at the bottom. PDF or Excel, one click. | وقمع التسويق، لو بتعمل إعلانات: العملاء داخلين، الحجوزات طالعة، والفلوس تحت. PDF أو Excel، ضغطة واحدة. |

## w11

| # | Time | Screen | Narration (EN, spoken) | Subtitle (AR, on screen) |
|---|------|--------|------------------------|---------------------------|
| 0 | 0:00 | The daily brief | The AI page. Every morning it writes you a brief: what's today, who owes, what's low in stock, what needs a call. Read it with your coffee. | صفحة الذكاء الاصطناعي. كل صبح بتكتبلك ملخص: إيه اللي النهاردة، مين عليه فلوس، إيه اللي قرّب يخلص، ومين محتاج مكالمة. اقراه مع قهوتك. |
| 1 | 0:11 | No-shows | The people who didn't show, and who's drifted away — with a message ready to bring them back. | اللي مجاش، واللي بعدوا — برسالة جاهزة ترجّعهم. |
| 2 | 0:19 | Bot misses | And what the bot couldn't answer this week, so you can teach it. It gets smarter because you tell it to, not by magic. | واللي البوت معرفش يرد عليه الأسبوع ده، عشان تعلّمه. بيبقى أشطر لأنك انت بتقوله، مش بالسحر. |
| 3 | 0:28 | The orb | And this — the assistant you can just ask. Who owes money? What did we do for this patient last time? How was Tuesday? Plain Arabic, and it answers from your own data. | وده — المساعد اللي تسأله وخلاص. مين عليه فلوس؟ عملنا إيه للمريض ده المرة اللي فاتت؟ الثلاثاء كان عامل إزاي؟ بالعربي العادي، وبيرد من بياناتك انت. |

## w12

| # | Time | Screen | Narration (EN, spoken) | Subtitle (AR, on screen) |
|---|------|--------|------------------------|---------------------------|
| 0 | 0:00 | Attendance | A few I haven't shown. Attendance and payroll: clock in, clock out, hours, and the month's pay, per person. | كام حاجة موريتهاش. الحضور والمرتبات: تسجيل حضور وانصراف، الساعات، ومرتب الشهر، لكل واحد. |
| 1 | 0:09 | Leads | Leads: anyone who messaged from an ad, before they're a patient. Who called them, when, and whether they booked. | العملاء المحتملين: أي حد بعت من إعلان، قبل ما يبقى مريض. مين كلّمه، إمتى، وحجز ولا لأ. |
| 2 | 0:18 | Marketing | Marketing: posts, offers and ad copy written for you, in your clinic's voice, ready to publish. | التسويق: بوستات وعروض وإعلانات مكتوبة ليك، بصوت عيادتك، جاهزة تتنشر. |
| 3 | 0:26 | Ortho | Orthodontics has its own tracking, visit by visit. | والتقويم ليه متابعته لوحده، زيارة زيارة. |
| 4 | 0:32 | Closing | And all of it is on your phone, too. So — this is Alpha. Try it free: message me, and I'll set your clinic up with you. | وده كله على موبايلك كمان. فـ — دي ألفا. جرّبها مجاناً: ابعتلي، وأظبطلك عيادتك معاك. |
