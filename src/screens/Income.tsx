import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ask, askText } from '../components/Dialog';
import { useLeaveGuard } from '../components/guard';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toast';
import { WeekBar } from '../components/WeekBar';
import { addMethod, incomeByDay, incomeForDay, listMethods, methodsForDay, saveIncomeDay, weekDays, type Method } from '../db/ops';
import { DAY_NAMES, DAY_SHORT, fromIso, iso, parseIso, startOfWeek, today } from '../lib/dates';
import { dayEvents, hebDay, hebDayMonth } from '../lib/hebrew';
import { parseAmountStrict, shekelSmart } from '../lib/money';
import { useBack } from '../components/useBack';
import { weekSummary, type WeekSummary } from '../db/repo';

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
  const date = iso(parseIso(params.get('date')) ?? today());
  const day = fromIso(date);
  const weekStart = useMemo(() => startOfWeek(fromIso(date)), [date]);
  const [methods, setMethods] = useState<Method[]>([]);
  const [values, setValues] = useState<Record<number, string>>({});
  const [week, setWeek] = useState<Map<string, number>>(new Map());
  const [dirty, setDirty] = useState(false);
  const [wk, setWk] = useState<WeekSummary | null>(null);
  const [saving, setSaving] = useState(false);

  const loadWeek = useCallback(async () => {
    const days = weekDays(weekStart);
    const [byDay, summary] = await Promise.all([incomeByDay(days[0], days[6]), weekSummary(weekStart)]);
    setWeek(byDay);
    setWk(summary);
  }, [weekStart]);

  useEffect(() => {
    (async () => {
      const [ms, amounts] = await Promise.all([methodsForDay(date), incomeForDay(date)]);
      setMethods(ms);
      setValues(Object.fromEntries(ms.map((m) => [m.id, fmtInput(amounts.get(m.id) ?? 0)])));
      setDirty(false);
    })();
  }, [date]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  const parsed = new Map(methods.map((m) => [m.id, parseAmountStrict(values[m.id] ?? '')]));
  const invalid = methods.filter((m) => parsed.get(m.id) === null);
  const dayTotal = methods.reduce((s, m) => s + (parsed.get(m.id) ?? 0), 0);
  const liveWeek = new Map(week);
  liveWeek.set(date, dayTotal);
  const weekTotal = [...liveWeek.values()].reduce((a, b) => a + b, 0);
  const maxDay = Math.max(1, ...liveWeek.values());

  /** Saves the day. Returns false (and says why) if an amount is not a valid number. */
  async function persist(): Promise<boolean> {
    if (invalid.length > 0) {
      toast(`הסכום ב${invalid[0].name} לא תקין. כותבים רק מספר, למשל 350 או 12.50`, 'err');
      return false;
    }
    const m = new Map<number, number>();
    for (const x of methods) m.set(x.id, parsed.get(x.id) ?? 0);
    await saveIncomeDay(date, m);
    setDirty(false);
    await loadWeek();
    return true;
  }

  // leaving the screen saves what was typed (like switching days); a bad amount asks first
  useLeaveGuard(dirty, async () => {
    if (invalid.length === 0) {
      try {
        return await persist();
      } catch {
        return ask({ title: 'השמירה נכשלה', text: 'לצאת בלי לשמור?', ok: 'לצאת בלי לשמור', cancel: 'להישאר', danger: true });
      }
    }
    return ask({
      title: 'יש סכום לא תקין',
      text: `הסכום ב${invalid[0].name} לא מספר, ולכן היום לא נשמר. לצאת בלי לשמור?`,
      ok: 'לצאת בלי לשמור',
      cancel: 'להישאר ולתקן',
      danger: true,
    });
  });

  async function pick(d: string) {
    if (d === date) return;
    if (dirty && !(await persist())) return;
    const p = new URLSearchParams(params);
    p.set('date', d);
    setParams(p, { replace: true });
  }

  async function save() {
    setSaving(true);
    try {
      if (await persist()) toast(`נשמר: ${shekelSmart(dayTotal)} ליום ${DAY_NAMES[day.getDay()]}`);
    } catch (e) {
      console.error(e);
      toast('השמירה נכשלה. נסה שוב.', 'err');
    }
    setSaving(false);
  }

  async function newMethod() {
    const name = await askText({ title: 'אמצעי תשלום חדש', placeholder: 'למשל: ביט, צ׳ק', ok: 'הוספה' });
    if (!name) return;
    const all = await listMethods(true);
    if (all.some((m) => m.name.trim() === name)) {
      toast(`"${name}" כבר קיים. אפשר להחזיר אותו בהגדרות ← אמצעי תשלום`, 'err');
      return;
    }
    await addMethod(name);
    const ms = await methodsForDay(date);
    setMethods(ms);
  }

  const events = dayEvents(day);
  const days = weekDays(weekStart);

  return (
    <>
      <header className="bar">
        <button type="button" className="icon-btn" aria-label="חזרה" onClick={() => back()}>
          <Icon name="back" />
        </button>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <h1 className="page-title">הכנסה יומית</h1>
          <span className="sub" style={{ fontSize: 14 }}>ברוטו – כל מה שנכנס לקופה, לפני תשלום לסוכנים</span>
        </div>
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
          const bad = parsed.get(m.id) === null;
          return (
            <div key={m.id}>
              <label className="pay-row">
                <span className="ic" style={{ background: t.bg, color: t.fg }}>
                  <Icon name={t.icon} />
                </span>
                <span className="nm">
                  {m.name}
                  {!m.active && <small className="muted-tag">מוסתר</small>}
                </span>
                <span className={`money-in${bad ? ' bad' : ''}`}>
                  <input
                    inputMode="decimal"
                    enterKeyHint="next"
                    placeholder="0"
                    aria-invalid={bad}
                    value={values[m.id] ?? ''}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => {
                      setValues((v) => ({ ...v, [m.id]: e.target.value }));
                      setDirty(true);
                    }}
                  />
                  <span>₪</span>
                </span>
              </label>
              {bad && <div className="field-err">כותבים רק מספר, למשל 350 או 12.50</div>}
            </div>
          );
        })}
        <button type="button" className="dashed-btn" onClick={newMethod}>
          <Icon name="plus" size={18} /> אמצעי תשלום נוסף
        </button>
        <div className="day-total">
          <span>סה״כ היום</span>
          <b>{shekelSmart(dayTotal)}</b>
        </div>
      </section>

      <section className="box" style={{ margin: '12px 16px 0', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 style={{ fontSize: 18, fontWeight: 800 }}>הכנסות השבוע (ברוטו)</h2>
          <span className="nowrap" style={{ fontSize: 22, fontWeight: 800, color: 'var(--primary)' }}>{shekelSmart(weekTotal)}</span>
        </div>
        <div className="bars">
          {days.map((d, i) => {
            const v = liveWeek.get(d) ?? 0;
            return (
              <div key={d} className={`bar-row${d === date ? ' on' : ''}`}>
                <span className="d">{DAY_SHORT[i]}</span>
                <span className="track">{v > 0 && <span className="fill" style={{ width: `${Math.max(2, (v / maxDay) * 100)}%` }} />}</span>
                <span className="v">{v > 0 ? shekelSmart(v) : '—'}</span>
              </div>
            );
          })}
        </div>
      </section>

      {wk && (
        <section className="box net-box">
          <div>
            <span>הכנסות ברוטו</span>
            <b>{shekelSmart(weekTotal)}</b>
          </div>
          <div>
            <span>{wk.mode === 'paid' ? 'פחות: שולם לסוכנים' : 'פחות: סחורה נטו'}</span>
            <b className="minus">{shekelSmart(-(wk.mode === 'paid' ? wk.paid : wk.goodsCost)).replace('-', '−')}</b>
          </div>
          <div>
            <span>פחות: הוצאות</span>
            <b className="minus">{shekelSmart(-wk.expenses).replace('-', '−')}</b>
          </div>
          <div className="total">
            <span>רווח נקי השבוע</span>
            <b>{shekelSmart(weekTotal - (wk.mode === 'paid' ? wk.paid : wk.goodsCost) - wk.expenses)}</b>
          </div>
        </section>
      )}

      <div className="sticky-save">
        {dirty && <div className="unsaved">יש שינויים שעוד לא נשמרו · נשמרים גם במעבר ליום אחר</div>}
        <button type="button" className="btn" onClick={save} disabled={saving}>
          {saving ? 'שומר…' : 'שמירה'}
        </button>
      </div>
    </>
  );
}
