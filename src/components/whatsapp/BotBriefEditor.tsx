"use client";

import type { BotBrief } from "@/lib/bot/brief";

type Tone = NonNullable<BotBrief["tone"]>;
type Prices = NonNullable<BotBrief["prices"]>;
type TextKey = "focus" | "neverSay" | "handoffWhen";

const CARD = "rounded-xl border border-line bg-surface-subtle p-4 space-y-2";
const FIELD =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent-soft focus:ring-1 focus:ring-accent-soft/30 resize-y";

/**
 * "How the AI should talk": five guided cards that fill `botBrief`.
 *
 * Text commits on blur and choices on click, like every other field on the WhatsApp screen. The
 * default choice (friendly, ranges) is stored as no key at all, so a clinic that never touches
 * these cards keeps today's prompt exactly. Choices are buttons, not selects: an empty controlled
 * select shows its first option and would look chosen when nothing is.
 */
export default function BotBriefEditor({
  brief,
  onChange,
  onCommit,
  showBotPriceNote,
  isAr,
}: {
  brief: BotBrief;
  onChange: (next: BotBrief) => void;
  onCommit: () => void;
  showBotPriceNote: boolean;
  isAr: boolean;
}) {
  const t = {
    focus: isAr ? "تحب الذكاء الاصطناعي يركّز على إيه؟" : "What should the AI focus on?",
    focusHint: isAr ? "الخدمات اللي عايزه يقترحها لما يكون مناسب، من غير ضغط." : "The treatments you want it to suggest when it fits, without pushing.",
    focusPh: isAr ? "مثال: الزراعة والتبييض، وعرض التنظيف الشهر ده" : "e.g. Implants and whitening, and this month's cleaning offer",
    tone: isAr ? "طريقة الكلام" : "Tone",
    toneFriendly: isAr ? "ودود" : "Friendly",
    toneFriendlyHint: isAr ? "دافي وقريب، زي دلوقتي." : "Warm and chatty, as it is today.",
    toneFormal: isAr ? "رسمي" : "Formal",
    toneFormalHint: isAr ? "محترم ورسمي، من غير هزار ولا إيموجي." : "Polite and formal, no jokes or emoji.",
    toneShort: isAr ? "مختصر" : "Short",
    toneShortHint: isAr ? "جملة أو اتنين في كل رد." : "One or two sentences per reply.",
    prices: isAr ? "الأسعار على واتساب" : "Prices on WhatsApp",
    pricesRanges: isAr ? "نطاق سعر" : "Price ranges",
    pricesRangesHint: isAr
      ? "بيقول نطاق السعر من قائمة أسعارك، وإن الدكتور بيأكده في الكشف."
      : "Gives a range from your price list and says the dentist confirms it.",
    pricesConsult: isAr ? "بعد الكشف بس" : "After the consultation",
    pricesConsultHint: isAr ? "مش بيقول أي سعر، وبيعرض حجز كشف بدل كده." : "Never quotes a price; offers a consultation instead.",
    botPriceNote: isAr
      ? "رد البوت الجاهز على الأسعار لسه بيستخدم قائمة أسعارك."
      : "The bot's own price answer still uses your price list.",
    neverSay: isAr ? "ممنوع يتكلم في" : "Never talk about",
    neverSayHint: isAr ? "مواضيع أو كلمات مش عايزه يقرّب منها خالص." : "Topics or words it must stay away from.",
    neverSayPh: isAr ? "مثال: مقارنة بعيادات تانية، أو وعود بنتيجة مضمونة" : "e.g. Comparisons with other clinics, or guaranteed results",
    handoffWhen: isAr ? "حوّل للاستقبال دايماً لما" : "Always pass to staff when",
    handoffWhenHint: isAr ? "مواقف لازم موظف يتعامل معاها بنفسه." : "Situations a person must always handle.",
    handoffWhenPh: isAr ? "مثال: حد يسأل عن أطفال تحت ٦ سنين، أو يطلب دكتور بالاسم" : "e.g. Someone asks about children under 6, or asks for a dentist by name",
  };

  const setText = (key: TextKey, value: string) => onChange({ ...brief, [key]: value });

  // The default is stored as no key at all, never as the default's name.
  const setTone = (tone: Tone) => {
    const next = { ...brief };
    if (tone === "friendly") delete next.tone;
    else next.tone = tone;
    onChange(next);
    onCommit();
  };

  const setPrices = (prices: Prices) => {
    const next = { ...brief };
    if (prices === "ranges") delete next.prices;
    else next.prices = prices;
    onChange(next);
    onCommit();
  };

  const textCard = (key: TextKey, title: string, hint: string, ph: string) => (
    <label className={`block ${CARD}`}>
      <span className="block text-sm font-black text-ink">{title}</span>
      <span className="block text-xs leading-relaxed text-ink-muted">{hint}</span>
      <textarea
        rows={2}
        dir="auto"
        maxLength={500}
        className={FIELD}
        placeholder={ph}
        value={brief[key] ?? ""}
        onChange={(e) => setText(key, e.target.value)}
        onBlur={onCommit}
      />
    </label>
  );

  const choiceCard = <V extends string>(
    title: string,
    current: V,
    options: Array<{ id: V; label: string; hint: string }>,
    pick: (v: V) => void,
    note?: string,
  ) => (
    <div className={CARD} role="group" aria-label={title}>
      <p className="text-sm font-black text-ink">{title}</p>
      <div className={`grid gap-2 ${options.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {options.map((opt) => {
          const active = current === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                if (!active) pick(opt.id);
              }}
              className={`text-start rounded-xl border px-3 py-2.5 transition-colors ${
                active ? "border-accent bg-accent/5 ring-1 ring-accent" : "border-line bg-surface hover:bg-surface-muted"
              }`}
            >
              <span className="block text-sm font-black text-ink">{opt.label}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{opt.hint}</span>
            </button>
          );
        })}
      </div>
      {note && <p className="text-xs leading-relaxed text-ink-muted">{note}</p>}
    </div>
  );

  return (
    <div className="grid gap-3">
      {textCard("focus", t.focus, t.focusHint, t.focusPh)}
      {choiceCard<Tone>(
        t.tone,
        brief.tone ?? "friendly",
        [
          { id: "friendly", label: t.toneFriendly, hint: t.toneFriendlyHint },
          { id: "formal", label: t.toneFormal, hint: t.toneFormalHint },
          { id: "short", label: t.toneShort, hint: t.toneShortHint },
        ],
        setTone,
      )}
      {choiceCard<Prices>(
        t.prices,
        brief.prices ?? "ranges",
        [
          { id: "ranges", label: t.pricesRanges, hint: t.pricesRangesHint },
          { id: "consult", label: t.pricesConsult, hint: t.pricesConsultHint },
        ],
        setPrices,
        showBotPriceNote ? t.botPriceNote : undefined,
      )}
      {textCard("neverSay", t.neverSay, t.neverSayHint, t.neverSayPh)}
      {textCard("handoffWhen", t.handoffWhen, t.handoffWhenHint, t.handoffWhenPh)}
    </div>
  );
}
