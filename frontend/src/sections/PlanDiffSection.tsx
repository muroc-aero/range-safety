import type { CSSProperties } from 'react';
import { api } from '../api/client';
import type { PlanDiffView } from '../api/types';
import { useAsync } from '../hooks/useAsync';
import { Badge } from '../design';
import type { Tone } from '../design/components/core';
import { ErrorState, Loading } from '../components/Feedback';

/* Plan diff (ports _plan_diff.html). Element-level field diff between two plan
   versions (defaults to parent -> latest), with an add/remove/modify scorecard
   and a grouped change table. Wired to /api/plan-diff. */

function actionTone(action: string): Tone {
  if (action === 'added') return 'ok';
  if (action === 'removed') return 'error';
  return 'warn';
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function PlanDiffSection({ studyKey }: { studyKey: string }) {
  const { data, error, loading } = useAsync<PlanDiffView>(() => api.planDiff(studyKey), [studyKey]);
  if (loading) return <Loading label="loading plan diff" />;
  if (error) return <ErrorState error={error} />;
  if (!data) return null;

  const td: CSSProperties = { padding: '7px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-700)', borderBottom: '1px solid var(--app-line-2)', verticalAlign: 'top' };
  const th: CSSProperties = { textAlign: 'left', padding: '7px 10px', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-300)', borderBottom: '1px solid var(--app-line)' };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        <span style={{ color: 'var(--ink-400)' }}>v{data.version_a ?? '—'} → v{data.version_b ?? '—'}</span>
        <span style={{ color: 'var(--green-700)' }}>+{data.summary?.added ?? 0} added</span>
        <span style={{ color: 'var(--red-600)' }}>−{data.summary?.removed ?? 0} removed</span>
        <span style={{ color: 'var(--amber-600)' }}>~{data.summary?.modified ?? 0} modified</span>
      </div>
      {data.changes?.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr>
              <th style={th}>element</th><th style={th}>change</th><th style={th}>old</th><th style={th}>new</th>
            </tr></thead>
            <tbody>
              {data.changes.map((c, i) => (
                <tr key={i}>
                  <td style={td}>{c.path}</td>
                  <td style={td}><Badge tone={actionTone(c.action)}>{c.action}</Badge></td>
                  <td style={{ ...td, color: 'var(--ink-500)' }}>{fmt(c.old)}</td>
                  <td style={td}>{fmt(c.new)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-300)' }}>No differences between these versions.</span>
      )}
    </div>
  );
}
