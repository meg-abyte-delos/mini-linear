import type { HTMLAttributes, InputHTMLAttributes, ReactNode, Ref } from 'react';

type Common = { ref?: Ref<HTMLInputElement> };

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & Common & { size?: 28 | 32; invalid?: boolean };

/** Text input: 28 in the app, 32 in forms/auth. `invalid` sets aria-invalid and the danger border. */
export function Input({ size = 28, invalid, className, ...rest }: InputProps) {
  return <input {...rest} className={className ? `input ${className}` : 'input'} data-size={size} aria-invalid={invalid || rest['aria-invalid'] || undefined} />;
}

/** A checkbox or switch always has an accessible name: a visible `label`, or an `aria-label` / `aria-labelledby`. */
type Named = { label: ReactNode } | { label?: undefined; 'aria-label': string } | { label?: undefined; 'aria-labelledby': string };
export type CheckProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'> & Common & Named;

/** Themed checkbox (16px box, accent when checked). Wraps a native input so forms and a11y behave natively. */
export function Checkbox({ label, className, ...rest }: CheckProps) {
  const box = <input {...rest} type='checkbox' className={className ? `cb ${className}` : 'cb'} />;
  return label === undefined ? box : <label className='cb-row'>{box}<span>{label}</span></label>;
}

/** On/off switch (26×16). Native checkbox with role=switch. */
/** Checkbox look for a row-select column inside a role=option / row that owns the selection state (aria-selected): not focusable, hidden from AT, so it never nests an interactive control. Same `.cb` style. */
export function CheckMark({ checked, className, ...rest }: Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'role'> & { checked: boolean }) {
  return <span {...rest} aria-hidden='true' data-checked={checked || undefined} className={className ? `cb ${className}` : 'cb'} />;
}

export function Toggle({ label, className, ...rest }: CheckProps) {
  const sw = <input {...rest} type='checkbox' role='switch' className={className ? `toggle ${className}` : 'toggle'} />;
  return label === undefined ? sw : <label className='cb-row'>{sw}<span>{label}</span></label>;
}
