import Link from 'next/link';
import { currentAccount } from '@/lib/session';
import { unreadCount } from '@/lib/repo';
import { switchAccount } from '@/app/actions';
import { can } from '@/lib/permissions';
import { AutoSelect } from './AutoSelect';
import { memberLabel } from '@/lib/types';

export async function Header() {
  const { actor, members } = await currentAccount();
  const unread = actor ? await unreadCount(actor.id) : 0;
  const canCreate = can(actor, 'project.create').ok;

  return (
    <>
      <header className="topbar">
        <div>
          <Link href="/" className="brand">
            Golden Hour
          </Link>
          <span className="brand-sub">Where each project is heading, and what to fix first</span>
        </div>
        <div className="topbar-right">
          {members.length > 0 && (
            <label className="account">
              Signed in as
              <AutoSelect
                action={switchAccount}
                name="memberId"
                value={actor?.id ?? ''}
                options={members.map((m) => ({ value: m.id, label: memberLabel(m) }))}
                label="Signed in as"
              />
            </label>
          )}
          <Link href="/notifications" className="bell" aria-label={`Notifications, ${unread} unread`}>
            🔔 {unread > 0 && <span className="count">{unread}</span>}
          </Link>
        </div>
      </header>
      <nav className="nav">
        <Link href="/">Projects</Link>
        <Link href="/team">Team</Link>
        <Link href="/notifications">Notifications{unread > 0 ? ` (${unread})` : ''}</Link>
        {!canCreate && <span className="muted small" style={{ alignSelf: 'center', marginLeft: 'auto' }}>Only PM can create projects</span>}
      </nav>
    </>
  );
}
