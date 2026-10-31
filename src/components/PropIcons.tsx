// 14px property icons for the issue sidebar pills.
const P = {
  label: 'M2.5 3.5v3.6l5.9 5.9 4.6-4.6-5.9-5.9H3.5a1 1 0 0 0-1 1ZM5.2 5.2h.01',
  estimate: 'M7 2 2.5 4.5v5L7 12l4.5-2.5v-5Z M2.5 4.5 7 7l4.5-2.5M7 7v5',
  due: 'M3 3.5h8a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5ZM2.5 6h9M5 2v2.5M9 2v2.5',
  parent: 'M4 2.5v5a2 2 0 0 0 2 2h5M8.5 7l2.5 2.5L8.5 12',
  project: 'M2.5 3.5h3.2l1.3 1.5h4.5v5.5a1 1 0 0 1-1 1h-8Z',
  cycle: 'M11.5 7A4.5 4.5 0 1 1 9.8 3.5M11.5 2.5V5H9',
  branch: 'M4.5 2.5v9M4.5 11.5a1.5 1.5 0 1 0 0 .01M9.5 4a1.5 1.5 0 1 0 0 .01M9.5 5.5c0 2.5-5 2-5 4.5',
  copy: 'M5 5h6.5a.5.5 0 0 1 .5.5V12a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V5.5A.5.5 0 0 1 5 5ZM9.5 3.5V2.6a.1.1 0 0 0-.1-.1H2.6a.1.1 0 0 0-.1.1v6.8a.1.1 0 0 0 .1.1h.9',
  panel: 'M2.5 3h9a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-7a.5.5 0 0 1 .5-.5ZM8.5 3v8',
  user: 'M7 7a2.2 2.2 0 1 0 0-4.4A2.2 2.2 0 0 0 7 7ZM2.8 12c.4-2 2.1-3.2 4.2-3.2s3.8 1.2 4.2 3.2',
} as const;
export function PropIcon({ name }: { name: keyof typeof P }) {
  return (<svg className='prop-ic' width='14' height='14' viewBox='0 0 14 14' fill='none' stroke='currentColor' strokeWidth='1.3' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' focusable='false'><path d={P[name]} /></svg>);
}
