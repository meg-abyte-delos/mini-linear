import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

type Size = 24 | 28 | 32;
type Base = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { size?: Size; tone?: 'danger'; loading?: boolean; ref?: Ref<HTMLButtonElement> };

export type ButtonProps = Base & { variant?: 'primary' | 'secondary' | 'ghost'; children: ReactNode };

/** The one text button. Loading keeps the width (label hidden, spinner overlaid) and sets aria-busy. */
export function Button({ variant = 'secondary', size = 28, tone, loading, disabled, className, type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button {...rest} type={type} className={className ? `btn ${className}` : 'btn'} data-variant={variant} data-size={size} data-tone={tone} aria-busy={loading || undefined} disabled={disabled || loading}>
      <span className='btn-label'>{children}</span>
      {loading && <span className='btn-spin' aria-hidden='true' />}
    </button>
  );
}

export type IconButtonProps = Base & { label: string; children: ReactNode };

/** Square icon-only button. `label` is required and becomes the accessible name and the native tooltip. */
export function IconButton({ label, size = 28, tone, loading, disabled, className, type = 'button', title, children, ...rest }: IconButtonProps) {
  return (
    <button {...rest} type={type} className={className ? `btn ${className}` : 'btn'} data-variant='icon' data-size={size} data-tone={tone} aria-label={label} title={title ?? label} aria-busy={loading || undefined} disabled={disabled || loading}>
      <span className='btn-label'>{children}</span>
      {loading && <span className='btn-spin' aria-hidden='true' />}
    </button>
  );
}
