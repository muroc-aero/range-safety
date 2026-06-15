import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { StudyCase, StudyView } from '../api/types';
import { useAsync } from '../hooks/useAsync';
import { Card } from '../design';
import { CytoscapeGraph } from '../components/CytoscapeGraph';
import { StudyPlotGallery } from '../components/StudyPlotGallery';
import { Empty, ErrorState, Loading } from '../components/Feedback';
import { useCurrentStudy } from '../shell/currentStudy';
import { keyLabel } from '../lib/keys';
import { stateLabel } from '../lib/lifecycle';

/* Study scope view (ports _study.html). Two flavors over /api/study:
   - studyfs: a hangar.sdk.study expanded into cases -> spreadsheet case table
     with a progress strip and live refresh while running, plus trade-grid
     plots.
   - omd grouping: plans sharing metadata.study -> lineage graph + matrix.
   Run-scoped detail is reached by opening a case's plan. */

const POLL_MS = 10_000;

function caseStatusColor(status?: string): string {
  if (status === 'converged' || status === 'completed') return 'var(--green-700)';
  if (status === 'failed' || status === 'error' || status === 'timeout') return 'var(--red-600)';
  if (status === 'running') return 'var(--amber-600)';
  return 'var(--ink-400)';
}

function fmtNum(v: unknown): string {
  return typeof v === 'number' ? String(Number(v.toPrecision(5))) : v == null ? '—' : String(v);
}

function CaseTable({ data, onOpenPlan }: { data: StudyView; onOpenPlan: (k: string) => void }) {
  const cases = data.cases ?? [];
  const params = data.param_keys ?? [];
  const outputs = data.output_keys ?? [];
  const th: CSSProperties = { textAlign: 'left', padding: '8px 10px', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-300)', borderBottom: '1px solid var(--app-line)', whiteSpace: 'nowrap' };
  const td: CSSProperties = { padding: '8px 10px', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--ink-700)', borderBottom: '1px solid var(--app-line-2)', whiteSpace: 'nowrap' };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640 }}>
        <thead>
          <tr>
            <th style={th}>case</th>
            {params.map((p) => <th key={p} style={th}>{p}</th>)}
            <th style={th}>status</th>
            <th style={th}>run</th>
            {outputs.map((o) => <th key={o} style={th}>{o}</th>)}
            <th style={th}>wall s</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c: StudyCase) => (
            <tr key={c.case_id}>
              <td style={td}>{c.case_id}{c.source === 'manual' ? <span style={{ color: 'var(--ink-300)' }}> (manual)</span> : null}</td>
              {params.map((p) => <td key={p} style={td}>{fmtNum(c.params?.[p])}</td>)}
              <td style={{ ...td, color: caseStatusColor(c.status) }} title={c.error || ''}>{c.status ?? '—'}</td>
              <td style={td}>
                {c.plan_key ? (
                  <button onClick={() => onOpenPlan(c.plan_key!)} style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--blue-600)' }}>
                    {c.run_ref ? c.run_ref.slice(-12) : 'open'}
                  </button>
                ) : <span style={{ color: 'var(--ink-300)' }}>—</span>}
              </td>
              {outputs.map((o) => <td key={o} style={td}>{fmtNum(c.outputs?.[o])}</td>)}
              <td style={td}>{c.wall_time_s != null ? c.wall_time_s.toFixed(1) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StudyOverview({ studyKey }: { studyKey: string }) {
  const navigate = useNavigate();
  const { setStudy } = useCurrentStudy();
  const { data, error, loading, reload } = useAsync<StudyView>(() => api.study(studyKey), [studyKey]);

  useEffect(() => {
    setStudy({ key: studyKey, label: keyLabel(studyKey), version: data?.progress?.version ?? null });
  }, [studyKey, data?.progress?.version, setStudy]);

  // Live refresh while the study is still running (ports the 10s case-table poll).
  const running = !!data?.progress && data.progress.done < data.progress.total;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(reload, POLL_MS);
    return () => clearInterval(id);
  }, [running, reload]);

  if (loading && !data) return <Loading label="loading study" />;
  if (error) return <ErrorState error={error} />;
  if (!data) return <Empty>No study data.</Empty>;

  const isCaseStudy = (data.cases?.length ?? 0) > 0 || !!data.progress;
  const prog = data.progress;
  const openPlan = (k: string) => navigate(`/study/${encodeURIComponent(k)}`);

  return (
    <div style={{ padding: '24px 32px 48px', maxWidth: 1320, margin: '0 auto' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--blue-700)', marginBottom: 8 }}>study scope</div>
        <h1 style={{ fontFamily: 'var(--font-sans)', fontSize: 24, fontWeight: 600, letterSpacing: '-.02em', color: 'var(--ink-800)', margin: 0 }}>{keyLabel(studyKey)}</h1>
      </div>

      {isCaseStudy && prog ? (
        <>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-500)', margin: '0 0 8px' }}>
            progress <b style={{ color: 'var(--ink-700)' }}>{prog.done}/{prog.total}</b>
            {Object.entries(prog.counts || {}).map(([k, v]) => <span key={k}> · {k} <b style={{ color: 'var(--ink-700)' }}>{v}</b></span>)}
            {prog.mean_case_wall_s ? <span> · mean {prog.mean_case_wall_s.toFixed(1)} s</span> : null}
            {running ? <span style={{ color: 'var(--amber-600)' }}> · auto-refreshing</span> : null}
          </p>
          <div style={{ height: 6, background: 'var(--app-line)', borderRadius: 3, margin: '0 0 18px', overflow: 'hidden' }}>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--green-600)', width: `${prog.total ? Math.round((100 * prog.done) / prog.total) : 0}%` }} />
          </div>
          <Card flush padded={false} style={{ marginBottom: 18 }}><CaseTable data={data} onOpenPlan={openPlan} /></Card>
          {data.study_plot_types?.length ? (
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-400)', margin: '0 0 10px' }}>trade-space plots</div>
              <StudyPlotGallery studyKey={studyKey} types={data.study_plot_types} />
            </div>
          ) : null}
        </>
      ) : data.members?.length ? (
        <>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--ink-500)', margin: '0 0 16px', lineHeight: 1.55 }}>
            {data.members.length} member analysis(es). Each is its own five-state analysis; node colour = its current state.
          </p>
          {data.graph && data.graph.nodes.length ? (
            <Card flush padded={false} style={{ marginBottom: 18 }}>
              <CytoscapeGraph graph={data.graph} graphStyle="study" height={360} />
            </Card>
          ) : null}
          <Card flush padded={false}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr>
                  {['plan', 'state', 'objective', ...(data.metric_keys ?? [])].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-300)', borderBottom: '1px solid var(--app-line)' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {data.members.map((m) => (
                    <tr key={m.plan_id}>
                      <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--blue-600)', borderBottom: '1px solid var(--app-line-2)' }}>{m.plan_id}{m.version ? ` v${m.version}` : ''}</td>
                      <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--ink-600)', borderBottom: '1px solid var(--app-line-2)' }}>{stateLabel(m.current_state)}</td>
                      <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--ink-400)', borderBottom: '1px solid var(--app-line-2)' }}>{m.objective ?? '—'}</td>
                      {(data.metric_keys ?? []).map((k) => (
                        <td key={k} style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--ink-700)', borderBottom: '1px solid var(--app-line-2)' }}>{fmtNum(m.metrics?.[k])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <Empty>This study has no cases or member analyses recorded.</Empty>
      )}
    </div>
  );
}
