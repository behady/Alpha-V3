import assert from "node:assert/strict";
import { buildBotPrompt, fixedPromptLayers, LANGUAGE_RULE, PHONE_HIDDEN_LINE, promptVersion, type BotPromptInput } from "../src/lib/bot/botPrompt";

/**
 * The WhatsApp prompt's SHAPE, pinned.
 *
 * Wording is judged by sending the prompt to a model (scripts/probe-model-battery.mts); this
 * file pins what a model cannot tell you it noticed: that the order is the one designed, that
 * the language rule is near the top, that dentist mode puts the script above the medicine
 * prohibitions instead of below them, that nothing is said twice, and that the fixed layers
 * carry no clinic-specific text. Each of these was a measured failure before it was a rule.
 */

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

const base: BotPromptInput = {
  clinicName: "Alpha Dental Clinic",
  mode: "sales",
  clinical: false,
  canBook: true,
  hoursText: "السبت للخميس 12-10",
  addressText: "٥ شارع الجمهورية",
  clinicPhone: "01551558269",
  priceLines: "تنظيف: يبدأ من 700 ج.م",
  facts: { dentists: "د. محمد سمير" },
  patient: { known: true, name: "منى", gender: "female", upcomingAppointment: "الأحد 6 مساءً" },
  personaName: "نور",
  knowledge: [],
  dossierText: "",
  offeredSlots: [{ id: "s1", label: "بكرة 5 مساءً" }],
};

const lines = (s: string) => s.split("\n");

run("the first line says the order matters, and the language rule is within the first six", () => {
  const p = lines(buildBotPrompt(base));
  assert.ok(p[0].includes("اللي مكتوبة أعلى بتكسب"), "precedence sentence first");
  const at = p.findIndex((l) => l.includes(LANGUAGE_RULE));
  assert.ok(at > 0 && at < 6, `language rule at line ${at}`);
  assert.equal(p.filter((l) => l.includes("اللغة بتتحدد")).length, 1, "said once, not twice");
});

run("layers come in the designed order", () => {
  const p = buildBotPrompt(base);
  const order = ["الثوابت —", "شغلانتك النهاردة", "الحجز والمواعيد:", "الأسعار والخدمات:", "الأدوية (", "الحساب والفلوس", "الناس والهويات:", "الشكاوى والغضب:", "الأسلوب —", "معلومات العيادة:"];
  let last = -1;
  for (const marker of order) {
    const i = p.indexOf(marker);
    assert.ok(i > last, `${marker} should come after the previous marker (found at ${i}, previous ${last})`);
    last = i;
  }
});

run("outside dentist mode every medical question goes to a person; inside it the script outranks the medicine rules", () => {
  const plain = buildBotPrompt(base);
  assert.ok(plain.includes("أي سؤال طبي (ألم، ورم، دواء، تشخيص، هل ده طبيعي): اختار handoff_medical"));
  assert.ok(!plain.includes("وضع الدكتور شغال"));

  const dentist = buildBotPrompt({ ...base, clinical: true });
  assert.ok(!dentist.includes("أي سؤال طبي (ألم، ورم"), "the blanket rule is gone");
  assert.ok(dentist.includes("علامات الخطر → handoff_medical فوراً"), "the red flags stay");
  assert.ok(dentist.includes("حامل أو مرضعة أو طفل"), "special populations still hand off when they ask about medicine");
  const script = dentist.indexOf("وضع الدكتور شغال");
  const medicines = dentist.indexOf("الأدوية (اللي الدكتور كتبه بس):");
  const redFlags = dentist.indexOf("علامات الخطر → handoff_medical");
  assert.ok(redFlags < script, "red flags above the script");
  assert.ok(script < medicines, "the script above the medicine prohibitions");
  assert.ok(dentist.includes("السكريبت ده بيكسب"), "and it says so");
});

run("nothing is said twice", () => {
  for (const variant of [base, { ...base, clinical: true }, { ...base, mode: "assisted" as const }, { ...base, canBook: false }]) {
    const seen = new Map<string, number>();
    for (const l of lines(buildBotPrompt(variant))) {
      const t = l.trim();
      if (!t) continue;
      seen.set(t, (seen.get(t) || 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([l]) => l.slice(0, 60));
    assert.deepEqual(dupes, [], `duplicate lines: ${dupes.join(" | ")}`);
  }
});

run("layers 1–4 are identical for every clinic, and the clinic's name is the first fact in layer 5", () => {
  const a = buildBotPrompt(base);
  const b = buildBotPrompt({ ...base, clinicName: "عيادة النور" });
  const fixed = fixedPromptLayers("sales", false, true).filter(Boolean).join("\n");
  assert.ok(a.startsWith(fixed), "the prompt opens with the fixed layers");
  assert.ok(b.startsWith(fixed), "for any clinic");
  assert.ok(!fixed.includes("Alpha") && !fixed.includes("النور"), "no clinic name in the fixed layers");
  assert.ok(a.includes("معلومات العيادة:\nاسم العيادة: Alpha Dental Clinic"));
  assert.ok(b.includes("اسم العيادة: عيادة النور"));
});

run("a number that cannot book is told so, in sales mode only", () => {
  assert.ok(buildBotPrompt({ ...base, canBook: false }).includes("الحجز مش متاح للرقم ده دلوقتي"));
  assert.ok(!buildBotPrompt({ ...base, canBook: true }).includes("الحجز مش متاح للرقم ده"));
  assert.ok(!buildBotPrompt({ ...base, mode: "assisted", canBook: false }).includes("الحجز مش متاح للرقم ده"));
});

run("every action the prompt names is one the schema accepts", () => {
  const known = new Set(["answer", "open_booking", "book_slot", "reschedule", "cancel", "late", "suggest_medicine", "handoff_medical", "handoff_complaint", "handoff_staff", "handoff_other"]);
  const p = buildBotPrompt({ ...base, clinical: true, medicines: [{ id: "m1", label: "مسكن" }] });
  const named = new Set([...p.matchAll(/\b(handoff_[a-z]+|open_booking|book_slot|suggest_medicine|reschedule|cancel|late)\b/g)].map((m) => m[1]));
  for (const n of named) assert.ok(known.has(n), `unknown action ${n}`);
});

run("the rules that each closed an incident are still there", () => {
  const p = buildBotPrompt({ ...base, clinical: false });
  for (const must of [
    "يبدأ من", // prices as ranges
    "خدمات إحنا مش بنعملها", // notOffered
    "are you a bot/AI/human/real person", // the bot question
    "حتى \"زي البروفين\" على سبيل المثال ممنوعة", // no drug names, even as examples
    "أ/", // no ugly abbreviations
    "زي ما قلتلك", // don't repeat what angered them
    "عليا كام", // money from the file only
    "handoff_staff والإدارة هي اللي تتأكد", // claimed identities
    "ملف حد تاني", // someone else's record
    "آمن تماماً", // never "completely safe"
    "متختارش open_booking وترجعه لقايمة الدكاترة", // "the first one" books the first one
    "النظام بيلغي الميعاد فعلاً", // cancel really cancels
    "المريضة **ست**", // feminine address
  ]) {
    assert.ok(p.includes(must), `missing: ${must}`);
  }
});

run("the dynamic sections render exactly as before", () => {
  const p = buildBotPrompt({
    ...base,
    coaching: "  اتكلم رسمي  ",
    knowledge: [{ q: " بتقبلوا فيزا؟ ", a: " أيوه " }],
    playbook: " الخلاصة ",
    sessionGapMinutes: 200,
    flaggedForStaff: true,
    bookingStep: "اختيار الدكتور",
    dossierText: "\nملف المريض",
    memory: " ذاكرة ",
    medicines: [{ id: "m1", label: "مسكن", whenToUse: "وجع" }],
    medicineScreened: false,
    media: [{ id: "f1", label: "صور", when: "لما يسأل" }],
  });
  for (const must of [
    "\nتعليمات صاحب العيادة (التزم بيها حرفياً):\nاتكلم رسمي",
    "س: بتقبلوا فيزا؟\nج: أيوه",
    "\nخلاصة اللي بينجح مع مرضى العيادة دي (اتعلمها من محادثات حقيقية):\nالخلاصة",
    "المريض رجع يكتب بعد 3 ساعة",
    "متعلّم عليها إن حد من الاستقبال يتابعها",
    "المريض دلوقتي في خطوة حجز: اختيار الدكتور",
    "\nملف المريض",
    "ذاكرة من محادثات سابقة مع المريض ده (ابدأ من مكان ما وقفتوا، ومتعيدش اللي هو عارفه):\nذاكرة",
    "- s1 → بكرة 5 مساءً",
    "- [m1] مسكن — بتتقال لما: وجع",
    "المريض لسه مردش على أسئلة الأمان",
    "- [f1] صور — لما يسأل",
    "اسمك نور. عرّف بنفسك مرة واحدة بس",
  ]) {
    assert.ok(p.includes(must), `missing: ${must}`);
  }
});

run("a default brief leaves the prompt unchanged", () => {
  const plain = buildBotPrompt(base);
  assert.equal(buildBotPrompt({ ...base, brief: {} }), plain);
  assert.equal(buildBotPrompt({ ...base, brief: { tone: "friendly", prices: "ranges" } as never }), plain);
});

run("the brief lands in layer 5 only", () => {
  const fixed = fixedPromptLayers(base.mode, base.clinical, base.canBook);
  const withBrief = fixedPromptLayers(base.mode, base.clinical, base.canBook);
  assert.deepEqual(withBrief, fixed, "layers 1-4 do not take a brief");
  const p = buildBotPrompt({ ...base, brief: { focus: "زراعة" } });
  const line = "ركّز في كلامك على: زراعة";
  assert.ok(p.includes(line), "focus line present");
  assert.ok(p.indexOf(line) > p.indexOf("معلومات العيادة:"), "after the clinic-information header");
  assert.ok(p.startsWith(buildBotPrompt(base).split("معلومات العيادة:")[0]), "everything above layer 5 is byte-identical");
});

run("consult drops price lines and the handoff fallback", () => {
  const p = buildBotPrompt({ ...base, priceLines: "تقويم: يبدأ من 15,000", brief: { prices: "consult" } });
  assert.ok(!p.includes("15,000"), "no price in the prompt");
  assert.ok(!p.includes("قائمة الأسعار: غير متوفرة"), "no 'list unavailable' fallback either");
  assert.ok(p.includes("مش بتقول أسعار"), "the consult rule is there");
});

run("consult keeps the service names, without prices", () => {
  const p = buildBotPrompt({ ...base, priceLines: "تقويم: يبدأ من 15,000 ج.م\nتبييض: يبدأ من 3,500 ج.م", brief: { prices: "consult" } });
  assert.ok(p.includes("تقويم") && p.includes("تبييض"), "service names are listed");
  assert.ok(p.includes("قائمة الخدمات اللي بنقدمها"), "under the consult heading");
  assert.ok(!p.includes("15,000") && !p.includes("3,500"), "no price figures");
  assert.ok(!p.includes("قائمة الخدمات والأسعار"), "not the priced heading");
});

/* Owner switches (bot-owner-rules): dentist names hidden, branches shown. Off = today's prompt. */

const HIDE_RULE = '- ممنوع تذكر اسم أي دكتور أو طبيب في ردودك: قول "الدكتور" أو "الدكتور المختص" وخلاص، حتى لو المريض سأل.';
const BRANCH_RULE = "- لو المريض قال إن المكان بعيد أو سأل عن فرع تاني: اعرض عليه الفروع من القائمة (الاسم والعنوان) واسأله أنهي أقرب له — متحوّلش للاستقبال عشان سؤال عن فرع.";
const USUAL_DENTIST = "- لو المريض بيتعالج عادةً عند دكتور معيّن (مكتوب في ملفه)، اعرض عليه المواعيد بتاعته الأول واذكر اسمه.";
const FROM_DENTISTS = 'جاوب من خانة "الأطباء"';

run("the prompt is unchanged when neither new input is set", () => {
  for (const v of [base, { ...base, clinical: true }, { ...base, mode: "assisted" as const }, { ...base, canBook: false }]) {
    const plain = buildBotPrompt(v);
    assert.equal(buildBotPrompt({ ...v, hideDoctorNames: false, branchesText: "" }), plain);
    assert.equal(buildBotPrompt({ ...v, hideDoctorNames: undefined, branchesText: "   " }), plain);
    assert.deepEqual(fixedPromptLayers(v.mode, v.clinical, v.canBook, false), fixedPromptLayers(v.mode, v.clinical, v.canBook));
    assert.equal(promptVersion(v.mode, v.clinical, v.canBook, false), promptVersion(v.mode, v.clinical, v.canBook));
    assert.ok(!plain.includes(HIDE_RULE) && !plain.includes("الفروع:") && !plain.includes(BRANCH_RULE));
    assert.ok(plain.includes("- الأطباء: د. محمد سمير"), "the dentists section is still there");
    assert.ok(plain.includes(USUAL_DENTIST) && plain.includes(FROM_DENTISTS));
  }
});

run("hidden names: the rule is there, the dentists section and the usual-dentist rule are gone", () => {
  const p = buildBotPrompt({ ...base, hideDoctorNames: true });
  assert.equal(p.split("\n").filter((l) => l === HIDE_RULE).length, 1, "said once");
  assert.ok(!p.includes("- الأطباء:"), "no الأطباء section");
  assert.ok(!p.includes("د. محمد سمير"), "no dentist name from the facts");
  assert.ok(!p.includes(USUAL_DENTIST), "no usual-dentist rule");
  assert.ok(!p.includes(FROM_DENTISTS), "no answer-from-the-dentists rule");
  // The rule sits in the fixed layers with the other people rules, so it outranks layer 5.
  assert.ok(fixedPromptLayers("sales", false, true, true).includes(HIDE_RULE));
  assert.ok(p.indexOf(HIDE_RULE) < p.indexOf("معلومات العيادة:"));
  assert.notEqual(promptVersion("sales", false, true, true), promptVersion("sales", false, true));
  // The other facts are untouched.
  assert.ok(buildBotPrompt({ ...base, facts: { parking: "قدام العيادة" }, hideDoctorNames: true }).includes("- الباركن: قدام العيادة"));
});

run("branches: a الفروع block right after the address, and the far-away rule", () => {
  const branchesText = "• المعادي: شارع 9 — ت: 01001234567\n• مدينة نصر: 12 عباس العقاد";
  const p = buildBotPrompt({ ...base, branchesText });
  assert.ok(p.includes(`العنوان: ${base.addressText}\nالفروع:\n${branchesText}\n`), "right after the address line");
  assert.ok(p.includes(BRANCH_RULE));
  assert.ok(p.indexOf(BRANCH_RULE) > p.indexOf("الفروع:"));
  // A clinic with branches but no single address still gets the block.
  assert.ok(buildBotPrompt({ ...base, addressText: undefined, branchesText }).includes(`الفروع:\n${branchesText}`));
  // Layers 1-4 do not change for a branch list.
  assert.ok(p.startsWith(fixedPromptLayers("sales", false, true).filter(Boolean).join("\n")));
});

// ---- hidden number (a lid sender) ---------------------------------------------------------------

run("hidden number: the ask-for-the-number line replaces the no-booking line, and only then", () => {
  const closed = { ...base, canBook: false };
  const p = buildBotPrompt({ ...closed, phoneHidden: true });
  assert.ok(p.includes(PHONE_HIDDEN_LINE), "asks for the number");
  assert.ok(!p.includes("الحجز مش متاح للرقم ده دلوقتي"), "the plain no-booking line is gone");
  assert.equal(p.split("\n").filter((l) => l === PHONE_HIDDEN_LINE).length, 1, "said once");
  assert.notEqual(promptVersion("sales", false, false, false, true), promptVersion("sales", false, false));
  // Not when booking is open (a lid sender who typed their number), not in assisted mode.
  assert.ok(!buildBotPrompt({ ...base, canBook: true, phoneHidden: true }).includes(PHONE_HIDDEN_LINE));
  assert.ok(!buildBotPrompt({ ...closed, mode: "assisted", phoneHidden: true }).includes(PHONE_HIDDEN_LINE));
  // Absent or false: byte-identical to today.
  for (const v of [base, closed, { ...closed, clinical: true }]) {
    assert.equal(buildBotPrompt({ ...v, phoneHidden: false }), buildBotPrompt(v));
    assert.deepEqual(fixedPromptLayers(v.mode, v.clinical, v.canBook, undefined, false), fixedPromptLayers(v.mode, v.clinical, v.canBook));
    assert.equal(promptVersion(v.mode, v.clinical, v.canBook, undefined, false), promptVersion(v.mode, v.clinical, v.canBook));
  }
});
