import { ArrowRight } from 'lucide-react';
import { api } from '../api/client';
import type { StateProjection } from '../api/types';
import { useAsync } from '../hooks/useAsync';
import { coverageColor, STATE_TO_TAB, type StudyTab } from '../lib/lifecycle';

/* The five-state lifecycle strip (ports _state_strip.html to the Instrument
   surface). The lit node is the study's inferred current state; each node is
   clickable and loads that state's tab (gather->requirements, planning->
   formulation, executing->results, verifying->provenance, concluding->report).
   Coverage dots show how populated each state is; the meta line shows
   confidence, the next forward state, the coverage legend, and the model's
   feedback-edge triggers (rescope/rerun/replan). */

interface Props {
  state: StateProjection | null;
  activeTab: StudyTab;
  onPick: (tab: StudyTab) => void;
}

const DOT = (color: string) => (
  <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flex: 'none' }} />
);

export function StateStrip({ state, activeTab, onPick }: Props) {
  const { data: machine } = useAsync(() => api.machine(), []);
  if (!machine) return null;

  const current = state?.current;
  const coverage = state?.coverage ?? {};

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '11px 32px', background: 'var(--app-subtle)',
        borderBottom: '1px solid var(--app-line)',
      }}
    >
      {machine.states.map((s, i) => {
        const tab = STATE_TO_TAB[s.id];
        const isCurrent = s.id === current;
        const isActive = tab === activeTab;
        const cov = coverage[s.id] ?? 'absent';
        return (
          <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => tab && onPick(tab)}
              title={`Load the ${s.label} view (${cov})`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '6px 11px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap',
                border: `1px solid ${isCurrent ? 'var(--blue-700)' : isActive ? 'var(--blue-200)' : 'var(--app-line)'}`,
                background: isCurrent ? 'var(--blue-50)' : 'var(--app-panel)',
                color: isCurrent ? 'var(--blue-700)' : 'var(--ink-500)',
                fontWeight: isCurrent ? 600 : 400,
              }}
            >
              {DOT(coverageColor(cov))}
              {s.label}
            </button>
            {i < machine.states.length - 1 ? (
              <ArrowRight size={12} style={{ color: 'var(--ink-200)' }} />
            ) : null}
          </span>
        );
      })}

      {state ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14, marginLeft: 6, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-400)' }}>
          <span title="Inferred from recorded runs / assessments / decisions">
            current {Math.round(state.confidence * 100)}%
          </span>
          {state.next?.forward_state ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              next <ArrowRight size={11} /> {state.next.forward_state}
            </span>
          ) : null}
        </span>
      ) : null}

      <span style={{ flex: 1 }} />

      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-300)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{DOT('var(--green-600)')}populated</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{DOT('var(--amber-600)')}thin</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{DOT('var(--ink-200)')}absent</span>
      </span>

      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {machine.feedback_edges.map((e) => (
          <span
            key={e.trigger}
            title={`${e.from} -> ${e.to}`}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.06em',
              padding: '2px 7px', borderRadius: 'var(--radius-sm)',
              border: '1px dashed var(--app-line)', color: 'var(--ink-400)',
            }}
          >
            {e.trigger}
          </span>
        ))}
      </span>
    </div>
  );
}
