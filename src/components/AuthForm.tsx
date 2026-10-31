'use client';
import { useState } from 'react';
import { safeNext } from '@/lib/auth/guard';
import { Button, Input } from '@/components/ui';

function Logo() {
  return <svg className='auth-logo' width='32' height='32' viewBox='0 0 32 32' aria-hidden='true'><rect width='32' height='32' rx='8' fill='var(--accent)'/><path d='M9 21.5 21.5 9M9 16.5 16.5 9M13.5 23 23 13.5' stroke='var(--accent-fg)' strokeWidth='2.2' strokeLinecap='round'/></svg>;
}

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const login = mode === 'login';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/v1/auth/${mode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.trim().toLowerCase(), password }) });
      if (res.ok && login) { window.location.assign(safeNext(new URLSearchParams(window.location.search).get('next'))); return; }
      if (res.ok) { setSent(true); return; }
      setError(res.status === 401 ? 'Invalid email or password.' : res.status === 429 ? 'Too many attempts. Try again in a minute.' : res.status === 400 ? 'Check your email and password (8+ characters).' : 'Something went wrong. Try again.');
    } catch { setError('Network error. Try again.'); } finally { setBusy(false); }
  }

  if (sent) return <main className='auth'><div className='auth-card'><Logo /><h1>Check your email</h1><p className='auth-sub'>If the address can be used, a verification link is on its way.</p><a href='/login'>Back to sign in</a></div></main>;
  return (
    <main className='auth'>
      <form className='auth-card' onSubmit={submit} aria-labelledby='auth-title'>
        <Logo />
        <h1 id='auth-title'>{login ? 'Sign in to Mini-Linear' : 'Create your account'}</h1>
        <label>Email<Input size={32} type='email' name='email' placeholder='name@company.com' invalid={!!error} autoComplete='email' required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Password<Input size={32} type='password' name='password' invalid={!!error} autoComplete={login ? 'current-password' : 'new-password'} required minLength={login ? 1 : 8} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p role='alert' className='auth-err'><svg width='14' height='14' viewBox='0 0 16 16' aria-hidden='true'><circle cx='8' cy='8' r='7' fill='none' stroke='currentColor' strokeWidth='1.5'/><path d='M8 4.5v4M8 11h.01' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round'/></svg>{error}</p>}
        <Button type='submit' variant='primary' size={32} className='auth-submit' loading={busy}>{login ? 'Sign in' : 'Sign up'}</Button>
        <p className='auth-sub'>{login ? <>No account? <a href='/signup'>Sign up</a></> : <>Already registered? <a href='/login'>Sign in</a></>}</p>
      </form>
    </main>
  );
}
