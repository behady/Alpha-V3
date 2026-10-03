"use client";

/**
 * Where the approval papers go in.
 *
 * Each file: a fresh `docId`, an upload to `insuranceDocPath(clinicId, docId, name)` with the
 * file's real type (the read route refuses `application/octet-stream`), then
 * `POST /api/insurance/read`. A file shows its progress here — uploading, reading, or failed — and
 * leaves this list the moment it is read: `onRead` hands it to the page, which opens a confirm card.
 *
 * A failed read keeps the uploaded file and offers "Try again" and "Type it myself" (a blank card
 * beside the same scan). A failed upload offers only "Try again": there is nothing to type beside.
 * Three files are worked on at a time; a stack of twenty does not fire twenty model calls at once.
 */

import { useCallback, useRef, useState } from "react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { AlertTriangle, FileUp, Loader2, PencilLine, RotateCcw, X } from "lucide-react";
import { storage } from "@/lib/firebase";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { insuranceDocPath } from "@/lib/storagePaths";
import type { Payer } from "@/lib/payers";
import { blankResult, contentTypeOf, InsuranceCallError, readDocument, type OpenDoc } from "./api";
import { tr } from "./text";

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPT = ".pdf,.jpg,.jpeg,.png";
const ACCEPTED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const PARALLEL = 3;

type Item = {
  key: string;
  file: File;
  docId: string;
  docPath: string;
  contentType: string;
  /** The file is in Storage: a retry only re-reads. */
  uploaded: boolean;
  docUrl: string;
  state: "waiting" | "uploading" | "reading" | "failed";
  error: string;
  retryable: boolean;
};

export default function ApprovalDropZone({ payer, onRead }: { payer: Payer | null; onRead: (doc: OpenDoc) => void }) {
  const { clinicId } = useClinic();
  const { language } = useLanguage();
  const isAr = language === "ar";
  const t = tr(isAr);

  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // The queue lives outside state so the workers see additions made while they run.
  const queue = useRef<Item[]>([]);
  const running = useRef(0);

  const patch = useCallback((key: string, change: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...change } : it)));
  }, []);

  const work = useCallback(
    async (item: Item) => {
      if (!clinicId || !payer) return;
      let { uploaded, docUrl } = item;
      try {
        if (!uploaded) {
          patch(item.key, { state: "uploading", error: "" });
          try {
            await uploadBytes(ref(storage, item.docPath), item.file, { contentType: item.contentType });
          } catch (err) {
            console.error("Insurance upload failed", err);
            patch(item.key, { state: "failed", error: t("uploadFailed"), retryable: true });
            return;
          }
          uploaded = true;
          patch(item.key, { uploaded: true });
        }
        patch(item.key, { state: "reading", error: "" });
        if (!docUrl) docUrl = await getDownloadURL(ref(storage, item.docPath)).catch(() => "");
        patch(item.key, { docUrl });
        const outcome = await readDocument({ clinicId, payerId: payer.id, docId: item.docId, docPath: item.docPath });
        if (outcome.ok) {
          setItems((prev) => prev.filter((it) => it.key !== item.key));
          onRead({ payerId: payer.id, docId: item.docId, docPath: item.docPath, docUrl, contentType: item.contentType, result: outcome.result, typed: false });
          return;
        }
        patch(item.key, { state: "failed", error: outcome.error || t("failed"), retryable: outcome.retryable });
      } catch (err) {
        const message = err instanceof InsuranceCallError ? t(err.kind === "signed_out" ? "signedOut" : "networkFailed") : t("failed");
        patch(item.key, { state: "failed", error: message, retryable: true, uploaded });
      }
    },
    [clinicId, payer, patch, onRead, t],
  );

  /** Up to PARALLEL workers, each draining the queue until it is empty. */
  const pump = useCallback(() => {
    while (running.current < PARALLEL && queue.current.length > 0) {
      running.current += 1;
      void (async () => {
        try {
          for (let next = queue.current.shift(); next; next = queue.current.shift()) await work(next);
        } finally {
          running.current -= 1;
        }
      })();
    }
  }, [work]);

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      if (!clinicId || !payer) return;
      const added: Item[] = [];
      for (const file of Array.from(list)) {
        const docId = crypto.randomUUID();
        const contentType = contentTypeOf(file);
        const base: Item = {
          key: docId,
          file,
          docId,
          docPath: insuranceDocPath(clinicId, docId, file.name),
          contentType,
          uploaded: false,
          docUrl: "",
          state: "waiting",
          error: "",
          retryable: false,
        };
        if (!ACCEPTED_TYPES.has(contentType)) added.push({ ...base, state: "failed", error: t("wrongType") });
        else if (file.size > MAX_BYTES) added.push({ ...base, state: "failed", error: t("tooBig") });
        else {
          added.push(base);
          queue.current.push(base);
        }
      }
      setItems((prev) => [...prev, ...added]);
      pump();
    },
    [clinicId, payer, pump, t],
  );

  const retry = (item: Item) => {
    const again = { ...item, state: "waiting" as const, error: "" };
    patch(item.key, { state: "waiting", error: "" });
    queue.current.push(again);
    pump();
  };

  const typeIt = (item: Item) => {
    if (!payer) return;
    setItems((prev) => prev.filter((it) => it.key !== item.key));
    onRead({ payerId: payer.id, docId: item.docId, docPath: item.docPath, docUrl: item.docUrl, contentType: item.contentType, result: blankResult(item.docId), typed: true });
  };

  const dismiss = (item: Item) => setItems((prev) => prev.filter((it) => it.key !== item.key));

  const disabled = !payer;

  return (
    <section className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled && e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
          disabled
            ? "cursor-not-allowed border-line bg-surface-subtle opacity-60"
            : over
              ? "border-ink bg-surface-subtle"
              : "border-line bg-surface hover:border-ink-muted"
        }`}
        data-tour="insurance-drop"
      >
        <div className="grid size-12 place-items-center rounded-2xl bg-ink-slab text-white">
          <FileUp size={22} />
        </div>
        <div>
          <p className="font-display text-lg font-black text-ink">{disabled ? t("dropNoPayer") : t("dropTitle")}</p>
          <p className="mt-1 text-[13px] font-semibold text-ink-muted">{t("dropHint")}</p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="rounded-xl border border-line bg-surface px-4 py-2 text-[13px] font-black text-ink transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed"
        >
          {t("dropPick")}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.key} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
              {it.state === "failed" ? (
                <AlertTriangle size={16} className="shrink-0 text-rose-600" />
              ) : (
                <Loader2 size={16} className="shrink-0 animate-spin text-ink-muted" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-black text-ink" dir="ltr">
                  {it.file.name}
                </p>
                <p className={`text-[12px] font-semibold ${it.state === "failed" ? "text-rose-700" : "text-ink-muted"}`}>
                  {it.state === "uploading" || it.state === "waiting" ? t("uploading") : it.state === "reading" ? t("reading") : it.error || t("failed")}
                </p>
              </div>
              {it.state === "failed" && (
                <div className="flex flex-wrap gap-2">
                  {it.retryable && (
                    <button type="button" onClick={() => retry(it)} className={chip}>
                      <RotateCcw size={13} /> {t("tryAgain")}
                    </button>
                  )}
                  {it.uploaded && (
                    <button type="button" onClick={() => typeIt(it)} className={chip}>
                      <PencilLine size={13} /> {t("typeIt")}
                    </button>
                  )}
                  <button type="button" onClick={() => dismiss(it)} className={chip} aria-label={t("dismiss")}>
                    <X size={13} />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const chip =
  "inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-[12px] font-black text-ink-body transition-colors hover:bg-surface-subtle hover:text-ink";
