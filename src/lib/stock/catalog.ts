import type { StockShape, StockUnit } from "./types";

/**
 * The built-in catalogue: what an Egyptian general practice stocks, named the way staff say it.
 *
 * Nothing here is a brand. A clinic's brands arrive as variants with the first delivery. The
 * `group` places each item in the standard cabinet map (see STANDARD_MAP); `starter` marks the
 * short list a one-chair clinic can accept in one tap. Arabic names are the words used at the
 * chair, not dictionary translations, because that is what a new assistant hears.
 */
export interface CatalogItem {
  key: string;
  en: string;
  ar: string;
  unit: StockUnit;
  per: string;
  shape: StockShape;
  group: CatalogGroup;
  tracked?: boolean;
  starter?: boolean;
  /** Extra words search should match: slang, spellings, abbreviations. */
  syn?: string;
}

export type CatalogGroup =
  | "anaesthesia" | "fillings" | "endo" | "burs" | "disposables" | "impressions" | "suction"
  | "sterilisation" | "surgery" | "ortho" | "pedo" | "whitening" | "xray" | "pharmacy" | "prostho";

export const CATALOG_GROUPS: Record<CatalogGroup, { en: string; ar: string }> = {
  anaesthesia: { en: "Anaesthesia", ar: "التخدير" },
  fillings: { en: "Fillings & bonding", ar: "الحشوات والبوند" },
  endo: { en: "Root canal", ar: "علاج الجذور" },
  burs: { en: "Burs & polishing", ar: "السنون والتلميع" },
  disposables: { en: "Gloves & masks", ar: "جلافز وماسكات" },
  impressions: { en: "Impressions & temporaries", ar: "الطبعات والمؤقت" },
  suction: { en: "Suction & cotton", ar: "سكشن وقطن" },
  sterilisation: { en: "Sterilisation", ar: "التعقيم" },
  surgery: { en: "Surgery & implants", ar: "الجراحة والزراعة" },
  ortho: { en: "Orthodontics", ar: "التقويم" },
  pedo: { en: "Children", ar: "الأطفال" },
  whitening: { en: "Whitening", ar: "التبييض" },
  xray: { en: "X-ray", ar: "الأشعة" },
  pharmacy: { en: "Medications", ar: "الأدوية" },
  prostho: { en: "Crown & bridge", ar: "التركيبات" },
};

const I = (
  key: string, group: CatalogGroup, en: string, ar: string, unit: StockUnit, per: string, shape: StockShape,
  extra: Partial<Pick<CatalogItem, "tracked" | "starter" | "syn">> = {}
): CatalogItem => ({ key, group, en, ar, unit, per, shape, ...extra });

export const CATALOG: CatalogItem[] = [
  // anaesthesia
  I("anes-art", "anaesthesia", "Articaine 4% carpules", "بنج أرتيكايين", "box", "50 carpules", "box", { starter: true, syn: "بنج كاربول articaine septanest ubistesin" }),
  I("anes-mepi", "anaesthesia", "Mepivacaine 3% carpules", "بنج ميبيفاكايين", "box", "50 carpules", "box", { syn: "scandonest بنج كاربول" }),
  I("anes-lido", "anaesthesia", "Lidocaine 2% carpules", "بنج ليدوكايين", "box", "50 carpules", "box", { syn: "lidocaine بنج" }),
  I("needle-short", "anaesthesia", "Needles 30G short", "إبر 30G قصيرة", "box", "100 pcs", "box", { starter: true, syn: "ابر needles سن بنج" }),
  I("needle-long", "anaesthesia", "Needles 27G long", "إبر 27G طويلة", "box", "100 pcs", "box", { syn: "ابر needles" }),
  I("topical", "anaesthesia", "Topical anaesthetic gel", "توبيكال جل", "jar", "30 g", "jar", { starter: true, syn: "توبيكال topical benzocaine" }),
  I("topical-spray", "anaesthesia", "Topical anaesthetic spray", "توبيكال سبراي", "bottle", "50 ml", "bottle", { syn: "سبراي بنج" }),
  // fillings
  I("comp", "fillings", "Composite", "كومبوزيت", "syringe", "4 g", "syringe", { starter: true, syn: "كمبوزت كومبوزت حشو ضوئي composite resin" }),
  I("flow", "fillings", "Flowable composite", "فلو", "syringe", "2 g", "syringe", { starter: true, syn: "شرم فلو flow flowable" }),
  I("bulk", "fillings", "Bulk-fill composite", "بالك فيل", "syringe", "4 g", "syringe", { syn: "bulk fill" }),
  I("bond", "fillings", "Bonding agent", "بوند", "bottle", "5 ml", "bottle", { starter: true, syn: "بوندنج adhesive bond universal" }),
  I("etch", "fillings", "Etching gel 37%", "إتش", "syringe", "3 ml", "syringe", { starter: true, syn: "اتش شرم اتش acid etch phosphoric" }),
  I("gic", "fillings", "Glass ionomer", "جلاس أيونومر", "set", "powder + liquid", "box", { syn: "GI glass ionomer جلاس" }),
  I("liner", "fillings", "Calcium hydroxide liner", "لاينر", "set", "base + catalyst", "cartridge", { syn: "dycal liner" }),
  I("matrix", "fillings", "Matrix bands", "ماتريكس", "pack", "12 pcs", "pack", { starter: true, syn: "matrix band شرائط" }),
  I("wedges", "fillings", "Wooden wedges", "ويدجز", "box", "100 pcs", "box", { syn: "wedge اسافين" }),
  I("strips", "fillings", "Polishing strips", "شرائط تلميع", "pack", "50 pcs", "pack", { syn: "finishing strip" }),
  I("artic", "fillings", "Articulating paper", "ورق عضة", "box", "12 books", "pack", { syn: "articulating paper ورق كربون" }),
  I("temp-fill", "fillings", "Temporary filling", "حشو مؤقت", "jar", "40 g", "jar", { syn: "cavit تمبوراري temporary" }),
  // endo
  I("kfiles", "endo", "Hand files", "فايلات يد", "pack", "6 pcs", "pack", { starter: true, syn: "فايل files k-file k file" }),
  I("rotary", "endo", "Rotary files", "فايلات روتاري", "pack", "6 pcs", "pack", { syn: "روتاري protaper rotary" }),
  I("gp", "endo", "Gutta percha points", "جوتا", "box", "120 pcs", "box", { starter: true, syn: "جوتا gutta percha" }),
  I("paper", "endo", "Paper points", "بيبر بوينت", "box", "200 pcs", "box", { starter: true, syn: "paper points" }),
  I("sealer", "endo", "Root canal sealer", "سيلر", "set", "1 set", "cartridge", { syn: "sealer ah plus" }),
  I("naocl", "endo", "Sodium hypochlorite", "كلور", "bottle", "1 L", "bottle", { starter: true, syn: "كلور naocl hypo hypochlorite" }),
  I("edta", "endo", "EDTA gel", "إيدتا", "syringe", "5 ml", "syringe", { syn: "edta" }),
  I("irrig-needles", "endo", "Irrigation needles", "إبر غسيل", "box", "100 pcs", "box", { syn: "irrigation needles" }),
  I("caoh", "endo", "Calcium hydroxide paste", "كالسيوم هيدروكسيد", "syringe", "2 g", "syringe", { syn: "calcium hydroxide metapex" }),
  I("rubber-dam", "endo", "Rubber dam sheets", "ربر دام", "box", "36 pcs", "pack", { syn: "rubber dam" }),
  I("gates", "endo", "Gates Glidden drills", "جيتس", "pack", "6 pcs", "pack", { syn: "gates glidden" }),
  // burs
  I("dia", "burs", "Diamond burs", "سنون دايموند", "box", "5 pcs", "box", { starter: true, syn: "بير سنون diamond burs" }),
  I("carbide", "burs", "Carbide burs", "سنون كاربايد", "box", "5 pcs", "box", { syn: "بير كاربايد carbide" }),
  I("round-bur", "burs", "Round burs", "سنون روند", "box", "5 pcs", "box", { syn: "بير round" }),
  I("stones", "burs", "Polishing stones", "ستونز", "box", "12 pcs", "box", { syn: "ستونز stones white stone" }),
  I("discs", "burs", "Polishing discs", "ديسكات", "box", "40 pcs", "box", { syn: "soflex discs ديسك" }),
  I("rubber-cups", "burs", "Prophy rubber cups", "كاسات تلميع", "pack", "100 pcs", "pack", { syn: "prophy cups" }),
  I("prophy-paste", "burs", "Prophy paste", "معجون تلميع", "jar", "200 g", "jar", { syn: "prophy paste" }),
  // disposables
  I("gloves", "disposables", "Gloves", "جلافز", "box", "100 pcs", "box", { starter: true, syn: "قفازات gloves جوانتي" }),
  I("masks", "disposables", "Face masks", "ماسكات", "box", "50 pcs", "box", { starter: true, syn: "كمامات masks" }),
  I("bibs", "disposables", "Patient bibs", "مرايل", "pack", "125 pcs", "pack", { starter: true, syn: "bibs napkins مريلة" }),
  I("cups", "disposables", "Paper cups", "أكواب", "pack", "100 pcs", "pack", { starter: true, syn: "كوبايات cups" }),
  I("headrest", "disposables", "Headrest covers", "أغطية مسند", "box", "250 pcs", "pack", { syn: "headrest covers" }),
  I("sleeves-3in1", "disposables", "3-in-1 syringe sleeves", "أكياس السرنجة", "box", "500 pcs", "pack", { syn: "sleeves covers" }),
  // suction
  I("suction", "suction", "Saliva ejectors", "سكشن", "pack", "100 pcs", "pack", { starter: true, syn: "سكشن suction tips ejector" }),
  I("hve", "suction", "HVE suction tips", "سكشن كبير", "pack", "25 pcs", "pack", { syn: "high volume suction" }),
  I("cotton", "suction", "Cotton rolls", "قطن رول", "bag", "1000 pcs", "bag", { starter: true, syn: "قطن cotton" }),
  I("gauze", "suction", "Gauze", "شاش", "pack", "100 pcs", "pack", { starter: true, syn: "شاش gauze" }),
  I("micro", "suction", "Micro applicator tips", "ميكروبراش", "box", "100 pcs", "box", { syn: "microbrush applicator" }),
  I("mixing-tips", "suction", "Mixing tips", "مكسنج تيبس", "bag", "50 pcs", "bag", { syn: "mixing tips" }),
  // impressions
  I("alginate", "impressions", "Alginate", "ألجينات", "bag", "450 g", "bag", { starter: true, syn: "الجينات alginate" }),
  I("pvs-putty", "impressions", "Silicone putty", "سيليكون بوتي", "set", "2 jars", "jar", { syn: "putty rubber base ربر بيس" }),
  I("pvs-light", "impressions", "Silicone light body", "سيليكون لايت", "pack", "2 cartridges", "cartridge", { syn: "light body wash" }),
  I("trays", "impressions", "Impression trays", "ملاعق طبعات", "set", "assorted", "pack", { syn: "trays ملاعق" }),
  I("temp-crown", "impressions", "Temporary crown material", "تاج مؤقت", "cartridge", "50 ml", "cartridge", { syn: "protemp temporary crown مؤقت" }),
  I("temp-cem", "impressions", "Temporary cement", "أسمنت مؤقت", "tube", "25 g", "cartridge", { syn: "temp bond تمب بوند" }),
  I("wax", "impressions", "Bite wax", "شمع عضة", "box", "12 sheets", "box", { syn: "wax شمع" }),
  // prostho
  I("resin-cem", "prostho", "Resin cement", "أسمنت ريزن", "set", "dual cure", "syringe", { syn: "ريزن resin cement" }),
  I("gic-lut", "prostho", "Glass ionomer luting cement", "أسمنت تثبيت", "set", "powder + liquid", "box", { syn: "luting cement تثبيت" }),
  I("fiber-post", "prostho", "Fibre posts", "دعامات فايبر", "box", "10 pcs", "box", { syn: "fiber post بوست" }),
  I("core", "prostho", "Core build-up material", "مادة كور", "syringe", "dual cure", "syringe", { syn: "core build up" }),
  I("retraction", "prostho", "Retraction cord", "خيط لثة", "pack", "1 pack", "pack", { syn: "retraction cord خيط" }),
  // sterilisation
  I("pouches-s", "sterilisation", "Sterilisation pouches small", "أكياس تعقيم صغيرة", "box", "200 pcs", "pack", { starter: true, syn: "pouches اكياس تعقيم" }),
  I("pouches-l", "sterilisation", "Sterilisation pouches large", "أكياس تعقيم كبيرة", "box", "200 pcs", "pack", { syn: "pouches اكياس تعقيم" }),
  I("surf-dis", "sterilisation", "Surface disinfectant", "مطهر أسطح", "bottle", "1 L", "bottle", { starter: true, syn: "معقم اسطح disinfectant سبراي معقم" }),
  I("instr-dis", "sterilisation", "Instrument disinfectant", "مطهر أدوات", "can", "2 L", "bottle", { syn: "معقم ادوات instrument disinfectant" }),
  I("indicator", "sterilisation", "Autoclave indicator tape", "شريط مؤشر", "roll", "50 m", "pack", { syn: "indicator tape تيب" }),
  I("hp-oil", "sterilisation", "Handpiece oil", "زيت الهاندبيس", "can", "500 ml", "bottle", { syn: "زيت oil handpiece" }),
  I("hand-san", "sterilisation", "Hand sanitiser", "معقم أيدي", "bottle", "500 ml", "bottle", { syn: "sanitizer كحول" }),
  // surgery
  I("implant", "surgery", "Dental implant", "زرعة", "piece", "1 fixture", "vial", { tracked: true, syn: "implant fixture زرعة" }),
  I("bone", "surgery", "Bone graft", "بون جرافت", "vial", "0.5 g", "vial", { tracked: true, syn: "bone graft عظم" }),
  I("membrane", "surgery", "Collagen membrane", "ممبرين", "piece", "20×30 mm", "pack", { tracked: true, syn: "membrane" }),
  I("sutures", "surgery", "Sutures 3-0 silk", "خيط جراحة", "box", "12 pcs", "box", { syn: "خيط sutures silk" }),
  I("sutures-abs", "surgery", "Sutures absorbable 4-0", "خيط ذائب", "box", "12 pcs", "box", { syn: "vicryl absorbable" }),
  I("blades", "surgery", "Scalpel blades #15", "شفرات مشرط", "box", "100 pcs", "box", { syn: "مشرط blade scalpel" }),
  I("hemo", "surgery", "Haemostatic sponge", "إسفنج مرقئ", "box", "10 pcs", "box", { syn: "gelfoam hemostatic" }),
  I("chx", "surgery", "Chlorhexidine mouthwash", "كلورهيكسيدين", "bottle", "250 ml", "bottle", { syn: "chlorhexidine مضمضة" }),
  I("saline", "surgery", "Sterile saline", "محلول ملح", "bottle", "500 ml", "bottle", { syn: "saline ملح" }),
  // ortho
  I("brackets", "ortho", "Metal brackets", "براكتس", "set", "1 case", "box", { syn: "براكت brackets" }),
  I("wires", "ortho", "NiTi archwires", "أسلاك نيتي", "pack", "10 pcs", "pack", { syn: "wire سلك archwire" }),
  I("ligatures", "ortho", "Elastic ligatures", "لجاتشر", "pack", "1040 pcs", "pack", { syn: "ligature مطاط" }),
  I("ortho-adh", "ortho", "Bracket adhesive", "لاصق براكتس", "syringe", "4 g", "syringe", { syn: "transbond adhesive" }),
  I("elastics", "ortho", "Intraoral elastics", "مطاط تقويم", "bag", "100 pcs", "bag", { syn: "elastics" }),
  I("power-chain", "ortho", "Power chain", "باور تشين", "roll", "4.5 m", "pack", { syn: "power chain" }),
  // pedo
  I("ssc", "pedo", "Stainless steel crowns", "تيجان ستانلس", "set", "assorted", "box", { syn: "ssc crowns تيجان اطفال" }),
  I("fluoride", "pedo", "Fluoride varnish", "فلورايد", "box", "50 doses", "box", { syn: "فلورايد fluoride varnish جل" }),
  I("sealant", "pedo", "Pit & fissure sealant", "سيلانت", "syringe", "1.2 ml", "syringe", { syn: "sealant" }),
  I("pulpotomy", "pedo", "Pulpotomy material", "مادة بلبوتومي", "bottle", "1 bottle", "bottle", { syn: "formocresol mta pulpotomy" }),
  // whitening
  I("bleach-office", "whitening", "In-office whitening gel", "جل تبييض عيادة", "kit", "1 kit", "syringe", { syn: "تبييض bleaching whitening" }),
  I("bleach-home", "whitening", "Home whitening gel", "جل تبييض منزلي", "syringe", "3 ml", "syringe", { syn: "home bleaching" }),
  I("gingival", "whitening", "Gingival barrier", "حاجز لثة", "syringe", "1.2 ml", "syringe", { syn: "gingival barrier" }),
  // xray
  I("sleeves", "xray", "Sensor sleeves", "أكياس السنسور", "box", "500 pcs", "pack", { syn: "sensor sleeves barrier" }),
  I("films", "xray", "Periapical films", "أفلام أشعة", "box", "150 pcs", "box", { syn: "film افلام" }),
  // pharmacy
  I("amox", "pharmacy", "Amoxicillin 1 g", "أموكسيسيلين", "strip", "14 tabs", "pack", { syn: "augmentin antibiotic مضاد حيوي" }),
  I("ibu", "pharmacy", "Ibuprofen 400 mg", "إيبوبروفين", "strip", "20 tabs", "pack", { syn: "brufen painkiller مسكن" }),
  I("adrenaline", "pharmacy", "Adrenaline ampoules", "أدرينالين", "box", "5 amps", "box", { syn: "adrenaline epinephrine emergency" }),
];

export const CATALOG_BY_KEY: Record<string, CatalogItem> = Object.fromEntries(CATALOG.map((c) => [c.key, c]));

/** Unit names as staff say them. */
export const UNIT_NAMES: Record<string, { en: string; ar: string; plural: string }> = {
  box: { en: "box", ar: "علبة", plural: "boxes" },
  syringe: { en: "syringe", ar: "سرنجة", plural: "syringes" },
  bottle: { en: "bottle", ar: "زجاجة", plural: "bottles" },
  pack: { en: "pack", ar: "باكت", plural: "packs" },
  jar: { en: "jar", ar: "برطمان", plural: "jars" },
  bag: { en: "bag", ar: "شنطة", plural: "bags" },
  cartridge: { en: "cartridge", ar: "كارتريدج", plural: "cartridges" },
  piece: { en: "piece", ar: "قطعة", plural: "pieces" },
  vial: { en: "vial", ar: "فيال", plural: "vials" },
  set: { en: "set", ar: "طقم", plural: "sets" },
  roll: { en: "roll", ar: "رول", plural: "rolls" },
  can: { en: "can", ar: "بستلة", plural: "cans" },
  tube: { en: "tube", ar: "أنبوبة", plural: "tubes" },
  kit: { en: "kit", ar: "كيت", plural: "kits" },
  strip: { en: "strip", ar: "شريط", plural: "strips" },
};

export function unitLabel(unit: string, n: number, ar: boolean): string {
  const u = UNIT_NAMES[unit] || { en: unit, ar: unit, plural: unit + "s" };
  if (ar) return u.ar;
  return n === 1 ? u.en : u.plural;
}

/**
 * The standard cabinet map.
 *
 * Every chair room gets cabinet A (what the dentist reaches for during treatment) and cabinet B
 * (what the assistant restocks). Sterilisation and the Store always exist. A drawer lists the
 * catalogue groups that live in it; items picked at setup land in the drawer of their group, in
 * every chair room, and in the Store when marked bulk.
 */
export interface StandardDrawer {
  cabinet: "A" | "B";
  where: { en: string; ar: string };
  number: number;
  nameEn: string;
  nameAr: string;
  groups: CatalogGroup[];
  tracked?: boolean;
}

export const CHAIR_DRAWERS: StandardDrawer[] = [
  { cabinet: "A", where: { en: "left of the chair", ar: "يسار الكرسي" }, number: 1, nameEn: "Anaesthesia", nameAr: "التخدير", groups: ["anaesthesia"] },
  { cabinet: "A", where: { en: "left of the chair", ar: "يسار الكرسي" }, number: 2, nameEn: "Fillings & bonding", nameAr: "الحشوات والبوند", groups: ["fillings"] },
  { cabinet: "A", where: { en: "left of the chair", ar: "يسار الكرسي" }, number: 3, nameEn: "Root canal", nameAr: "علاج الجذور", groups: ["endo"] },
  { cabinet: "A", where: { en: "left of the chair", ar: "يسار الكرسي" }, number: 4, nameEn: "Burs & polishing", nameAr: "السنون والتلميع", groups: ["burs", "prostho"] },
  { cabinet: "B", where: { en: "behind the chair", ar: "خلف الكرسي" }, number: 1, nameEn: "Gloves & masks", nameAr: "جلافز وماسكات", groups: ["disposables"] },
  { cabinet: "B", where: { en: "behind the chair", ar: "خلف الكرسي" }, number: 2, nameEn: "Impressions & temporaries", nameAr: "الطبعات والمؤقت", groups: ["impressions", "xray", "whitening"] },
  { cabinet: "B", where: { en: "behind the chair", ar: "خلف الكرسي" }, number: 3, nameEn: "Suction & cotton", nameAr: "سكشن وقطن", groups: ["suction"] },
];

/** Specialist drawers added to Chair 1 only when the clinic picks items from those groups. */
export const SPECIALIST_DRAWERS: StandardDrawer[] = [
  { cabinet: "B", where: { en: "behind the chair", ar: "خلف الكرسي" }, number: 4, nameEn: "Surgery & implants", nameAr: "الجراحة والزراعة", groups: ["surgery"], tracked: true },
  { cabinet: "B", where: { en: "behind the chair", ar: "خلف الكرسي" }, number: 5, nameEn: "Orthodontics", nameAr: "التقويم", groups: ["ortho"] },
  { cabinet: "B", where: { en: "behind the chair", ar: "خلف الكرسي" }, number: 6, nameEn: "Children", nameAr: "الأطفال", groups: ["pedo"] },
  { cabinet: "B", where: { en: "behind the chair", ar: "خلف الكرسي" }, number: 7, nameEn: "Medications", nameAr: "الأدوية", groups: ["pharmacy"] },
];

export const STERI_DRAWERS: StandardDrawer[] = [
  { cabinet: "A", where: { en: "above the autoclave", ar: "فوق الأوتوكلاف" }, number: 1, nameEn: "Pouches & indicators", nameAr: "أكياس ومؤشرات", groups: ["sterilisation"] },
];

export const STORE_DRAWERS: StandardDrawer[] = [
  { cabinet: "A", where: { en: "shelving", ar: "الأرفف" }, number: 1, nameEn: "Bulk anaesthesia & fillings", nameAr: "بنج وحشوات (جملة)", groups: ["anaesthesia", "fillings"] },
  { cabinet: "A", where: { en: "shelving", ar: "الأرفف" }, number: 2, nameEn: "Bulk gloves & disposables", nameAr: "جلافز ومستهلكات (جملة)", groups: ["disposables", "suction", "sterilisation"] },
];

export const ROOM_NAMES = {
  chair: { en: "Chair", ar: "كرسي" },
  ST: { en: "Sterilisation", ar: "التعقيم" },
  SR: { en: "Store", ar: "المخزن" },
};

/** Suppliers common in Egypt, offered as suggestions; the clinic types its own freely. */
export const DEFAULT_SUPPLIERS = ["DentaCarts", "Nile Dental", "Alldent", "Kandil", "Other"];
