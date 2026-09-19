package com.alphadental.clinic.data

/**
 * Every alert the system can raise - GENERATED from the website's catalogue.
 *
 * Source of truth: `src/lib/notificationCatalog.ts`. Regenerate with
 * `python scripts/gen-android-notify-catalog.py` (which reads the Functions copy,
 * `functions/notificationCatalog.js`, itself generated from the TypeScript). Never edit the lists
 * by hand: the ids are storage keys shared with the website, the bell and every personal mute
 * list, and a row that disagrees with the website's is a clinic being told two different things.
 *
 * The resolver at the bottom is a straight port of `resolveNotify` and `notifyTiming`, so the
 * phone and the website read the same saved answers the same way.
 */
object NotifyCatalog {

    val ROLES = listOf("Owner", "Admin", "Dentist", "Receptionist", "Assistant")

    data class Group(val id: String, val en: String, val ar: String, val noteEn: String, val noteAr: String)

    data class Timing(
        val key: String,
        /** "minutes", "hours" or "hourOfDay". */
        val kind: String,
        val en: String,
        val ar: String,
        val fallback: Int,
        val min: Int,
        val max: Int,
    )

    data class Event(
        val id: String,
        val group: String,
        val en: String,
        val ar: String,
        val whenEn: String,
        val whenAr: String,
        val roles: List<String>,
        /** The audience is part of what the alert is; no role picker. */
        val rolesFixed: Boolean = false,
        /** A ceiling the clinic cannot raise. */
        val rolesMax: List<String>? = null,
        val bell: Boolean,
        val push: Boolean,
        val ignoresQuietHours: Boolean = false,
        val timings: List<Timing> = emptyList(),
        /** Where the answer lived before the catalogue existed (`alertPreferences.inApp.<key>`). */
        val legacyKey: String? = null,
    )

    val GROUPS: List<Group> = listOf(
        Group("unanswered", "Patients waiting for a reply", "مرضى مستنيين رد", "The only alerts here that cost you money if you switch them off.", "دي التنبيهات اللي إغلاقها بيكلّفك فلوس فعلاً."),
        Group("frontdesk", "Front desk", "الاستقبال", "Arrivals, bookings, and anything the WhatsApp bot changed in the diary.", "الوصول والحجوزات وأي حاجة البوت غيّرها في اليومية."),
        Group("leads", "Leads", "العملاء المحتملين", "New enquiries and the ones nobody has answered yet.", "الاستفسارات الجديدة واللي محدش رد عليها."),
        Group("briefs", "Daily briefs", "ملخص اليوم", "The morning summary. One version for the desk, one for each dentist.", "ملخص الصباح. نسخة للاستقبال ونسخة لكل دكتور."),
        Group("money", "Money", "الفلوس", "Never sent to anyone but owners and admins, whatever you set here.", "مش بتوصل غير للمالك والمدير، مهما تظبّط هنا."),
        Group("clinic", "Running the clinic", "إدارة العيادة", "Stock, the lab, reviews and marketing that is ready to send.", "المخزون والمعمل والتقييمات والتسويق الجاهز للإرسال."),
        Group("delivery", "Is anything broken?", "في حاجة واقفة؟", "Messages that never left the building. Switch these off and a dead WhatsApp connection is silent.", "رسايل مخرجتش. لو قفلتها، انقطاع الواتساب مش هيبان."),
    )

    val EVENTS: List<Event> = listOf(
        Event(
            id = "patientWaitingReply",
            group = "unanswered",
            en = "A patient is waiting for a reply",
            ar = "مريض مستني رد",
            whenEn = "A patient wrote on WhatsApp and nobody at the desk has answered.",
            whenAr = "مريض كتب على واتساب ومحدش من الاستقبال رد.",
            roles = listOf("Owner", "Admin", "Receptionist"),
            bell = true,
            push = true,
            ignoresQuietHours = true,
            timings = listOf(Timing("afterMinutes", "minutes", "Alert after", "نبّه بعد", 15, 2, 240)),
        ),
        Event(
            id = "patientWaitingReplyEscalated",
            group = "unanswered",
            en = "Still waiting — tell the owner",
            ar = "لسه مستني — بلّغ المالك",
            whenEn = "The same patient is still unanswered well past the first alert.",
            whenAr = "نفس المريض لسه مفيش رد عليه بعد التنبيه الأول بكتير.",
            roles = listOf("Owner", "Admin"),
            rolesMax = listOf("Owner", "Admin"),
            bell = true,
            push = true,
            ignoresQuietHours = true,
            timings = listOf(Timing("afterMinutes", "minutes", "Escalate after", "صعّد بعد", 45, 5, 480)),
        ),
        Event(
            id = "botHandedOff",
            group = "unanswered",
            en = "The bot has passed a patient to a person",
            ar = "البوت سلّم مريض لحد",
            whenEn = "The bot could not answer and said reception would. Somebody has to, now.",
            whenAr = "البوت مقدرش يرد وقال إن الاستقبال هيرد. لازم حد يرد، حالاً.",
            roles = listOf("Owner", "Admin", "Receptionist"),
            bell = true,
            push = true,
            ignoresQuietHours = true,
        ),
        Event(
            id = "patientRepliedAfterClaim",
            group = "unanswered",
            en = "Someone took the chat, then went quiet",
            ar = "حد مسك المحادثة وسكت",
            whenEn = "A member of staff took a conversation off the bot, the patient replied, and it was left.",
            whenAr = "حد من الفريق مسك المحادثة من البوت، المريض رد، والمحادثة اتسابت.",
            roles = listOf("Owner", "Admin", "Receptionist"),
            bell = true,
            push = true,
            ignoresQuietHours = true,
        ),
        Event(
            id = "optedOutPatientNeedsReply",
            group = "unanswered",
            en = "A patient who blocked messages needs a person",
            ar = "مريض موقف الرسايل ومحتاج حد",
            whenEn = "Somebody who asked to stop receiving messages has written in. The bot will not answer them, ever.",
            whenAr = "حد طلب إيقاف الرسايل بعت. البوت مش هيرد عليه أبداً.",
            roles = listOf("Owner", "Admin", "Receptionist"),
            bell = true,
            push = true,
            ignoresQuietHours = true,
        ),
        Event(
            id = "urgentPatientMessage",
            group = "unanswered",
            en = "A message the bot refused to answer",
            ar = "رسالة البوت رفض يردّ عليها",
            whenEn = "Pain, bleeding, or anything clinical. The bot hands these straight to a human by design.",
            whenAr = "وجع أو نزيف أو أي حاجة طبية. البوت بيسلّمها لحد فوراً بالتصميم.",
            roles = listOf("Owner", "Admin", "Receptionist"),
            bell = true,
            push = true,
            ignoresQuietHours = true,
        ),
        Event(
            id = "patientArrived",
            group = "frontdesk",
            en = "A patient has arrived",
            ar = "مريض وصل",
            whenEn = "Goes to the dentist treating them, and nobody else.",
            whenAr = "بتوصل للدكتور بتاع الحالة، ومحدش تاني.",
            roles = listOf("Dentist"),
            rolesFixed = true,
            bell = true,
            push = true,
            ignoresQuietHours = true,
            legacyKey = "patientArrival",
        ),
        Event(
            id = "slotFreed",
            group = "frontdesk",
            en = "A slot just freed up",
            ar = "ميعاد فضي",
            whenEn = "An appointment was cancelled or marked a no-show, so the time is available again.",
            whenAr = "ميعاد اتلغى أو المريض مجاش، فالوقت بقى فاضي.",
            roles = listOf("Owner", "Admin", "Receptionist"),
            bell = true,
            push = true,
        ),
        Event(
            id = "onlineBooking",
            group = "frontdesk",
            en = "A new online booking",
            ar = "حجز جديد أونلاين",
            whenEn = "Somebody booked themselves through the clinic's public booking page.",
            whenAr = "حد حجز لنفسه من صفحة الحجز العامة.",
            roles = listOf("Owner", "Admin", "Receptionist"),
            bell = true,
            push = true,
        ),
        Event(
            id = "botBooked",
            group = "frontdesk",
            en = "The bot booked an appointment",
            ar = "البوت حجز ميعاد",
            whenEn = "A patient booked over WhatsApp without a person being involved.",
            whenAr = "مريض حجز على واتساب من غير أي حد.",
            roles = listOf("Owner", "Admin", "Receptionist"),
            bell = true,
            push = true,
        ),
        Event(
            id = "botRescheduled",
            group = "frontdesk",
            en = "The bot moved an appointment",
            ar = "البوت عدّل ميعاد",
            whenEn = "A patient changed their own time over WhatsApp.",
            whenAr = "مريض غيّر ميعاده بنفسه على واتساب.",
            roles = listOf("Owner", "Admin", "Receptionist"),
            bell = true,
            push = true,
        ),
        Event(
            id = "botCancelled",
            group = "frontdesk",
            en = "The bot cancelled an appointment",
            ar = "البوت لغى ميعاد",
            whenEn = "A patient cancelled over WhatsApp. The slot is now free.",
            whenAr = "مريض لغى على واتساب. الميعاد بقى فاضي.",
            roles = listOf("Owner", "Admin", "Receptionist"),
            bell = true,
            push = true,
        ),
        Event(
            id = "patientRequestedChange",
            group = "frontdesk",
            en = "A patient is asking to cancel, move, or says they'll be late",
            ar = "مريض بيطلب إلغاء أو تعديل أو بيقول هيتأخر",
            whenEn = "Asked for, not done — somebody has to act on it.",
            whenAr = "طلب، مش تنفيذ — لازم حد يتصرّف.",
            roles = listOf("Owner", "Admin", "Receptionist"),
            bell = true,
            push = true,
            ignoresQuietHours = true,
        ),
        Event(
            id = "newLead",
            group = "leads",
            en = "A new lead came in",
            ar = "عميل محتمل جديد",
            whenEn = "From a Facebook or Instagram ad, the moment the form is submitted.",
            whenAr = "من إعلان فيسبوك أو إنستجرام، لحظة إرسال الفورم.",
            roles = listOf("Owner", "Admin", "Receptionist"),
            bell = true,
            push = true,
        ),
        Event(
            id = "leadWaiting",
            group = "leads",
            en = "A lead is waiting for an answer",
            ar = "عميل محتمل مستني رد",
            whenEn = "Nobody has replied to a new enquiry. The first minutes are what win it.",
            whenAr = "محدش رد على استفسار جديد. أول دقايق هي اللي بتكسبه.",
            roles = listOf("Owner", "Admin", "Receptionist"),
            bell = true,
            push = true,
            timings = listOf(Timing("afterMinutes", "minutes", "Alert after", "نبّه بعد", 15, 2, 240)),
        ),
        Event(
            id = "leadAbandoned",
            group = "leads",
            en = "A paid lead has been abandoned",
            ar = "عميل مدفوع اتسيب",
            whenEn = "You paid for this enquiry and hours later nobody has replied. Goes over the desk's head on purpose.",
            whenAr = "دفعت فلوس على الاستفسار ده وبعد ساعات محدش رد. بتتعدّى الاستقبال بالتصميم.",
            roles = listOf("Owner", "Admin"),
            rolesMax = listOf("Owner", "Admin"),
            bell = true,
            push = true,
            timings = listOf(Timing("afterMinutes", "minutes", "Escalate after", "صعّد بعد", 120, 15, 1440)),
        ),
        Event(
            id = "leadFollowupsDue",
            group = "leads",
            en = "Follow-up calls are due today",
            ar = "مكالمات متابعة مستحقة النهارده",
            whenEn = "A once-a-day count of the leads somebody promised to call back.",
            whenAr = "عدّ مرة في اليوم للعملاء اللي حد وعد يكلّمهم.",
            roles = listOf("Owner", "Admin", "Receptionist"),
            bell = true,
            push = true,
            timings = listOf(Timing("hour", "hourOfDay", "Send at", "ابعت الساعة", 10, 0, 23)),
        ),
        Event(
            id = "morningBriefClinic",
            group = "briefs",
            en = "The clinic's morning brief",
            ar = "ملخص الصباح للعيادة",
            whenEn = "How many are booked today and what time the first one is.",
            whenAr = "كام محجوز النهارده وأول ميعاد إمتى.",
            roles = listOf("Owner", "Admin", "Receptionist"),
            bell = true,
            push = true,
            timings = listOf(Timing("hour", "hourOfDay", "Send at", "ابعت الساعة", 7, 0, 23)),
        ),
        Event(
            id = "morningBriefDentist",
            group = "briefs",
            en = "Each dentist's own day",
            ar = "يوم كل دكتور",
            whenEn = "Sent to each dentist separately, containing only their own patients.",
            whenAr = "بتتبعت لكل دكتور لوحده، وفيها مرضاه بس.",
            roles = listOf("Dentist"),
            rolesFixed = true,
            bell = true,
            push = true,
            timings = listOf(Timing("hour", "hourOfDay", "Send at", "ابعت الساعة", 7, 0, 23)),
        ),
        Event(
            id = "eveningDigest",
            group = "money",
            en = "The day, closed out",
            ar = "اليوم بعد ما يخلص",
            whenEn = "What came through the door today, and who was late or absent.",
            whenAr = "اللي دخل النهارده، ومين اتأخر أو غاب.",
            roles = listOf("Owner", "Admin"),
            rolesMax = listOf("Owner", "Admin"),
            bell = true,
            push = true,
            timings = listOf(Timing("hour", "hourOfDay", "Send at", "ابعت الساعة", 21, 0, 23)),
        ),
        Event(
            id = "stockLow",
            group = "clinic",
            en = "Something is running low",
            ar = "حاجة قربت تخلص",
            whenEn = "An item dropped to its reorder point.",
            whenAr = "صنف وصل لحد إعادة الطلب.",
            roles = listOf("Owner", "Admin", "Receptionist"),
            bell = true,
            push = true,
        ),
        Event(
            id = "labCaseBack",
            group = "clinic",
            en = "A lab case is back",
            ar = "حالة معمل وصلت",
            whenEn = "Somebody marked a case received. Call the patient and book the fitting.",
            whenAr = "حد سجّل إن الحالة وصلت. كلّم المريض واحجزله التركيب.",
            roles = listOf("Owner", "Admin", "Receptionist"),
            bell = false,
            push = false,
            legacyKey = "labReady",
        ),
        Event(
            id = "reviewRequestsReady",
            group = "clinic",
            en = "Review requests are ready to send",
            ar = "طلبات تقييم جاهزة",
            whenEn = "Today's happy patients, drafted and waiting for one tap in Marketing.",
            whenAr = "مرضى النهارده المبسوطين، الرسايل متجهزة ومستنية ضغطة في التسويق.",
            roles = listOf("Owner", "Admin", "Receptionist"),
            bell = true,
            push = true,
        ),
        Event(
            id = "birthdayWishesReady",
            group = "clinic",
            en = "Birthday wishes are ready to send",
            ar = "تهاني أعياد ميلاد جاهزة",
            whenEn = "Drafted for today's birthdays, waiting for you to look and send.",
            whenAr = "متجهزة لأعياد ميلاد النهارده، مستنية تبصّ وتبعت.",
            roles = listOf("Owner", "Admin", "Receptionist"),
            bell = true,
            push = true,
        ),
        Event(
            id = "occasionSoon",
            group = "clinic",
            en = "A season is coming up",
            ar = "مناسبة جاية",
            whenEn = "Ten days before Ramadan, back-to-school and the rest, so there is time to prepare.",
            whenAr = "عشر أيام قبل رمضان والمدارس وغيرهم، عشان يبقى في وقت للتحضير.",
            roles = listOf("Owner", "Admin"),
            bell = true,
            push = true,
        ),
        Event(
            id = "unhappyReview",
            group = "clinic",
            en = "A patient rated their visit poorly",
            ar = "مريض قيّم الزيارة وحش",
            whenEn = "Reaches the manager's pocket instead of Google. A call the same day is what turns it around.",
            whenAr = "بتوصل للمدير مش لجوجل. مكالمة في نفس اليوم هي اللي بتقلبها.",
            roles = listOf("Owner", "Admin"),
            rolesMax = listOf("Owner", "Admin"),
            bell = true,
            push = true,
            ignoresQuietHours = true,
        ),
        Event(
            id = "fiveStarReview",
            group = "clinic",
            en = "A patient left five stars",
            ar = "مريض قيّم ٥ نجوم",
            whenEn = "Worth knowing the same day — that is when to ask them for a video.",
            whenAr = "يستحق تعرفه في نفس اليوم — ده وقت ما تطلب منه فيديو.",
            roles = listOf("Owner", "Admin", "Receptionist"),
            bell = true,
            push = true,
        ),
        Event(
            id = "messagesStuck",
            group = "delivery",
            en = "Messages to patients are not going out",
            ar = "رسايل المرضى مش بتخرج",
            whenEn = "The queue has stopped moving. Usually a dead WhatsApp connection, and otherwise silent.",
            whenAr = "الطابور واقف. عادةً انقطاع واتساب، ومن غير كده مفيش أي علامة.",
            roles = listOf("Owner", "Admin"),
            bell = true,
            push = true,
            timings = listOf(Timing("hour", "hourOfDay", "Check at", "اتشيّك الساعة", 11, 0, 23), Timing("stuckHours", "hours", "Count as stuck after", "اعتبرها واقفة بعد", 3, 1, 48)),
        ),
        Event(
            id = "aiCreditsOut",
            group = "delivery",
            en = "The AI ran out of credit",
            ar = "رصيد الذكاء الاصطناعي خلص",
            whenEn = "The bot has stopped answering patients and is sending them all to reception.",
            whenAr = "البوت وقف عن الرد على المرضى وبيحوّلهم كلهم للاستقبال.",
            roles = listOf("Owner", "Admin"),
            rolesMax = listOf("Owner", "Admin"),
            bell = true,
            push = true,
            ignoresQuietHours = true,
        ),
        Event(
            id = "messageWaitingManual",
            group = "delivery",
            en = "A message is waiting to be sent by hand",
            ar = "رسالة مستنية تتبعت بالإيد",
            whenEn = "Only happens when WhatsApp sending is set to manual. Switch this off and nobody knows to send them.",
            whenAr = "بتحصل بس لما إرسال واتساب يكون يدوي. لو قفلتها محدش هيعرف يبعتها.",
            roles = listOf("Owner", "Admin", "Receptionist"),
            bell = true,
            push = true,
        ),
    )

    fun event(id: String): Event? = EVENTS.firstOrNull { it.id == id }

    fun eventsIn(group: String): List<Event> = EVENTS.filter { it.group == group }

    /** What one alert resolves to for a clinic: where it goes, and to whom. */
    data class Resolved(val event: Event, val bell: Boolean, val push: Boolean, val roles: List<String>)

    /**
     * The clinic's own answer, then the answer it gave before this page existed, then the
     * catalogue's default. Same order as the website's `resolveNotify`.
     */
    fun resolve(eventId: String, prefs: Map<String, Any?>?): Resolved? {
        val event = event(eventId) ?: return null
        val saved = (prefs?.get("events") as? Map<*, *>)?.get(eventId) as? Map<*, *>
        val legacy = event.legacyKey?.let { (prefs?.get("inApp") as? Map<*, *>)?.get(it) as? Boolean }
        val bell = (saved?.get("bell") as? Boolean) ?: legacy ?: event.bell
        val push = (saved?.get("push") as? Boolean) ?: legacy ?: event.push
        var roles = event.roles
        val askedRoles = saved?.get("roles") as? List<*>
        if (!event.rolesFixed && askedRoles != null) {
            roles = askedRoles.mapNotNull { it?.toString() }.filter { it in ROLES }
        }
        event.rolesMax?.let { max -> roles = roles.filter { it in max } }
        return Resolved(event, bell, push, roles)
    }

    /** One of an alert's numbers as this clinic set it, or what the code used before. */
    fun timing(eventId: String, key: String, prefs: Map<String, Any?>?): Int {
        val t = event(eventId)?.timings?.firstOrNull { it.key == key } ?: return 0
        val raw = ((prefs?.get("timings") as? Map<*, *>)?.get(eventId) as? Map<*, *>)?.get(key) as? Number
        val v = raw?.toInt() ?: return t.fallback
        return v.coerceIn(t.min, t.max)
    }
}
