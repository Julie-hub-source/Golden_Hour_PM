import 'server-only';
import { cookies } from 'next/headers';
import { loadMembers } from './repo';
import { toActor, type Actor } from './permissions';
import type { Member } from './types';

/**
 * No authentication in this phase (CLAUDE.md section 2). The header switcher stores the chosen
 * member id in this cookie. When real login arrives, replace `currentAccount` only.
 */
export const ACCOUNT_COOKIE = 'pulse_account';

export async function currentAccount(): Promise<{ actor: Actor | null; members: Member[] }> {
  const members = await loadMembers();
  const jar = await cookies();
  const chosen = jar.get(ACCOUNT_COOKIE)?.value;
  // Default to the first PM so the demo always has someone who can act
  const member = members.find((m) => m.id === chosen) ?? members.find((m) => m.role === 'PM') ?? members[0] ?? null;
  return { actor: toActor(member), members };
}
