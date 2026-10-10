// Photos attached to a treatment: the server accepts only a file uploaded into THIS clinic's folder
// for THIS note, linked by Firebase's download URL for that same path.
import assert from "node:assert/strict";
import { acceptNotePhoto, parseNotePhotos } from "../src/lib/notePhotos.ts";
import { clinicalNotePhotoPath } from "../src/lib/storagePaths.ts";

const url = (path) =>
  `https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/${encodeURIComponent(path)}?alt=media&token=t`;

const good = clinicalNotePhotoPath("clinicA", "n1");
assert.deepEqual(acceptNotePhoto("clinicA", "n1", { url: url(good), path: good }), { url: url(good), path: good });

// Another clinic's file, another note's file, or a path that climbs out of the folder.
const otherClinic = clinicalNotePhotoPath("clinicB", "n1");
assert.equal(acceptNotePhoto("clinicA", "n1", { url: url(otherClinic), path: otherClinic }), null);
const otherNote = clinicalNotePhotoPath("clinicA", "n2");
assert.equal(acceptNotePhoto("clinicA", "n1", { url: url(otherNote), path: otherNote }), null);
const climb = "clinics/clinicA/clinical_notes/n1/../n2/x.jpg";
assert.equal(acceptNotePhoto("clinicA", "n1", { url: url(climb), path: climb }), null);

// The URL must be the download link for the same path, not any address on the web.
assert.equal(acceptNotePhoto("clinicA", "n1", { url: "https://evil.example/x.jpg", path: good }), null);
assert.equal(acceptNotePhoto("clinicA", "n1", { url: url(otherNote), path: good }), null);

// Junk in, nothing out.
assert.equal(acceptNotePhoto("clinicA", "n1", null), null);
assert.equal(acceptNotePhoto("clinicA", "n1", { url: 5, path: good }), null);
assert.equal(acceptNotePhoto("", "n1", { url: url(good), path: good }), null);

// Stored photos: malformed entries are dropped instead of rendering broken images.
assert.deepEqual(parseNotePhotos(undefined), []);
assert.deepEqual(
  parseNotePhotos([{ url: url(good), path: good, addedAt: "2026-10-10T10:00:00Z", addedBy: "Dr A" }, { url: "http://x", path: "p" }, "junk"]),
  [{ url: url(good), path: good, addedAt: "2026-10-10T10:00:00Z", addedBy: "Dr A" }]
);

console.log("✓ notePhotos: path, clinic, note and URL checks hold");
