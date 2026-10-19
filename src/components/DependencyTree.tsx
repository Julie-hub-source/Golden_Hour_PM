import type { ReactNode } from 'react';
import { isClosed, type DependencySchedule } from '@/lib/schedule';
import { colourOf } from '@/lib/palette';
import { taskLink } from '@/lib/links';
import { SvgLink } from './SvgLink';
import { ROLE_ORDER, memberLabel, type Member, type Task } from '@/lib/types';

const NW = 180; // node width
const NH = 58; // node height
const GX = 250; // column pitch
const GY = 76; // row pitch
const PAD = 24;

/**
 * Dependency tree, left to right. Each column is one layer of the chain: a task sits one column
 * to the right of its latest open blocker. Tasks in the same column run in parallel.
 * When a task has several blockers, their lines join at one junction dot, then one line enters the task.
 * Amber frame: critical path. Red border: blocked. Closed tasks are hidden.
 */
export function DependencyTree({
  baseHref,
  tasks,
  members,
  schedule,
}: {
  /** Page the task popup opens on, e.g. /projects/x/dashboard?tab=timeline */
  baseHref: string;
  tasks: Task[];
  members: Member[];
  schedule: DependencySchedule;
}) {
  const open = tasks.filter((t) => !isClosed(t) && schedule.plans.has(t.id));
  if (open.length === 0) return null;

  const byId = new Map(open.map((t) => [t.id, t]));
  const openBlockers = (t: Task) => t.blockedBy.filter((d) => byId.has(d));
  const roleRank = (t: Task) => {
    const role = members.find((m) => m.id === t.picId)?.role;
    const i = role ? ROLE_ORDER.indexOf(role) : ROLE_ORDER.length;
    return i === -1 ? ROLE_ORDER.length : i;
  };

  // Layer = longest chain of open blockers before the task
  const layer = new Map<string, number>();
  const layerOf = (id: string): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    const ps = openBlockers(byId.get(id)!);
    const l = ps.length ? Math.max(...ps.map(layerOf)) + 1 : 0;
    layer.set(id, l);
    return l;
  };
  open.forEach((t) => layerOf(t.id));

  const columns = new Map<number, Task[]>();
  for (const t of open) {
    const l = layer.get(t.id)!;
    columns.set(l, [...(columns.get(l) ?? []), t]);
  }
  const layers = [...columns.keys()].sort((a, b) => a - b);
  const maxN = Math.max(...layers.map((l) => columns.get(l)!.length));

  // Position: each column is centred vertically
  const pos = new Map<string, { x: number; y: number }>();
  for (const l of layers) {
    const items = columns.get(l)!.sort((a, b) => roleRank(a) - roleRank(b) || a.code.localeCompare(b.code));
    const offset = ((maxN - items.length) * GY) / 2;
    items.forEach((t, i) => pos.set(t.id, { x: PAD + l * GX, y: PAD + offset + i * GY }));
  }

  const W = PAD * 2 + layers[layers.length - 1] * GX + NW;
  const H = PAD * 2 + (maxN - 1) * GY + NH;
  const critical = (id: string) => schedule.plans.get(id)?.critical ?? false;

  // Edges
  const edges: ReactNode[] = [];
  open.forEach((t) => {
    const ps = openBlockers(t);
    if (ps.length === 0) return;
    const tp = pos.get(t.id)!;
    const tx = tp.x;
    const ty = tp.y + NH / 2;

    if (ps.length === 1) {
      const q = pos.get(ps[0])!;
      const x1 = q.x + NW;
      const y1 = q.y + NH / 2;
      const mx = (x1 + tx) / 2;
      const hot = critical(ps[0]) && critical(t.id);
      edges.push(
        <path
          key={`e-${t.id}`}
          d={`M${x1} ${y1} C ${mx} ${y1}, ${mx} ${ty}, ${tx} ${ty}`}
          fill="none"
          stroke={hot ? '#f5a524' : '#9ca3af'}
          strokeWidth={hot ? 2.5 : 1.5}
        />,
      );
      return;
    }

    // Several blockers: their lines meet at one junction, then one line goes into the task
    const rightEdge = Math.max(...ps.map((d) => pos.get(d)!.x + NW));
    const jx = (rightEdge + tx) / 2;
    const ys = ps.map((d) => pos.get(d)!.y + NH / 2);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const jy = (yMin + yMax) / 2;
    ps.forEach((d, i) => {
      edges.push(
        <path key={`b-${t.id}-${d}`} d={`M${pos.get(d)!.x + NW} ${ys[i]} L${jx} ${ys[i]}`} fill="none" stroke="#9ca3af" strokeWidth={1.5} />,
      );
    });
    edges.push(<path key={`j-${t.id}`} d={`M${jx} ${yMin} L${jx} ${yMax}`} fill="none" stroke="#9ca3af" strokeWidth={2} />);
    edges.push(<path key={`o-${t.id}`} d={`M${jx} ${jy} L${tx} ${ty}`} fill="none" stroke="#9ca3af" strokeWidth={1.5} />);
    edges.push(<circle key={`c-${t.id}`} cx={jx} cy={jy} r={3.5} fill="#6b7280" />);
  });

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>Dependency tree · left to right</h3>
      <div style={{ overflow: 'auto', padding: '8px 0', border: '1px solid var(--line)', borderRadius: 10, background: '#fff' }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Dependency tree">
          {edges}
          {open.map((t) => {
            const q = pos.get(t.id)!;
            const colour = colourOf(members, t.picId);
            const pic = members.find((m) => m.id === t.picId);
            const owner = pic ? memberLabel(pic) : 'Unassigned';
            const late = schedule.plans.get(t.id)?.late ?? false;
            const lateWd = schedule.plans.get(t.id)?.lateWd ?? 0;
            const name = t.name.length > 24 ? `${t.name.slice(0, 23)}…` : t.name;
            return (
              <SvgLink key={t.id} href={taskLink(baseHref, t.id)}>
                <g style={{ cursor: 'pointer' }}>
                  {critical(t.id) && (
                    <rect x={q.x - 3} y={q.y - 3} width={NW + 6} height={NH + 6} rx={10} fill="none" stroke="#f5a524" strokeWidth={1.5} />
                  )}
                  <rect
                    x={q.x}
                    y={q.y}
                    width={NW}
                    height={NH}
                    rx={8}
                    fill={late ? '#FCEBEB' : `${colour}1a`}
                    stroke={late ? '#E24B4A' : t.blocked ? '#e5484d' : colour}
                    strokeWidth={late || t.blocked ? 2.5 : 1.5}
                  />
                  <text x={q.x + 10} y={q.y + 18} fontSize={11} fontWeight={700} fill="#374151">
                    {t.code} · {t.duration}d
                  </text>
                  {/* One flame per struggle. Solved flames get a diagonal strike-through. */}
                  {t.issues.map((issue, idx) => {
                    // Read left to right in the same order as the Gantt: the first struggle is on the left
                    const fx = q.x + NW - 14 - (t.issues.length - 1 - idx) * 17;
                    const fy = q.y + 18;
                    return (
                      <g key={issue.id}>
                        <circle cx={fx} cy={fy - 4} r={8} fill="#fff" stroke="rgba(0,0,0,.15)" />
                        <text x={fx} y={fy} fontSize={13} textAnchor="middle">
                          🔥
                        </text>
                        {issue.solvedAt && (
                          <line x1={fx - 7} y1={fy + 3} x2={fx + 7} y2={fy - 11} stroke="#111827" strokeWidth={2} />
                        )}
                      </g>
                    );
                  })}
                  <text x={q.x + 10} y={q.y + 34} fontSize={12} fontWeight={600} fill="#1d2330">
                    {name}
                  </text>
                  <text x={q.x + 10} y={q.y + 49} fontSize={10} fill="#6b7280">
                    {owner} · {t.environment}
                  </text>
                  {/* Late pill sits on the bottom edge, clear of the flames at the top right */}
                  {late && (
                    <g>
                      <rect x={q.x + 10} y={q.y + NH - 8} width={78} height={16} rx={8} fill="#E24B4A" />
                      <text x={q.x + 49} y={q.y + NH + 3} fontSize={9} fontWeight={700} fill="#fff" textAnchor="middle">
                        Late +{lateWd} wd
                      </text>
                    </g>
                  )}
                </g>
              </SvgLink>
            );
          })}
        </svg>
      </div>
      <p className="note">
        Parallel tasks sit side by side in the same column. Where several tasks feed one task, their lines join at a single junction before the next task. Amber frame: critical path. Red border: has an open struggle. 🔥 One flame per struggle, crossed out when solved. Closed tasks are hidden. Click a task to open its detail.
      </p>
    </div>
  );
}
