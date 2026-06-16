import type { Tone as BadgeTone } from '../design/components/core';

/* Shared lifecycle labels + badge tone mapping for the five-stage state
   machine (state_machine.py ids). Kept in one place so the rail, study list,
   and viewer agree. */

export const STATE_LABEL: Record<string, string> = {
  gather_requirements: 'Gather',
  planning: 'Planning',
  executing: 'Executing',
  verifying: 'Verifying',
  concluding: 'Concluding',
};

export function stateLabel(state: string): string {
  return STATE_LABEL[state] ?? state;
}

export function stateTone(state: string): BadgeTone {
  switch (state) {
    case 'concluding':
    case 'verifying':
      return 'ok';
    case 'executing':
      return 'info';
    case 'planning':
      return 'blueprint';
    default:
      return 'neutral';
  }
}

/* Section-tab ids for the per-plan StudyViewer, in lifecycle order. The
   state-strip maps each lifecycle state to the tab that represents it, so
   clicking a state node loads that view (the old shell's behaviour). */
export type StudyTab =
  | 'requirements'
  | 'formulation'
  | 'decisions'
  | 'results'
  | 'plots'
  | 'provenance'
  | 'report';

export const STUDY_TABS: StudyTab[] = [
  'requirements', 'formulation', 'decisions', 'results', 'plots', 'provenance', 'report',
];

export const STATE_TO_TAB: Record<string, StudyTab> = {
  gather_requirements: 'requirements',
  planning: 'formulation',
  executing: 'results',
  verifying: 'provenance',
  concluding: 'report',
};

/** Coverage dot color (state_machine coverage: populated/thin/absent). */
export function coverageColor(cov: string): string {
  switch (cov) {
    case 'populated':
      return 'var(--green-600)';
    case 'thin':
      return 'var(--amber-600)';
    default:
      return 'var(--ink-200)';
  }
}
