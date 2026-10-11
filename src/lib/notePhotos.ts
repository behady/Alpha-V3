/**
 * Photographs attached to one treatment on the clinical timeline.
 *
 * The browser uploads the file to Storage itself (under the note's own folder — see
 * `clinicalNotePhotoPath`) and then asks /api/clinical/procedures to attach it, because Firestore
 * lets no client write a clinical note. The server only accepts a photo whose path sits in THIS
 * clinic's folder for THIS note and whose URL is the download link for that same path, so a request
 * cannot pin another clinic's file, or an arbitrary web address, to a patient's record.
 *
 * Pure: shared by the route, the card and the tests.
 */

import { clinicalNotePhotoFolder } from "./storagePaths";

export interface NotePhoto {
  url: string;
  path: string;
  /** ISO time it was attached. */
  addedAt: string;
  addedBy?: string;
}

/** Enough for a before / during / after series on a long case, small enough to load on a phone. */
export const MAX_NOTE_PHOTOS = 24;

const DOWNLOAD_HOST = "https://firebasestorage.googleapis.com/";

/** The photos stored on a note, dropping anything malformed rather than rendering a broken image. */
export function parseNotePhotos(raw: unknown): NotePhoto[] {
  if (!Array.isArray(raw)) return [];
  const out: NotePhoto[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.url !== "string" || typeof r.path !== "string") continue;
    if (!r.url.startsWith(DOWNLOAD_HOST)) continue;
    out.push({
      url: r.url,
      path: r.path,
      addedAt: typeof r.addedAt === "string" ? r.addedAt : "",
      ...(typeof r.addedBy === "string" && r.addedBy ? { addedBy: r.addedBy } : {}),
    });
  }
  return out;
}

/**
 * One photo a request wants attached, or null when it does not belong to this note.
 *
 * The path must be inside the note's folder with nothing but a plain file name after it, and the
 * URL must be Firebase's download link for exactly that path.
 */
export function acceptNotePhoto(clinicId: string, noteId: string, raw: unknown): { url: string; path: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const { url, path } = raw as Record<string, unknown>;
  if (typeof url !== "string" || typeof path !== "string") return null;

  let folder: string;
  try {
    folder = clinicalNotePhotoFolder(clinicId, noteId);
  } catch {
    return null;
  }
  if (!path.startsWith(folder)) return null;
  const file = path.slice(folder.length);
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(file) || file.includes("..")) return null;

  if (!url.startsWith(DOWNLOAD_HOST)) return null;
  if (!url.includes(`/o/${encodeURIComponent(path)}?`)) return null;

  return { url, path };
}
