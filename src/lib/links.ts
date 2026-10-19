/**
 * Link to a task's detail popup. The popup opens on the page at `base`, so the user stays where they were.
 * The parameter is `open` (not `task`), because the What-if form already uses `task` to pick a task.
 */
export function taskLink(base: string, taskId: string): string {
  return `${base}${base.includes('?') ? '&' : '?'}open=${taskId}`;
}
