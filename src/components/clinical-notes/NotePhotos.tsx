"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Camera, ChevronLeft, ChevronRight, Loader2, Trash2, X, Images } from "lucide-react";
import { storage } from "@/lib/firebase";
import { currentClinicId } from "@/lib/db-utils";
import { clinicalNotePhotoPath } from "@/lib/storagePaths";
import { addProcedurePhotos, removeProcedurePhoto } from "@/lib/moneyApi";
import { MAX_NOTE_PHOTOS, parseNotePhotos, type NotePhoto } from "@/lib/notePhotos";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import Protect from "@/components/Protect";
import { compressImage } from "./utils";
import { Note } from "./types";

/**
 * The camera button on a treatment card.
 *
 * Each picture is shrunk in the browser first (a phone photo is 4–8 MB; 1600px JPEG keeps every
 * clinical detail at a tenth of that), uploaded into the note's own folder, and only then attached
 * through the API — Firestore lets no client write a clinical note directly.
 */
export function NotePhotoButton({ note, size = 16 }: { note: Note; size?: number }) {
  const { language } = useLanguage();
  const { showToast } = useUI();
  const ar = language === "ar";
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const label = ar ? "إضافة صور للإجراء" : "Add photos";

  const onFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    if (inputRef.current) inputRef.current.value = "";
    if (files.length === 0) return;

    const room = MAX_NOTE_PHOTOS - parseNotePhotos(note.photos).length;
    if (files.length > room) {
      showToast(
        ar ? `الإجراء يحتمل ${MAX_NOTE_PHOTOS} صورة فقط` : `A treatment holds up to ${MAX_NOTE_PHOTOS} photos`,
        "error"
      );
      if (room <= 0) return;
    }

    setUploading(true);
    try {
      const clinicId = currentClinicId();
      const uploaded: Array<{ url: string; path: string }> = [];
      for (const file of files.slice(0, Math.max(0, room))) {
        // A format the browser cannot draw (HEIC on some desktops) goes up as it is.
        let blob: Blob = file;
        let ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        try {
          blob = await compressImage(file, 1600, 0.85);
          ext = "jpg";
        } catch {
          /* keep the original */
        }
        const path = clinicalNotePhotoPath(clinicId, note.id, ext);
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, blob, { contentType: ext === "jpg" ? "image/jpeg" : file.type || "image/jpeg" });
        uploaded.push({ url: await getDownloadURL(storageRef), path });
      }
      if (uploaded.length > 0) await addProcedurePhotos(note.id, uploaded);
      showToast(
        ar ? `تم رفع ${uploaded.length} صورة` : `${uploaded.length} photo${uploaded.length === 1 ? "" : "s"} added`,
        "success"
      );
    } catch (e) {
      showToast(e instanceof Error && e.message ? e.message : ar ? "فشل رفع الصورة" : "Photo upload failed", "error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Protect permission="clinical.edit">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        title={label}
        aria-label={label}
        className={`${size >= 16 ? "p-2.5 shadow-sm" : "p-1.5"} rounded-lg text-sky-700 bg-sky-50 hover:bg-sky-100 transition-colors border border-sky-100 disabled:opacity-60`}
      >
        {uploading ? <Loader2 size={size} className="animate-spin" /> : <Camera size={size} />}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => void onFiles(e.target.files)}
      />
    </Protect>
  );
}

/**
 * The pictures on a treatment card: a row of thumbnails, or (compact cards) one count chip.
 * Either opens a full-screen viewer.
 */
export function NotePhotoStrip({ note, compact = false, canEdit = true }: { note: Note; compact?: boolean; canEdit?: boolean }) {
  const { language } = useLanguage();
  const photos = parseNotePhotos(note.photos);
  const [open, setOpen] = useState<number | null>(null);
  const ar = language === "ar";

  if (photos.length === 0) return null;

  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={() => setOpen(0)}
          title={ar ? "عرض الصور" : "View photos"}
          className="flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-100 shrink-0"
        >
          <Images size={12} /> {photos.length}
        </button>
      ) : (
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {photos.map((p, i) => (
            <button
              key={p.path}
              type="button"
              onClick={() => setOpen(i)}
              className="w-16 h-16 rounded-lg overflow-hidden border border-line bg-surface-muted hover:ring-2 hover:ring-sky-300 transition-shadow"
              aria-label={ar ? `صورة ${i + 1}` : `Photo ${i + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- Storage download URLs, not optimisable */}
              <img src={p.url} alt="" loading="lazy" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {open !== null && (
        <PhotoViewer
          note={note}
          photos={photos}
          start={open}
          canEdit={canEdit}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

/**
 * Full-screen viewer. Portalled to <body>: a fixed overlay rendered inside the page's scrolling
 * <main> is clipped by it.
 */
function PhotoViewer({
  note,
  photos,
  start,
  canEdit,
  onClose,
}: {
  note: Note;
  photos: NotePhoto[];
  start: number;
  canEdit: boolean;
  onClose: () => void;
}) {
  const { language } = useLanguage();
  const { confirm, showToast } = useUI();
  const ar = language === "ar";
  const [index, setIndex] = useState(Math.min(start, photos.length - 1));
  const photo = photos[Math.min(index, photos.length - 1)];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % photos.length);
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + photos.length) % photos.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [photos.length, onClose]);

  if (!photo || typeof document === "undefined") return null;

  const remove = async () => {
    onClose();
    const ok = await confirm(
      ar ? "إزالة هذه الصورة من الإجراء؟" : "Remove this photo from the treatment?",
      { confirmLabel: ar ? "إزالة" : "Remove", cancelLabel: ar ? "إلغاء" : "Cancel", tone: "danger" }
    );
    if (!ok) return;
    try {
      await removeProcedurePhoto(note.id, photo.path);
      showToast(ar ? "تمت إزالة الصورة" : "Photo removed", "success");
    } catch (e) {
      showToast(e instanceof Error && e.message ? e.message : ar ? "تعذرت الإزالة" : "Could not remove", "error");
    }
  };

  const added = photo.addedAt ? new Date(photo.addedAt) : null;

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/90 flex flex-col" onClick={onClose} role="dialog" aria-modal="true">
      <div className="flex items-center justify-between gap-3 p-3 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0">
          <p className="font-bold truncate">{note.procedure}</p>
          <p className="text-xs text-white/60">
            {index + 1} / {photos.length}
            {added && !Number.isNaN(added.getTime()) && ` · ${added.toLocaleDateString(ar ? "ar-EG" : "en-GB")}`}
            {photo.addedBy && ` · ${photo.addedBy}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canEdit && (
            <Protect permission="clinical.edit">
              <button
                type="button"
                onClick={() => void remove()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-rose-600 text-sm font-bold"
              >
                <Trash2 size={15} /> {ar ? "إزالة" : "Remove"}
              </button>
            </Protect>
          )}
          <a
            href={photo.url}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-bold"
          >
            {ar ? "فتح الأصل" : "Open original"}
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label={ar ? "إغلاق" : "Close"}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0 flex items-center justify-center p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- Storage download URL */}
        <img
          src={photo.url}
          alt={note.procedure || ""}
          className="max-w-full max-h-full object-contain rounded-lg"
          onClick={(e) => e.stopPropagation()}
        />
        {photos.length > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIndex((i) => (i - 1 + photos.length) % photos.length);
              }}
              aria-label={ar ? "السابقة" : "Previous"}
              className="absolute left-3 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/25 text-white"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIndex((i) => (i + 1) % photos.length);
              }}
              aria-label={ar ? "التالية" : "Next"}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/25 text-white"
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
