import { useState } from 'react';
import { api } from '../api/client';
import { Card, Select } from '../design';

/* Study trade-grid plot gallery (ports the _study.html trade-space gallery +
   dashboard.js renderGallery). A plot-type selector plus an optional style
   toggle (paper / contour), rendering one PNG from /api/study-plots. */

interface Props {
  studyKey: string;
  types: string[];
  styles?: string[];
}

export function StudyPlotGallery({ studyKey, types, styles = ['paper', 'contour'] }: Props) {
  const [type, setType] = useState(types[0] ?? '');
  const [style, setStyle] = useState(styles[0] ?? 'paper');
  const [errored, setErrored] = useState(false);
  if (!types.length) return null;

  return (
    <Card flush padded={false}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '11px 16px', borderBottom: '1px solid var(--app-line-2)' }}>
        <Select mono value={type} options={types} onChange={(e) => { setType(e.target.value); setErrored(false); }} style={{ minWidth: 160 }} />
        {styles.length > 1 ? (
          <Select mono value={style} options={styles} onChange={(e) => { setStyle(e.target.value); setErrored(false); }} style={{ minWidth: 120 }} />
        ) : null}
      </div>
      <div style={{ background: '#fff', minHeight: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {errored ? (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--red-600)', padding: 24 }}>
            Plot '{type}' ({style}) could not be rendered for this study.
          </span>
        ) : (
          <img
            src={api.studyPlotImageUrl(studyKey, type, style)}
            alt={`${type} (${style})`}
            onError={() => setErrored(true)}
            style={{ width: '100%', display: 'block' }}
          />
        )}
      </div>
    </Card>
  );
}
