import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { injectStyle } from '../style';

/* Brand primitives — BrandMark, TitleBlock, DimensionRule. CSS verbatim. */

// -- BrandMark --------------------------------------------------------------

injectStyle('lk-mark-css', `
.lk-mark{display:inline-flex; align-items:center; gap:.6em; color:var(--text-strong); text-decoration:none}
.lk-mark__tri{width:0; height:0; flex:none;
  border-left:1.0em solid var(--accent);
  border-top:.64em solid transparent; border-bottom:.64em solid transparent}
.lk-mark__wm{font-family:var(--font-mono); font-weight:var(--fw-semibold); letter-spacing:.13em; line-height:1; white-space:nowrap}
.lk-mark__wm small{display:block; font-weight:var(--fw-regular); font-size:.5em; letter-spacing:.18em; color:var(--text-faint); margin-top:.35em}
.lk-mark--sm{font-size:13px}
.lk-mark--md{font-size:17px}
.lk-mark--lg{font-size:24px}
.lk-mark--xl{font-size:34px}
`);

export interface BrandMarkProps extends HTMLAttributes<HTMLElement> {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  markOnly?: boolean;
  sub?: ReactNode;
  href?: string;
  wordmark?: ReactNode;
}

export function BrandMark({
  size = 'md', markOnly = false, sub, href, wordmark = 'LAKESIDE AI',
  className = '', ...rest
}: BrandMarkProps) {
  const cls = ['lk-mark', `lk-mark--${size}`, className].filter(Boolean).join(' ');
  const inner = (
    <>
      <span className="lk-mark__tri" aria-hidden="true" />
      {markOnly ? null : (
        <span className="lk-mark__wm">{wordmark}{sub ? <small>{sub}</small> : null}</span>
      )}
    </>
  );
  if (href) {
    return <a className={cls} href={href} {...(rest as HTMLAttributes<HTMLAnchorElement>)}>{inner}</a>;
  }
  return <span className={cls} {...rest}>{inner}</span>;
}

// -- TitleBlock -------------------------------------------------------------

injectStyle('lk-tblock-css', `
.lk-tblock{display:grid; border:var(--bw-rule) solid var(--text-strong); font-family:var(--font-mono)}
.lk-tblock__c{padding:10px 14px; border-right:var(--bw-hair) solid var(--border-strong); min-width:0}
.lk-tblock__c:last-child{border-right:none}
.lk-tblock__k{font-size:var(--fs-3xs); letter-spacing:var(--ls-wide); text-transform:uppercase; color:var(--text-faint); margin-bottom:5px; white-space:nowrap}
.lk-tblock__v{font-size:var(--fs-sm); color:var(--text-strong); font-weight:var(--fw-medium); display:flex; align-items:center; gap:7px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.lk-tblock__v--ok{color:var(--green-700)}
.lk-tblock__v--blueprint{color:var(--blueprint-text)}
`);

export interface TitleBlockCell {
  k: ReactNode;
  v: ReactNode;
  grow?: number;
  tone?: 'ok' | 'blueprint';
}

export interface TitleBlockProps extends HTMLAttributes<HTMLDivElement> {
  cells?: TitleBlockCell[];
}

export function TitleBlock({ cells = [], className = '', style, ...rest }: TitleBlockProps) {
  const cols = cells.map((c) => c.grow ? `${c.grow}fr` : '1fr').join(' ');
  return (
    <div className={['lk-tblock', className].filter(Boolean).join(' ')} style={{ gridTemplateColumns: cols, ...style }} {...rest}>
      {cells.map((c, i) => (
        <div className="lk-tblock__c" key={i}>
          <div className="lk-tblock__k">{c.k}</div>
          <div className={['lk-tblock__v', c.tone && `lk-tblock__v--${c.tone}`].filter(Boolean).join(' ')}>{c.v}</div>
        </div>
      ))}
    </div>
  );
}

// -- DimensionRule ----------------------------------------------------------

injectStyle('lk-dim-css', `
.lk-dim{display:flex; align-items:center; color:var(--blueprint); font-family:var(--font-mono); font-size:var(--fs-3xs); letter-spacing:.1em}
.lk-dim__tick{width:1px; height:10px; background:currentColor; flex:none}
.lk-dim__span{flex:1; height:1px; background:currentColor}
.lk-dim__lbl{padding:0 12px; color:var(--text-muted); white-space:nowrap; text-transform:uppercase; background:var(--surface-canvas)}
.lk-dim--plain .lk-dim__lbl{background:transparent}
`);

export interface DimensionRuleProps extends HTMLAttributes<HTMLDivElement> {
  label?: ReactNode;
  plain?: boolean;
  style?: CSSProperties;
}

export function DimensionRule({ label, plain = false, className = '', style, ...rest }: DimensionRuleProps) {
  return (
    <div className={['lk-dim', plain && 'lk-dim--plain', className].filter(Boolean).join(' ')} style={style} {...rest}>
      <span className="lk-dim__tick" aria-hidden="true" />
      <span className="lk-dim__span" aria-hidden="true" />
      {label ? <span className="lk-dim__lbl">{label}</span> : null}
      <span className="lk-dim__span" aria-hidden="true" />
      <span className="lk-dim__tick" aria-hidden="true" />
    </div>
  );
}
