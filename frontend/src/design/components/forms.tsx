import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { injectStyle } from '../style';

/* Form primitives — Input, Select, Checkbox, Switch. CSS verbatim. */

injectStyle('lk-field-css', `
.lk-field{display:flex; flex-direction:column; gap:6px}
.lk-field__label{font-family:var(--font-mono); font-size:var(--fs-2xs); letter-spacing:var(--ls-label); color:var(--text-muted); text-transform:uppercase}
.lk-field__hint{font-family:var(--font-sans); font-size:var(--fs-xs); color:var(--text-faint)}
.lk-field__err{font-family:var(--font-mono); font-size:var(--fs-xs); color:var(--error)}
`);

// -- Input ------------------------------------------------------------------

injectStyle('lk-input-css', `
.lk-input{
  display:flex; align-items:center; gap:8px;
  height:var(--control-h-md); padding:0 12px;
  background:var(--surface-card); border:var(--bw-hair) solid var(--border);
  border-radius:var(--radius-sm); box-shadow:var(--inset-field);
  transition:border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard);
}
.lk-input:focus-within{border-color:var(--blue-400); box-shadow:var(--focus-shadow)}
.lk-input--invalid{border-color:var(--error)}
.lk-input--invalid:focus-within{box-shadow:0 0 0 3px var(--error-soft)}
.lk-input__affix{font-family:var(--font-mono); font-size:var(--fs-xs); color:var(--text-faint); white-space:nowrap}
.lk-input input{
  flex:1; min-width:0; border:none; outline:none; background:transparent;
  font-family:var(--font-sans); font-size:var(--fs-base); color:var(--text-strong);
}
.lk-input--mono input{font-family:var(--font-mono); font-size:var(--fs-sm); letter-spacing:var(--ls-label)}
.lk-input input::placeholder{color:var(--text-faint)}
.lk-input--disabled{opacity:.55; pointer-events:none}
`);

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  mono?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
}

export function Input({
  label, hint, error, mono = false, prefix, suffix, disabled = false,
  id, className = '', ...rest
}: InputProps) {
  const wrapCls = ['lk-input', mono && 'lk-input--mono', error && 'lk-input--invalid', disabled && 'lk-input--disabled', className].filter(Boolean).join(' ');
  const field = (
    <span className={wrapCls}>
      {prefix ? <span className="lk-input__affix">{prefix}</span> : null}
      <input id={id} disabled={disabled} {...rest} />
      {suffix ? <span className="lk-input__affix">{suffix}</span> : null}
    </span>
  );
  if (!label && !hint && !error) return field;
  return (
    <label className="lk-field" htmlFor={id}>
      {label ? <span className="lk-field__label">{label}</span> : null}
      {field}
      {error ? <span className="lk-field__err">{error}</span> : hint ? <span className="lk-field__hint">{hint}</span> : null}
    </label>
  );
}

// -- Select -----------------------------------------------------------------

injectStyle('lk-select-css', `
.lk-select{position:relative; display:flex; align-items:center;
  height:var(--control-h-md); padding:0 12px;
  background:var(--surface-card); border:var(--bw-hair) solid var(--border);
  border-radius:var(--radius-sm); box-shadow:var(--inset-field);
  transition:border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard);
}
.lk-select:focus-within{border-color:var(--blue-400); box-shadow:var(--focus-shadow)}
.lk-select select{
  appearance:none; -webkit-appearance:none; border:none; outline:none; background:transparent;
  font-family:var(--font-sans); font-size:var(--fs-base); color:var(--text-strong);
  flex:1; padding-right:20px; cursor:pointer;
}
.lk-select--mono select{font-family:var(--font-mono); font-size:var(--fs-sm)}
.lk-select__chev{position:absolute; right:12px; pointer-events:none; color:var(--text-faint); font-size:11px; font-family:var(--font-mono)}
.lk-select--disabled{opacity:.55; pointer-events:none}
`);

export type SelectOption = string | { value: string; label: string };

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
  mono?: boolean;
  options?: SelectOption[];
}

export function Select({
  label, hint, mono = false, options, disabled = false, id, className = '',
  children, ...rest
}: SelectProps) {
  const wrapCls = ['lk-select', mono && 'lk-select--mono', disabled && 'lk-select--disabled', className].filter(Boolean).join(' ');
  const control = (
    <span className={wrapCls}>
      <select id={id} disabled={disabled} {...rest}>
        {options ? options.map((o) => {
          const val = typeof o === 'string' ? o : o.value;
          const lab = typeof o === 'string' ? o : o.label;
          return <option key={val} value={val}>{lab}</option>;
        }) : children}
      </select>
      <span className="lk-select__chev" aria-hidden="true">▾</span>
    </span>
  );
  if (!label && !hint) return control;
  return (
    <label className="lk-field" htmlFor={id}>
      {label ? <span className="lk-field__label">{label}</span> : null}
      {control}
      {hint ? <span className="lk-field__hint">{hint}</span> : null}
    </label>
  );
}

// -- Checkbox ---------------------------------------------------------------

injectStyle('lk-check-css', `
.lk-check{display:inline-flex; align-items:flex-start; gap:9px; cursor:pointer; font-family:var(--font-sans); font-size:var(--fs-base); color:var(--text-body)}
.lk-check input{position:absolute; opacity:0; width:0; height:0}
.lk-check__box{
  flex:none; width:17px; height:17px; margin-top:1px;
  border:var(--bw-rule) solid var(--border-strong); border-radius:var(--radius-sm);
  background:var(--surface-card); display:flex; align-items:center; justify-content:center;
  transition:background var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard);
}
.lk-check__box svg{width:11px; height:11px; stroke:#fff; stroke-width:3; fill:none; opacity:0; transition:opacity var(--dur-fast)}
.lk-check input:checked + .lk-check__box{background:var(--accent); border-color:var(--accent)}
.lk-check input:checked + .lk-check__box svg{opacity:1}
.lk-check input:focus-visible + .lk-check__box{box-shadow:var(--focus-shadow)}
.lk-check input:disabled ~ *{opacity:.5}
.lk-check__txt{line-height:1.35}
.lk-check__txt small{display:block; font-family:var(--font-mono); font-size:var(--fs-xs); color:var(--text-faint); margin-top:2px}
`);

export interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
}

export function Checkbox({ label, hint, disabled = false, className = '', children, ...rest }: CheckboxProps) {
  return (
    <label className={['lk-check', className].filter(Boolean).join(' ')}>
      <input type="checkbox" disabled={disabled} {...rest} />
      <span className="lk-check__box" aria-hidden="true">
        <svg viewBox="0 0 12 12"><path d="M1.5 6.5 L4.5 9.5 L10.5 2.5" /></svg>
      </span>
      {(label || children || hint) ? (
        <span className="lk-check__txt">{label ?? children}{hint ? <small>{hint}</small> : null}</span>
      ) : null}
    </label>
  );
}

// -- Switch -----------------------------------------------------------------

injectStyle('lk-switch-css', `
.lk-switch{display:inline-flex; align-items:center; gap:10px; cursor:pointer; font-family:var(--font-sans); font-size:var(--fs-base); color:var(--text-body)}
.lk-switch input{position:absolute; opacity:0; width:0; height:0}
.lk-switch__track{
  position:relative; flex:none; width:38px; height:21px; border-radius:11px;
  background:var(--border-strong); transition:background var(--dur-base) var(--ease-standard);
}
.lk-switch__knob{
  position:absolute; top:2px; left:2px; width:17px; height:17px; border-radius:9px;
  background:#fff; box-shadow:var(--shadow-xs);
  transition:transform var(--dur-base) var(--ease-standard);
}
.lk-switch input:checked + .lk-switch__track{background:var(--accent)}
.lk-switch input:checked + .lk-switch__track .lk-switch__knob{transform:translateX(17px)}
.lk-switch input:focus-visible + .lk-switch__track{box-shadow:var(--focus-shadow)}
.lk-switch input:disabled ~ *{opacity:.5}
.lk-switch__txt{line-height:1.3}
.lk-switch__txt small{display:block; font-family:var(--font-mono); font-size:var(--fs-xs); color:var(--text-faint); margin-top:2px}
`);

export interface SwitchProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
}

export function Switch({ label, hint, disabled = false, className = '', children, ...rest }: SwitchProps) {
  return (
    <label className={['lk-switch', className].filter(Boolean).join(' ')}>
      <input type="checkbox" role="switch" disabled={disabled} {...rest} />
      <span className="lk-switch__track" aria-hidden="true"><span className="lk-switch__knob" /></span>
      {(label || children || hint) ? (
        <span className="lk-switch__txt">{label ?? children}{hint ? <small>{hint}</small> : null}</span>
      ) : null}
    </label>
  );
}
