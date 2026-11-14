/**
 * The map link, printed beside an address that has already been said.
 *
 * The "map link" answer is free text, and a clinic pasted its whole street address into it above
 * the links — the same address its profile already holds. The confirmation prints the profile
 * address and then this field, so every booking carried the address twice. The fix is not to
 * police what a clinic types: it is to not say again a line the patient has just read.
 *
 * Pure. Links are never dropped; a line of words goes only when it is the address over again.
 */

/** Below this many letters a line is too short to be called a repeat because the address contains it. */
const MIN_CONTAINED = 20;

function fold(line: string): string {
  return line
    .replace(/^[\s📍*]+/u, "")
    .replace(/^العنوان\s*[:：-]?\s*/u, "")
    .replace(/[*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function repeatsAddress(line: string, address: string): boolean {
  if (!address || /https?:\/\//i.test(line)) return false;
  const a = fold(line);
  if (!a) return false;
  if (a === address) return true;
  const [short, long] = a.length <= address.length ? [a, address] : [address, a];
  return short.length >= MIN_CONTAINED && long.includes(short);
}

export function mapLinesBesideAddress(address: string | undefined | null, mapsUrl: string | undefined | null): string {
  const said = fold(String(address || ""));
  return String(mapsUrl || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !repeatsAddress(l, said))
    .join("\n");
}
