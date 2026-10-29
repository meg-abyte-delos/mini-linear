import '@fontsource-variable/inter';
import './theme.css';
import './globals.css';
import './ui-progress.css';
import './ui-search.css';
import './ui-projects.css';
import './ui-inbox.css';
import './ui-board.css';
import './ui-list.css';
import './ui-palette.css';
import { cookies } from 'next/headers';

export const metadata = { title: 'Mini-Linear' };
// Dynamic render so Next stamps the per-request CSP nonce (set in proxy.ts) on its scripts.
export const dynamic = 'force-dynamic';

// Theme comes from the ml_theme cookie set by PATCH /api/v1/me: light | dark | system (system = follow the OS, no attribute).
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const t = (await cookies()).get('ml_theme')?.value;
  const theme = t === 'light' || t === 'dark' ? t : t === 'system' ? undefined : 'dark';
  return (
    <html lang='en' data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
