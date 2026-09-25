import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toast';
import { WeekBar } from '../components/WeekBar';
import { addMethod, incomeByDay, incomeForDay, listMethods, saveIncomeDay, weekDays, type Method } from '../db/ops';
import { DAY_NAMES, DAY_SHORT, fromIso, iso, startOfWeek, today } from '../lib/dates';
import { dayEvents, hebDay, hebDayMonth } from '../lib/hebrew';
import { parseAmount, shekel } from '../lib/money';
import { useBack } from '../components/useBack';

const TONES = [
  { bg: 'var(--green-soft)', fg: 'var(--green)', icon: 'cash' },
  { bg: 'var(--blue-soft)', fg: 'var(--blue)', icon: 'card' },
  { bg: 'var(--chip)', fg: 'var(--ink2)', icon: 'dots' },
];

function fmtInput(n: number) {
  return n ? String(Number(n.toFixed(2))) : '';
}

export function Income() {
  const [params, setParams] = useSearchParams();
  const back = useBack();
  const date = params.get('date') ?? iso(today());
  const day = fromIso(date);
  const weekStart = useMemo(() => startOfWeek(day), [date]);
  const [methods, setMethods] = useState<Method[]>([]);
  const [values, setValues] = useState<Record<number, string>>({});
  const [week, setWeek] = useState<Map<string, number>>(new Map());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadWeek = useCallback(async () => {
    const days = weekDays(weekStart);
    setWeek(await incomeByDay(days[0], days[6]));
  }, [weekStart]);

  useEffect(() => {
    (async () => {
      const [ms, amounts] = await Promise.all([listMethods(), incomeForDay(date)]);
      setMethods(ms);
      setValues(Object.fromEntries(ms.map((m) => [m.id, fmtInput(amounts.get(m.id) ?? 0)])));
      setDirty(false);
    })();
  }, [date]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  const dayTotal = methods.reduce((s, m) => s + parseAmount(values[m.id] ?? ''), 0);
  const savedToday = week.get(date) ?? 0;
  const liveWeek = new Map(week);
  liveWeek.set(date, dayTotal);
  const weekTotal = [...liveWeek.values()].reduce((a, b) => a + b, 0);
  const maxDay = Math.max(1, ...liveWeek.values());

  async function persist() {
    const m = new Map<number, number>();
    for (const x of methods) m.set(x.id, parseAmount(values[x.id] ?? ''));
    await saveIncomeDay(date, m);
    setDirty(false);
    await loadWeek();
  }

  async function pick(d: string) {
    if (d === date) return;
    if (dirty) await persist();
    const p = new URLSearchParams(params);
    p.set('date', d);
    setParams(p, { replace: true });
  }

  async function save() {
    setSaving(true);
    try {
      await persist();
      toast(`נשמר: ${shekel(dayTotal)} ליום ${DAY_NAMES[day.getDay()]}`);
    } catch (e) {
      console.error(e);
      toast('השמירה נכשלה');
    }
    setSaving(false);
  }

  async function newMethod() {
    const name = window.prompt('שם אמצעי התשלום (למשל: ביט, צ׳ק)');
    if (!name?.trim()) return;
    await addMethod(name);
    const ms = await listMethods();
    setMethods(ms);
  }

  const events = dayEvents(day);
  const days = weekDays(weekStart);

  return (
    <>
      <header className="bar">
        <button
          type="button"
          className="icon-btn"
          aria-label="חזרה"
          onClick={async () => {
            if (dirty) await persist();
            back();
          }}
        >
          <Icon name="back" />
        </button>
        <h1 className="page-title" style={{ flex: 1 }}>הכנסה יומית</h1>
      </header>

      <div className="pad" style={{ marginBottom: 10 }}>
        <WeekBar
          weekStart={weekStart}
          onChange={(w) => {
            const t = today();
            pick(startOfWeek(t).getTime() === w.getTime() ? iso(t) : iso(w));
          }}
        />
      </div>

      <div className="days">
        {days.map((d, i) => {
          const dd = fromIso(d);
          const chag = dayEvents(dd).some((e) => e.chag);
          const cls = ['day', d === date ? 'on' : '', chag ? 'chag' : '', i === 6 ? 'sat' : ''].join(' ');
          return (
            <button key={d} type="button" className={cls} onClick={() => pick(d)} aria-pressed={d === date} aria-label={`${DAY_NAMES[i]} ${dd.getDate()}`}>
              <b>{DAY_SHORT[i]}</b>
              <span className="g">{dd.getDate()}</span>
              <span className="h">{hebDay(dd)}</span>
              <span className={`mark${(liveWeek.get(d) ?? 0) > 0 ? ' has' : ''}`} />
            </button>
          );
        })}
      </div>

      <section className="box" style={{ margin: '12px 16px 0', padding: 16, gap: 12 }}>
        <div className="day-title">
          <h2>
            יום {DAY_NAMES[day.getDay()]}, {day.getDate()}.{day.getMonth() + 1}
          </h2>
          <span>{hebDayMonth(day)}</span>
        </div>
        {events.length > 0 && (
          <div className="week-notes" style={{ justifyContent: 'flex-start' }}>
            {events.map((e) => (
              <span key={e.name} className={e.chag ? 'chag' : ''}>{e.name}</span>
            ))}
          </div>
        )}
        {methods.map((m, i) => {
          const t = TONES[Math.min(i, TONES.length - 1)];
          return (
            <label key={m.id} className="pay-row">
              <span className="ic" style={{ background: t.bg, color: t.fg }}>
                <Icon name={t.icon} />
              </span>
              <span className="nm">{m.name}</span>
              <span className="money-in">
                <input
                  inputMode="decimal"
                  placeholder="0"
                  value={values[m.id] ?? ''}
                  onChange={(e) => {
                    setValues((v) => ({ ...v, [m.id]: e.target.value }));
                    setDirty(true);
                  }}
                />
                <span>₪</span>
              </span>
            </label>
          );
        })}
        <button type="button" className="dashed-btn" onClick={newMethod}>+ אמצעי תשלום נוסף</button>
        <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink2)' }}>סה״כ היום</span>
          <span style={{ fontFamily: 'var(--display)', fontSize: 32 }}>{shekel(dayTotal)}</span>
        </div>
        {dirty && savedToday !== dayTotal && <span className="hint">יש שינויים שעוד לא נשמרו</span>}
      </section>

      <section className="box" style={{ margin: '12px 16px 0', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 style={{ fontSize: 18, fontWeight: 800 }}>השבוע עד עכשיו</h2>
          <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--primary)' }}>{shekel(weekTotal)}</span>
        </div>
        <div className="bars">
          {days.map((d, i) => {
            const v = liveWeek.get(d) ?? 0;
            return (
              <div key={d} className={`bar-row${d === date ? ' on' : ''}`}>
                <span className="d">{DAY_SHORT[i]}</span>
                <span className="track">
                  {v > 0 && <span className="fill" style={{ width: `${Math.max(2, (v / maxDay) * 100)}%` }} />}
                </span>
                <span className="v">{v > 0 ? shekel(v) : '—'}</span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="sticky-save">
        <button type="button" className="btn" onClick={save} disabled={saving}>
          {saving ? 'שומר…' : 'שמירה'}
        </button>
      </div>
    </>
  );
}
