import 'server-only';
import { cookies } from 'next/headers';
import { todayIso } from './calendar';
import type { Status, Task } from './types';

/**
 * Test clock: pretend today is another date, to try the app without waiting. Only a status change can be
 * made while it is on, and it is kept in this cookie, not the database. The cookie has no expiry date, so
 * it ends when the browser session ends. A new tab turns it off (see TestClock); a reload keeps it.
 */
export const CLOCK_COOKIE = 'golden_test_clock';
export const MAX_CLOCK_CHANGES = 40;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface TestClock {
  /** The pretended today, YYYY-MM-DD. */
  date: string;
  /** Status changes made while the clock is on, by task id. */
  statuses: Record<string, Status>;
}

/** The test clock for this browser, or null in real time. Also null outside a request (e.g. the daily cron). */
export async function readTestClock(): Promise<TestClock | null> {
  try {
    const raw = (await cookies()).get(CLOCK_COOKIE)?.value;
    if (!raw) return null;
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<TestClock>;
    if (typeof parsed.date !== 'string' || !ISO.test(parsed.date)) return null;
    return { date: parsed.date, statuses: parsed.statuses ?? {} };
  } catch {
    return null;
  }
}

/** Today for this browser: the test date when the clock is on, otherwise the real date. */
export async function clockToday(): Promise<string> {
  return (await readTestClock())?.date ?? todayIso();
}

export async function writeTestClock(clock: TestClock | null): Promise<void> {
  const jar = await cookies();
  if (!clock) {
    jar.delete(CLOCK_COOKIE);
    return;
  }
  jar.set(CLOCK_COOKIE, encodeURIComponent(JSON.stringify(clock)), { path: '/', sameSite: 'lax', httpOnly: true });
}

/** Tasks with their test-clock status. A changed task is dated to the test date, as a real status change would be. */
export function applyTestClock(tasks: Task[], clock: TestClock): Task[] {
  return tasks.map((t) => {
    const status = clock.statuses[t.id];
    if (!status) return t;
    // Closing a task solves its struggles, as the real change does
    const issues = status === 'closed' ? t.issues.map((i) => (i.solvedAt ? i : { ...i, solvedAt: clock.date })) : t.issues;
    return { ...t, status, sinceDate: clock.date, issues, blocked: issues.some((i) => !i.solvedAt) };
  });
}
