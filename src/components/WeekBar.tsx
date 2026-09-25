import { Icon } from './Icon';
import { addDays, DAY_NAMES, startOfWeek, today, weekLabel } from '../lib/dates';
import { weekInfo } from '../lib/hebrew';

type Props = { weekStart: Date; onChange: (d: Date) => void; allowFuture?: boolean };

export function WeekBar({ weekStart, onChange, allowFuture = false }: Props) {
  const current = startOfWeek(today());
  const isCurrent = weekStart.getTime() === current.getTime();
  const info = weekInfo(weekStart);
  const nextDisabled = !allowFuture && weekStart.getTime() >= current.getTime();
  return (
    <div className="weekbar">
      <div className="switcher">
        <button type="button" aria-label="השבוע הקודם" onClick={() => onChange(addDays(weekStart, -7))}>
          <Icon name="prev" stroke={2.5} />
        </button>
        <button type="button" className="label" onClick={() => onChange(current)} aria-label="חזרה לשבוע הנוכחי">
          <b className={info.isChag ? 'chag' : ''}>{info.title}</b>
          <span>
            {weekLabel(weekStart)} · {info.hebRange}
          </span>
          {isCurrent && <em>השבוע</em>}
        </button>
        <button type="button" aria-label="השבוע הבא" disabled={nextDisabled} onClick={() => onChange(addDays(weekStart, 7))}>
          <Icon name="next" stroke={2.5} />
        </button>
      </div>
      {info.notes.length > 0 && (
        <div className="week-notes">
          {info.notes.map((n) => (
            <span key={n.name + n.day} className={n.chag ? 'chag' : ''}>
              {DAY_NAMES[n.day]} · {n.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
