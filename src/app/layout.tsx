import './globals.css';

export const metadata = { title: 'Mini-Linear' };
// Dynamic render so Next stamps the per-request CSP nonce (set in middleware) on its scripts.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en'>
      <body>{children}</body>
    </html>
  );
}
