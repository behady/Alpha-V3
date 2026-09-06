"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, ImageIcon, Trash2, Upload } from "lucide-react";
import { addDoc, deleteDoc, doc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { currentClinicId, getClinicCollection } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";

/**
 * The pictures and files the assistant may send.
 *
 * Whitening and veneers sell on before-and-after photos; a price sheet answers ten questions at
 * once. The clinic uploads each file once with a label and a few words on when to send it, and
 * the model sees that list on every turn — "[m3] تبييض قبل وبعد — لما حد يسأل عن التبييض" —
 * and names the one to attach. The file goes out after the reply, from the clinic's number.
 */

export interface BotMediaItem {
  id: string;
  label: string;
  when: string;
  url: string;
  kind: "image" | "document";
  fileName: string;
}

export default function BotMediaLibrary() {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { user } = useAuth();
  const [items, setItems] = useState<BotMediaItem[]>([]);
  const [label, setLabel] = useState("");
  const [when, setWhen] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(getClinicCollection("bot_media"), (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as BotMediaItem))), () => {});
    return () => unsub();
  }, [user]);

  const upload = async () => {
    if (!file || !label.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const clinicId = currentClinicId();
      const isImage = file.type.startsWith("image/");
      if (!isImage && file.type !== "application/pdf") throw new Error(isAr ? "صورة أو PDF بس" : "Images or PDF only");
      const safe = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-60);
      const task = uploadBytesResumable(ref(storage, `clinics/${clinicId}/bot_media/${Date.now()}_${safe}`), file, { contentType: file.type });
      await new Promise<void>((resolve, reject) => task.on("state_changed", undefined, reject, () => resolve()));
      const url = await getDownloadURL(task.snapshot.ref);
      await addDoc(getClinicCollection("bot_media"), {
        label: label.trim().slice(0, 80),
        when: when.trim().slice(0, 200),
        url,
        kind: isImage ? "image" : "document",
        fileName: file.name.slice(0, 120),
        createdAt: serverTimestamp(),
      });
      setLabel("");
      setWhen("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-4 mt-2 border-t border-line space-y-3">
      <p className="text-[11px] font-black uppercase tracking-widest text-ink-body">{isAr ? "صور وملفات البوت يقدر يبعتها" : "Photos and files the bot can send"}</p>
      <p className="text-xs text-ink-body leading-relaxed max-w-2xl">
        {isAr
          ? "صور قبل وبعد، قائمة الأسعار PDF، صور العيادة. اكتب لكل ملف اسم وإمتى يتبعت، والبوت هيبعته في اللحظة المناسبة بعد رده."
          : "Before/after photos, a price list PDF, photos of the clinic. Give each a name and when to send it; the bot attaches it at the right moment after its reply."}
      </p>

      {items.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface-subtle px-3 py-2">
              {m.kind === "image" ? (
                <img src={m.url} alt="" className="h-12 w-12 rounded-lg object-cover shrink-0" />
              ) : (
                <span className="h-12 w-12 rounded-lg bg-surface flex items-center justify-center shrink-0"><FileText size={18} className="text-ink-muted" /></span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-ink truncate" dir="auto">{m.label}</p>
                <p className="text-[11px] text-ink-muted truncate" dir="auto">{m.when || m.fileName}</p>
              </div>
              <button
                type="button"
                onClick={() => void deleteDoc(doc(getClinicCollection("bot_media"), m.id))}
                className="p-1.5 rounded-lg text-ink-muted hover:text-danger"
                aria-label="delete"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
        <label className="block space-y-1">
          <span className="text-xs font-bold text-ink">{isAr ? "اسم الملف (زي ما البوت يفهمه)" : "Name (as the bot should understand it)"}</span>
          <input dir="auto" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" placeholder={isAr ? "تبييض قبل وبعد" : "Whitening before/after"} value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-bold text-ink">{isAr ? "إمتى يبعته" : "When to send it"}</span>
          <input dir="auto" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" placeholder={isAr ? "لما حد يسأل عن التبييض أو الابتسامة" : "When someone asks about whitening"} value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <div className="flex items-center gap-2">
          <input ref={fileInput} type="file" accept="image/*,application/pdf" className="text-xs" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <button type="button" disabled={busy || !file || !label.trim()} onClick={() => void upload()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-ink text-surface text-xs font-black disabled:opacity-40">
            {busy ? <Upload size={13} className="animate-pulse" /> : <ImageIcon size={13} />} {isAr ? "رفع" : "Upload"}
          </button>
        </div>
      </div>
      {error && <p className="text-xs font-bold text-danger">{error}</p>}
    </div>
  );
}
