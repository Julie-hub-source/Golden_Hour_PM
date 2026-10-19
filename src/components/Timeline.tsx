import Link from 'next/link';
import { addDays, diffDays, formatDate, formatDayMonth, isWeekend, weekdayShort } from '@/lib/calendar';
import { isClosed, type DependencySchedule } from '@/lib/schedule';
import { ROLE_ORDER, ROLES, STATUS_LABEL, type Member, type Task } from '@/lib/types';

/** Day width in px, as in the prototype. */
const DW = 26;

/** Same palette as the prototype, assigned by team order so each person keeps one colour. */
const COLORS = ['#3b6cf6', '#2fa36b', '#f5a524', '#e5484d', '#8b5cf6', '#0ea5e9', '#ec4899', '#14b8a6', '#84cc16', '#6366f1'];

interface Item {
  task: Task;
  start: string;
  end: string;
}

/** Greedy sub-row packing: a task goes into the first sub-row that is free before it starts. */
function packRows(items: Item[]): Item[][] {
  const rows: { end: string; items: Item[] }[] = [];
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
  if (open.length === 0) return <div className="card"><p className="muted">All tasks are Closed.</p></div>;

  const memberIndex = new Map(members.map((m, i) => [m.id, i]));
  const memberById = new Map(members.map((m) => [m.id, m]));
  const roleRank = (role: string) => {
    const i = ROLE_ORDER.indexOf(role as (typeof ROLE_ORDER)[number]);
    return i === -1 ? ROLE_ORDER.length : i;
  };
  const colourOf = (id: string | null) => {
    const i = id ? memberIndex.get(id) ?? 0 : 0;
    return id ? COLORS[i % COLORS.length] : '#9ca3af';
  };

  // One lane per person, ordered by role; unassigned last
  const byPerson = new Map<string, Task[]>();
  for (const t of open) {
    const key = t.picId ?? 'unassigned';
    byPerson.set(key, [...(byPerson.get(key) ?? []), t]);
  }
  const keys = [...byPerson.keys()].sort((a, b) => {
    if (a === 'unassigned') return 1;
    if (b === 'unassigned') return -1;
    const ma = memberById.get(a), mb = memberById.get(b);
    return roleRank(ma?.role ?? '') - roleRank(mb?.role ?? '') || (ma?.name ?? '').localeCompare(mb?.name ?? '');
  });

  // Visible range: Monday of the first start to a week after the last end
  const starts = open.map((t) => schedule.plans.get(t.id)!.start);
  const ends = open.map((t) => schedule.plans.get(t.id)!.end);
  const first = starts.reduce((a, b) => (a < b ? a : b));
  const last = ends.reduce((a, b) => (a > b ? a : b));
  const offsetToMonday = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const rangeStart = addDays(first, -offsetToMonday);
  const rangeEnd = addDays(last, 7);
  const days = diffDays(rangeStart, rangeEnd) + 1;
  const width = days * DW;
  const x = (iso: string) => diffDays(rangeStart, iso) * DW;

  const dayList = Array.from({ length: days }, (_, i) => addDays(rangeStart, i));
  const weekends = dayList.filter((d) => isWeekend(d));
  const mondays = dayList.filter((d) => new Date(d + 'T00:00:00Z').getUTCDay() === 1);

  const legendPeople = members.filter((m) => byPerson.has(m.id));

  return (
    <div className="card">
      <h3>Task timeline · projected dates by member</h3>
      <div className="legend">
        {legendPeople.map((m) => (
          <span key={m.id} className="chip">
            <i style={{ background: colourOf(m.id) }} />
            {m.name} · {m.role}
          </span>
        ))}
        <span className="chip">
          <i style={{ background: '#e7e9ec' }} />
          Weekend (no work)
        </span>
        <span className="chip">
          <i style={{ background: '#fff', outline: '2px solid var(--amber)' }} />
          Critical path
        </span>
        <span className="chip">
          <i style={{ background: '#fff', boxShadow: '0 0 0 2px var(--red)' }} />
          Blocked
        </span>
        <span className="chip">
          <span style={{ width: 2, height: 12, borderLeft: '2px dashed var(--red)', display: 'inline-block' }} />
          Prod commit {formatDate(commitProd)}
        </span>
      </div>

      <div className="tlscroll">
        <div className="tlin" style={{ width: width + 190 }}>
          <div className="axrow">
            <div className="sp" />
            <div className="ticks" style={{ width }}>
              {mondays.map((d) => (
                <span key={d} style={{ left: x(d) }}>
                  {formatDayMonth(d)}
                </span>
              ))}
            </div>
          </div>

          {keys.map((key) => {
            const m = memberById.get(key) ?? null;
            const items: Item[] = byPerson.get(key)!.map((t) => {
              const p = schedule.plans.get(t.id)!;
              return { task: t, start: p.start, end: p.end };
            });
            const rows = packRows(items);
            const colour = colourOf(m?.id ?? null);
            return (
              <div key={key} className="lane">
                <div className="llabel">
                  {m ? (
                    <>
                      <span style={{ color: colour, fontWeight: 600 }}>{m.name}</span>
                      <div className="muted small">{m.role}</div>
                    </>
                  ) : (
                    <span className="muted">Unassigned</span>
                  )}
                </div>
                <div className="ltrack" style={{ width, minHeight: Math.max(1, rows.length) * 30 + 14 }}>
                  {weekends.map((d) => (
                    <div key={d} className="wkend" style={{ left: x(d), width: DW }} />
                  ))}
                  <div className="cline" style={{ left: x(commitProd) }} title={`Prod commit ${formatDate(commitProd)}`} />
                  {rows.map((row, r) => (
                    <div key={r} className="lrow">
                      {row.map(({ task, start, end }) => {
                        const p = schedule.plans.get(task.id)!;
                        const w = Math.max(DW, (diffDays(start, end) + 1) * DW) - 2;
                        const flip = x(start) > width * 0.6;
                        return (
                          <Link
                            key={task.id}
                            href={`/projects/${projectId}/tasks/${task.id}`}
                            className={`seg ${p.critical ? 'crit' : ''} ${task.blocked ? 'blk' : ''}`}
                            style={{ left: x(start) + 1, width: w, background: colour }}
                          >
                            {task.code}
                            <span className={`tip ${flip ? 'tr' : ''}`}>
                              <b>
                                {task.code} · {task.name}
                              </b>
                              <br />
                              {task.phase} · {task.environment}
                              <br />
                              {weekdayShort(start)} {formatDate(start)} → {weekdayShort(end)} {formatDate(end)} ({task.duration} working day
                              {task.duration === 1 ? '' : 's'})
                              <br />
                              Status: {STATUS_LABEL[task.status]}
                              {task.blocked ? ` · Blocked: ${task.blocker}` : ''}
                              {p.critical ? ' · Critical path' : ''}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="note">
        Scroll sideways to move along the timeline. Saturdays and Sundays are shaded and never hold work. Hover a segment for the dates; click it to open the task. Closed tasks are hidden. Overlapping tasks of the same person stack into extra rows. Roles in use: {ROLES.join(', ')}.
      </p>
    </div>
  );
}
