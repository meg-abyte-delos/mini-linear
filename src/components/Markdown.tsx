import { Fragment } from 'react';
import { parseMarkdown, type Inline } from '@/lib/detail/markdown';

function Inl({ c }: { c: Inline[] }) {
  return <>{c.map((n, k) => {
    switch (n.t) {
      case 'text': return <Fragment key={k}>{n.v}</Fragment>;
      case 'code': return <code key={k}>{n.v}</code>;
      case 'strong': return <strong key={k}><Inl c={n.c} /></strong>;
      case 'em': return <em key={k}><Inl c={n.c} /></em>;
      case 'del': return <del key={k}><Inl c={n.c} /></del>;
      case 'mention': return <span key={k} className='mention'>@{n.user}</span>;
      case 'link': { const ext = /^(https?:|mailto:)/i.test(n.href); return <a key={k} href={n.href} {...(ext ? { target: '_blank', rel: 'noopener noreferrer nofollow ugc' } : {})}><Inl c={n.c} /></a>; }
    }
  })}</>;
}

/** Renders the safe markdown subset as React elements. Never injects HTML. */
export function Markdown({ source, empty = 'No description' }: { source: string; empty?: string }) {
  const blocks = parseMarkdown(source);
  if (!blocks.length) return <p className='md-empty'>{empty}</p>;
  return (
    <div className='md'>
      {blocks.map((b, k) => {
        switch (b.t) {
          case 'p': return <p key={k}><Inl c={b.c} /></p>;
          case 'h': { const H = (`h${b.level + 2}`) as 'h3' | 'h4' | 'h5'; return <H key={k}><Inl c={b.c} /></H>; }
          case 'ul': return <ul key={k}>{b.items.map((it, n) => <li key={n}><Inl c={it} /></li>)}</ul>;
          case 'ol': return <ol key={k}>{b.items.map((it, n) => <li key={n}><Inl c={it} /></li>)}</ol>;
          case 'task': return <ul key={k} className='tasks'>{b.items.map((it, n) => <li key={n}><input type='checkbox' checked={it.done} readOnly disabled aria-label={it.done ? 'Done' : 'Not done'} /> <Inl c={it.c} /></li>)}</ul>;
          case 'quote': return <blockquote key={k}><Inl c={b.c} /></blockquote>;
          case 'pre': return <pre key={k}><code>{b.v}</code></pre>;
          case 'hr': return <hr key={k} />;
        }
      })}
    </div>
  );
}
