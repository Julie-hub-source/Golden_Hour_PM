import Link from 'next/link';
import { loadNotifications } from '@/lib/repo';
import { currentAccount } from '@/lib/session';
import { PROJECT_TIMEZONE, formatDate } from '@/lib/calendar';
import { markAllNotificationsRead } from '@/app/actions';
import { ActionForm } from '@/components/ActionForm';

/** Same date format as the rest of the app, plus the time in Asia/Ho_Chi_Minh. */
const formatWhen = (iso: string) => {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: PROJECT_TIMEZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: PROJECT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return `${formatDate(day)} ${time}`;
};

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const { actor } = await currentAccount();
  if (!actor) return <p className="empty">Choose an account to see notifications.</p>;
  const items = await loadNotifications(actor.id);
  const unread = items.filter((n) => !n.read).length;

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="spread">
        <div>
          <h1>Notifications</h1>
          <p className="muted">For {actor.name}. {unread} unread.</p>
        </div>
        {unread > 0 && (
          <ActionForm action={markAllNotificationsRead} submitLabel="Mark all as read">
            {null}
          </ActionForm>
        )}
      </div>
      <div className="section">
        {items.length === 0 && <p className="empty">Nothing yet.</p>}
        {items.map((n) => (
          <div key={n.id} className={`notif${n.read ? '' : ' unread'}`}>
            <div>{n.message}</div>
            <div className="small muted">
              {n.projectName && n.projectId && (
                <>
                  <Link href={`/projects/${n.projectId}`}>{n.projectName}</Link> ·{' '}
                </>
              )}
              {formatWhen(n.createdAt)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
