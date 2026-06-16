import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from 'react';
import { injectStyle } from '../style';

/* Core primitives — Button, IconButton, Badge, Tag, StatusPill, Card.
   Ported from the lakesideai-design system (App / Instrument surface).
   CSS preserved verbatim; props typed. */

// -- Button -----------------------------------------------------------------

injectStyle('lk-btn-css', `
.lk-btn{
  --_bg:var(--accent); --_fg:var(--text-on-accent); --_bd:transparent;
  display:inline-flex; align-items:center; justify-content:center; gap:.5em;
  font-family:var(--font-sans); font-weight:var(--fw-medium);
  font-size:var(--fs-sm); line-height:1; letter-spacing:var(--ls-tight);
  height:var(--control-h-md); padding:0 18px;
  border:var(--bw-rule) solid var(--_bd); border-radius:var(--radius-sm);
  background:var(--_bg); color:var(--_fg); cursor:pointer; text-decoration:none;
  white-space:nowrap; transition:background var(--dur-fast) var(--ease-standard),
    border-color var(--dur-fast) var(--ease-standard),
    transform var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard);
}
.lk-btn:focus-visible{outline:none; box-shadow:var(--focus-shadow)}
.lk-btn:active{transform:var(--press-shift)}
.lk-btn[disabled]{opacity:.42; cursor:not-allowed; transform:none}
.lk-btn--mono{font-family:var(--font-mono); font-weight:var(--fw-medium); letter-spacing:var(--ls-label)}
.lk-btn--sm{height:var(--control-h-sm); padding:0 13px; font-size:var(--fs-xs)}
.lk-btn--lg{height:var(--control-h-lg); padding:0 26px; font-size:var(--fs-base)}

.lk-btn--primary{--_bg:var(--accent); --_fg:#fff; --_bd:var(--accent)}
.lk-btn--primary:hover:not([disabled]){--_bg:var(--accent-hover); --_bd:var(--accent-hover)}

.lk-btn--blueprint{--_bg:var(--blue-700); --_fg:#fff; --_bd:var(--blue-700)}
.lk-btn--blueprint:hover:not([disabled]){--_bg:var(--blue-800); --_bd:var(--blue-800)}

.lk-btn--secondary{--_bg:transparent; --_fg:var(--text-strong); --_bd:var(--border-strong)}
.lk-btn--secondary:hover:not([disabled]){--_bg:var(--surface-subtle); --_bd:var(--text-strong)}

.lk-btn--ghost{--_bg:transparent; --_fg:var(--text-body); --_bd:transparent; padding-left:10px; padding-right:10px}
.lk-btn--ghost:hover:not([disabled]){--_bg:var(--surface-subtle)}

.lk-btn--danger{--_bg:transparent; --_fg:var(--error); --_bd:var(--error-border)}
.lk-btn--danger:hover:not([disabled]){--_bg:var(--error-soft); --_bd:var(--error)}
`);

export type ButtonVariant =
  | 'primary'
  | 'blueprint'
  | 'secondary'
  | 'ghost'
  | 'danger';

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  mono?: boolean;
  href?: string;
  /** Anchor attributes, used when `href` renders the button as an <a>. */
  target?: string;
  rel?: string;
  type?: 'button' | 'submit' | 'reset';
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  mono = false,
  disabled = false,
  href,
  iconLeft,
  iconRight,
  className = '',
  children,
  type,
  ...rest
}: ButtonProps) {
  const cls = [
    'lk-btn', `lk-btn--${variant}`,
    size !== 'md' && `lk-btn--${size}`,
    mono && 'lk-btn--mono', className,
  ].filter(Boolean).join(' ');

  if (href) {
    return (
      <a className={cls} href={href} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {iconLeft ? <span className="lk-btn__i" aria-hidden="true">{iconLeft}</span> : null}
        {children}
        {iconRight ? <span className="lk-btn__i" aria-hidden="true">{iconRight}</span> : null}
      </a>
    );
  }
  return (
    <button className={cls} disabled={disabled} type={type || 'button'} {...rest}>
      {iconLeft ? <span className="lk-btn__i" aria-hidden="true">{iconLeft}</span> : null}
      {children}
      {iconRight ? <span className="lk-btn__i" aria-hidden="true">{iconRight}</span> : null}
    </button>
  );
}

// -- IconButton -------------------------------------------------------------

injectStyle('lk-iconbtn-css', `
.lk-iconbtn{
  display:inline-flex; align-items:center; justify-content:center;
  width:var(--control-h-md); height:var(--control-h-md);
  border:var(--bw-hair) solid transparent; border-radius:var(--radius-sm);
  background:transparent; color:var(--text-muted); cursor:pointer;
  transition:background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard);
}
.lk-iconbtn svg{width:1.05em; height:1.05em; display:block}
.lk-iconbtn:hover:not([disabled]){background:var(--surface-subtle); color:var(--text-strong)}
.lk-iconbtn:active{transform:var(--press-shift)}
.lk-iconbtn:focus-visible{outline:none; box-shadow:var(--focus-shadow)}
.lk-iconbtn[disabled]{opacity:.4; cursor:not-allowed}
.lk-iconbtn--bordered{border-color:var(--border)}
.lk-iconbtn--bordered:hover:not([disabled]){border-color:var(--border-strong)}
.lk-iconbtn--accent{color:var(--accent)}
.lk-iconbtn--sm{width:var(--control-h-sm); height:var(--control-h-sm); font-size:14px}
.lk-iconbtn--lg{width:var(--control-h-lg); height:var(--control-h-lg); font-size:19px}
`);

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 'sm' | 'md' | 'lg';
  bordered?: boolean;
  accent?: boolean;
  label?: string;
}

export function IconButton({
  size = 'md', bordered = false, accent = false, disabled = false,
  label, className = '', children, ...rest
}: IconButtonProps) {
  const cls = [
    'lk-iconbtn', size !== 'md' && `lk-iconbtn--${size}`,
    bordered && 'lk-iconbtn--bordered', accent && 'lk-iconbtn--accent', className,
  ].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={disabled} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

// -- Badge ------------------------------------------------------------------

injectStyle('lk-badge-css', `
.lk-badge{
  display:inline-flex; align-items:center; gap:.5em;
  font-family:var(--font-mono); font-weight:var(--fw-medium);
  font-size:var(--fs-2xs); letter-spacing:var(--ls-label); line-height:1;
  padding:4px 9px; border-radius:var(--radius-sm);
  border:var(--bw-hair) solid transparent; white-space:nowrap; text-transform:none;
}
.lk-badge__dot{width:6px; height:6px; border-radius:50%; background:currentColor; flex:none}
.lk-badge--neutral{background:var(--surface-subtle); color:var(--text-muted); border-color:var(--border)}
.lk-badge--ok{background:var(--ok-soft); color:var(--green-700); border-color:var(--ok-border)}
.lk-badge--warn{background:var(--warn-soft); color:var(--amber-600); border-color:var(--warn-border)}
.lk-badge--error{background:var(--error-soft); color:var(--red-600); border-color:var(--error-border)}
.lk-badge--info{background:var(--info-soft); color:var(--cyan-600); border-color:var(--info-soft)}
.lk-badge--accent{background:var(--accent-soft); color:var(--accent-text); border-color:var(--accent-border)}
.lk-badge--blueprint{background:var(--blueprint-soft); color:var(--blueprint-text); border-color:var(--blueprint-border)}
.lk-badge--solid.lk-badge--ok{background:var(--ok); color:#fff; border-color:transparent}
.lk-badge--solid.lk-badge--warn{background:var(--warn); color:#fff; border-color:transparent}
.lk-badge--solid.lk-badge--error{background:var(--error); color:#fff; border-color:transparent}
.lk-badge--outline{background:transparent}
`);

export type Tone =
  | 'neutral' | 'ok' | 'warn' | 'error' | 'info' | 'accent' | 'blueprint';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean;
  solid?: boolean;
  outline?: boolean;
}

export function Badge({
  tone = 'neutral', dot = false, solid = false, outline = false,
  className = '', children, ...rest
}: BadgeProps) {
  const cls = ['lk-badge', `lk-badge--${tone}`, solid && 'lk-badge--solid', outline && 'lk-badge--outline', className].filter(Boolean).join(' ');
  return (
    <span className={cls} {...rest}>
      {dot ? <span className="lk-badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

// -- Tag --------------------------------------------------------------------

injectStyle('lk-tag-css', `
.lk-tag{
  display:inline-flex; align-items:center; gap:.45em;
  font-family:var(--font-mono); font-size:var(--fs-xs); line-height:1;
  padding:4px 8px; border-radius:var(--radius-sm);
  background:var(--surface-subtle); color:var(--text-body);
  border:var(--bw-hair) solid var(--border);
}
.lk-tag__k{color:var(--text-faint)}
.lk-tag__x{
  display:inline-flex; align-items:center; justify-content:center;
  width:14px; height:14px; margin-right:-2px; border:none; background:transparent;
  color:var(--text-faint); cursor:pointer; border-radius:2px; font-size:13px; line-height:1;
}
.lk-tag__x:hover{background:var(--border); color:var(--text-strong)}
.lk-tag--accent{background:var(--accent-soft); border-color:var(--accent-border); color:var(--accent-text)}
.lk-tag--blueprint{background:var(--blueprint-soft); border-color:var(--blueprint-border); color:var(--blueprint-text)}
`);

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  label?: ReactNode;
  value?: ReactNode;
  tone?: 'neutral' | 'accent' | 'blueprint';
  onRemove?: () => void;
}

export function Tag({ label, value, tone = 'neutral', onRemove, className = '', children, ...rest }: TagProps) {
  const cls = ['lk-tag', tone !== 'neutral' && `lk-tag--${tone}`, className].filter(Boolean).join(' ');
  return (
    <span className={cls} {...rest}>
      {label ? <span className="lk-tag__k">{label}</span> : null}
      <span className="lk-tag__v">{value ?? children}</span>
      {onRemove ? <button type="button" className="lk-tag__x" aria-label="Remove" onClick={onRemove}>×</button> : null}
    </span>
  );
}

// -- StatusPill -------------------------------------------------------------

injectStyle('lk-pill-css', `
.lk-pill{
  display:inline-flex; align-items:center; gap:.6em;
  font-family:var(--font-mono); font-weight:var(--fw-medium);
  font-size:var(--fs-xs); letter-spacing:var(--ls-label); line-height:1;
  padding:6px 13px 6px 11px; border-radius:var(--radius-pill);
  border:var(--bw-hair) solid; white-space:nowrap;
}
.lk-pill__dot{width:7px; height:7px; border-radius:50%; background:currentColor; flex:none; position:relative}
.lk-pill--live .lk-pill__dot::after{content:''; position:absolute; inset:-3px; border-radius:50%; background:currentColor; opacity:.22}
.lk-pill--ok{background:var(--ok-soft); color:var(--green-700); border-color:var(--ok-border)}
.lk-pill--warn{background:var(--warn-soft); color:var(--amber-600); border-color:var(--warn-border)}
.lk-pill--error{background:var(--error-soft); color:var(--red-600); border-color:var(--error-border)}
.lk-pill--idle{background:var(--surface-subtle); color:var(--text-muted); border-color:var(--border)}
.lk-pill__dot{color:inherit}
.lk-pill--ok .lk-pill__dot{background:var(--ok)}
.lk-pill--warn .lk-pill__dot{background:var(--warn)}
.lk-pill--error .lk-pill__dot{background:var(--error)}
.lk-pill--idle .lk-pill__dot{background:var(--text-faint)}
`);

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  status?: 'ok' | 'warn' | 'error' | 'idle';
  live?: boolean;
}

export function StatusPill({ status = 'ok', live = true, className = '', children, ...rest }: StatusPillProps) {
  const cls = ['lk-pill', `lk-pill--${status}`, live && status !== 'idle' && 'lk-pill--live', className].filter(Boolean).join(' ');
  return (
    <span className={cls} {...rest}>
      <span className="lk-pill__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

// -- Card -------------------------------------------------------------------

injectStyle('lk-card-css', `
.lk-card{
  background:var(--surface-card); border:var(--bw-hair) solid var(--border);
  border-radius:var(--radius-md); overflow:hidden; color:var(--text-body);
}
.lk-card--raised{box-shadow:var(--shadow-sm)}
.lk-card--flush{border-radius:0}
.lk-card__head{
  display:flex; align-items:center; justify-content:space-between; gap:12px;
  padding:11px 16px; border-bottom:var(--bw-hair) solid var(--border-divider);
}
.lk-card__title{
  display:flex; align-items:center; gap:9px;
  font-family:var(--font-mono); font-size:var(--fs-2xs);
  letter-spacing:var(--ls-kicker); text-transform:uppercase; color:var(--text-muted);
}
.lk-card__title::before{content:''; width:8px; height:8px; background:var(--blueprint); border-radius:1px; flex:none}
.lk-card--accent .lk-card__title::before{background:var(--accent)}
.lk-card__body{padding:16px}
.lk-card__body--flush{padding:0}
.lk-card__foot{padding:11px 16px; border-top:var(--bw-hair) solid var(--border-divider); background:var(--surface-subtle)}
`);

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  headerRight?: ReactNode;
  footer?: ReactNode;
  raised?: boolean;
  flush?: boolean;
  accent?: boolean;
  padded?: boolean;
}

export function Card({
  title, headerRight, footer, raised = false, flush = false, accent = false,
  padded = true, className = '', children, ...rest
}: CardProps) {
  const cls = ['lk-card', raised && 'lk-card--raised', flush && 'lk-card--flush', accent && 'lk-card--accent', className].filter(Boolean).join(' ');
  return (
    <section className={cls} {...rest}>
      {title || headerRight ? (
        <header className="lk-card__head">
          <span className="lk-card__title">{title}</span>
          {headerRight ? <span className="lk-card__head-right">{headerRight}</span> : null}
        </header>
      ) : null}
      <div className={padded ? 'lk-card__body' : 'lk-card__body lk-card__body--flush'}>{children}</div>
      {footer ? <footer className="lk-card__foot">{footer}</footer> : null}
    </section>
  );
}
