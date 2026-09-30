"use client";

import { useState } from "react";
import { Check, ExternalLink, Loader2, LocateFixed, MapPin } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { acquireBestPosition, locationFailureMessage } from "@/lib/attendanceLocation";
import {
  CLOCK_IN_RADII,
  coordsFromText,
  isUsablePin,
  pinMapLink,
  type ClockInPin,
} from "@/lib/setupWizard";

/**
 * Setup step: pin where the clinic is, so a phone clock-in only counts from inside it.
 *
 * The same three fields Settings → Clock-in rules saves (`attendanceLat`, `attendanceLng`,
 * `attendanceRadius` on `clinic_info`), and the same reader the Time Clock uses to take a position
 * — it waits a few seconds for a satellite fix instead of trusting the first coarse one, and says
 * in plain words why when it cannot get one. The page owns the pin and the save; this is the part
 * a person touches.
 *
 * Most owners set up from home, where "use my location" would pin their living room. So a second
 * way in takes coordinates pasted from Google Maps, and the pin is always shown on a map before
 * anything is saved.
 */
export default function ClockInLocationStep({
  pin,
  stored,
  onChange,
}: {
  pin: ClockInPin;
  stored: ClockInPin;
  onChange: (pin: ClockInPin) => void;
}) {
  const { language } = useLanguage();
  const ar = language === "ar";

  const [locating, setLocating] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [pasted, setPasted] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);

  const t = {
    already: ar ? "مكان العيادة متحدد بالفعل. تقدر تثبّته من جديد لو اتنقلتوا." : "The clinic is already pinned. Pin it again if you have moved.",
    here: ar ? "أنا في العيادة — ثبّت المكان ده" : "I'm at the clinic — pin this spot",
    again: ar ? "ثبّت المكان من جديد" : "Pin this spot again",
    hereHint: ar
      ? "اقف جوه العيادة، ويفضّل جنب شباك، ودوس الزرار. الموبايل بياخد كام ثانية عشان يحدد المكان بدقة."
      : "Stand inside the clinic, near a window if you can, and press the button. The phone takes a few seconds to find a precise fix.",
    locating: ar ? "بنحدد مكانك…" : "Finding where you are…",
    pinned: ar ? "مكان العيادة" : "The clinic's pin",
    accurate: (m: number) => (ar ? `دقة حوالي ±${m} متر` : `accurate to about ±${m} m`),
    map: ar ? "شوفه على الخريطة" : "See it on the map",
    radius: ar ? "تسجيل الحضور من الموبايل بيتحسب لحد" : "A phone clock-in counts within",
    metres: (m: string) => (ar ? `${m} متر` : `${m} m`),
    radiusHint: ar
      ? "جوه المباني الـ GPS ممكن يغلط عشرات الأمتار، والحضور بيحسب حساب ده. اختار مسافة أكبر بس لو العيادة في مبنى أو مجمّع كبير."
      : "Indoors a phone's GPS can be off by tens of metres, and the Time Clock allows for that. Pick a wider one only if the clinic is in a large building or compound.",
    notThere: ar ? "مش في العيادة دلوقتي؟" : "Not at the clinic right now?",
    pasteLabel: ar ? "الصق إحداثيات العيادة أو عنوانها من جوجل مابس" : "Paste the clinic's coordinates or its Google Maps address",
    pasteHow: ar
      ? "في جوجل مابس على الكمبيوتر: كليك يمين على العيادة، ودوس على الأرقام اللي فوق عشان تتنسخ، والصقها هنا."
      : "In Google Maps on a computer: right-click the clinic, click the numbers at the top to copy them, and paste them here.",
    use: ar ? "استخدم ده" : "Use this",
    noCoords: ar
      ? "مفيش إحداثيات في ده. روابط المشاركة القصيرة (maps.app.goo.gl) مش بيبقى فيها إحداثيات — انسخ الأرقام زي ما هو مكتوب فوق، أو ثبّت المكان وانت في العيادة."
      : "No coordinates in that. Short share links (maps.app.goo.gl) don't carry them — copy the numbers as described above, or pin the spot next time you're at the clinic.",
  };

  const locate = async () => {
    setLocating(true);
    setError("");
    const result = await acquireBestPosition();
    setLocating(false);
    if (!result.ok) {
      setError(locationFailureMessage(result.failure, ar));
      return;
    }
    setAccuracy(Math.round(result.reading.accuracy));
    onChange({ ...pin, lat: result.reading.latitude.toFixed(6), lng: result.reading.longitude.toFixed(6) });
  };

  const applyPasted = () => {
    const found = coordsFromText(pasted);
    if (!found) {
      setError(t.noCoords);
      return;
    }
    setError("");
    setAccuracy(null);
    onChange({ ...pin, lat: found.lat.toFixed(6), lng: found.lng.toFixed(6) });
    setPasted("");
  };

  const hasPin = isUsablePin(pin.lat, pin.lng);
  const unchangedStored = hasPin && isUsablePin(stored.lat, stored.lng) && pin.lat === stored.lat && pin.lng === stored.lng;
  // A radius typed on the Settings screen (say 75) is kept as a choice rather than silently dropped.
  const radii = (CLOCK_IN_RADII as readonly string[]).includes(pin.radius) ? [...CLOCK_IN_RADII] : [...CLOCK_IN_RADII, pin.radius];

  return (
    <div className="space-y-5">
      {unchangedStored && (
        <p className="flex items-center gap-2 text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5">
          <Check size={16} className="shrink-0" /> {t.already}
        </p>
      )}

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => void locate()}
          disabled={locating}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-ink-slab text-white text-sm font-black hover:bg-ink disabled:opacity-60 transition-all"
        >
          {locating ? <Loader2 size={16} className="animate-spin" /> : <LocateFixed size={16} />}
          {locating ? t.locating : hasPin ? t.again : t.here}
        </button>
        <p className="text-xs font-medium text-ink-muted leading-relaxed">{t.hereHint}</p>
      </div>

      {error && (
        <p role="alert" className="text-sm font-semibold text-danger bg-danger-tint border border-danger/25 rounded-xl px-4 py-3 leading-relaxed">
          {error}
        </p>
      )}

      {hasPin && (
        <div className="rounded-2xl border border-line p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-10 h-10 rounded-xl bg-accent-tint text-accent grid place-items-center shrink-0">
                <MapPin size={18} />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-black text-ink-muted uppercase tracking-widest">{t.pinned}</p>
                <p className="font-figure text-sm font-bold text-ink" dir="ltr">
                  {pin.lat}, {pin.lng}
                </p>
                {accuracy !== null && <p className="text-xs font-medium text-ink-muted">{t.accurate(accuracy)}</p>}
              </div>
            </div>
            <a
              href={pinMapLink(pin.lat, pin.lng)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-subtle px-3 py-2 text-xs font-bold text-ink-body hover:border-line-strong"
            >
              <ExternalLink size={13} /> {t.map}
            </a>
          </div>

          <div>
            <p className="text-sm font-black text-ink mb-2">{t.radius}</p>
            <div className="inline-flex rounded-xl border border-line p-1 bg-surface-subtle" role="radiogroup" aria-label={t.radius}>
              {radii.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={pin.radius === r}
                  onClick={() => onChange({ ...pin, radius: r })}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-black transition-colors ${
                    pin.radius === r ? "bg-ink-slab text-white" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {t.metres(r)}
                </button>
              ))}
            </div>
            <p className="text-xs font-medium text-ink-muted leading-relaxed mt-2">{t.radiusHint}</p>
          </div>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setPasteOpen((o) => !o)}
          aria-expanded={pasteOpen}
          className="text-sm font-bold text-accent-ink hover:underline"
        >
          {t.notThere}
        </button>
        {pasteOpen && (
          <div className="mt-3 space-y-2">
            <label className="block">
              <span className="block text-[11px] font-black text-ink-muted uppercase tracking-widest mb-2">{t.pasteLabel}</span>
              <span className="flex flex-col sm:flex-row gap-2">
                <input
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyPasted();
                    }
                  }}
                  placeholder="30.0444, 31.2357"
                  dir="ltr"
                  className="flex-1 min-w-0 px-4 py-3 bg-surface-subtle border border-line rounded-xl font-semibold text-ink outline-none focus:bg-surface focus:border-accent-soft transition-all"
                />
                <button
                  type="button"
                  onClick={applyPasted}
                  disabled={!pasted.trim()}
                  className="px-5 py-3 rounded-xl border border-line bg-surface text-sm font-black text-ink hover:border-line-strong disabled:opacity-50"
                >
                  {t.use}
                </button>
              </span>
            </label>
            <p className="text-xs font-medium text-ink-muted leading-relaxed">{t.pasteHow}</p>
          </div>
        )}
      </div>
    </div>
  );
}
