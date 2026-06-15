import type { CSSProperties } from 'react';
import { api } from '../api/client';
import type { Requirement, RequirementsView } from '../api/types';
import { useAsync } from '../hooks/useAsync';
import { Badge, Card } from '../design';
import type { Tone } from '../design/components/core';
import { Empty, ErrorState, Loading } from '../components/Feedback';

/* Requirements view (ports _requirements.html). Grouped by priority; each
   requirement shows its acceptance criteria, status, verification edges, and
   traceability. Wired to /api/requirements. */

const PRIORITIES: (string | null)[] = ['primary', 'secondary', 'goal', null];

function statusTone(status: string): Tone {
  switch (status) {
    case 'verified': return 'ok';
    case 'violated': return 'error';
    case 'waived': return 'neutral';
    case 'open': return 'info';
    default: return 'neutral';
  }
}

function edgeTone(relation: string): Tone {
  if (relation === 'satisfies') return 'ok';
  if (relation === 'violates') return 'error';
  return 'neutral';
}

const mono = (size = 11): CSSProperties => ({
  fontFamily: 'var(--font-mono)', fontSize: size, color: 'var(--ink-600)',
});

function ReqRow({ r }: { r: Requirement }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 110px 1.1fr 0.9fr', gap: 14, padding: '12px 0', borderBottom: '1px solid var(--app-line-2)', alignItems: 'start' }}>
      <span style={mono()}>{r.id}</span>
      <div>
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--ink-700)', lineHeight: 1.45 }}>{r.text}</div>
        {r.traces_to.length ? (
          <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-300)' }}>
            traces to: {r.traces_to.join(', ')}
          </div>
        ) : null}
      </div>
      <span><Badge tone={statusTone(r.status)} dot>{r.status}</Badge></span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {r.acceptance_criteria.length ? r.acceptance_criteria.map((c, i) => (
          <span key={i} style={mono(11)}>
            {c.metric} {c.comparator} {String(c.threshold)}
          </span>
        )) : <span style={{ color: 'var(--ink-300)' }}>—</span>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {r.verification_edges.length ? r.verification_edges.map((e, i) => (
          <Badge key={i} tone={edgeTone(e.relation)} title={e.subject_id}>{e.relation}</Badge>
        )) : <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-300)' }}>none</span>}
      </div>
    </div>
  );
}

export function RequirementsSection({ studyKey }: { studyKey: string }) {
  const { data, error, loading } = useAsync<RequirementsView>(() => api.requirements(studyKey), [studyKey]);
  if (loading) return <Loading label="loading requirements" />;
  if (error) return <ErrorState error={error} />;
  const reqs = data?.requirements ?? [];
  if (!reqs.length) return <Empty>No requirements recorded for this study.</Empty>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {PRIORITIES.map((prio) => {
        const group = reqs.filter((r) => (r.priority ?? null) === prio);
        if (!group.length) return null;
        return (
          <div key={String(prio)}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-400)', marginBottom: 8 }}>
              {prio ?? 'unspecified priority'}
            </div>
            <Card>
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 110px 1.1fr 0.9fr', gap: 14, paddingBottom: 8, borderBottom: '1px solid var(--app-line)', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-300)' }}>
                  <span>id</span><span>requirement</span><span>status</span><span>acceptance</span><span>verification</span>
                </div>
                {group.map((r) => <ReqRow key={r.id} r={r} />)}
              </div>
            </Card>
          </div>
        );
      })}
    </div>
  );
}
