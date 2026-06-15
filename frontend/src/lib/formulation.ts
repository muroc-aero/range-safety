import type { SpecRow } from '../design/components/data';

/* Defensive extraction of formulation sections from an omd plan dict. Plan
   YAML shapes vary across factories, so each extractor tolerates missing keys
   and only emits a section when it found rows. */

export interface Section {
  title: string;
  rows: SpecRow[];
}

type Dict = Record<string, unknown>;

function asDict(v: unknown): Dict | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : null;
}
function asArr(v: unknown): Dict[] {
  return Array.isArray(v) ? (v.filter((x) => asDict(x)) as Dict[]) : [];
}
function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  return String(v);
}
function tail(name: string): string {
  return name.includes('.') ? name.split('.').pop()! : name;
}

function operatingPoint(plan: Dict): Section | null {
  const op = asDict(plan.operating_point) ?? asDict(plan.operating_conditions);
  if (!op) return null;
  const rows: SpecRow[] = Object.entries(op)
    .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
    .map(([k, v]) => ({ k, v: str(v) }));
  return rows.length ? { title: 'operating point', rows } : null;
}

function objectiveConstraints(plan: Dict): Section | null {
  const rows: SpecRow[] = [];
  const obj = asDict(plan.objective);
  if (obj?.name) rows.push({ k: 'minimize', v: tail(str(obj.name)), tag: true });
  for (const c of asArr(plan.constraints)) {
    const name = tail(str(c.name));
    const bound =
      c.equals != null ? `= ${str(c.equals)}` :
      c.upper != null && c.lower != null ? `[${str(c.lower)}, ${str(c.upper)}]` :
      c.upper != null ? `≤ ${str(c.upper)}` :
      c.lower != null ? `≥ ${str(c.lower)}` : '';
    if (name) rows.push({ k: name, v: bound });
  }
  const solver = asDict(plan.driver) ?? asDict(plan.optimizer);
  const optName = solver?.optimizer ?? solver?.name ?? plan.optimizer;
  if (typeof optName === 'string') rows.push({ k: 'optimizer', v: optName });
  return rows.length ? { title: 'objective & constraints', rows } : null;
}

function designVariables(plan: Dict): Section | null {
  const dvs = asArr(plan.design_variables);
  if (!dvs.length) return null;
  const rows: SpecRow[] = dvs.map((d) => {
    const name = tail(str(d.name));
    const range =
      d.lower != null && d.upper != null
        ? `[${str(d.lower)}, ${str(d.upper)}]`
        : d.lower != null ? `≥ ${str(d.lower)}`
        : d.upper != null ? `≤ ${str(d.upper)}` : '';
    const units = d.units ? ` ${str(d.units)}` : '';
    return { k: name, v: `${range}${units}`.trim() || '—' };
  });
  return { title: `design variables (${dvs.length})`, rows };
}

function components(plan: Dict): Section | null {
  const comps = asArr(plan.components);
  if (!comps.length) return null;
  const rows: SpecRow[] = comps.map((c) => ({
    k: str(c.name ?? c.id),
    v: str(c.factory ?? c.type ?? c.component_type ?? ''),
    blueprint: true,
  }));
  return { title: `components (${comps.length})`, rows };
}

export function formulationSections(plan: Dict | null | undefined): Section[] {
  if (!plan) return [];
  return [
    operatingPoint(plan),
    components(plan),
    designVariables(plan),
    objectiveConstraints(plan),
  ].filter((s): s is Section => s !== null);
}
