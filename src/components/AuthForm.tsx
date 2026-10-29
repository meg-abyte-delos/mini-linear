'use client';
import { useState } from 'react';
import { safeNext } from '@/lib/auth/guard';

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

  if (sent) return <main className='auth'><div className='auth-card'><h1>Check your email</h1><p className='auth-sub'>If the address can be used, a verification link is on its way.</p><a href='/login'>Back to sign in</a></div></main>;
  return (
    <main className='auth'>
      <form className='auth-card' onSubmit={submit} aria-labelledby='auth-title'>
        <h1 id='auth-title'>{login ? 'Sign in to Mini-Linear' : 'Create your account'}</h1>
        <label>Email<input type='email' name='email' autoComplete='email' required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Password<input type='password' name='password' autoComplete={login ? 'current-password' : 'new-password'} required minLength={login ? 1 : 8} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p role='alert' className='auth-err'>{error}</p>}
        <button type='submit' disabled={busy}>{busy ? 'Please wait…' : login ? 'Sign in' : 'Sign up'}</button>
        <p className='auth-sub'>{login ? <>No account? <a href='/signup'>Sign up</a></> : <>Already registered? <a href='/login'>Sign in</a></>}</p>
      </form>
    </main>
  );
}
