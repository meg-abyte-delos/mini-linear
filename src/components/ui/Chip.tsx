import type { ReactNode } from 'react';

interface Props { children: ReactNode; lead?: ReactNode; tone?: 'neutral' | 'accent' | 'danger'; onRemove?: () => void; removeLabel?: string; onClick?: () => void }
// Label / filter chip. Clickable chips render a button; removable ones get a separate labelled remove button.
export function Chip({ children, lead, tone = 'neutral', onRemove, removeLabel = 'Remove', onClick }: Props) {
  const body = <>{lead}<span className='chip-text'>{children}</span></>;
  return (
    <span className='chip' data-tone={tone}>
      {onClick ? <button type='button' className='chip-main' onClick={onClick}>{body}</button> : body}
      {onRemove && <button type='button' className='chip-x' aria-label={removeLabel} onClick={onRemove}>&times;</button>}
    </span>
  );
}
