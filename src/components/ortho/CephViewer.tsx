"use client";

import { useMemo, useRef, useState } from "react";
import { Crosshair, RotateCcw, Ruler, Save, Loader2 } from "lucide-react";
import {
  analyzeCeph,
  CEPH_LABELS,
  CEPH_LANDMARKS,
  CEPH_LINES,
  type CephAnalysis,
  type CephCalibration,
  type CephConfidence,
  type CephLandmarkId,
  type CephLandmarks,
  type CephMeasurement,
  type CephNormOverrides,
  type CephPoint,
} from "@/lib/orthoCeph";

/**
 * The tracing: the film with the landmarks drawn over it, every dot draggable, the reference
 * lines redrawn as it moves, and the measurement table recomputed on every drag — the same
 * `analyzeCeph` the server ran, so what the dentist sees while correcting is exactly what will be
 * stored when they save.
 *
 * Coordinates are the report's 0–1000 grid per axis. The overlay is an SVG whose viewBox is
 * `1000·aspect × 1000`, so a landmark at (x, y) is drawn at (x·aspect, y): circles stay round and
 * text stays upright while the picture's own proportions are kept.
 */
export default function CephViewer({
  imageUrl,
  imageSize,
  landmarks,
  calibration,
  confidence,
  norms,
  readOnly,
  ar,
  saving,
  onSave,
}: {
  imageUrl: string;
  imageSize?: { width: number; height: number } | null;
  landmarks: CephLandmarks;
  calibration: CephCalibration | null;
  confidence?: Partial<Record<CephLandmarkId, CephConfidence>>;
  norms: CephNormOverrides;
  readOnly: boolean;
  ar: boolean;
  saving?: boolean;
  onSave?: (landmarks: CephLandmarks, calibration: CephCalibration | null) => void;
}) {
  const [local, setLocal] = useState<CephLandmarks>(landmarks);
  const [cal, setCal] = useState<CephCalibration | null>(calibration);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(imageSize || null);
  const [dragging, setDragging] = useState<CephLandmarkId | "cal_a" | "cal_b" | null>(null);
  const [placing, setPlacing] = useState<CephLandmarkId | null>(null);
  const [calMode, setCalMode] = useState<0 | 1 | 2>(0);
  const [calDraft, setCalDraft] = useState<{ a?: CephPoint; b?: CephPoint }>({});
  const [calMm, setCalMm] = useState<string>(calibration ? String(calibration.mm) : "");
  const [showLines, setShowLines] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);

  // Re-seed the working copy when the saved tracing changes (a review was stored), during render
  // rather than in an effect so the first paint already shows the new dots.
  const [seed, setSeed] = useState({ landmarks, calibration });
  if (seed.landmarks !== landmarks || seed.calibration !== calibration) {
    setSeed({ landmarks, calibration });
    setLocal(landmarks);
    setCal(calibration);
    setCalMm(calibration ? String(calibration.mm) : "");
  }

  const aspect = natural && natural.height > 0 ? natural.width / natural.height : 1;
  const W = 1000 * aspect;
  const analysis: CephAnalysis = useMemo(() => analyzeCeph(local, { aspect, calibration: cal, norms }), [local, aspect, cal, norms]);
  const dirty = JSON.stringify(local) !== JSON.stringify(landmarks) || JSON.stringify(cal) !== JSON.stringify(calibration);

  const toGrid = (e: { clientX: number; clientY: number }): CephPoint | null => {
    const el = boxRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    const x = Math.max(0, Math.min(1000, Math.round(((e.clientX - r.left) / r.width) * 1000)));
    const y = Math.max(0, Math.min(1000, Math.round(((e.clientY - r.top) / r.height) * 1000)));
    return { x, y };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || readOnly) return;
    const p = toGrid(e);
    if (!p) return;
    if (dragging === "cal_a" || dragging === "cal_b") {
      if (!cal) return;
      setCal({ ...cal, [dragging === "cal_a" ? "a" : "b"]: p });
    } else {
      setLocal((cur) => ({ ...cur, [dragging]: p }));
    }
  };
  const onPointerUp = () => setDragging(null);

  const onSurfaceClick = (e: React.MouseEvent) => {
    if (readOnly) return;
    const p = toGrid(e);
    if (!p) return;
    if (calMode === 1) {
      setCalDraft({ a: p });
      setCalMode(2);
      return;
    }
    if (calMode === 2 && calDraft.a) {
      const mm = Number(calMm);
      setCal({ a: calDraft.a, b: p, mm: Number.isFinite(mm) && mm > 0 ? mm : 10 });
      setCalDraft({});
      setCalMode(0);
      return;
    }
    if (placing) {
      setLocal((cur) => ({ ...cur, [placing]: p }));
      setPlacing(null);
    }
  };

  const removeLandmark = (id: CephLandmarkId) => {
    setLocal((cur) => {
      const next = { ...cur };
      delete next[id];
      return next;
    });
  };

  const pt = (id: CephLandmarkId | "OP1" | "OP2"): CephPoint | null => {
    if (id === "OP1") return local.U6 && local.L6 ? mid(local.U6, local.L6) : null;
    if (id === "OP2") return local.U1I && local.L1I ? mid(local.U1I, local.L1I) : null;
    return local[id] || null;
  };

  const missing = CEPH_LANDMARKS.filter((l) => !local[l.id]);
  const tone: Record<CephMeasurement["status"], string> = {
    normal: "text-emerald-700 bg-emerald-50",
    high: "text-orange-700 bg-orange-50",
    low: "text-sky-700 bg-sky-50",
    unscaled: "text-slate-500 bg-slate-100",
    missing: "text-slate-400 bg-slate-50",
  };
  const L = {
    lines: ar ? "الخطوط" : "Lines",
    calibrate: ar ? "معايرة" : "Calibrate",
    calHint1: ar ? "اضغط على أول نقطة على المسطرة" : "Click the first point on the ruler",
    calHint2: ar ? "اضغط على النقطة التانية" : "Click the second point",
    mm: ar ? "المسافة بينهم (مم)" : "Distance between them (mm)",
    clearCal: ar ? "إلغاء المعايرة" : "Remove calibration",
    place: ar ? "ضع نقطة ناقصة:" : "Place a missing landmark:",
    placing: ar ? "اضغط على الصورة لوضع" : "Click on the picture to place",
    reset: ar ? "رجّع تتبّع الذكاء الاصطناعي" : "Back to the AI's tracing",
    save: ar ? "حفظ التصحيحات" : "Save corrections",
    measurements: ar ? "القياسات" : "Measurements",
    norm: ar ? "الطبيعي" : "Norm",
    value: ar ? "القيمة" : "Value",
    uncal: ar ? "الصورة غير مُعايرة: القياسات الخطية (مم) غير محسوبة. عايِر على المسطرة لتظهر." : "Uncalibrated picture: linear measurements (mm) are not computed. Calibrate on the ruler to get them.",
    clinicNorm: ar ? "قاعدة العيادة" : "clinic norm",
    facing: ar ? "الوجه ناحية" : "Facing",
    right: ar ? "اليمين" : "right",
    left: ar ? "الشمال" : "left",
    remove: ar ? "إزالة" : "remove",
    readOnly: ar ? "التقرير موقّع — التتبّع للقراءة فقط." : "The report is signed — the tracing is read-only.",
  };
  const interp = analysis.interpretation;
  const lab = (g: keyof typeof CEPH_LABELS, v: string | null) => (v ? ((CEPH_LABELS[g] as Record<string, { en: string; ar: string }>)[v] || { en: v, ar: v })[ar ? "ar" : "en"] : null);
  const chips = [
    lab("skeletalClass", interp.skeletalClass),
    lab("vertical", interp.vertical),
    interp.maxilla ? `${ar ? "الفك العلوي" : "Maxilla"} ${lab("jaw", interp.maxilla)}` : null,
    interp.mandible ? `${ar ? "الفك السفلي" : "Mandible"} ${lab("jaw", interp.mandible)}` : null,
    interp.upperIncisors ? `${ar ? "القواطع العلوية" : "Upper incisors"} ${lab("inclination", interp.upperIncisors)}` : null,
    interp.lowerIncisors ? `${ar ? "القواطع السفلية" : "Lower incisors"} ${lab("inclination", interp.lowerIncisors)}` : null,
    lab("profile", interp.profile),
  ].filter((c): c is string => !!c);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" onClick={() => setShowLines((s) => !s)} className={`px-3 py-1.5 rounded-lg font-bold border ${showLines ? "bg-purple-600 text-white border-purple-600" : "bg-surface border-line text-slate-600"}`}>
          {L.lines}
        </button>
        {!readOnly && (
          <>
            <button
              type="button"
              onClick={() => {
                setCalMode(1);
                setCalDraft({});
                setPlacing(null);
              }}
              className={`px-3 py-1.5 rounded-lg font-bold border flex items-center gap-1.5 ${calMode ? "bg-amber-500 text-white border-amber-500" : "bg-surface border-line text-slate-600"}`}
            >
              <Ruler size={13} /> {L.calibrate}
            </button>
            {cal && (
              <>
                <label className="flex items-center gap-1.5 font-bold text-slate-500">
                  {L.mm}
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={calMm}
                    onChange={(e) => {
                      setCalMm(e.target.value);
                      const mm = Number(e.target.value);
                      if (Number.isFinite(mm) && mm > 0) setCal({ ...cal, mm });
                    }}
                    className="w-20 p-1.5 bg-surface border border-line rounded-lg font-bold text-slate-700"
                  />
                </label>
                <button type="button" onClick={() => setCal(null)} className="px-2.5 py-1.5 rounded-lg font-bold border border-line text-slate-500">
                  {L.clearCal}
                </button>
              </>
            )}
            {dirty && (
              <button
                type="button"
                onClick={() => {
                  setLocal(landmarks);
                  setCal(calibration);
                }}
                className="px-3 py-1.5 rounded-lg font-bold border border-line text-slate-600 flex items-center gap-1.5"
              >
                <RotateCcw size={13} /> {L.reset}
              </button>
            )}
            {onSave && (
              <button
                type="button"
                onClick={() => onSave(local, cal)}
                disabled={!dirty || saving}
                className="ml-auto px-4 py-1.5 rounded-lg font-black bg-emerald-600 text-white disabled:bg-slate-100 disabled:text-slate-400 flex items-center gap-1.5"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {L.save}
              </button>
            )}
          </>
        )}
        <span className="text-slate-400 font-bold">
          {L.facing} {analysis.facing === "right" ? L.right : L.left}
        </span>
      </div>
      {calMode === 1 && <p className="text-xs font-bold text-amber-700">{L.calHint1}</p>}
      {calMode === 2 && <p className="text-xs font-bold text-amber-700">{L.calHint2}</p>}
      {placing && (
        <p className="text-xs font-bold text-purple-700">
          {L.placing} {placing}
        </p>
      )}
      {readOnly && <p className="text-xs font-bold text-slate-400">{L.readOnly}</p>}

      <div
        ref={boxRef}
        className={`relative w-full bg-black rounded-2xl overflow-hidden select-none ${calMode || placing ? "cursor-crosshair" : ""}`}
        style={{ aspectRatio: `${aspect}` }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onClick={onSurfaceClick}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Lateral cephalogram"
          className="absolute inset-0 w-full h-full object-fill"
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) setNatural({ width: img.naturalWidth, height: img.naturalHeight });
          }}
        />
        <svg viewBox={`0 0 ${W} 1000`} className="absolute inset-0 w-full h-full" style={{ touchAction: "none" }}>
          {showLines &&
            CEPH_LINES.map((ln) => {
              const a = pt(ln.from);
              const b = pt(ln.to);
              if (!a || !b) return null;
              return <line key={ln.id} x1={a.x * aspect} y1={a.y} x2={b.x * aspect} y2={b.y} stroke={ln.color} strokeWidth={2.5} strokeOpacity={0.85} strokeDasharray={ln.id === "OP" ? "8 6" : undefined} />;
            })}
          {cal && (
            <g>
              <line x1={cal.a.x * aspect} y1={cal.a.y} x2={cal.b.x * aspect} y2={cal.b.y} stroke="#fbbf24" strokeWidth={3} strokeDasharray="6 4" />
              {(["a", "b"] as const).map((k) => (
                <circle
                  key={k}
                  cx={cal[k].x * aspect}
                  cy={cal[k].y}
                  r={9}
                  fill="#fbbf24"
                  stroke="#000"
                  strokeWidth={1.5}
                  style={{ cursor: readOnly ? "default" : "grab" }}
                  onPointerDown={(e) => {
                    if (readOnly) return;
                    e.stopPropagation();
                    (e.target as Element).setPointerCapture?.(e.pointerId);
                    setDragging(k === "a" ? "cal_a" : "cal_b");
                  }}
                />
              ))}
            </g>
          )}
          {calDraft.a && <circle cx={calDraft.a.x * aspect} cy={calDraft.a.y} r={9} fill="#fbbf24" stroke="#000" strokeWidth={1.5} />}
          {CEPH_LANDMARKS.map((info) => {
            const p = local[info.id];
            if (!p) return null;
            const conf = confidence?.[info.id];
            const fill = conf === "low" ? "#f87171" : conf === "moderate" ? "#fbbf24" : "#4ade80";
            return (
              <g key={info.id}>
                <circle
                  cx={p.x * aspect}
                  cy={p.y}
                  r={dragging === info.id ? 12 : 8}
                  fill={fill}
                  fillOpacity={0.9}
                  stroke="#0f172a"
                  strokeWidth={1.5}
                  style={{ cursor: readOnly ? "default" : "grab" }}
                  onPointerDown={(e) => {
                    if (readOnly) return;
                    e.stopPropagation();
                    (e.target as Element).setPointerCapture?.(e.pointerId);
                    setDragging(info.id);
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <title>{`${info.id} — ${ar ? info.ar : info.en}`}</title>
                </circle>
                <text x={p.x * aspect + 11} y={p.y - 8} fontSize={22} fontWeight={800} fill="#fff" stroke="#0f172a" strokeWidth={3} paintOrder="stroke" style={{ pointerEvents: "none" }}>
                  {info.id}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {!readOnly && missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-bold text-slate-500 flex items-center gap-1">
            <Crosshair size={13} /> {L.place}
          </span>
          {missing.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setPlacing(placing === m.id ? null : m.id);
                setCalMode(0);
              }}
              title={m.hint}
              className={`px-2 py-1 rounded-md font-bold border ${placing === m.id ? "bg-purple-600 text-white border-purple-600" : "bg-surface border-line text-slate-600"}`}
            >
              {m.id}
            </button>
          ))}
        </div>
      )}
      {!readOnly && (
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          {CEPH_LANDMARKS.filter((l) => local[l.id]).map((l) => (
            <span key={l.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-subtle border border-line text-slate-500 font-bold">
              {l.id}
              <button type="button" onClick={() => removeLandmark(l.id)} className="text-slate-400 hover:text-rose-600" title={L.remove}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span key={c} className="px-2.5 py-1 rounded-lg bg-purple-50 text-purple-800 text-xs font-black">
              {c}
            </span>
          ))}
        </div>
      )}

      <div className="bg-surface rounded-2xl border border-line overflow-hidden">
        <div className="px-4 py-2.5 border-b border-line text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center justify-between">
          <span>{L.measurements}</span>
          {analysis.calibrated ? <span className="text-emerald-600">{ar ? "مُعايَرة" : "calibrated"}</span> : <span className="text-amber-600">{ar ? "غير مُعايَرة" : "uncalibrated"}</span>}
        </div>
        {!analysis.calibrated && <p className="px-4 py-2 text-[11px] font-bold text-amber-700 bg-amber-50">{L.uncal}</p>}
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[9px] uppercase tracking-widest text-slate-400">
              <th className="text-start px-4 py-1.5 font-black">{ar ? "القياس" : "Measurement"}</th>
              <th className="text-end px-2 py-1.5 font-black">{L.value}</th>
              <th className="text-end px-2 py-1.5 font-black">{L.norm}</th>
              <th className="text-end px-4 py-1.5 font-black">z</th>
            </tr>
          </thead>
          <tbody>
            {analysis.measurements
              .filter((m) => m.status !== "missing")
              .map((m) => (
                <tr key={m.id} className="border-t border-line/60">
                  <td className="px-4 py-1.5 font-bold text-slate-700">
                    {ar ? m.ar : m.en}
                    <span className="text-slate-400 font-medium"> · {m.source}</span>
                  </td>
                  <td className="px-2 py-1.5 text-end font-black tabular-nums">
                    {m.value === null ? "—" : `${m.value}${m.unit}`}
                  </td>
                  <td className="px-2 py-1.5 text-end tabular-nums text-slate-500 font-bold">
                    {m.norm ? `${m.norm.mean} ± ${m.norm.sd}` : "—"}
                    {analysis.normOverrides.includes(m.id) && <span className="ms-1 text-[9px] text-purple-600">({L.clinicNorm})</span>}
                  </td>
                  <td className="px-4 py-1.5 text-end">
                    <span className={`inline-block px-1.5 py-0.5 rounded font-black tabular-nums ${tone[m.status]}`}>
                      {m.z === null ? (CEPH_LABELS.status[m.status] as { en: string; ar: string })[ar ? "ar" : "en"] : m.z > 0 ? `+${m.z}` : m.z}
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {analysis.missingCore.length > 0 && (
          <p className="px-4 py-2 text-[11px] font-bold text-slate-400 border-t border-line">
            {ar ? "نقاط أساسية ناقصة:" : "Core landmarks missing:"} {analysis.missingCore.join(", ")}
          </p>
        )}
      </div>
    </div>
  );
}

function mid(a: CephPoint, b: CephPoint): CephPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
