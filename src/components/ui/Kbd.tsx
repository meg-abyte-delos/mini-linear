export function Kbd({ keys }: { keys: string | string[] }) {
  const list = Array.isArray(keys) ? keys : [keys];
  return <span className='kbd-group'>{list.map((k, i) => <kbd key={i} className='kbd'>{k}</kbd>)}</span>;
}
