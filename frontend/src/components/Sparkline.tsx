import type { OptHistory } from '../api/types';

/* Optimization-history sparklines (ports dashboard.js sparkSvg/renderSparklines).
   Compact inline SVG trajectories for objective / constraints / DVs, with a
   dashed bound line where the bound is in range. Null points leave gaps rather
   than fabricating a value. The full matplotlib plots remain in the Plots tab. */

const W = 130;
const H = 30;
const PAD = 3;

function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'n/a';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return String(Math.round(v * 1e4) / 1e4);
}

function SparkSvg({ values, stroke, bound }: { values: (number | null)[]; stroke: string; bound?: number | null }) {
  const nums = values.filter((v): v is number => v !== null && v !== undefined);
  if (nums.length < 2) return <span style={{ color: 'var(--ink-300)', fontSize: 11 }}>(no trajectory)</span>;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const span = hi - lo || 1;
  const n = values.length;
  const x = (i: number) => PAD + (i / (n - 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - ((v - lo) / span) * (H - 2 * PAD);

  const segs: string[][] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (v === null || v === undefined) { if (cur.length) { segs.push(cur); cur = []; } return; }
    cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (cur.length) segs.push(cur);

  const showBound = bound !== null && bound !== undefined && bound >= lo && bound <= hi;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ flex: 'none' }}>
      {showBound ? (
        <line x1={PAD} y1={y(bound!).toFixed(1)} x2={W - PAD} y2={y(bound!).toFixed(1)} stroke="var(--red-600)" strokeWidth="1" strokeDasharray="3,2" />
      ) : null}
      {segs.map((pts, i) => (
        <polyline key={i} fill="none" stroke={stroke} strokeWidth="1.5" points={pts.join(' ')} />
      ))}
    </svg>
  );
}

function Row({ label, values, stroke, bound, unit }: { label: string; values: (number | null)[]; stroke: string; bound?: number | null; unit?: string }) {
  let first: number | null = null;
  let last: number | null = null;
  for (const v of values) {
    if (v !== null && v !== undefined) { if (first === null) first = v; last = v; }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '5px 0' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-600)', minWidth: 120 }}>{label}</span>
      <SparkSvg values={values} stroke={stroke} bound={bound} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-400)' }}>
        {fmt(first)} → {fmt(last)}{unit ? ` ${unit}` : ''}
      </span>
    </div>
  );
}

export function Sparklines({ history }: { history: OptHistory }) {
  if (!history.iterations || history.iterations.length < 2) return null;
  return (
    <div>
      {history.objective ? (
        <>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-300)', margin: '4px 0' }}>objective</div>
          <Row label={history.objective.label} values={history.objective.values} stroke="var(--blue-600)" />
        </>
      ) : null}
      {history.constraints?.length ? (
        <>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-300)', margin: '8px 0 4px' }}>constraints</div>
          {history.constraints.map((c) => <Row key={c.label} label={c.label} values={c.values} stroke="var(--amber-600)" bound={c.bound} />)}
        </>
      ) : null}
      {history.design_variables?.length ? (
        <>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-300)', margin: '8px 0 4px' }}>design variables</div>
          {history.design_variables.map((d) => <Row key={d.label} label={d.label} values={d.values} stroke="var(--green-600)" unit={d.units} />)}
        </>
      ) : null}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-300)', marginTop: 8 }}>
        {history.iterations.length} sampled iteration(s). Full plots in the Plots tab.
      </div>
    </div>
  );
}
