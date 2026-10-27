export default function Loading() {
  return (
    <div className='shell'>
      <aside className='side' aria-hidden='true' />
      <main className='main' aria-busy='true'>
        <header className='head'><div className='crumbs'><span>Delos</span><span className='sep'>/</span><h1 className='crumb-title'>Issues</h1></div></header>
        <div className='scroll' role='status' aria-label='Loading issues'>
          <span className='sr-only'>Loading issues…</span>
          {Array.from({ length: 8 }, (_, n) => <div key={n} className='row skeleton' aria-hidden='true'><span className='sk sk-s' /><span className='sk sk-l' style={{ width: `${40 + ((n * 17) % 35)}%` }} /></div>)}
        </div>
      </main>
    </div>
  );
}
