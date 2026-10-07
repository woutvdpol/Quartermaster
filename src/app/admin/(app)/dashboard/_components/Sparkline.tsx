/** Tiny trend line (server component). Values are drawn to scale from zero; the box stretches to its width. */
export function Sparkline({ values, label, className }: { values: number[]; label: string; className?: string }) {
  const n = values.length;
  const max = Math.max(1, ...values);
  const W = 100;
  const H = 32;
  const pts = values.map((v, i) => [n <= 1 ? W / 2 : (i / (n - 1)) * W, H - 2 - (v / max) * (H - 4)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const area = n ? `${line} L${W} ${H} L0 ${H} Z` : "";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className={className ?? "block h-10 w-full"}>
      <path d={area} className="fill-accent" fillOpacity={0.12} />
      <path d={line} fill="none" className="stroke-accent" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
