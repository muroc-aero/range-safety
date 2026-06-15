/* TypeScript projections of the dashboard ReadModel JSON contract
   (range_safety/dashboard/read_model.py + sources.py). Only the fields the
   SPA reads are typed; unknown extras are tolerated. A study/run "key" is the
   `{source}:{id}` string the API dispatches on (e.g. "omd:reg28m-opt"). */

export type StudyKey = string;
export type RunKey = string;

/** Five-stage lifecycle state ids (state_machine.py). */
export type LifecycleState =
  | 'gather_requirements'
  | 'planning'
  | 'executing'
  | 'verifying'
  | 'concluding';

export type SourceName = 'omd' | 'sdk' | 'studyfs';

export interface StudyListItem {
  key: StudyKey;
  study_id: string;
  label: string;
  version: number | null;
  current_state: LifecycleState | string;
  source: SourceName | string;
  owner?: string;
  updated?: string;
}

export type Coverage = 'populated' | 'thin' | 'absent' | string;

export interface ServerStatus {
  name: string;
  url: string | null;
  reachable: boolean;
  status_code: number | null;
  latency_ms: number;
  detail?: string;
  error?: string;
}

export interface MachineState {
  id: string;
  label: string;
}

export interface FeedbackEdge {
  from: string;
  to: string;
  trigger: string;
}

export interface MachineDef {
  states: MachineState[];
  forward_edges: { from: string; to: string }[];
  feedback_edges: FeedbackEdge[];
}

export interface StateProjection {
  current: LifecycleState | string;
  confidence: number;
  signals: Record<string, unknown>;
  coverage?: Record<string, Coverage>;
  transitions?: unknown[];
  next?: { forward_state?: string; replan_triggers?: unknown[] };
  plan_id: StudyKey;
  plan_version: number | null;
}

export interface RunRef {
  run_id: RunKey;
  version: number | null;
  created_at: string;
}

// -- graph (Cytoscape-native elements) --------------------------------------

export interface GraphNode {
  data: {
    id: string;
    label?: string;
    kind?: string;
    node_type?: string;
    entity_type?: string;
    status?: string | null;
    verdict?: string | null;
    properties?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    [k: string]: unknown;
  };
}

export interface GraphEdge {
  data: {
    source: string;
    target: string;
    relation?: string;
    label?: string;
    [k: string]: unknown;
  };
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type GraphStyle = 'plan_detail' | 'provenance' | 'session' | string;

// -- requirements -----------------------------------------------------------

export interface AcceptanceCriterion {
  metric?: string;
  comparator?: string;
  threshold?: unknown;
}

export interface VerificationEdge {
  relation: string;
  subject_id: string;
}

export interface Requirement {
  id: string;
  text: string | null;
  type: string | null;
  priority: string | null;
  status: string;
  acceptance_criteria: AcceptanceCriterion[];
  traces_to: string[];
  verification_edges: VerificationEdge[];
}

export interface RequirementsView {
  plan_id: StudyKey;
  requirements: Requirement[];
}

// -- plan (formulation) -----------------------------------------------------

export interface Decision {
  id?: string;
  decision?: string;
  reasoning?: string;
  rationale?: string;
  decision_type?: string;
  created_at?: string;
  [k: string]: unknown;
}

export interface PlanView {
  plan_id: StudyKey;
  version: number | null;
  plan: Record<string, unknown>;
  decisions: Decision[];
  graph: Graph;
  graph_style: GraphStyle;
}

// -- results ----------------------------------------------------------------

export interface HeadlineMetric {
  name: string;
  label: string;
  value: number | string;
  unit?: string;
  role?: string;
}

export interface ConstraintRow {
  name: string;
  value: number;
  bound: number | null;
  bound_type: string | null;
  passed: boolean;
  margin: number | null;
  message: string;
}

export interface CheckItem {
  name: string;
  passed: boolean;
  message: string;
  severity?: string | null;
}

export interface CheckGroup {
  title: string;
  passed: boolean;
  summary: string;
  items: CheckItem[];
}

export interface OptHistory {
  iterations?: number[];
  objective?: { label: string; values: (number | null)[] };
  constraints?: {
    label: string;
    values: (number | null)[];
    bound: number | null;
    bound_type: string | null;
  }[];
  design_variables?: { label: string; values: (number | null)[]; units: string }[];
}

export interface ResultsView {
  run_id: RunKey;
  run_entity: Record<string, unknown> | string | null;
  headline: HeadlineMetric[];
  constraints: ConstraintRow[];
  checks: CheckGroup[];
  opt_history: OptHistory | Record<string, never>;
  final: Record<string, unknown> | null;
  history: unknown[];
  validation: Record<string, unknown>;
  graph?: Graph;
  graph_style?: GraphStyle;
}

// -- reasoning / report -----------------------------------------------------

export interface ReasoningView {
  plan_id: StudyKey;
  focus: string | null;
  graph: Graph;
}

export interface Conclusion {
  id?: string;
  created_at?: string;
  run_id?: string;
  verdict?: string;
  narrative?: string;
  metrics?: unknown[];
  requirements?: unknown[];
}

// -- study (case table + grouping) ------------------------------------------

export interface StudyCase {
  case_id: string;
  runner?: string;
  source?: string;
  params: Record<string, unknown>;
  status?: string;
  run_ref?: string | null;
  plan_key?: string | null;
  outputs: Record<string, number>;
  wall_time_s?: number | null;
  error?: string | null;
}

export interface StudyProgress {
  done: number;
  total: number;
  version?: number | null;
  counts: Record<string, number>;
  mean_case_wall_s?: number | null;
}

export interface StudyMember {
  plan_id: string;
  version: number | null;
  name: string | null;
  current_state: string;
  objective: string | null;
  metrics: Record<string, number>;
}

export interface StudyView {
  study_id: string;
  key?: string;
  // studyfs (case table)
  progress?: StudyProgress;
  param_keys?: string[];
  output_keys?: string[];
  study_plot_types?: string[];
  cases?: StudyCase[];
  // omd grouping (lineage)
  members?: StudyMember[];
  metric_keys?: string[];
  graph?: Graph;
}

export interface ReportView {
  plan_id: StudyKey;
  version: number | null;
  current_state: LifecycleState | string;
  scorecard: Record<string, number>;
  phases: { id?: string; name?: string; mode?: string }[];
  conclusions: Conclusion[];
  replan_triggers: unknown[];
  decisions: Decision[];
}
