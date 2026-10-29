// Full-page states for the home screen when the signed-in user has no usable workspace (instead of the generic Next error page).
import Link from 'next/link';
import type { WorkspaceProblem } from '@/lib/auth/workspace-context';

export function WorkspaceState({ problem }: { problem: WorkspaceProblem }) {
  return problem === 'no-workspace' ? (
    <main className='auth'>
      <div className='auth-card' role='status'>
        <h1>No workspace yet</h1>
        <p className='auth-sub'>Your account is not a member of any workspace. Ask an admin to invite you, then reload this page.</p>
      </div>
    </main>
  ) : (
    <main className='auth'>
      <div className='auth-card' role='alert'>
        <h1>Could not load your workspace</h1>
        <p className='auth-sub'>Something went wrong on our side. Try again in a moment.</p>
        <Link href='/'>Retry</Link>
      </div>
    </main>
  );
}
