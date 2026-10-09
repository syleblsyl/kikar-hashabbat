import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { MonthBar } from './MonthBar';
import { incomeByDay } from '../db/ops';
import { monthRange } from '../db/repo';
import { DAY_NAMES, DAY_SHORT, fromIso, iso, nextFriday, prevFriday, sellingDay, startOfWeek } from '../lib/dates';
import { dayEvents, hebDay, hebDayMonth, weekInfo } from '../lib/hebrew';

type Props = { date: string; onPick: (date: string) => void };

/**
 * Which selling day: arrows move a week (Friday to Friday); tapping the date opens the month,
 * where any day can be chosen (a holiday eve, for example).
 */
export function SellingDayBar({ date, onPick }: Props) {
  const d = fromIso(date);
  const max = iso(sellingDay());
  const [open, setOpen] = useState(false);
  const [ym, setYm] = useState({ y: d.getFullYear(), m: d.getMonth() });
  const [marks, setMarks] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    setYm({ y: d.getFullYear(), m: d.getMonth() });
  }, [date]);

  useEffect(() => {
    if (!open) return;
    const { from, to } = monthRange(ym.y, ym.m);
    incomeByDay(from, to).then(setMarks);
  }, [open, ym.y, ym.m, date]);

  const isFriday = d.getDay() === 5;
  const title = isFriday ? weekInfo(startOfWeek(d)).title : dayEvents(d).map((e) => e.name).join(', ');
  const next = iso(nextFriday(d));
  const first = new Date(ym.y, ym.m, 1);
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => iso(new Date(ym.y, ym.m, i + 1))),
  ];

  return (
    <>
      <div className="pad" style={{ marginBottom: 12 }}>
        <div className="switcher">
          <button type="button" aria-label="השבוע הקודם" onClick={() => onPick(iso(prevFriday(d)))}>
            <Icon name="prev" stroke={2.5} />
          </button>
          <button type="button" className="label" onClick={() => setOpen((x) => !x)} aria-expanded={open} aria-label="בחירת יום בלוח">
            <b>
              {isFriday ? 'שישי' : `יום ${DAY_NAMES[d.getDay()]}`} {d.getDate()}.{d.getMonth() + 1}
            </b>
            <span>
              {hebDayMonth(d)}
              {title ? ` · ${title}` : ''}
            </span>
            {date === max ? <em>השבוע</em> : <em className="cal-tag">{open ? 'סגירת הלוח' : 'לוח'}</em>}
          </button>
          <button type="button" aria-label="השבוע הבא" disabled={next > max} onClick={() => onPick(next)}>
            <Icon name="next" stroke={2.5} />
          </button>
        </div>
      </div>

      {open && (
        <section className="income-cal">
          <div className="pad" style={{ marginBottom: 8 }}>
            <MonthBar ym={ym} onChange={setYm} />
          </div>
          <div className="cal" role="grid" aria-label="ימי החודש">
            {DAY_SHORT.map((x) => (
              <span key={x} className="cal-h">{x}</span>
            ))}
            {cells.map((c, i) => {
              if (!c) return <span key={`b${i}`} />;
              const dd = fromIso(c);
              const chag = dayEvents(dd).some((e) => e.chag);
              const v = marks.get(c) ?? 0;
              const future = c > max;
              const cls = ['cal-d', c === date ? 'on' : '', chag ? 'chag' : '', dd.getDay() === 6 ? 'sat' : '', dd.getDay() === 5 ? 'fri' : '', future ? 'future' : ''].join(' ');
              return (
                <button
                  key={c}
                  type="button"
                  className={cls}
                  disabled={future}
                  onClick={() => {
                    onPick(c);
                    setOpen(false);
                  }}
                  aria-pressed={c === date}
                  aria-label={`${DAY_NAMES[dd.getDay()]} ${dd.getDate()}${v > 0 ? `, ${Math.round(v)} שקלים` : ''}`}
                >
                  <b>{dd.getDate()}</b>
                  <span className="h">{hebDay(dd)}</span>
                  <span className={`mark${v > 0 ? ' has' : ''}`} />
                </button>
              );
            })}
          </div>
          <p className="hint" style={{ margin: '6px 16px 0', textAlign: 'center' }}>
            בוחרים את היום עצמו (שישי, או ערב חג). הליל שלפניו נרשם יחד איתו.
          </p>
        </section>
      )}
    </>
  );
}
