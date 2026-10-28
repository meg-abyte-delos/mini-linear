/** Email digest behind an interface: the real transport (SMTP, Resend...) plugs in via setDigestSender. */
export type DigestItem = { type: string; identifier: string; title: string; actorEmail: string | null; createdAt: string };
export type Digest = { to: string; subject: string; text: string; count: number };
export interface DigestSender { send(digest: Digest): Promise<void> }

export class NoopDigestSender implements DigestSender { async send(): Promise<void> { /* intentionally nothing */ } }
let sender: DigestSender = new NoopDigestSender();
export const setDigestSender = (s: DigestSender) => { sender = s; };
export const getDigestSender = () => sender;

const LABEL: Record<string, string> = { assigned: 'Assigned to you', mention: 'Mentioned you', comment: 'New comment', status_change: 'Status changed', due_soon: 'Due soon' };

/** Pure: groups unread items by type (fixed order), newest first inside a group. Returns null when there is nothing to send. */
export function buildDigest(to: string, items: DigestItem[]): Digest | null {
  if (items.length === 0) return null;
  const lines: string[] = [];
  for (const ty of Object.keys(LABEL)) {
    const g = items.filter((i) => i.type === ty).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!g.length) continue;
    lines.push(`${LABEL[ty]} (${g.length})`);
    for (const i of g) lines.push(`  ${i.identifier} ${i.title}${i.actorEmail ? ` (${i.actorEmail})` : ''}`);
    lines.push('');
  }
  return { to, subject: `${items.length} unread notification${items.length > 1 ? 's' : ''}`, text: lines.join('\n').trimEnd(), count: items.length };
}
