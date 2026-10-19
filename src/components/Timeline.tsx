import { addDays, diffDays, formatDate, isWeekend, todayIso } from '@/lib/calendar';
import { isClosed, type DependencySchedule } from '@/lib/schedule';
import { ROLE_ORDER, STATUS_LABEL, memberLabel, type Member, type Task } from '@/lib/types';
import { SegLink } from './SegLink';
import { COLORS } from '@/lib/palette';
import { taskLink } from '@/lib/links';

/** Day width in px, as in the prototype. */
const DW = 26;


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
  baseHref,
  tasks,
  members,
  schedule,
  closedPlans,
  commitProd,
}: {
  /** Page the task popup opens on, e.g. /projects/x/dashboard?tab=timeline */
  baseHref: string;
  tasks: Task[];
  members: Member[];
  schedule: DependencySchedule;
  /** Planned dates of Closed tasks (no late shifts), so the whole project shows from start to end. */
  closedPlans: Map<string, { start: string; end: string }>;
  commitProd: string;
}) {
  // Open tasks use the live schedule; Closed tasks show their planned dates, greyed out
  const open = tasks.filter((t) => !isClosed(t) && schedule.plans.has(t.id));
  const done = tasks.filter((t) => isClosed(t) && closedPlans.has(t.id));
  const shown = [...open, ...done];
  if (shown.length === 0) return <div className="card"><p className="muted">No tasks yet.</p></div>;
  const planOf = (t: Task) =>
    isClosed(t)
      ? { start: closedPlans.get(t.id)!.start, end: closedPlans.get(t.id)!.end, critical: false, late: false, lateWd: 0 }
      : schedule.plans.get(t.id)!;

  const today = todayIso();
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
  for (const t of shown) {
    const key = t.picId ?? 'unassigned';
    byPerson.set(key, [...(byPerson.get(key) ?? []), t]);
  }
  const keys = [...byPerson.keys()].sort((a, b) => {
    if (a === 'unassigned') return 1;
    if (b === 'unassigned') return -1;
    const ma = memberById.get(a), mb = memberById.get(b);
    return roleRank(ma?.role ?? '') - roleRank(mb?.role ?? '') || (ma?.name ?? '').localeCompare(mb?.name ?? '');
  });

  // Range: Monday of the earliest date (including today) to a week after the latest date.
  // The width follows the schedule, so a short plan gives a short timeline.
  const starts = shown.map((t) => planOf(t).start);
  const ends = shown.map((t) => planOf(t).end);
  const first = [...starts, today].reduce((a, b) => (a < b ? a : b));
  const last = [...ends, today, commitProd].reduce((a, b) => (a > b ? a : b));
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
            {memberLabel(m)}
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
          <span className="flame">🔥</span>
          Struggle (crossed out when solved)
        </span>
        <span className="chip">
          <span style={{ width: 2, height: 12, borderLeft: '2px dashed var(--red)', display: 'inline-block' }} />
          Prod commit {formatDate(commitProd)}
        </span>
        <span className="chip">
          <span style={{ width: 2, height: 12, background: 'var(--blue)', display: 'inline-block' }} />
          Today {formatDate(today)}
        </span>
      </div>

      <div className="tlscroll">
        <div className="tlin" style={{ width: width + 190 }}>
          <div className="axrow">
            <div className="sp" />
            <div className="ticks" style={{ width }}>
              {mondays.map((d) => (
                <span key={d} style={{ left: x(d) }}>
                  {formatDate(d)}
                </span>
              ))}
              <span className="today-label" style={{ left: x(today) + DW / 2 }}>
                Today
              </span>
            </div>
          </div>

          {keys.map((key) => {
            const m = memberById.get(key) ?? null;
            const items: Item[] = byPerson.get(key)!.map((t) => {
              const p = planOf(t);
              return { task: t, start: p.start, end: p.end };
            });
            const rows = packRows(items);
            const colour = colourOf(m?.id ?? null);
            return (
              <div key={key} className="lane">
                <div className="llabel">
                  {m ? (
                    <>
                      <span style={{ color: colour, fontWeight: 600 }}>{memberLabel(m)}</span>
                      
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
                  <div className="today-line" style={{ left: x(today) + DW / 2 }} />
                  {rows.map((row, r) => (
                    <div key={r} className="lrow">
                      {row.map(({ task, start, end }) => {
                        const p = planOf(task);
                        const finished = isClosed(task);
                        const w = Math.max(DW, (diffDays(start, end) + 1) * DW) - 2;
                        // Split the bar at the deadline: person's colour up to it, red stripes after it
                        const dl = task.deadline;
                        // A task that has not started yet has no stripes: it is not late, and its colour stays normal
                        // Finished tasks are plain grey, with no stripes
                        const started = start <= today;
                        const colourEnd = !started ? end : dl < end ? dl : end;
                        const colourDays = started && dl < start ? 0 : diffDays(start, colourEnd) + 1;
                        const stripeFrom = started && dl >= start ? addDays(dl, 1) : start;
                        const stripeDays = !finished && started && end >= stripeFrom ? diffDays(stripeFrom, end) + 1 : 0;
                        const colourW = stripeDays === 0 ? w : colourDays === 0 ? 0 : colourDays * DW - 1;
                        const stripeW = w - colourW;
                        const barColour = colour;
                        return (
                          <SegLink
                            key={task.id}
                            href={taskLink(baseHref, task.id)}
                            className={`seg ${p.critical ? 'crit' : ''} ${task.blocked ? 'blk' : ''}`}
                            style={{ left: x(start) + 1, width: w, background: 'transparent' }}
                            label={
                              <>
                                {colourW > 0 && <span className="seg-part" style={{ width: colourW, background: barColour }} />}
                                {stripeW > 0 && <span className="seg-stripe" style={{ left: colourW, width: stripeW }} />}
                                <span className="seg-label">{task.code}</span>
                                {p.late && <span className="late-tag">Late</span>}
                                {task.issues.map((i) => (
                                  <span key={i.id} className={`flame ${i.solvedAt ? 'solved' : ''}`}>
                                    🔥
                                  </span>
                                ))}
                              </>
                            }
                            tip={
                              <>
                                <b>
                                  {task.code} · {task.name}
                                </b>
                                <br />
                                {task.phase} · {task.environment}
                                <br />
                                {formatDate(start)} → {formatDate(end)} ({task.duration} working day
                                {task.duration === 1 ? '' : 's'})
                                <br />
                                Status: {STATUS_LABEL[task.status]}
                                <br />
                                Deadline {formatDate(task.deadline)}
                                {p.late ? ` · Late by ${p.lateWd} working day(s)` : ''}
                                {task.issues.map((i) => (
                                  <div key={i.id}>
                                    🔥 {i.solvedAt ? <s>{i.reason}</s> : i.reason}
                                    {i.solvedAt ? ' · solved' : ' · open'}
                                  </div>
                                ))}
                                {p.critical ? ' · Critical path' : ''}
                              </>
                            }
                          />
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
        The timeline shows the whole project, from the first task to the last. Closed tasks use their planned dates and keep their normal colour. Scroll sideways to move along the timeline. Saturdays and Sundays are shaded and never hold work. Hover a segment for the dates; click it to open the task. Overlapping tasks of the same person stack into extra rows.
      </p>
    </div>
  );
}
