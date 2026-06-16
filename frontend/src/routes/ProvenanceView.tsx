import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import { Card } from '../design';
import { CytoscapeGraph } from '../components/CytoscapeGraph';
import { ErrorState, Loading, Empty } from '../components/Feedback';
import { useCurrentStudy } from '../shell/currentStudy';
import { keyLabel } from '../lib/keys';

/* Full-screen provenance graph for a study. Falls back to the pinned current
   study when no key is in the URL. Uses the reasoning subgraph (run_record /
   assessment / decision / requirement / conclusion + their relations). */

const LEGEND: { label: string; bg: string; border: string }[] = [
  { label: 'plan / run', bg: '#eaf1f8', border: '#15487a' },
  { label: 'decision', bg: '#fbefd9', border: '#e08a1e' },
  { label: 'requirement', bg: '#eaf1f8', border: '#1b5e9e' },
  { label: 'assessment / conclusion', bg: '#e7f4ec', border: '#1f9d55' },
];

export function ProvenanceView() {
  const { studyKey: raw } = useParams();
  const { study } = useCurrentStudy();
  const studyKey = useMemo(
    () => (raw ? decodeURIComponent(raw) : study?.key ?? ''),
    [raw, study],
  );
  const { setStudy } = useCurrentStudy();
  useEffect(() => {
    if (studyKey && !study) setStudy({ key: studyKey, label: keyLabel(studyKey), version: null });
  }, [studyKey, study, setStudy]);

  const { data, error, loading } = useAsync(
    () => (studyKey ? api.reasoning(studyKey) : Promise.resolve(null)),
    [studyKey],
  );

  if (!studyKey) {
    return <Empty>Open a study first — its provenance graph appears here.</Empty>;
  }

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 1320, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--blue-700)', marginBottom: 8 }}>provenance</div>
          <h1 style={{ fontFamily: 'var(--font-sans)', fontSize: 24, fontWeight: 600, letterSpacing: '-.02em', color: 'var(--ink-800)', margin: 0 }}>{keyLabel(studyKey)}</h1>
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {LEGEND.map((l) => (
            <span key={l.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-400)' }}>
              <span style={{ width: 12, height: 12, borderRadius: 2, background: l.bg, border: `1px solid ${l.border}` }} />
              {l.label}
            </span>
          ))}
        </div>
      </div>

      <Card flush padded={false}>
        {loading ? <Loading label="loading provenance" /> : null}
        {error ? <ErrorState error={error} /> : null}
        {data?.graph && (data.graph.nodes.length || data.graph.edges.length) ? (
          <CytoscapeGraph graph={data.graph} graphStyle="provenance" height="calc(100vh - 220px)" />
        ) : !loading && !error ? (
          <Empty>No provenance graph recorded for this study.</Empty>
        ) : null}
      </Card>
    </div>
  );
}
