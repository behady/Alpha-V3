/**
 * The assistant may repeat a medicine's name. It may never introduce one.
 *
 * The prompt already says so at length, and the model still slipped: asked about a painful tooth
 * it answered "you can take a painkiller like Brufen", which is a prescription written by a
 * receptionist — to a patient who might be pregnant, asthmatic, on blood thinners, or nursing an
 * ulcer, none of which a WhatsApp thread can rule out. Rules the model is asked to follow are
 * followed most of the time; this is the part that has to be true every time, so it is code.
 *
 * The line drawn here is narrow on purpose. Two mentions are legitimate and stay allowed:
 *
 *   1. **The dentist's own prescription.** Reading back what is written in this patient's file is
 *      the whole pharmacist skill the clinic asked for, and it invents nothing.
 *   2. **A name the patient just used.** "Can I take Panadol with this?" has to be answerable with
 *      "about the Panadol, the dentist has to be the one to say" — echoing their word back is not
 *      recommending it, and refusing to say it at all makes the reply unreadable.
 *
 * Anything else — a brand the model reached for on its own — is treated the way a stray price is:
 * one corrective retry, then a person.
 */

/**
 * One medicine, in every spelling it reaches WhatsApp in.
 *
 * Brand and generic and Arabic transliteration are deliberately ONE entry rather than three. The
 * printed prescription says "Brufen 600" because that is what the pharmacy sells; the patient
 * writes "بروفين"; the model, answering in Arabic, writes whichever it likes. Split into separate
 * entries, a legitimate read-back of the dentist's own line would trip the guard the moment the
 * script changed — which is a worse failure than the one being prevented, because it silences a
 * correct answer.
 */
const DRUGS: string[][] = [
  // --- painkillers and anti-inflammatories ---------------------------------------------------
  ["brufen", "ibuprofen", "بروفين", "بروفن", "ايبوبروفين", "ابوبروفين"],
  ["cataflam", "catafast", "diclofenac", "voltaren", "كتافلام", "كتافاست", "ديكلوفيناك", "فولتارين", "ديكلاك", "رابيدوس", "ديكلوفين"],
  ["ketolac", "ketorolac", "كيتولاك", "كيتوفان", "كيتورولاك"],
  ["celebrex", "celecoxib", "سيليبريكس", "سيليكوكسيب"],
  ["panadol", "adol", "paracetamol", "cetal", "بنادول", "بانادول", "ادول", "سيتال", "باراسيتامول", "بارامول"],
  ["novalgin", "dipyrone", "نوفالجين", "نوفالدول"],
  ["aspirin", "aspocid", "اسبرين", "اسبوسيد"],
  // --- antibiotics ---------------------------------------------------------------------------
  ["augmentin", "amoxicillin", "hibiotic", "megamox", "moxclav", "amoxil", "اوجمنتين", "اوجمانتين", "اموكسيسيللين", "اموكسيسلين", "هاي بيوتك", "ميجاموكس", "اي موكس"],
  ["flagyl", "metronidazole", "amrizole", "فلاجيل", "امريزول", "ميترونيدازول"],
  ["rodogyl", "spiramycin", "روداجيل", "سبيرامايسين"],
  ["dalacin", "clindamycin", "دالاسين", "كليندامايسين"],
  ["xithrone", "azithromycin", "زيثرون", "ازيثرومايسين", "زيثروماكس"],
  ["ceporex", "cephalexin", "سيبوركس", "سيفالكسين"],
  ["vibramycin", "doxycycline", "فيبرامايسين", "دوكسيسيكلين"],
  ["erythrocin", "erythromycin", "اريثرومايسين"],
  ["ciprofar", "ciprofloxacin", "سيبروفار", "سيبروفلوكساسين"],
  // --- everything else the formulary can prescribe ---------------------------------------------
  ["alphintern", "chymotrypsin", "الفينترن", "الفانترن"],
  ["danzen", "serratiopeptidase", "دانزن"],
  ["dexamethasone", "ديكساميثازون", "كورتيزون", "ديبروفوس"],
  ["hexitol", "chlorhexidine", "هيكسيتول", "كلورهيكسيدين"],
  ["orovex", "اوروفكس"],
  ["betadine", "povidone", "بيتادين"],
  ["tantum", "benzydamine", "تانتوم"],
  ["miconaz", "miconazole", "ميكوناز", "ميكونازول"],
  ["nystatin", "نيستاتين"],
  ["diflucan", "fluconazole", "ديفلوكان", "فلوكونازول"],
  ["zovirax", "acyclovir", "زوفيراكس", "اسيكلوفير"],
  ["kapron", "tranexamic", "كابرون", "ترانيكساميك"],
  ["dicynone", "etamsylate", "دايسينون"],
  ["omez", "omeprazole", "اوميز", "اوميبرازول"],
  ["claritine", "loratadine", "كلاريتين", "لوراتادين"],
  ["atarax", "hydroxyzine", "اتاراكس"],
  ["neurorubine", "نيوروروبين"],
];

/** Alef and ya spellings vary by keyboard; a needle must not depend on which one was typed. */
function normalize(text: string): string {
  return String(text || "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase();
}

/** Latin needles match whole words; Arabic has no case and no reliable boundary, so substring. */
function hasForm(haystack: string, form: string): boolean {
  const f = normalize(form);
  if (!f) return false;
  if (/^[a-z\s]+$/.test(f)) return new RegExp(`\\b${f.replace(/\s+/g, "\\s+")}\\b`).test(haystack);
  return haystack.includes(f);
}

/**
 * Medicines the reply names that neither the dentist nor the patient put on the table.
 *
 * `allowed` is free text — the patient's own message plus their prescription lines — rather than a
 * parsed list, because a name only has to APPEAR in one of them to be fair game, and parsing
 * "Augmentin 1g — كل 12 ساعة" back into a token is a second thing to get wrong.
 */
export function strayDrugNames(reply: string, allowed: string): string[] {
  const text = normalize(reply);
  if (!text.trim()) return [];
  const safe = normalize(allowed);
  const found: string[] = [];
  for (const forms of DRUGS) {
    const said = forms.find((f) => hasForm(text, f));
    if (!said) continue;
    if (forms.some((f) => hasForm(safe, f))) continue;
    found.push(said);
  }
  return found;
}
