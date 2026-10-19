/** Colours from the prototype, assigned by team order so each person keeps one colour across views. */
export const COLORS = ['#3b6cf6', '#2fa36b', '#f5a524', '#e5484d', '#8b5cf6', '#0ea5e9', '#ec4899', '#14b8a6', '#84cc16', '#6366f1'];

export function colourOf(members: { id: string }[], id: string | null): string {
  if (!id) return '#9ca3af';
  const i = members.findIndex((m) => m.id === id);
  return COLORS[(i < 0 ? 0 : i) % COLORS.length];
}
