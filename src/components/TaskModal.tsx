import Link from 'next/link';
import { TaskDetail } from './TaskDetail';

/**
 * Task detail shown as a popup over the current page. Closing it goes back to `closeHref`.
 * The backdrop and the ✕ button both link to `closeHref`, so no JavaScript is needed.
 */
export function TaskModal({ projectId, taskId, base, closeHref }: { projectId: string; taskId: string; base: string; closeHref: string }) {
  return (
    <div className="mbg">
      <Link href={closeHref} scroll={false} className="mbg-backdrop" aria-label="Close task detail" />
      <div className="mbox">
        <div className="mtop">
          <h3>Task detail</h3>
          <Link href={closeHref} scroll={false} className="x" aria-label="Close">
            ✕
          </Link>
        </div>
        <TaskDetail projectId={projectId} taskId={taskId} base={base} />
      </div>
    </div>
  );
}
