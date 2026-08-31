"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toPng } from "html-to-image";
import { X, Download, Loader2, Smartphone, Square, ImageOff } from "lucide-react";
import { Cairo, Plus_Jakarta_Sans } from "next/font/google";
import { MARKETING_THEMES, type BrandKit, type MarketingLanguage } from "@/types/marketing";

/**
 * The Design Studio — text in, a ready-to-post branded image out.
 *
 * The core decision (made back in the planning session): designs come from professionally
 * built HTML/CSS templates filled with the AI's text and the clinic's identity — never from
 * generative image models. Every export is deterministic, the Arabic renders perfectly, and
 * a post costs nothing to produce. The theme (Brand Kit) picks the family; the layout picks
 * the composition; the clinic only ever sees finished-looking options.
 *
 * Export renders a hidden artboard at true pixel size (1080² / 1080×1920) and rasterizes it
 * with html-to-image; the visible preview is the same artboard scaled down with a transform.
 */

const cairo = Cairo({ subsets: ["arabic"], weight: ["400", "600", "700", "900"] });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "600", "700", "800"] });

export type DesignInput = {
  language: MarketingLanguage;
  /** Internal label — becomes the download filename. */
  title: string;
  body: string;
};

type Layout = "announce" | "offer" | "tip";
type Format = "square" | "story";

const FORMATS: Record<Format, { w: number; h: number }> = {
  square: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
};

/** First line (or sentence) makes a headline; the rest becomes supporting copy. */
function splitCopy(body: string): { headline: string; rest: string } {
  const clean = body.trim();
  const firstBreak = clean.indexOf("\n");
  if (firstBreak > 0 && firstBreak <= 120) {
    return { headline: clean.slice(0, firstBreak).trim(), rest: clean.slice(firstBreak + 1).trim() };
  }
  const sentenceEnd = clean.search(/[.!؟?…]\s/);
  if (sentenceEnd > 0 && sentenceEnd <= 120) {
    return { headline: clean.slice(0, sentenceEnd + 1).trim(), rest: clean.slice(sentenceEnd + 1).trim() };
  }
  return { headline: clean.slice(0, 90), rest: clean.slice(90).trim() };
}

/** Text length → font size, so a long caption shrinks instead of overflowing the artboard. */
const fit = (text: string, base: number, perChar = 0.22, min = 0.45) =>
  Math.max(base * min, base - text.length * perChar);

export default function DesignStudio({
  item,
  brand,
  clinicName,
  phone,
  logoUrl,
  isAr,
  onClose,
}: {
  item: DesignInput;
  brand: BrandKit;
  clinicName: string;
  phone: string;
  logoUrl: string;
  isAr: boolean;
  onClose: () => void;
}) {
  const theme = MARKETING_THEMES.find((t) => t.id === brand.theme) || MARKETING_THEMES[0];
  const accent = brand.accent?.trim() || theme.accent;

  const initial = useMemo(() => splitCopy(item.body), [item.body]);
  const [headline, setHeadline] = useState(initial.headline);
  const [rest, setRest] = useState(initial.rest);
  const [layout, setLayout] = useState<Layout>("announce");
  const [format, setFormat] = useState<Format>("square");
  const [includeLogo, setIncludeLogo] = useState(brand.showLogo !== false && !!logoUrl);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setPortalTarget(document.body), []);

  const rtl = item.language === "ar";
  const fontClass = rtl ? cairo.className : jakarta.className;

  const download = async () => {
    if (!exportRef.current) return;
    setExporting(true);
    setExportError("");
    try {
      const { w, h } = FORMATS[format];
      const dataUrl = await toPng(exportRef.current, {
        width: w,
        height: h,
        pixelRatio: 1,
        cacheBust: true,
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${(item.title || "design").replace(/[^\w؀-ۿ-]+/g, "_").slice(0, 60)}_${format}.png`;
      a.click();
    } catch (e) {
      console.error("Design export failed", e);
      setExportError(
        includeLogo
          ? isAr
            ? "فشل التصدير — غالباً بسبب صورة اللوجو (مصدر خارجي). جرّب إيقاف اللوجو ثم التحميل."
            : "Export failed — usually the logo image (external host). Try switching the logo off, then download."
          : isAr
            ? "فشل التصدير. جرّب مرة أخرى."
            : "Export failed. Please try again."
      );
    } finally {
      setExporting(false);
    }
  };

  /* ------------------------------- the artboard ------------------------------- */

  const Artboard = ({ w, h }: { w: number; h: number }) => {
    const story = h > w;
    const pad = w * 0.085;
    const isLuxury = theme.id === "luxury";
    const isBasic = theme.id === "basic";

    const ground = isLuxury ? theme.ground : isBasic ? "#ffffff" : `linear-gradient(160deg, #ffffff 20%, ${theme.ground} 100%)`;
    const ink = theme.ink;
    const soft = isLuxury ? "rgba(244,239,227,0.72)" : "#475569";

    const headlineSize = fit(headline, story ? w * 0.085 : w * 0.075);
    const restSize = fit(rest, story ? w * 0.042 : w * 0.037, 0.05, 0.62);

    const footer = (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: pad / 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: w * 0.02 }}>
          {includeLogo && logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              crossOrigin="anonymous"
              alt=""
              style={{ width: w * 0.075, height: w * 0.075, objectFit: "contain", borderRadius: w * 0.015 }}
            />
          ) : null}
          <span style={{ fontSize: w * 0.032, fontWeight: 800, color: isLuxury ? accent : ink }}>{clinicName}</span>
        </div>
        {brand.showPhone !== false && phone ? (
          <span dir="ltr" style={{ fontSize: w * 0.03, fontWeight: 700, color: soft }}>{phone}</span>
        ) : null}
      </div>
    );

    return (
      <div
        dir={rtl ? "rtl" : "ltr"}
        className={fontClass}
        style={{
          width: w,
          height: h,
          background: ground,
          color: ink,
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: pad,
          boxSizing: "border-box",
        }}
      >
        {/* Theme dressing */}
        {isLuxury ? (
          <div
            style={{
              position: "absolute",
              inset: w * 0.03,
              border: `2px solid ${accent}55`,
              borderRadius: w * 0.02,
              pointerEvents: "none",
            }}
          />
        ) : isBasic ? (
          <div style={{ position: "absolute", top: 0, insetInlineStart: 0, width: "100%", height: w * 0.018, background: accent }} />
        ) : (
          <>
            <div
              style={{
                position: "absolute",
                top: -w * 0.22,
                insetInlineEnd: -w * 0.22,
                width: w * 0.55,
                height: w * 0.55,
                borderRadius: "50%",
                background: `${accent}1f`,
              }}
            />
            <div
              style={{
                position: "absolute",
                bottom: -w * 0.3,
                insetInlineStart: -w * 0.18,
                width: w * 0.5,
                height: w * 0.5,
                borderRadius: "50%",
                background: `${accent}14`,
              }}
            />
          </>
        )}

        {/* Header */}
        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span
            style={{
              fontSize: w * 0.028,
              fontWeight: 800,
              letterSpacing: rtl ? 0 : 2,
              textTransform: "uppercase",
              color: isLuxury ? accent : soft,
            }}
          >
            {clinicName}
          </span>
          {layout === "tip" && (
            <span
              style={{
                fontSize: w * 0.028,
                fontWeight: 900,
                background: isLuxury ? `${accent}22` : `${accent}18`,
                color: isLuxury ? accent : accent,
                padding: `${w * 0.012}px ${w * 0.03}px`,
                borderRadius: 999,
              }}
            >
              {rtl ? "💡 نصيحة اليوم" : "💡 Daily tip"}
            </span>
          )}
        </div>

        {/* Body */}
        <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: h * 0.03 }}>
          {layout === "offer" && (
            <span
              style={{
                alignSelf: rtl ? "flex-start" : "flex-start",
                fontSize: w * 0.03,
                fontWeight: 900,
                background: accent,
                color: isLuxury ? "#0e1116" : "#ffffff",
                padding: `${w * 0.014}px ${w * 0.035}px`,
                borderRadius: 999,
              }}
            >
              {rtl ? "عرض خاص" : "Special offer"}
            </span>
          )}
          <p
            style={{
              fontSize: headlineSize,
              fontWeight: 900,
              lineHeight: 1.25,
              margin: 0,
              color: layout === "offer" && !isLuxury ? accent : ink,
              whiteSpace: "pre-wrap",
            }}
          >
            {headline}
          </p>
          {rest && (
            <p style={{ fontSize: restSize, fontWeight: 600, lineHeight: 1.65, margin: 0, color: soft, whiteSpace: "pre-wrap" }}>
              {rest}
            </p>
          )}
          {layout === "offer" && (
            <span
              style={{
                alignSelf: rtl ? "flex-start" : "flex-start",
                marginTop: h * 0.015,
                fontSize: w * 0.034,
                fontWeight: 900,
                border: `${w * 0.004}px solid ${isLuxury ? accent : ink}`,
                color: isLuxury ? accent : ink,
                padding: `${w * 0.018}px ${w * 0.05}px`,
                borderRadius: 999,
              }}
            >
              {rtl ? "احجز الآن ↙" : "Book now ↗"}
            </span>
          )}
        </div>

        {/* Footer */}
        <div style={{ position: "relative" }}>{footer}</div>
      </div>
    );
  };

  /* -------------------------------- the modal -------------------------------- */

  const { w, h } = FORMATS[format];
  const previewWidth = 340;
  const scale = previewWidth / w;

  if (!portalTarget) return null;

  return createPortal(
    <div className="fixed inset-0 z-[320] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" dir={isAr ? "rtl" : "ltr"}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <h3 className="text-base font-black text-slate-900">{isAr ? "استوديو التصميم" : "Design Studio"}</h3>
            <p className="text-[11px] font-bold text-slate-400">
              {isAr ? `الثيم: ${theme.ar} — يتغير من «هوية العيادة»` : `Theme: ${theme.en} — change it from Brand Kit`}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full bg-surface-muted hover:bg-slate-200 text-ink-muted">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 grid md:grid-cols-[1fr_360px] gap-5">
          {/* Controls */}
          <div className="space-y-4 min-w-0">
            <div>
              <label className="block text-xs font-black text-ink-muted mb-1.5">{isAr ? "التكوين" : "Layout"}</label>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: "announce", en: "Post", ar: "منشور" },
                    { id: "offer", en: "Offer", ar: "عرض" },
                    { id: "tip", en: "Tip", ar: "نصيحة" },
                  ] as { id: Layout; en: string; ar: string }[]
                ).map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setLayout(l.id)}
                    className={`py-2.5 rounded-xl border text-xs font-black transition-colors ${
                      layout === l.id ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    {isAr ? l.ar : l.en}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-black text-ink-muted mb-1.5">{isAr ? "المقاس" : "Format"}</label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => setFormat("square")}
                  className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl border text-xs font-black transition-colors ${
                    format === "square" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200"
                  }`}
                >
                  <Square size={13} /> {isAr ? "مربع (بوست)" : "Square (feed)"}
                </button>
                <button
                  onClick={() => setFormat("story")}
                  className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl border text-xs font-black transition-colors ${
                    format === "story" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200"
                  }`}
                >
                  <Smartphone size={13} /> {isAr ? "طولي (ستوري)" : "Story (9:16)"}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-black text-ink-muted mb-1.5">{isAr ? "العنوان على التصميم" : "Headline on the design"}</label>
              <textarea
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                rows={2}
                dir="auto"
                className="w-full bg-surface-subtle border border-line rounded-xl p-3 text-sm font-bold text-slate-800 outline-none focus:border-emerald-400 resize-y"
              />
            </div>
            <div>
              <label className="block text-xs font-black text-ink-muted mb-1.5">{isAr ? "النص المساعد" : "Supporting text"}</label>
              <textarea
                value={rest}
                onChange={(e) => setRest(e.target.value)}
                rows={4}
                dir="auto"
                className="w-full bg-surface-subtle border border-line rounded-xl p-3 text-xs text-slate-700 leading-relaxed outline-none focus:border-emerald-400 resize-y"
              />
            </div>

            {logoUrl && (
              <button
                onClick={() => setIncludeLogo((v) => !v)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-black transition-colors ${
                  includeLogo ? "bg-surface text-slate-700 border-line-strong" : "bg-surface-muted text-slate-400 border-line"
                }`}
              >
                <ImageOff size={13} /> {includeLogo ? (isAr ? "اللوجو ظاهر — اضغط للإخفاء" : "Logo on — click to hide") : isAr ? "اللوجو مخفي" : "Logo off"}
              </button>
            )}

            {exportError && <p className="text-xs font-bold text-rose-600">{exportError}</p>}

            <button
              onClick={download}
              disabled={exporting || !headline.trim()}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-accent hover:bg-emerald-600 text-ink-on-accent font-black text-sm transition-colors disabled:opacity-50"
            >
              {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              {exporting ? (isAr ? "جارٍ التصدير…" : "Exporting…") : isAr ? "تحميل الصورة (PNG)" : "Download image (PNG)"}
            </button>
            <p className="text-[11px] font-bold text-slate-400">
              {isAr
                ? "حمّل الصورة ثم انشرها مع الكابشن من التقويم — نفس أسلوب «النظام يجهز وأنت تنشر»."
                : "Download, then post it with the caption from your calendar — same prepare-and-you-post flow as everything else."}
            </p>
          </div>

          {/* Preview */}
          <div className="flex items-start justify-center">
            <div
              className="rounded-2xl border border-line shadow-lg overflow-hidden shrink-0"
              style={{ width: previewWidth, height: h * scale }}
            >
              <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: w, height: h }}>
                <Artboard w={w} h={h} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Hidden full-size artboard — what actually gets rasterized. */}
      <div style={{ position: "fixed", top: 0, left: -13000, pointerEvents: "none" }} aria-hidden="true">
        <div ref={exportRef}>
          <Artboard w={w} h={h} />
        </div>
      </div>
    </div>,
    portalTarget
  );
}
