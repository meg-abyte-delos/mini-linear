import Link from 'next/link';

// Our own 404: Next's built-in page ships inline styles, which the strict CSP (style-src 'self') blocks. Styled by tokens only.
export const metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <main className='auth'>
      <div className='auth-card' role='status'>
        <h1>Page not found</h1>
        <p className='auth-sub'>This page does not exist, or you do not have access to it.</p>
        <Link href='/' className='nf-link'>Back to issues</Link>
      </div>
    </main>
  );
}
