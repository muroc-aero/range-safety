import type { HTMLAttributes, ReactNode } from 'react';
import { injectStyle } from '../style';

/* Data primitives — StatCard, SpecTable, Callout, DecisionCard. CSS verbatim. */

// -- StatCard ---------------------------------------------------------------

injectStyle('lk-stat-css', `
.lk-stat{padding:14px 16px; background:var(--surface-card); min-width:0}
.lk-stat__v{font-family:var(--font-mono); font-weight:var(--fw-medium); font-size:var(--fs-xl); letter-spacing:-.01em; line-height:1; color:var(--text-strong); display:flex; align-items:baseline; gap:3px}
.lk-stat__v .u{font-size:var(--fs-sm); color:var(--text-faint); font-weight:var(--fw-regular)}
.lk-stat__v--ok{color:var(--green-700)}
.lk-stat__v--warn{color:var(--amber-600)}
.lk-stat__v--error{color:var(--red-600)}
.lk-stat__k{font-family:var(--font-mono); font-size:var(--fs-2xs); letter-spacing:var(--ls-label); color:var(--text-faint); margin-top:6px; display:flex; align-items:center; gap:6px}
.lk-stat__delta{font-family:var(--font-mono); font-size:var(--fs-2xs); padding:1px 5px; border-radius:var(--radius-sm)}
.lk-stat__delta--down{color:var(--green-700); background:var(--green-50)}
.lk-stat__delta--up{color:var(--red-600); background:var(--red-50)}
`);

export interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  label?: ReactNode;
  value?: ReactNode;
  unit?: ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'error';
  delta?: ReactNode;
  deltaDir?: 'up' | 'down';
}

export function StatCard({ label, value, unit, tone = 'default', delta, deltaDir, className = '', ...rest }: StatCardProps) {
  const vCls = ['lk-stat__v', tone !== 'default' && `lk-stat__v--${tone}`].filter(Boolean).join(' ');
  return (
    <div className={['lk-stat', className].filter(Boolean).join(' ')} {...rest}>
      <div className={vCls}>{value}{unit ? <span className="u">{unit}</span> : null}</div>
      <div className="lk-stat__k">
        {label}
        {delta ? <span className={`lk-stat__delta lk-stat__delta--${deltaDir || 'down'}`}>{delta}</span> : null}
      </div>
    </div>
  );
}

// -- SpecTable --------------------------------------------------------------

injectStyle('lk-spec-css', `
.lk-spec{font-family:var(--font-mono); font-size:var(--fs-sm); width:100%}
.lk-spec__r{display:flex; align-items:baseline; justify-content:space-between; gap:16px; padding:8px 0; border-bottom:var(--bw-hair) solid var(--border-divider)}
.lk-spec__r:last-child{border-bottom:none}
.lk-spec__k{color:var(--text-faint); white-space:nowrap}
.lk-spec__v{color:var(--text-strong); font-weight:var(--fw-medium); text-align:right}
.lk-spec__v--tag{background:var(--accent-soft); color:var(--accent-text); padding:1px 8px; border-radius:var(--radius-sm); font-weight:var(--fw-medium)}
.lk-spec__v--blueprint{background:var(--blueprint-soft); color:var(--blueprint-text); padding:1px 8px; border-radius:var(--radius-sm)}
.lk-spec--zebra .lk-spec__r:nth-child(even){background:var(--surface-subtle); margin:0 -16px; padding-left:16px; padding-right:16px}
`);

export interface SpecRow {
  k: ReactNode;
  v: ReactNode;
  tag?: boolean;
  blueprint?: boolean;
}

export interface SpecTableProps extends HTMLAttributes<HTMLDListElement> {
  rows?: SpecRow[];
  zebra?: boolean;
}

export function SpecTable({ rows = [], zebra = false, className = '', ...rest }: SpecTableProps) {
  return (
    <dl className={['lk-spec', zebra && 'lk-spec--zebra', className].filter(Boolean).join(' ')} {...rest}>
      {rows.map((r, i) => {
        const vCls = ['lk-spec__v', r.tag && 'lk-spec__v--tag', r.blueprint && 'lk-spec__v--blueprint'].filter(Boolean).join(' ');
        return (
          <div className="lk-spec__r" key={i}>
            <dt className="lk-spec__k">{r.k}</dt>
            <dd className={vCls}>{r.v}</dd>
          </div>
        );
      })}
    </dl>
  );
}

// -- Callout ----------------------------------------------------------------

injectStyle('lk-callout-css', `
.lk-callout{border-left:var(--bw-accent) solid var(--info); background:var(--surface-subtle); padding:12px 16px; border-radius:0 var(--radius-sm) var(--radius-sm) 0}
.lk-callout__head{display:flex; align-items:center; gap:8px; font-family:var(--font-mono); font-size:var(--fs-2xs); letter-spacing:var(--ls-label); text-transform:uppercase; color:var(--info); margin-bottom:6px}
.lk-callout__body{font-family:var(--font-sans); font-size:var(--fs-sm); line-height:1.55; color:var(--text-body)}
.lk-callout--ok{border-left-color:var(--ok); background:var(--ok-soft)}
.lk-callout--ok .lk-callout__head{color:var(--green-700)}
.lk-callout--warn{border-left-color:var(--warn); background:var(--warn-soft)}
.lk-callout--warn .lk-callout__head{color:var(--amber-600)}
.lk-callout--error{border-left-color:var(--error); background:var(--error-soft)}
.lk-callout--error .lk-callout__head{color:var(--red-600)}
.lk-callout--blueprint{border-left-color:var(--blueprint); background:var(--blueprint-soft)}
.lk-callout--blueprint .lk-callout__head{color:var(--blueprint-text)}
`);

export interface CalloutProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: 'info' | 'ok' | 'warn' | 'error' | 'blueprint';
  title?: ReactNode;
  icon?: ReactNode;
}

export function Callout({ tone = 'info', title, icon, className = '', children, ...rest }: CalloutProps) {
  return (
    <div className={['lk-callout', tone !== 'info' && `lk-callout--${tone}`, className].filter(Boolean).join(' ')} {...rest}>
      {title ? <div className="lk-callout__head">{icon ? <span aria-hidden="true">{icon}</span> : null}{title}</div> : null}
      <div className="lk-callout__body">{children}</div>
    </div>
  );
}

// -- DecisionCard -----------------------------------------------------------

injectStyle('lk-dec-css', `
.lk-dec{border:var(--bw-hair) solid var(--border); border-left:var(--bw-accent) solid var(--blueprint); border-radius:0 var(--radius-md) var(--radius-md) 0; background:var(--surface-card); padding:13px 16px}
.lk-dec__top{display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:7px}
.lk-dec__id{font-family:var(--font-mono); font-size:var(--fs-2xs); letter-spacing:.06em; font-weight:var(--fw-semibold); color:var(--blueprint-text)}
.lk-dec__when{font-family:var(--font-mono); font-size:var(--fs-3xs); color:var(--text-faint)}
.lk-dec__title{font-family:var(--font-sans); font-weight:var(--fw-semibold); font-size:var(--fs-sm); letter-spacing:var(--ls-tight); color:var(--text-strong); margin-bottom:5px; line-height:1.35}
.lk-dec__why{font-family:var(--font-sans); font-size:var(--fs-sm); line-height:1.55; color:var(--text-muted)}
.lk-dec__foot{display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; padding-top:10px; border-top:var(--bw-hair) solid var(--border-divider)}
.lk-dec__ev{display:inline-flex; align-items:center; gap:5px; font-family:var(--font-mono); font-size:var(--fs-3xs); color:var(--blue-600); background:var(--blueprint-soft); padding:3px 7px; border-radius:var(--radius-sm); text-decoration:none}
.lk-dec__ev::before{content:'↳'}
.lk-dec--superseded{border-left-color:var(--text-faint); opacity:.72}
.lk-dec--superseded .lk-dec__id{color:var(--text-muted)}
`);

export interface DecisionEvidence {
  label?: ReactNode;
  href?: string;
}

export interface DecisionCardProps
  extends Omit<HTMLAttributes<HTMLElement>, 'id' | 'title'> {
  id?: ReactNode;
  when?: ReactNode;
  title?: ReactNode;
  superseded?: boolean;
  evidence?: DecisionEvidence[];
}

export function DecisionCard({ id, when, title, superseded = false, evidence = [], className = '', children, ...rest }: DecisionCardProps) {
  return (
    <article className={['lk-dec', superseded && 'lk-dec--superseded', className].filter(Boolean).join(' ')} {...rest}>
      <div className="lk-dec__top">
        <span className="lk-dec__id">{id}</span>
        {when ? <span className="lk-dec__when">{when}</span> : null}
      </div>
      {title ? <div className="lk-dec__title">{title}</div> : null}
      <div className="lk-dec__why">{children}</div>
      {evidence.length ? (
        <div className="lk-dec__foot">
          {evidence.map((e, i) => <a className="lk-dec__ev" key={i} href={e.href || '#'}>{e.label}</a>)}
        </div>
      ) : null}
    </article>
  );
}
