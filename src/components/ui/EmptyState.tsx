import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons';

// Linear-style empty state: quiet glyph, one-line title, short hint, optional action.
export function EmptyState({ icon, title, hint, action, compact = false, role = 'status' }: { icon: IconName; title: ReactNode; hint?: ReactNode; action?: ReactNode; compact?: boolean; role?: 'status' | 'alert' }) {
  return (
    <div className={`state empty es${compact ? ' es-compact' : ''}`} role={role}>
      <span className='es-glyph'><Icon name={icon} size={compact ? 20 : 28} /></span>
      <p className='es-title'>{title}</p>
      {hint && <p className='es-hint'>{hint}</p>}
      {action && <div className='es-act'>{action}</div>}
    </div>
  );
}
