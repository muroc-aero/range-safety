import { api } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import type { StudyListItem } from '../api/types';
import { Card, SpecTable, StatusPill } from '../design';
import { ErrorState, Loading } from '../components/Feedback';

/* Data-source inventory. The dashboard reads from three provenance sources;
   this view reports, honestly, which sources currently hold recorded studies
   (derived from the real study list) rather than fabricating live server
   health, which this app has no endpoint to probe. */

const SOURCES: { id: string; title: string; desc: string }[] = [
  { id: 'omd', title: 'omd', desc: 'OpenMDAO plan runner — plan provenance + recorder runs' },
  { id: 'sdk', title: 'sdk', desc: 'oas / ocp / pyc sessions — tool-call graph + artifacts' },
  { id: 'studyfs', title: 'studyfs', desc: 'multi-case studies — expanded spec + case table' },
];

export function ServersView() {
  const { data, error, loading } = useAsync<StudyListItem[]>(() => api.listStudies(), []);

  const counts = (data ?? []).reduce<Record<string, number>>((acc, s) => {
    acc[s.source] = (acc[s.source] ?? 0) + 1;
    return acc;
  }, {});
  const latest = (data ?? []).reduce<Record<string, string>>((acc, s) => {
    const u = s.updated ?? '';
    if (u > (acc[s.source] ?? '')) acc[s.source] = u;
    return acc;
  }, {});

  return (
    <div style={{ padding: '28px 32px', maxWidth: 980, margin: '0 auto' }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--blue-700)', marginBottom: 9 }}>data sources</div>
        <h1 style={{ fontFamily: 'var(--font-sans)', fontSize: 28, fontWeight: 600, letterSpacing: '-.02em', color: 'var(--ink-800)', margin: 0 }}>Sources</h1>
      </div>

      {loading ? <Loading label="probing sources" /> : null}
      {error ? <ErrorState error={error} /> : null}
      {data ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 18 }}>
          {SOURCES.map((src) => {
            const n = counts[src.id] ?? 0;
            return (
              <Card
                key={src.id}
                title={src.title}
                headerRight={<StatusPill status={n > 0 ? 'ok' : 'idle'} live={n > 0}>{n > 0 ? 'has data' : 'no studies'}</StatusPill>}
              >
                <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, lineHeight: 1.55, color: 'var(--ink-500)', margin: '0 0 12px' }}>{src.desc}</p>
                <SpecTable rows={[
                  { k: 'studies', v: String(n) },
                  { k: 'latest', v: latest[src.id] ? latest[src.id].slice(0, 13) : '—' },
                ]} />
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
