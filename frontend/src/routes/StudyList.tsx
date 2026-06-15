import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Search } from 'lucide-react';
import { api } from '../api/client';
import type { StudyListItem } from '../api/types';
import { useAsync } from '../hooks/useAsync';
import { Badge, Card, Input, Select } from '../design';
import { Empty, ErrorState, Loading } from '../components/Feedback';
import { stateLabel, stateTone } from '../lib/lifecycle';

/* Landing grid of study cards, wired to /api/studies. Cheap list fields only
   (no per-study metrics): status, source, version, last-updated. Click opens
   the study viewer. Source + substring filters mirror the old shell selector. */

const SOURCES = [
  { value: 'all', label: 'all sources' },
  { value: 'omd', label: 'omd' },
  { value: 'sdk', label: 'sdk' },
  { value: 'studyfs', label: 'studyfs' },
];

function fmtUpdated(ts?: string): string {
  if (!ts) return '';
  // omd timestamps look like 20260414T145425; surface the date portion.
  const m = ts.match(/^(\d{4})(\d{2})(\d{2})T?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return ts.slice(0, 10);
}

function StudyCard({ s, onOpen }: { s: StudyListItem; onOpen: (k: string) => void }) {
  return (
    <div onClick={() => onOpen(s.key)} style={{ cursor: 'pointer' }}>
      <Card raised padded={false} style={{ height: '100%' }}>
        <div style={{ padding: '16px 18px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Badge tone={stateTone(s.current_state)} dot>{stateLabel(s.current_state)}</Badge>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-300)', letterSpacing: '.08em', textTransform: 'uppercase' }}>{s.source}</span>
        </div>
        <div style={{ padding: '12px 18px 16px' }}>
          <h3 style={{ fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', color: 'var(--ink-800)', marginBottom: 6, wordBreak: 'break-word' }}>{s.label}</h3>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.5, color: 'var(--ink-400)', margin: 0 }}>{s.study_id}</p>
        </div>
        <div style={{ padding: '11px 18px', borderTop: '1px solid var(--app-line-2)', background: 'var(--app-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-400)' }}>
            {s.version != null ? `v${s.version}` : '—'}
            {s.updated ? <span style={{ color: 'var(--ink-300)', marginLeft: 8 }}>{fmtUpdated(s.updated)}</span> : null}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--blue-600)', display: 'flex', alignItems: 'center', gap: 5 }}>
            open <ArrowRight size={13} />
          </span>
        </div>
      </Card>
    </div>
  );
}

export function StudyList() {
  const navigate = useNavigate();
  const [src, setSrc] = useState('all');
  const [q, setQ] = useState('');
  const { data, error, loading } = useAsync(
    () => api.listStudies({ src: src === 'all' ? undefined : src, q: q || undefined }),
    [src, q],
  );

  const open = (key: string) => navigate(`/study/${encodeURIComponent(key)}`);

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, marginBottom: 22, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--blue-700)', marginBottom: 9 }}>verification &amp; validation</div>
          <h1 style={{ fontFamily: 'var(--font-sans)', fontSize: 28, fontWeight: 600, letterSpacing: '-.02em', color: 'var(--ink-800)', margin: 0 }}>Studies</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Select mono value={src} options={SOURCES} onChange={(e) => setSrc(e.target.value)} style={{ minWidth: 130 }} />
          <Input mono prefix={<Search size={13} />} placeholder="filter name / id" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 210 }} />
        </div>
      </div>

      {loading ? <Loading label="loading studies" /> : null}
      {error ? <ErrorState error={error} /> : null}
      {data && data.length === 0 ? (
        <Empty>No studies match. The dashboard reads recorded omd plans, sdk sessions, and studies from the-hangar data root — run an analysis to populate it.</Empty>
      ) : null}
      {data && data.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))', gap: 18 }}>
          {data.map((s) => <StudyCard key={s.key} s={s} onOpen={open} />)}
        </div>
      ) : null}
    </div>
  );
}
