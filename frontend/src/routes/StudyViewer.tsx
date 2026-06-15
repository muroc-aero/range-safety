import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, GitFork } from 'lucide-react';
import { api } from '../api/client';
import type { OptHistory, PlanView, ResultsView, RunRef, StateProjection } from '../api/types';
import { useAsync } from '../hooks/useAsync';
import {
  Badge, Button, Callout, Card, DecisionCard, Select, SpecTable, StatCard, Tag,
} from '../design';
import { ErrorState, Loading, Empty } from '../components/Feedback';
import { CytoscapeGraph } from '../components/CytoscapeGraph';
import { Sparklines } from '../components/Sparkline';
import { StateStrip } from '../components/StateStrip';
import { RequirementsSection } from '../sections/RequirementsSection';
import { ReportSection } from '../sections/ReportSection';
import { StudyOverview } from './StudyOverview';
import { useCurrentStudy } from '../shell/currentStudy';
import { keyLabel, shortRun, splitKey } from '../lib/keys';
import { formulationSections } from '../lib/formulation';
import {
  STATE_TO_TAB, STUDY_TABS, stateLabel, stateTone, type StudyTab,
} from '../lib/lifecycle';

// in-progress poll cadence for the state-strip (ports the old 8s shell poll)
const STATE_POLL_MS = 8_000;

// -- section tab bar --------------------------------------------------------

function SectionTabs({ active, onSet }: { active: StudyTab; onSet: (s: StudyTab) => void }) {
  return (
    <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--app-line)', position: 'sticky', top: 0, background: 'var(--app-canvas)', zIndex: 3, padding: '0 32px', overflowX: 'auto' }}>
      {STUDY_TABS.map((t) => (
        <button
          key={t}
          onClick={() => onSet(t)}
          style={{
            padding: '13px 16px', border: 'none', background: 'transparent', cursor: 'pointer',
            fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.04em',
            color: active === t ? 'var(--blue-700)' : 'var(--ink-400)',
            borderBottom: active === t ? '2px solid var(--blue-700)' : '2px solid transparent',
            marginBottom: -1,
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

// -- results ----------------------------------------------------------------

function numFmt(v: unknown): string {
  if (typeof v !== 'number') return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(3);
  return String(Number(v.toPrecision(4)));
}

function MarginBar({ margin, passed }: { margin: number; passed: boolean }) {
  // |margin| in [0,1] -> fill 0-100%; >1 (gross violation) clamps to 100%.
  const pct = Math.min(Math.abs(margin), 1) * 100;
  return (
    <span style={{ display: 'inline-block', width: 90, height: 6, background: 'var(--app-line)', borderRadius: 3, overflow: 'hidden', verticalAlign: 'middle' }} title={`margin ${margin.toFixed(2)}`}>
      <span style={{ display: 'block', height: 6, width: `${pct}%`, background: passed ? 'var(--green-600)' : 'var(--red-600)' }} />
    </span>
  );
}

function ConstraintStrip({ rows }: { rows: ResultsView['constraints'] }) {
  const sym = (t: string | null) => (t === 'upper' ? '≤' : t === 'lower' ? '≥' : '=');
  return (
    <Card title="constraints">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {rows.map((c) => (
          <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
            <Badge tone={c.passed ? 'ok' : 'error'}>{c.passed ? 'met' : 'violated'}</Badge>
            <span style={{ color: 'var(--ink-700)', flex: 1, minWidth: 0 }}>{c.name}</span>
            <span style={{ color: 'var(--ink-400)' }}>{sym(c.bound_type)} {c.bound != null ? numFmt(c.bound) : '—'}</span>
            <span style={{ color: 'var(--ink-700)' }}>= {numFmt(c.value)}</span>
            {c.margin != null ? <MarginBar margin={c.margin} passed={c.passed} /> : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

function RawFinalValues({ final }: { final: Record<string, unknown> }) {
  const entries = Object.entries(final);
  return (
    <details style={{ marginTop: 20 }}>
      <summary style={{ cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-400)' }}>
        all final values ({entries.length})
      </summary>
      <Card flush padded={false} style={{ marginTop: 10 }}>
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {entries.map(([k, v]) => (
                <tr key={k}>
                  <td style={{ padding: '6px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-500)', borderBottom: '1px solid var(--app-line-2)', width: '55%' }}>{k}</td>
                  <td style={{ padding: '6px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-700)', borderBottom: '1px solid var(--app-line-2)' }}>
                    {Array.isArray(v) ? <span style={{ color: 'var(--ink-300)' }}>[array, {v.length}]</span> : numFmt(v)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </details>
  );
}

function ResultsSection({ runKey }: { runKey: string | null }) {
  const { data, error, loading } = useAsync<ResultsView | null>(
    () => (runKey ? api.results(runKey) : Promise.resolve(null)),
    [runKey],
  );
  if (!runKey) return <Empty>No run recorded for this study yet.</Empty>;
  if (loading) return <Loading label="loading results" />;
  if (error) return <ErrorState error={error} />;
  if (!data) return <Empty>No results.</Empty>;

  const headline = data.headline ?? [];
  const cols = Math.min(Math.max(headline.length, 1), 6);
  const nCases = Array.isArray(data.history) ? data.history.length : 0;
  const optHist = data.opt_history as OptHistory;
  const hasHistory = !!optHist?.iterations && optHist.iterations.length >= 2;
  return (
    <div>
      {nCases ? (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-300)', marginBottom: 12 }}>{nCases} recorded case(s)</div>
      ) : null}

      {headline.length ? (
        <Card flush padded={false} style={{ marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols},1fr)`, gap: 1, background: 'var(--app-line)' }}>
            {headline.map((m) => (
              <StatCard
                key={m.name}
                label={m.role === 'objective' ? `${m.label} · obj` : m.label}
                value={typeof m.value === 'number' ? numFmt(m.value) : String(m.value)}
                unit={m.unit || undefined}
                tone={m.role === 'objective' ? 'ok' : 'default'}
              />
            ))}
          </div>
        </Card>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 18, alignItems: 'start' }}>
        {data.constraints.length ? <ConstraintStrip rows={data.constraints} /> : <div />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {data.checks.map((g) => (
            <Callout key={g.title} tone={g.passed ? 'ok' : 'error'} title={g.title}>
              {g.summary || (g.passed ? 'all checks passed' : 'checks failed')}
              {g.items.length ? (
                <ul style={{ margin: '8px 0 0', paddingLeft: 16, fontSize: 12 }}>
                  {g.items.slice(0, 8).map((it, i) => (
                    <li key={i} style={{ color: it.passed ? 'var(--ink-500)' : 'var(--red-600)' }}>{it.name || it.message}</li>
                  ))}
                </ul>
              ) : null}
            </Callout>
          ))}
          {!data.checks.length ? (
            <Callout tone="info" title="verification">No automated checks recorded for this run.</Callout>
          ) : null}
        </div>
      </div>

      {hasHistory ? (
        <Card title="optimization history" style={{ marginTop: 18 }}>
          <Sparklines history={optHist} />
        </Card>
      ) : null}

      {data.graph && data.graph.nodes.length ? (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-400)', marginBottom: 10 }}>execution graph · lineage</div>
          <Card flush padded={false}><CytoscapeGraph graph={data.graph} graphStyle={data.graph_style || 'provenance'} height={420} /></Card>
        </div>
      ) : null}

      {data.final ? <RawFinalValues final={data.final} /> : null}
    </div>
  );
}

// -- formulation ------------------------------------------------------------

function FormulationSection({ studyKey }: { studyKey: string }) {
  const { data, error, loading } = useAsync<PlanView>(() => api.plan(studyKey), [studyKey]);
  if (loading) return <Loading label="loading formulation" />;
  if (error) return <ErrorState error={error} />;
  const sections = formulationSections(data?.plan);
  if (!sections.length) return <Empty>This study has no structured plan formulation (sdk sessions carry their structure as the execution graph — see the provenance tab).</Empty>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, alignItems: 'start' }}>
      {sections.map((s) => (
        <Card key={s.title} title={s.title}><SpecTable rows={s.rows} /></Card>
      ))}
    </div>
  );
}

// -- decisions --------------------------------------------------------------

function DecisionsSection({ studyKey }: { studyKey: string }) {
  const { data, error, loading } = useAsync<PlanView>(() => api.plan(studyKey), [studyKey]);
  if (loading) return <Loading label="loading decisions" />;
  if (error) return <ErrorState error={error} />;
  const decisions = data?.decisions ?? [];
  if (!decisions.length) return <Empty>No decisions recorded for this study.</Empty>;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-400)' }}>decision log</span>
        <Badge tone="blueprint">{decisions.length} decision{decisions.length === 1 ? '' : 's'}</Badge>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {decisions.map((d, i) => (
          <DecisionCard
            key={String(d.id ?? i)}
            id={String(d.id ?? d.decision_type ?? `dec-${i + 1}`)}
            when={d.created_at ? String(d.created_at) : undefined}
            title={String(d.decision ?? d.decision_type ?? 'Decision')}
          >
            {String(d.reasoning ?? d.rationale ?? '')}
          </DecisionCard>
        ))}
      </div>
    </div>
  );
}

// -- plots ------------------------------------------------------------------

function PlotsSection({ runKey }: { runKey: string | null }) {
  const { data, error, loading } = useAsync<string[]>(
    () => (runKey ? api.plotTypes(runKey) : Promise.resolve([])),
    [runKey],
  );
  if (!runKey) return <Empty>No run recorded for this study yet.</Empty>;
  if (loading) return <Loading label="loading plots" />;
  if (error) return <ErrorState error={error} />;
  if (!data || !data.length) return <Empty>No plots available for this run.</Empty>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(360px,1fr))', gap: 18 }}>
      {data.map((t) => (
        <Card key={t} flush padded={false}>
          <div style={{ background: '#fff' }}>
            <img src={api.plotImageUrl(runKey, t)} alt={t} loading="lazy" style={{ width: '100%', display: 'block' }} />
          </div>
          <div style={{ padding: '11px 16px', borderTop: '1px solid var(--app-line-2)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--blue-600)' }}>{t}</div>
        </Card>
      ))}
    </div>
  );
}

// -- provenance -------------------------------------------------------------

function ProvenanceSection({ studyKey }: { studyKey: string }) {
  const navigate = useNavigate();
  const { data, error, loading } = useAsync(() => api.reasoning(studyKey), [studyKey]);
  if (loading) return <Loading label="loading provenance" />;
  if (error) return <ErrorState error={error} />;
  const graph = data?.graph;
  const empty = !graph || (!graph.nodes.length && !graph.edges.length);
  return (
    <div>
      <Card
        title="W3C PROV-Agent graph"
        headerRight={
          <button onClick={() => navigate(`/provenance/${encodeURIComponent(studyKey)}`)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--blue-600)' }}>
            open full screen →
          </button>
        }
      >
        {empty ? <Empty>No provenance graph recorded for this study.</Empty> : <CytoscapeGraph graph={graph} graphStyle="provenance" height={420} />}
      </Card>
    </div>
  );
}

// -- per-plan viewer --------------------------------------------------------

function StudyPlanViewer({ studyKey }: { studyKey: string }) {
  const navigate = useNavigate();
  const { setStudy } = useCurrentStudy();
  const [sec, setSec] = useState<StudyTab>('results');
  const userPicked = useRef(false);

  const state = useAsync<StateProjection>(() => api.state(studyKey), [studyKey]);
  const runs = useAsync<RunRef[]>(() => api.listRuns(studyKey), [studyKey]);
  const plan = useAsync<PlanView>(() => api.plan(studyKey), [studyKey]);

  // Open on the tab for the inferred current state, until the user picks one.
  useEffect(() => {
    if (!userPicked.current && state.data?.current) {
      setSec(STATE_TO_TAB[state.data.current] ?? 'results');
    }
  }, [state.data?.current]);

  // Poll the state projection while the run is in progress (8s, like the old
  // state strip) so a live run's lifecycle/coverage updates without a reload.
  const live = state.data?.current === 'executing';
  useEffect(() => {
    if (!live) return;
    const id = setInterval(state.reload, STATE_POLL_MS);
    return () => clearInterval(id);
  }, [live, state.reload]);

  const pick = (t: StudyTab) => { userPicked.current = true; setSec(t); };

  // Run selector: default to the newest run; the user can switch among a
  // study's runs (results + plots follow the selection).
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  useEffect(() => {
    if (runs.data?.length) setSelectedRun((cur) => cur ?? runs.data![0].run_id);
  }, [runs.data]);
  const runKey = selectedRun ?? (runs.data?.length ? runs.data[0].run_id : null);
  const { source } = splitKey(studyKey);
  const planName = (plan.data?.plan as Record<string, unknown> | undefined)?.metadata as
    | Record<string, unknown>
    | undefined;
  const title = (planName?.name as string) || keyLabel(studyKey);
  const objective = (plan.data?.plan as Record<string, unknown> | undefined)?.objective as
    | Record<string, unknown>
    | undefined;
  const version = state.data?.plan_version ?? plan.data?.version ?? null;

  // Pin as the current study for the rail + breadcrumb.
  useEffect(() => {
    if (studyKey) setStudy({ key: studyKey, label: keyLabel(studyKey), version });
  }, [studyKey, version, setStudy]);

  if (state.error) return <ErrorState error={state.error} />;

  return (
    <div>
      <div style={{ padding: '22px 32px 18px', borderBottom: '1px solid var(--app-line)', background: 'var(--app-panel)' }}>
        <button onClick={() => navigate('/')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-400)', marginBottom: 12, padding: 0 }}>
          <ArrowLeft size={13} /> studies
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--blue-700)', marginBottom: 9, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>{source}</span>
              {state.data ? <Badge tone={stateTone(state.data.current)} dot>{stateLabel(state.data.current)}</Badge> : null}
            </div>
            <h1 style={{ fontFamily: 'var(--font-sans)', fontSize: 27, fontWeight: 600, letterSpacing: '-.02em', color: 'var(--ink-800)', marginBottom: 10, wordBreak: 'break-word' }}>{title}</h1>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-300)' }}>
              plan <b style={{ color: 'var(--ink-600)', fontWeight: 500 }}>{keyLabel(studyKey)}{version != null ? ` v${version}` : ''}</b>
              {runKey ? (
                <>
                  <span style={{ color: 'var(--blue-200)', margin: '0 10px' }}>/</span>
                  run <b style={{ color: 'var(--ink-600)', fontWeight: 500 }}>{shortRun(runKey)}</b>
                </>
              ) : null}
              {objective?.name ? (
                <>
                  <span style={{ color: 'var(--blue-200)', margin: '0 10px' }}>/</span>
                  min <b style={{ color: 'var(--ink-600)', fontWeight: 500 }}>{String(objective.name).split('.').pop()}</b>
                </>
              ) : null}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 9, flex: 'none', alignItems: 'center' }}>
            {runs.data && runs.data.length > 1 ? (
              <Select
                mono
                value={runKey ?? ''}
                options={runs.data.map((r) => ({ value: r.run_id, label: shortRun(r.run_id) }))}
                onChange={(e) => setSelectedRun(e.target.value)}
                style={{ maxWidth: 230 }}
                title="select run"
              />
            ) : null}
            <Button variant="secondary" size="sm" iconLeft={<GitFork size={14} />} onClick={() => navigate(`/provenance/${encodeURIComponent(studyKey)}`)}>Provenance</Button>
            {runKey ? (
              <Button variant="blueprint" size="sm" mono iconLeft={<Download size={14} />} href={`/api/results/${encodeURIComponent(runKey)}`} target="_blank" rel="noreferrer">Export</Button>
            ) : null}
          </div>
        </div>
      </div>

      <StateStrip state={state.data} activeTab={sec} onPick={pick} />

      <SectionTabs active={sec} onSet={pick} />

      <div style={{ padding: '24px 32px 60px', maxWidth: 1180, margin: '0 auto' }}>
        {sec === 'requirements' && <RequirementsSection studyKey={studyKey} />}
        {sec === 'formulation' && <FormulationSection studyKey={studyKey} />}
        {sec === 'decisions' && <DecisionsSection studyKey={studyKey} />}
        {sec === 'results' && <ResultsSection runKey={runKey} />}
        {sec === 'plots' && <PlotsSection runKey={runKey} />}
        {sec === 'provenance' && <ProvenanceSection studyKey={studyKey} />}
        {sec === 'report' && <ReportSection studyKey={studyKey} />}
        {sec === 'provenance' ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <Tag label="plan" value={`${keyLabel(studyKey)}${version != null ? ` v${version}` : ''}`} tone="blueprint" />
            {runKey ? <Tag label="run" value={shortRun(runKey)} /> : null}
            {state.data ? <Tag label="state" value={stateLabel(state.data.current)} tone="accent" /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// -- dispatcher -------------------------------------------------------------

export function StudyViewer() {
  const { studyKey: raw } = useParams();
  const studyKey = useMemo(() => decodeURIComponent(raw ?? ''), [raw]);
  // studyfs keys are multi-case studies, not a single plan/run -> the case
  // table, not the per-plan lifecycle viewer.
  if (splitKey(studyKey).source === 'studyfs') {
    return <StudyOverview studyKey={studyKey} />;
  }
  return <StudyPlanViewer studyKey={studyKey} />;
}
