"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Camera } from "lucide-react";

/**
 * Screenshots are written into the articles before they are captured, as:
 *
 *   ![Settings → Clinic profile, logo box](pending/clinic-profile-logo)
 *
 * The slot renders as a labelled placeholder so the article is complete and reviewable now, and
 * the alt text doubles as the shot list for whoever captures it. Swapping in the real image is a
 * one-line edit to `/help/<lang>/<name>.png` — no change to the article's structure.
 *
 * The marker is a relative path rather than a `PENDING:` scheme because react-markdown sanitises
 * URLs with unrecognised protocols down to an empty string, which silently turned every slot into
 * a broken image instead of a placeholder.
 */
const PENDING_PREFIX = "pending/";

function ScreenshotSlot({ caption }: { caption: string }) {
  return (
    <span className="my-6 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line-strong bg-slate-50/70 px-6 py-8 text-center">
      <Camera size={22} className="text-slate-300" />
      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
        Screenshot
      </span>
      <span className="text-xs font-semibold leading-relaxed text-ink-muted">{caption}</span>
    </span>
  );
}

export default function HelpMarkdown({ body, isRTL }: { body: string; isRTL: boolean }) {
  return (
    <div
      className="text-[15px] font-medium leading-[1.85] text-slate-700"
      dir={isRTL ? "rtl" : "ltr"}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => (
            <h2 className="mt-12 mb-4 text-xl font-black tracking-tight text-ink first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-8 mb-3 text-base font-black tracking-tight text-ink">
              {children}
            </h3>
          ),
          p: ({ children }) => <p className="my-4">{children}</p>,
          ul: ({ children }) => (
            <ul className={`my-4 space-y-2 ${isRTL ? "mr-5" : "ml-5"} list-disc marker:text-slate-300`}>
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol
              className={`my-5 space-y-3 ${isRTL ? "mr-5" : "ml-5"} list-decimal marker:font-black marker:text-accent`}
            >
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="pl-1.5">{children}</li>,
          strong: ({ children }) => <strong className="font-black text-ink">{children}</strong>,
          a: ({ href, children }) => (
            <a
              href={href}
              className="font-bold text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent"
            >
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code className="rounded-md border border-line bg-surface-subtle px-1.5 py-0.5 font-mono text-[13px] font-semibold text-slate-800">
              {children}
            </code>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-6 rounded-2xl border border-amber-200 bg-amber-50/60 px-5 py-4 text-sm font-semibold leading-relaxed text-amber-900 [&>p]:my-0">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="my-6 overflow-x-auto rounded-2xl border border-line">
              <table className="w-full border-collapse text-left text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-surface-subtle">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-line px-4 py-3 text-[11px] font-black uppercase tracking-wider text-ink-muted">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-slate-100 px-4 py-3 align-top font-semibold text-ink-body">
              {children}
            </td>
          ),
          hr: () => <hr className="my-10 border-slate-100" />,
          img: ({ src, alt }) => {
            const url = typeof src === "string" ? src : "";
            if (url.startsWith(PENDING_PREFIX)) {
              return <ScreenshotSlot caption={alt || ""} />;
            }
            return (
              <span className="my-6 flex flex-col gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={alt || ""}
                  className="w-full rounded-2xl border border-line shadow-sm"
                />
                {alt ? (
                  <span className="text-center text-xs font-semibold text-slate-400">{alt}</span>
                ) : null}
              </span>
            );
          },
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
