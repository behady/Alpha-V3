/**
 * What went wrong, said in the language on screen.
 *
 * The stock route answers in English and the browser's own word for "no internet" is
 * "Failed to fetch". Someone working in Arabic was shown both as they came. This turns every
 * message the route can send into Arabic, keeps the numbers and drawer codes that were in it,
 * and gives anything it does not recognise one plain Arabic line instead of raw English.
 */

type Rule = [RegExp, (m: RegExpMatchArray) => string];

const NO_INTERNET = /failed to fetch|networkerror|network request failed|load failed/i;

const RULES: Rule[] = [
  [/^Pick at least one item to stock\.$/, () => "اختار صنف واحد على الأقل."],
  [/^That is too much to set up in one go/, () => "ده كتير على مرة واحدة. اختار أصناف أقل وكمّل الباقي بعدين."],
  [/^A drawer needs a room code/, () => "الدرج محتاج كود غرفة."],
  [/^There is already a drawer (.+)\.$/, (m) => `فيه درج بالكود ${m[1]} قبل كده.`],
  [/^A room needs a short code/, () => "الغرفة محتاجة كود قصير."],
  [/^Say how many drawers or shelves it has\.$/, () => "قول فيه كام درج أو رف."],
  [/^That room already has (\d+) cabinets\.$/, (m) => `الغرفة دي فيها ${m[1]} دولاب خلاص.`],
  [/^A cabinet holds at most (\d+) drawers\.$/, (m) => `الدولاب آخره ${m[1]} درج.`],
  [/^A cabinet holds at most (\d+) shelves\.$/, (m) => `الدولاب آخره ${m[1]} رف.`],
  [/^Too many\.$/, () => "العدد كبير. قلّله وجرّب تاني."],
  [/^This one still holds (\d+) items? with stock/, (m) => `لسه فيه ${m[1]} صنف عليه كمية. انقلهم أو امسحهم الأول.`],
  [/^That is not an uploaded photo\.$/, () => "الصورة ما اترفعتش. صوّر تاني."],
  [/^The item needs a name\.$/, () => "الصنف محتاج اسم."],
  [/^(The|A) brand needs a name\.$/, () => "الماركة محتاجة اسم."],
  [/^Which drawer does it live in\?$/, () => "اختار الدرج."],
  [/^Which item is this a brand of\?$/, () => "اختار الصنف."],
  [/^Which patient\?$/, () => "اكتب اسم المريض."],
  [/^Which room, and what is it called\?$/, () => "اكتب اسم الغرفة."],
  [/^This row still has stock/, () => "السطر ده لسه عليه كمية. أكّد المسح الأول."],
  [/^No barcode\.$/, () => "مفيش باركود."],
  [/^Nothing to receive\.$/, () => "مفيش سطور تتستلم."],
  [/^One of the lines points at a drawer that no longer exists\.$/, () => "سطر من السطور على درج اتمسح. اختار له درج تاني."],
  [/^One of the brands no longer exists\.$/, () => "ماركة من السطور اتمسحت. شيل السطر وضيفه تاني."],
  [/^A line needs a brand or a new product\.$/, () => "كل سطر محتاج ماركة أو منتج جديد."],
  [/^A new product must say which item it is\.$/, () => "المنتج الجديد لازم يتحدد له صنف."],
  [/^That brand is not in that drawer\.$/, () => "الماركة دي مش في الدرج ده."],
  [/^The drawer shows none left/, () => "الدرج مسجّل إن مفيش منه. لو ده غلط، عدّه الأول."],
  [/^Pick a count to look at\.$/, () => "اختار عدّ."],
  [/^The count to compare with no longer exists\.$/, () => "العدّ اللي بتقارن بيه مبقاش موجود."],
  [/^That count no longer exists\.$/, () => "العدّ ده مبقاش موجود."],
  [/^Compare with an earlier count/, () => "قارن بعدّ أقدم، مش أحدث."],
  [/^Those two counts are too far apart/, () => "العدّتين بعاد عن بعض. اختار عدّ أقرب."],
  [/^That drawer no longer exists\.$/, () => "الدرج ده اتمسح. حدّث الصفحة."],
  [/^That item no longer exists\.$/, () => "الصنف ده اتمسح. حدّث الصفحة."],
  [/^That brand no longer exists\.$/, () => "الماركة دي اتمسحت. حدّث الصفحة."],
  [/^That row no longer exists\.$/, () => "السطر ده اتمسح. حدّث الصفحة."],
  [/^Could not load the cupboard\.$/, () => "الدولاب ما اتحمّلش. جرّب تاني."],
  [/^Could not load the counts\.$/, () => "العدّات ما اتحمّلتش. جرّب تاني."],
  [/^Could not compare those counts\.$/, () => "المقارنة ما اشتغلتش. جرّب تاني."],
  [/^Could not load the history\.$/, () => "السجل ما اتحمّلش. جرّب تاني."],
  [/^Could not make the Excel file\.$/, () => "ملف الإكسل ما اتعملش. جرّب تاني."],
  [/storage\//, () => "الصورة ما اترفعتش. جرّب تاني."],
  [/signed out|unauthorized|invalid token/i, () => "خرجت من الحساب. سجّل دخولك وجرّب تاني."],
  [/permission|forbidden|admin access|profile not found|only the clinic owner/i, () => "مش مسموح لك بالخطوة دي. اسأل الأدمن."],
  [/^Something went wrong\. Nothing was changed\.$/, () => "حصلت مشكلة. مفيش حاجة اتغيرت. جرّب تاني."],
  // The route's "Which drawer?" family means the page sent a request with a piece missing.
  [/^Which .+\?$/, () => "في حاجة ناقصة. حدّث الصفحة وجرّب تاني."],
];

const ARABIC = /[؀-ۿ]/;

export function friendlyStockError(message: string, ar: boolean): string {
  const raw = (message || "").trim();
  if (NO_INTERNET.test(raw)) {
    return ar ? "مفيش اتصال بالنت. اتأكد من النت وجرّب تاني. مفيش حاجة اتغيرت." : "No internet connection. Check it and try again. Nothing was changed.";
  }
  if (!ar) return raw || "Something went wrong. Nothing was changed.";
  if (ARABIC.test(raw)) return raw;
  for (const [re, say] of RULES) {
    const hit = raw.match(re);
    if (hit) return say(hit);
  }
  // Unknown: say so plainly, and do not promise that nothing changed, because nobody checked.
  return "حصلت مشكلة. جرّب تاني.";
}
