import { api } from '../api/client';
import { useAsync } from '../hooks/useAsync';
import type { ServerStatus } from '../api/types';
import { Card, SpecTable, StatusPill } from '../design';
import { ErrorState, Loading } from '../components/Feedback';

/* Server reachability. Status reflects whether each endpoint actually responds
   (the backend probes them), NOT whether it holds data. The dashboard is
   trivially up; peers come from RS_DASHBOARD_SERVERS (health URLs). */

export function ServersView() {
  const { data, error, loading, reload } = useAsync<ServerStatus[]>(() => api.servers(), []);

  return (
    <div style={{ padding: '28px 32px', maxWidth: 980, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 22 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--blue-700)', marginBottom: 9 }}>endpoint reachability</div>
          <h1 style={{ fontFamily: 'var(--font-sans)', fontSize: 28, fontWeight: 600, letterSpacing: '-.02em', color: 'var(--ink-800)', margin: 0 }}>Servers</h1>
        </div>
        <button onClick={reload} style={{ border: '1px solid var(--app-line)', background: 'var(--app-panel)', borderRadius: 'var(--radius-sm)', padding: '7px 13px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-500)' }}>
          re-probe
        </button>
      </div>

      {loading ? <Loading label="probing endpoints" /> : null}
      {error ? <ErrorState error={error} /> : null}
      {data ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 18 }}>
          {data.map((s) => (
            <Card
              key={s.name}
              title={s.name}
              headerRight={
                <StatusPill status={s.reachable ? 'ok' : 'error'} live={s.reachable}>
                  {s.reachable ? 'reachable' : 'unreachable'}
                </StatusPill>
              }
            >
              <SpecTable rows={[
                { k: 'url', v: s.url ?? '(this service)' },
                { k: 'http', v: s.status_code != null ? String(s.status_code) : s.error ? 'error' : '—' },
                { k: 'latency', v: `${s.latency_ms} ms` },
                ...(s.detail ? [{ k: 'note', v: s.detail }] : []),
                ...(s.error ? [{ k: 'error', v: s.error }] : []),
              ]} />
            </Card>
          ))}
        </div>
      ) : null}
      {data && data.length <= 1 ? (
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--ink-400)', lineHeight: 1.6, marginTop: 18, maxWidth: 620 }}>
          Only the dashboard is being probed. Configure peer servers (e.g. the hangar tool
          servers) via the <code style={{ fontFamily: 'var(--font-mono)' }}>RS_DASHBOARD_SERVERS</code> environment
          variable (a JSON list of <code style={{ fontFamily: 'var(--font-mono)' }}>{'{name, url}'}</code> health endpoints) to probe their reachability here.
        </p>
      ) : null}
    </div>
  );
}
