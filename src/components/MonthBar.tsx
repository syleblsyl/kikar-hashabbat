import { Icon } from './Icon';
import { MONTHS, today } from '../lib/dates';
import { hebMonthsOf } from '../lib/hebrew';

export type YM = { y: number; m: number };

export const thisMonth = (): YM => {
  const t = today();
  return { y: t.getFullYear(), m: t.getMonth() };
};
export const sameYM = (a: YM, b: YM) => a.y === b.y && a.m === b.m;
export const addMonths = (a: YM, n: number): YM => {
  const d = new Date(a.y, a.m + n, 1);
  return { y: d.getFullYear(), m: d.getMonth() };
};
/** "2026-10" ⇄ {y, m}; a bad value gives null */
export const ymKey = (a: YM) => `${a.y}-${String(a.m + 1).padStart(2, '0')}`;
export function parseYM(s: string | null | undefined): YM | null {
  const m = /^(\d{4})-(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return y >= 2000 && y <= 2100 && mo >= 0 && mo <= 11 ? { y, m: mo } : null;
}

type Props = {
  ym: YM;
  onChange: (ym: YM) => void;
  /** the month a tap on the label goes back to, and that gets the tag (default: this month) */
  anchor?: YM;
  /** text of the tag on the anchor month (default "החודש") */
  tag?: string;
};

/** Month switcher: Gregorian month with the Hebrew months it covers. */
export function MonthBar({ ym, onChange, anchor, tag = 'החודש' }: Props) {
  const now = thisMonth();
  const home = anchor ?? now;
  const isCurrent = sameYM(ym, home);
  const future = ym.y > now.y || (ym.y === now.y && ym.m >= now.m);
  return (
    <div className="switcher">
      <button type="button" aria-label="החודש הקודם" onClick={() => onChange(addMonths(ym, -1))}>
        <Icon name="prev" stroke={2.5} />
      </button>
      <button type="button" className="label" onClick={() => onChange(home)} aria-label={anchor ? `חזרה ל${MONTHS[home.m]}` : 'חזרה לחודש הנוכחי'}>
        <b>
          {MONTHS[ym.m]} {ym.y}
        </b>
        <span>{hebMonthsOf(ym.y, ym.m)}</span>
        {isCurrent && <em>{tag}</em>}
      </button>
      <button type="button" aria-label="החודש הבא" disabled={future} onClick={() => onChange(addMonths(ym, 1))}>
        <Icon name="next" stroke={2.5} />
      </button>
    </div>
  );
}
