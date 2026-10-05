export const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const DAY_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
export const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

export function today(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + days);
  return x;
}

/** Weeks run Sunday to Saturday. */
export function startOfWeek(d: Date): Date {
  return addDays(d, -d.getDay());
}

export function iso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** A valid yyyy-mm-dd string (real calendar date), else null. Used for dates that come from links. */
export function parseIso(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = fromIso(s);
  if (Number.isNaN(d.getTime()) || iso(d) !== s) return null;
  const y = d.getFullYear();
  return y >= 2000 && y <= 2100 ? d : null;
}

export function fromIso(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function longDate(d: Date): string {
  return `יום ${DAY_NAMES[d.getDay()]}, ${d.getDate()} ב${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function shortDate(d: Date): string {
  return `${DAY_SHORT[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}`;
}

export function weekLabel(start: Date): string {
  const end = addDays(start, 6);
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()}–${end.getDate()} ב${MONTHS[start.getMonth()]}`;
  }
  return `${start.getDate()} ב${MONTHS[start.getMonth()]} – ${end.getDate()} ב${MONTHS[end.getMonth()]}`;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/* ---------- months as "yyyy-mm" ---------- */

export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
/** "2026-09-30" → "2026-09" */
export const monthOf = (isoDate: string) => isoDate.slice(0, 7);
export function addMonthKey(m: string, n: number): string {
  const [y, mo] = m.split('-').map(Number);
  return monthKey(new Date(y, mo - 1 + n, 1));
}
export const thisMonthKey = () => monthKey(today());
/** "2026-09" → "ספטמבר" (with the year when it is not this year, or when asked) */
export function monthName(m: string, withYear = false): string {
  const [y, mo] = m.split('-').map(Number);
  return `${MONTHS[mo - 1]}${withYear || y !== today().getFullYear() ? ` ${y}` : ''}`;
}
export function monthFirst(m: string): string {
  return `${m}-01`;
}
export function monthLast(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return iso(new Date(y, mo, 0));
}
/** "d.m" for short lists */
export const dm = (s: string) => {
  const d = fromIso(s);
  return `${d.getDate()}.${d.getMonth() + 1}`;
};
