import { Paperclip } from "lucide-react";

/** The small "receipt" chip on an expense that was scanned: opens the original photo or PDF. */
export default function ReceiptPhotoLink({ url, ar }: { url?: string | null; ar: boolean }) {
  if (!url || !url.startsWith("https://firebasestorage.googleapis.com/")) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={ar ? "الفاتورة الأصلية" : "Original receipt"}
      className="ms-2 inline-flex items-center gap-1 align-middle text-[10px] font-black uppercase text-ink-muted bg-surface-muted hover:text-ink px-1.5 py-0.5 rounded-md"
    >
      <Paperclip size={11} />
      {ar ? "الفاتورة" : "Receipt"}
    </a>
  );
}
