import {
  DRUG_CATALOG,
  DRUG_CATEGORIES,
  normalizeDrugText,
  type CatalogDrug,
} from "@/lib/drugCatalog";

/**
 * One drug list, assembled from two places.
 *
 * The 53 built-in Egyptian drugs live in code and cost nothing to ship. A clinic's own shortcuts
 * live in Firestore under `drugs`. This module is the only place that knows how the two combine,
 * so Settings and the prescription studio can never disagree about what the list contains.
 *
 * A built-in is never copied into Firestore until the dentist touches it. Editing one writes a
 * single document carrying `catalogId`, which from then on stands in front of the built-in;
 * removing one writes the same document with `hidden: true`. That is copy-on-write: a clinic that
 * changes nothing stores nothing, and a clinic that renames Augmentin stores one row, not 53.
 *
 * The consequence worth remembering: `catalogId` is the join key. A clinic document carrying one
 * replaces the built-in of that id everywhere; a clinic document without one is the clinic's own
 * drug and is shown above the library.
 */

/** A document in the clinic's `drugs` collection, as Firestore hands it back. */
export type ClinicDrugDoc = {
  id: string;
  name?: string;
  dose?: string;
  doseAr?: string;
  /** Set when this document stands in for a built-in drug. */
  catalogId?: string;
  /** Set when the dentist removed a built-in from their list. */
  hidden?: boolean;
};

export type DrugOrigin =
  /** The clinic typed this one in themselves. */
  | "clinic"
  /** Straight from the built-in library, untouched. */
  | "builtin"
  /** A built-in the clinic has edited. */
  | "customized";

export type DrugListEntry = {
  /** Stable key for React and for the Rx picker. */
  key: string;
  /** The Firestore document backing this row, when there is one. */
  docId: string | null;
  /** The built-in this row came from, when it came from one. */
  catalogId: string | null;
  name: string;
  dose: string;
  doseAr: string;
  /** Catalog-only extras. Empty for a clinic's own drug — nobody knows what it is but them. */
  descEn: string;
  descAr: string;
  noteEn: string;
  noteAr: string;
  cautionEn: string;
  cautionAr: string;
  cat: string;
  origin: DrugOrigin;
};

const CATALOG_BY_ID = new Map<string, CatalogDrug>(DRUG_CATALOG.map((d) => [d.id, d]));

export function catalogDrugById(id: string): CatalogDrug | undefined {
  return CATALOG_BY_ID.get(id);
}

function entryFromCatalog(d: CatalogDrug, doc: ClinicDrugDoc | undefined): DrugListEntry {
  return {
    key: `catalog:${d.id}`,
    docId: doc?.id ?? null,
    catalogId: d.id,
    // An override supplies the name and doses; the description and the caution always come from
    // the catalog, because those are ours to keep accurate and were never the dentist's to edit.
    name: (doc?.name ?? "").trim() || d.name,
    dose: doc ? doc.dose ?? "" : d.doseEn,
    doseAr: doc ? doc.doseAr ?? "" : d.doseAr,
    descEn: d.descEn,
    descAr: d.descAr,
    noteEn: d.noteEn ?? "",
    noteAr: d.noteAr ?? "",
    cautionEn: d.cautionEn ?? "",
    cautionAr: d.cautionAr ?? "",
    cat: d.cat,
    origin: doc ? "customized" : "builtin",
  };
}

function entryFromClinicDoc(doc: ClinicDrugDoc): DrugListEntry {
  return {
    key: `clinic:${doc.id}`,
    docId: doc.id,
    catalogId: null,
    name: (doc.name ?? "").trim(),
    dose: doc.dose ?? "",
    doseAr: doc.doseAr ?? "",
    descEn: "",
    descAr: "",
    noteEn: "",
    noteAr: "",
    cautionEn: "",
    cautionAr: "",
    cat: "",
    origin: "clinic",
  };
}

/**
 * The clinic's own drugs first, then the built-in library in the order the catalog authors it.
 * Built-ins the clinic hid are left out; built-ins they edited show their edited values.
 */
export function mergeDrugList(clinicDocs: ClinicDrugDoc[]): DrugListEntry[] {
  const overrides = new Map<string, ClinicDrugDoc>();
  const own: ClinicDrugDoc[] = [];

  for (const doc of clinicDocs) {
    const catalogId = (doc.catalogId ?? "").trim();
    if (catalogId) {
      // Last one wins if a clinic somehow ends up with two rows for the same built-in.
      overrides.set(catalogId, doc);
    } else if ((doc.name ?? "").trim()) {
      own.push(doc);
    }
  }

  const ownEntries = own
    .map(entryFromClinicDoc)
    .sort((a, b) => a.name.localeCompare(b.name));

  const catalogEntries: DrugListEntry[] = [];
  for (const drug of DRUG_CATALOG) {
    const doc = overrides.get(drug.id);
    if (doc?.hidden) continue;
    catalogEntries.push(entryFromCatalog(drug, doc));
  }

  return [...ownEntries, ...catalogEntries];
}

/** Every word a search term is allowed to match on for one row. */
function haystack(entry: DrugListEntry): string {
  const cat = DRUG_CATEGORIES.find((c) => c.id === entry.cat);
  const keywords = entry.catalogId ? catalogDrugById(entry.catalogId)?.keywords ?? [] : [];
  return normalizeDrugText(
    [
      entry.name,
      entry.dose,
      entry.doseAr,
      entry.descEn,
      entry.descAr,
      cat?.labelEn ?? "",
      cat?.labelAr ?? "",
      ...keywords,
    ].join(" ")
  );
}

/**
 * Every whitespace-separated term must appear somewhere in the row, in any order, so "aug 1" and
 * "مضاد حيوي حساسيه" both land. An empty query returns the list untouched.
 */
export function searchDrugEntries(entries: DrugListEntry[], query: string): DrugListEntry[] {
  const q = normalizeDrugText(query);
  if (!q) return entries;
  const terms = q.split(" ").filter(Boolean);
  const index = new Map(entries.map((e) => [e.key, haystack(e)]));
  return entries.filter((e) => {
    const stack = index.get(e.key) ?? "";
    return terms.every((term) => stack.includes(term));
  });
}

/** The fields a copy-on-write override writes for a built-in the dentist edited. */
export function overrideDocFields(entry: DrugListEntry, name: string, dose: string, doseAr: string) {
  return {
    catalogId: entry.catalogId,
    name: name.trim(),
    dose: dose.trim(),
    doseAr: doseAr.trim(),
    hidden: false,
  };
}
