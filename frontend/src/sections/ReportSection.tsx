import { api } from '../api/client';
import type { Conclusion, ReportView } from '../api/types';
import { useAsync } from '../hooks/useAsync';
import { Badge, Card, DecisionCard, SpecTable, StatCard } from '../design';
import type { Tone } from '../design/components/core';
import { Empty, ErrorState, Loading } from '../components/Feedback';

/* Report / concluding view (ports _report.html): requirements scorecard,
   recorded conclusions (verdict + narrative + metrics + per-requirement
   verdict table), analysis phases, and declared replan triggers. Wired to
   /api/report. */

const SCORE: { key: string; tone: Tone }[] = [
  { key: 'verified', tone: 'ok' },
  { key: 'violated', tone: 'error' },
  { key: 'waived', tone: 'warn' },
  { key: 'open', tone: 'info' },
  { key: 'draft', tone: 'neutral' },
];

const SCORE_COLOR: Record<string, string> = {
  verified: 'var(--green-700)', violated: 'var(--red-600)', waived: 'var(--amber-600)',
  open: 'var(--blue-600)', draft: 'var(--ink-400)',
};

function verdictTone(v?: string): Tone {
  if (v === 'meets' || v === 'satisfies') return 'ok';
  if (v === 'fails' || v === 'violates') return 'error';
  return 'warn';
}

function num(v: unknown): string {
  return typeof v === 'number' ? (Math.abs(v) >= 1e5 || (v !== 0 && Math.abs(v) < 1e-3) ? v.toExponential(2) : String(Number(v.toPrecision(4)))) : String(v);
}

function ConclusionCard({ c }: { c: Conclusion }) {
  const metrics = (c.metrics ?? []) as { label: string; value: number | string; unit?: string; role?: string }[];
  const reqs = (c.requirements ?? []) as {
    id: string; text: string; verdict?: string;
    criteria?: { metric: string; comparator: string; threshold: unknown; actual?: number }[];
  }[];
  return (
    <Card
      title={c.run_id || c.id || 'conclusion'}
      headerRight={<Badge tone={verdictTone(c.verdict)}>{(c.verdict || 'partial').toUpperCase()}</Badge>}
    >
      {c.narrative ? <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, lineHeight: 1.55, color: 'var(--ink-600)', margin: '0 0 12px' }}>{c.narrative}</p> : null}
      {metrics.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(metrics.length, 6)},1fr)`, gap: 1, background: 'var(--app-line)', marginBottom: reqs.length ? 14 : 0 }}>
          {metrics.map((m) => (
            <StatCard key={m.label} label={m.label} value={num(m.value)} unit={m.unit || undefined} tone={m.role === 'objective' ? 'ok' : 'default'} />
          ))}
        </div>
      ) : null}
      {reqs.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {reqs.map((r) => (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 100px', gap: 12, alignItems: 'start', paddingTop: 8, borderTop: '1px solid var(--app-line-2)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-600)' }}>{r.id}</span>
              <div>
                <div style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--ink-700)' }}>{r.text}</div>
                {(r.criteria ?? []).map((cr, i) => (
                  <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-400)', marginTop: 2 }}>
                    {cr.metric} {cr.comparator} {String(cr.threshold)} <span style={{ color: 'var(--ink-300)' }}>(actual {cr.actual != null ? num(cr.actual) : 'n/a'})</span>
                  </div>
                ))}
              </div>
              <span><Badge tone={verdictTone(r.verdict)}>{r.verdict ?? 'open'}</Badge></span>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

export function ReportSection({ studyKey }: { studyKey: string }) {
  const { data, error, loading } = useAsync<ReportView>(() => api.report(studyKey), [studyKey]);
  if (loading) return <Loading label="loading report" />;
  if (error) return <ErrorState error={error} />;
  if (!data) return <Empty>No report.</Empty>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-400)', marginBottom: 10 }}>requirements scorecard</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12 }}>
          {SCORE.map((s) => (
            <Card key={s.key} padded={false}>
              <div style={{ padding: '14px 16px' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 500, color: SCORE_COLOR[s.key] }}>{data.scorecard?.[s.key] ?? 0}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-400)', marginTop: 4 }}>{s.key}</div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {data.conclusions?.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-400)' }}>conclusions</div>
          {data.conclusions.map((c, i) => <ConclusionCard key={c.id ?? i} c={c} />)}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, alignItems: 'start' }}>
        <Card title="analysis phases">
          {data.phases?.length ? (
            <SpecTable rows={data.phases.map((p) => ({ k: p.name || p.id || '—', v: p.mode || '' }))} />
          ) : <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-300)' }}>No phases declared.</span>}
        </Card>
        <Card title="replan triggers">
          {data.replan_triggers?.length ? (
            <ul style={{ margin: 0, paddingLeft: 18, fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--ink-600)', lineHeight: 1.6 }}>
              {data.replan_triggers.map((t, i) => <li key={i}>{String(t)}</li>)}
            </ul>
          ) : <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-300)' }}>None declared.</span>}
        </Card>
      </div>

      {data.decisions?.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-400)' }}>conclusions &amp; decisions</div>
          {data.decisions.map((d, i) => (
            <DecisionCard key={String(d.id ?? i)} id={String(d.id ?? d.decision_type ?? `dec-${i + 1}`)} title={String(d.decision ?? d.decision_type ?? 'Decision')}>
              {String(d.reasoning ?? d.rationale ?? '')}
            </DecisionCard>
          ))}
        </div>
      ) : null}
    </div>
  );
}
