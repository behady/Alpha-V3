/**
 * Counting things in Arabic, without writing English grammar in Arabic words.
 *
 * The noun after a number changes shape with the number. One takes the singular and usually drops
 * the digit entirely (`علاج واحد`, not `١ علاج`); two takes the dual and also drops it (`علاجين`);
 * three to ten take the plural (`٥ علاجات`); and eleven upwards goes back to the singular
 * (`١٥ علاج`). The rule then repeats on the last two digits, so 103 counts like 3 and 111 counts
 * like 11.
 *
 * Applying the English rule — `${n} ${n === 1 ? one : many}` — gets the two commonest cases in a
 * clinic exactly wrong: a five-person team reads `٥ شخص`, and a fifty-treatment catalogue reads
 * `٥٠ علاجات`. The team screen shipped worse than that, with `${n} حد`: `حد` is "someone", an
 * indefinite that is never counted at all, so the rail's headline — the largest text on the page —
 * read as "5 somebody can sign in".
 *
 * English keeps the digit in every case, so the same record serves both languages.
 */

export type CountedForms = {
  /** One. In Arabic this carries واحد and the caller's digit is dropped. */
  one: string;
  /** Two. In Arabic this is the dual and the digit is dropped. */
  two: string;
  /** Three to ten — the plural. */
  few: string;
  /** Eleven and up, and zero — back to the singular. */
  many: string;
};

/**
 * "5 treatments" / "٥ علاجات". Pass the forms already resolved into the reader's language;
 * `isAr` picks the rule, not the words.
 */
export function countedNoun(n: number, isAr: boolean, forms: CountedForms): string {
  if (!isAr) return `${n} ${n === 1 ? forms.one : forms.many}`;

  if (n === 1) return forms.one;
  if (n === 2) return forms.two;

  const lastTwo = Math.abs(Math.trunc(n)) % 100;
  if (lastTwo >= 3 && lastTwo <= 10) return `${n} ${forms.few}`;
  return `${n} ${forms.many}`;
}
