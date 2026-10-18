import Link from 'next/link';
import { currentAccount } from '@/lib/session';
import { unreadCount } from '@/lib/repo';
import { switchAccount } from '@/app/actions';
import { AutoSelect } from './AutoSelect';

export async function Header() {
  const { actor, members } = await currentAccount();
  const unread = actor ? await unreadCount(actor.id) : 0;

  return (
    <header className="topbar">
      <Link href="/" className="brand">
        Pulse
      </Link>
      <nav className="nav">
        <Link href="/">Projects</Link>
        <Link href="/team">Team</Link>
      </nav>
      <div className="topbar-right">
        <Link href="/notifications" className="bell" aria-label={`Notifications, ${unread} unread`}>
          🔔{unread > 0 && <span className="count">{unread}</span>}
        </Link>
        {members.length > 0 && (
          <label className="account">
            <span>Acting as</span>
            <AutoSelect
              action={switchAccount}
              name="memberId"
              value={actor?.id ?? ''}
              options={members.map((m) => ({ value: m.id, label: `${m.name} (${m.role})` }))}
              label="Acting as"
            />
          </label>
        )}
      </div>
    </header>
  );
}
