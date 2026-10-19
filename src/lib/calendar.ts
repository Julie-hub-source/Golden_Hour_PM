/**
 * Working-day calendar. Monday to Friday, no public holidays.
 * Dates are plain 'YYYY-MM-DD' strings. All arithmetic runs on UTC day numbers,
 * so the server timezone never changes a result.
 */

export const PROJECT_TIMEZONE = 'Asia/Ho_Chi_Minh';

const MS_PER_DAY = 86_400_000;
/** Monday 2000-01-03, used as the origin for working-day numbering. */
const EPOCH_DAY = Date.UTC(2000, 0, 3) / MS_PER_DAY;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Calendar day number (days since 1970-01-01) of an ISO date. */
function dayNumber(iso: string): number {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`Not an ISO date: ${iso}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / MS_PER_DAY;
}

function fromDayNumber(n: number): string {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  if (!ISO_RE.test(value)) return false;
  const d = new Date(dayNumber(value) * MS_PER_DAY);
  return d.toISOString().slice(0, 10) === value;
}

export function addDays(iso: string, days: number): string {
  return fromDayNumber(dayNumber(iso) + days);
}

/** Calendar days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

export function isWeekend(iso: string): boolean {
  const dow = mod(dayNumber(iso) - EPOCH_DAY, 7); // 0 = Monday
  return dow >= 5;
}

/**
 * Number of working days in [epoch, iso). Differences of this value give
 * working-day counts between two dates. It is a monotone step function.
 */
function workNumber(iso: string): number {
  const d = dayNumber(iso) - EPOCH_DAY;
  return Math.floor(d / 7) * 5 + Math.min(mod(d, 7), 5);
}

/** Working-day index of a date relative to a start date. Weekends map to the next working day. */
export function workIndex(startIso: string, iso: string): number {
  return workNumber(iso) - workNumber(startIso);
}

/** Calendar date of working day `k` counted from `startIso` (index 0 = first working day on/after start). */
export function workdayDate(startIso: string, k: number): string {
  const n = workNumber(startIso) + k;
  const weeks = Math.floor(n / 5);
  const r = mod(n, 5);
  return fromDayNumber(EPOCH_DAY + weeks * 7 + r);
}

/**
 * Working days in the half-open range (from, to]. Used for "N working days past"
 * and "N working days since". Returns a negative number if `to` is before `from`.
 */
export function workdaysAfter(from: string, to: string): number {
  return workNumber(addDays(to, 1)) - workNumber(addDays(from, 1));
}

/** Signed working-day distance from a to b (b - a), counting working days that fall in [a, b). */
export function workdaysBetween(a: string, b: string): number {
  return workNumber(b) - workNumber(a);
}

/** Today in the project timezone (Asia/Ho_Chi_Minh). */
export function todayIso(now: Date = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PROJECT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Parse user input as a calendar date. Accepts D/M/YYYY (no zero padding needed), with or without a
 * weekday prefix, and ISO yyyy-mm-dd. Returns null when the input is not a real date.
 */
export function parseDateInput(input: string): string | null {
  const s = input.trim().replace(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*\s+/i, '');
  if (ISO_RE.test(s)) return isIsoDate(s) ? s : null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const day = +m[1];
  const month = +m[2];
  const year = +m[3];
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}

/**
 * Display format used everywhere in the app: English weekday + D/M/YYYY, no zero padding,
 * e.g. "Tue 1/1/2027". parseDateInput accepts the same text back.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${weekdayShort(iso)} ${d}/${m}/${y}`;
}

export function weekdayShort(iso: string): string {
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][mod(dayNumber(iso) - EPOCH_DAY, 7)];
}
