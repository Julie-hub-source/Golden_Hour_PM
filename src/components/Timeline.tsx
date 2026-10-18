import Link from 'next/link';
import { addDays, diffDays, formatDayMonth, isWeekend } from '@/lib/calendar';
import { isClosed, type DependencySchedule } from '@/lib/schedule';
import { ROLE_ORDER, STATUS_LABEL, type Member, type Task } from '@/lib/types';

const DAY_PX = 26;

/** Stable colour per person, from their id. */
function colourFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 55% 45%)`;
}

/** Greedy sub-row packing: a task goes into the first sub-row that is free before it starts. */
function packRows(items: { start: string; end: string; task: Task }[]) {
  const rows: { end: string; items: typeof items }[] = [];
  for (const it of [...items].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))) {
    const row = rows.find((r) => r.end < it.start);
    if (row) {
      row.items.push(it);
      row.end = it.end;
    } else {
      rows.push({ end: it.end, items: [it] });
    }
  }
  return rows.map((r) => r.items);
}

interface Lane {
  key: string;
  label: string;
  role: string;
  colour: string;
  rows: ReturnType<typeof packRows>;
}

export function Timeline({
  projectId,
  tasks,
  members,
  schedule,
  commitProd,
}: {
  projectId: string;
  tasks: Task[];
  members: Member[];
  schedule: DependencySchedule;
  commitProd: string;
}) {
  const open = tasks.filter((t) => !isClosed(t) && schedule.plans.has(t.id));
  if (open.length === 0) return <p className="empty">No open tasks to show.</p>;

  const memberById = new Map(members.map((m) => [m.id, m]));
  const roleRank = (role: string) => {
    const i = ROLE_ORDER.indexOf(role as (typeof ROLE_ORDER)[number]);
    return i === -1 ? ROLE_ORDER.length : i;
  };

  // Lanes: one per person ordered by role, unassigned last
  const byPerson = new Map<string, Task[]>();
  for (const t of open) {
    const key = t.picId ?? 'unassigned';
    byPerson.set(key, [...(byPerson.get(key) ?? []), t]);
  }
  const lanes: Lane[] = [...byPerson.entries()]
    .map(([key, list]) => {
      const m = key === 'unassigned' ? null : memberById.get(key) ?? null;
      const items = list.map((t) => {
        const p = schedule.plans.get(t.id)!;
        return { start: p.start, end: p.end, task: t };
      });
      return {
        key,
        label: m ? m.name : 'Unassigned',
        role: m ? m.role : '',
        colour: m ? colourFor(m.id) : 'var(--muted)',
        rows: packRows(items),
      };
    })
    .sort((a, b) => {
      if (a.key === 'unassigned') return 1;
      if (b.key === 'unassigned') return -1;
      return roleRank(a.role) - roleRank(b.role) || a.label.localeCompare(b.label);
    });

  // Visible range: from the Monday of the first start to a week after the last end
  const allStarts = open.map((t) => schedule.plans.get(t.id)!.start);
  const allEnds = open.map((t) => schedule.plans.get(t.id)!.end);
  const first = allStarts.reduce((a, b) => (a < b ? a : b));
  const last = allEnds.reduce((a, b) => (a > b ? a : b));
  const rangeStart = addDays(first, -((((new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7))));
  const rangeEnd = addDays(last, 7);
  const days = diffDays(rangeStart, rangeEnd) + 1;
  const width = days * DAY_PX;
  const x = (iso: string) => diffDays(rangeStart, iso) * DAY_PX;

  const dayList = Array.from({ length: days }, (_, i) => addDays(rangeStart, i));
  const mondays = dayList.filter((d) => new Date(d + 'T00:00:00Z').getUTCDay() === 1);
  const weekends = dayList.filter((d) => isWeekend(d));

  return (
    <>
      <div className="tl-legend">
        <span>
          <span className="health-dot" style={{ background: 'var(--amber)' }} /> critical path
        </span>
        <span>
          <span className="health-dot" style={{ background: 'var(--red)' }} /> blocked
        </span>
        <span>
          <span className="health-dot" style={{ background: 'var(--red)', borderRadius: 0, width: 2, height: 12 }} /> Prod commit{' '}
          {formatDayMonth(commitProd)}
        </span>
        <span>Grey columns are weekends. Each person has one lane.</span>
      </div>
      <div className="timeline-wrap">
        <div className="timeline" style={{ width: width + 190 }}>
          <div className="tl-row">
            <div className="tl-label muted">Person</div>
            <div className="tl-axis" style={{ width, flex: '0 0 auto' }}>
              {mondays.map((d) => (
                <span key={d} style={{ left: x(d) + 2 }}>
                  {formatDayMonth(d)}
                </span>
              ))}
            </div>
          </div>

          {lanes.map((lane) => {
            const height = Math.max(1, lane.rows.length) * DAY_PX + 6;
            return (
              <div key={lane.key} className="tl-row" style={{ minHeight: height }}>
                <div className="tl-label">
                  <span style={{ color: lane.colour, fontWeight: 600 }}>{lane.label}</span>
                  {lane.role && <div className="role">{lane.role}</div>}
                </div>
                <div className="tl-lane" style={{ width, height }}>
                  {weekends.map((d) => (
                    <div key={d} className="tl-weekend" style={{ left: x(d), width: DAY_PX }} />
                  ))}
                  <div className="tl-commit" style={{ left: x(commitProd) }} />
                  {lane.rows.map((row, r) =>
                    row.map(({ start, end, task }) => {
                      const p = schedule.plans.get(task.id)!;
                      const cls = ['tl-bar', p.critical ? 'critical' : '', task.blocked ? 'blocked' : ''].join(' ').trim();
                      const title = [
                        `${task.code} ${task.name}`,
                        `${task.phase} · ${task.environment}`,
                        `${start} → ${end} · ${task.duration} working day(s)`,
                        STATUS_LABEL[task.status],
                        task.blocked ? `Blocked: ${task.blocker}` : '',
                      ]
                        .filter(Boolean)
                        .join('\n');
                      return (
                        <Link
                          key={task.id}
                          href={`/projects/${projectId}/tasks/${task.id}`}
                          className={cls}
                          title={title}
                          style={{
                            left: x(start) + 1,
                            width: Math.max(DAY_PX, (diffDays(start, end) + 1) * DAY_PX) - 2,
                            top: r * DAY_PX + 3,
                            background: lane.colour,
                            color: '#fff',
                          }}
                        >
                          {task.code} {task.name}
                        </Link>
                      );
                    }),
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
