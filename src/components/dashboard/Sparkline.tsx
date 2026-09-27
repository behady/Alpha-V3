"use client";

/**
 * A small trend line drawn beside a figure — one ink, no axes, no labels.
 *
 * The owner asked for "small trend lines beside the numbers, no big charts": the line says
 * whether the figure is climbing or sliding, and the figure next to it says by how much. A faint
 * second line, when given, is the comparison period drawn underneath.
 */
export default function Sparkline({
  values,
  compare,
  width = 96,
  height = 28,
  className = "",
}: {
  values: ReadonlyArray<number | null | undefined>;
  compare?: ReadonlyArray<number | null | undefined>;
  width?: number;
  height?: number;
  className?: string;
}) {
  const clean = (xs: ReadonlyArray<number | null | undefined>) => xs.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0));
  const a = clean(values);
  const b = compare ? clean(compare) : [];
  const all = [...a, ...b];
  if (a.length < 2) return null;
  const max = Math.max(1, ...all);
  const pad = 2;
  const path = (xs: number[]) =>
    xs
      .map((v, i) => {
        const x = pad + (i / Math.max(1, xs.length - 1)) * (width - pad * 2);
        const y = height - pad - (v / max) * (height - pad * 2);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden="true">
      {b.length >= 2 && <path d={path(b)} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />}
      <path d={path(a)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
