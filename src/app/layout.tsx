import '@fontsource-variable/inter';
import './theme.css';
import './globals.css';

export const metadata = { title: 'Mini-Linear' };
// Dynamic render so Next stamps the per-request CSP nonce (set in proxy.ts) on its scripts.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en' data-theme='dark'>
      <body>{children}</body>
    </html>
  );
}
