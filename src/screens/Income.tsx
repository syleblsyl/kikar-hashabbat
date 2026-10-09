import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ask } from '../components/Dialog';
import { useLeaveGuard } from '../components/guard';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toast';
import { MonthBar, sameYM, thisMonth } from '../components/MonthBar';
import { incomeByDay, incomeForDay, incomeKey, listSources, methodsForDay, saveIncomeDay, type Method, type Source } from '../db/ops';
import { addDays, DAY_NAMES, DAY_SHORT, fromIso, iso, parseIso, today } from '../lib/dates';
import { dayEvents, hebDay, hebDayMonth } from '../lib/hebrew';
import { parseAmountStrict, shekelSmart } from '../lib/money';
import { useBack } from '../components/useBack';
import { monthRange, monthSummary, type MonthSummary } from '../db/repo';

/** cash first (green), card (blue), anything else */
function methodTone(name: string) {
  if (/מזומן/.test(name)) return { bg: 'var(--green-soft)', fg: 'var(--green)', icon: 'cash' };
  if (/אשראי|כרטיס/.test(name)) return { bg: 'var(--blue-soft)', fg: 'var(--blue)', icon: 'card' };
  return { bg: 'var(--chip)', fg: 'var(--ink2)', icon: 'dots' };
}

function fmtInput(n: number) {
  return n ? String(Number(n.toFixed(2))) : '';
}

export function Income() {
  const [params, setParams] = useSearchParams();
  const back = useBack();
  const date = iso(parseIso(params.get('date')) ?? today());
  const day = fromIso(date);
  const ym = { y: day.getFullYear(), m: day.getMonth() };
  const [sources, setSources] = useState<Source[]>([]);
  const [methods, setMethods] = useState<Method[]>([]);
  /** "source|method" → typed text */
  const [values, setValues] = useState<Record<string, string>>({});
  /** hidden methods that have an amount today, per source */
  const [extra, setExtra] = useState<Set<string>>(new Set());
  /** what is saved for this day, to show month totals with today's typed amounts */
  const [savedDay, setSavedDay] = useState<Map<string, number>>(new Map());
  const [month, setMonth] = useState<Map<string, number>>(new Map());
  const [dirty, setDirty] = useState(false);
  const [ms, setMs] = useState<MonthSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [showCal, setShowCal] = useState(false);

  const loadMonth = useCallback(async () => {
    const { from, to } = monthRange(ym.y, ym.m);
    const [byDay, summary] = await Promise.all([incomeByDay(from, to), monthSummary(ym.y, ym.m)]);
    setMonth(byDay);
    setMs(summary);
  }, [ym.y, ym.m]);

  useEffect(() => {
    (async () => {
      const [src, mts, amounts] = await Promise.all([listSources(), methodsForDay(date), incomeForDay(date)]);
      setSources(src);
      setMethods(mts);
      const v: Record<string, string> = {};
      for (const s of src) for (const m of mts) v[incomeKey(s.id, m.id)] = fmtInput(amounts.get(incomeKey(s.id, m.id)) ?? 0);
      setValues(v);
      setExtra(new Set([...amounts.entries()].filter(([, a]) => a !== 0).map(([k]) => k)));
      setSavedDay(amounts);
      setDirty(false);
    })();
  }, [date]);

  useEffect(() => {
    loadMonth();
  }, [loadMonth]);

  const keys = Object.keys(values);
  const parsed = new Map(keys.map((k) => [k, parseAmountStrict(values[k] ?? '')]));
  const invalid = keys.filter((k) => parsed.get(k) === null);
  const sourceTotal = (sid: number) => methods.reduce((s, m) => s + (parsed.get(incomeKey(sid, m.id)) ?? 0), 0);
  const dayTotal = sources.reduce((s, src) => s + sourceTotal(src.id), 0);
  const live = new Map(month);
  live.set(date, dayTotal);
  const monthTotal = [...live.values()].reduce((a, b) => a + b, 0);
  // the two ways money comes in: cash and card (by name; the first two methods if they were renamed)
  const mainIds = new Set(
    (() => {
      const named = methods.filter((m) => m.active && (/מזומן/.test(m.name) || /אשראי|כרטיס/.test(m.name)));
      return (named.length ? named : methods.filter((m) => m.active).slice(0, 2)).map((m) => m.id);
    })(),
  );
  const nameOf = (k: string) => {
    const [sid, mid] = k.split('|').map(Number);
    return `${methods.find((m) => m.id === mid)?.name ?? ''} של ${sources.find((s) => s.id === sid)?.name ?? ''}`;
  };

  /** Saves the day. Returns false (and says why) if an amount is not a valid number. */
  async function persist(): Promise<boolean> {
    if (invalid.length > 0) {
      toast(`הסכום ב${nameOf(invalid[0])} לא תקין. כותבים רק מספר, למשל 350 או 12.50`, 'err');
      return false;
    }
    const rows = keys.map((k) => {
      const [sourceId, methodId] = k.split('|').map(Number);
      return { sourceId, methodId, amount: parsed.get(k) ?? 0 };
    });
    await saveIncomeDay(date, rows);
    setSavedDay(new Map(rows.map((r) => [incomeKey(r.sourceId, r.methodId), r.amount])));
    setDirty(false);
    await loadMonth();
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
      text: `הסכום ב${nameOf(invalid[0])} לא מספר, ולכן היום לא נשמר. לצאת בלי לשמור?`,
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

  const events = dayEvents(day);
  const todayIso = iso(today());
  const isToday = date === todayIso;
  // the month as a calendar: Sunday first, blanks before the 1st
  const first = new Date(ym.y, ym.m, 1);
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => iso(new Date(ym.y, ym.m, i + 1))),
  ];

  return (
    <>
      <header className="bar">
        <button type="button" className="icon-btn" aria-label="חזרה" onClick={() => back()}>
          <Icon name="back" />
        </button>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <h1 className="page-title">הכנסה יומית</h1>
          <span className="sub" style={{ fontSize: 14 }}>ברוטו – כל מה שנכנס, לפני תשלום לסוכנים</span>
        </div>
      </header>

      {/* which day */}
      <div className="pad" style={{ marginBottom: 10 }}>
        <div className="switcher">
          <button type="button" aria-label="היום הקודם" onClick={() => pick(iso(addDays(day, -1)))}>
            <Icon name="prev" stroke={2.5} />
          </button>
          <button type="button" className="label" onClick={() => setShowCal((x) => !x)} aria-expanded={showCal} aria-label="בחירת יום בלוח">
            <b>
              יום {DAY_NAMES[day.getDay()]}, {day.getDate()}.{day.getMonth() + 1}
            </b>
            <span>
              {hebDayMonth(day)}
              {events.length > 0 ? ` · ${events.map((e) => e.name).join(', ')}` : ''}
            </span>
            {isToday ? <em>היום</em> : <em className="cal-tag">{showCal ? 'סגירת הלוח' : 'לוח'}</em>}
          </button>
          <button type="button" aria-label="היום הבא" disabled={date >= todayIso} onClick={() => pick(iso(addDays(day, 1)))}>
            <Icon name="next" stroke={2.5} />
          </button>
        </div>
      </div>

      {showCal && (
        <section className="income-cal">
          <div className="pad" style={{ marginBottom: 8 }}>
            <MonthBar
              ym={ym}
              onChange={(next) => {
                pick(sameYM(next, thisMonth()) ? todayIso : iso(new Date(next.y, next.m, 1)));
              }}
            />
          </div>
          <div className="cal" role="grid" aria-label="ימי החודש">
            {DAY_SHORT.map((d) => (
              <span key={d} className="cal-h">{d}</span>
            ))}
            {cells.map((d, i) => {
              if (!d) return <span key={`b${i}`} />;
              const dd = fromIso(d);
              const chag = dayEvents(dd).some((e) => e.chag);
              const v = live.get(d) ?? 0;
              const cls = ['cal-d', d === date ? 'on' : '', chag ? 'chag' : '', dd.getDay() === 6 ? 'sat' : '', d === todayIso ? 'today' : '', d > todayIso ? 'future' : ''].join(' ');
              return (
                <button
                  key={d}
                  type="button"
                  className={cls}
                  onClick={() => {
                    pick(d);
                    setShowCal(false);
                  }}
                  aria-pressed={d === date}
                  aria-label={`${DAY_NAMES[dd.getDay()]} ${dd.getDate()}${v > 0 ? `, ${Math.round(v)} שקלים` : ''}`}
                >
                  <b>{dd.getDate()}</b>
                  <span className="h">{hebDay(dd)}</span>
                  <span className={`mark${v > 0 ? ' has' : ''}`} />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* one big box per place: the store on top, the mikveh under it */}
      {sources.map((src, si) => {
        // cash and card always; any other method only where it already has an amount that day
        const shown = methods.filter((m) => mainIds.has(m.id) || extra.has(incomeKey(src.id, m.id)));
        return (
          <section key={src.id} className={`src-card s${si % 2}`} aria-label={src.name}>
            <div className="src-head">
              <span className="ic">
                <Icon name={si === 0 ? 'store' : 'drop'} size={26} />
              </span>
              <b>{src.name}</b>
              <span className="src-total">{shekelSmart(sourceTotal(src.id))}</span>
            </div>
            {shown.map((m) => {
              const k = incomeKey(src.id, m.id);
              const t = methodTone(m.name);
              const bad = parsed.get(k) === null;
              return (
                <div key={k}>
                  <label className="src-row">
                    <span className="mi" style={{ background: t.bg, color: t.fg }}>
                      <Icon name={t.icon} />
                    </span>
                    <span className="nm">
                      {m.name}
                      {!m.active && <small className="muted-tag">מוסתר</small>}
                    </span>
                    <span className={`money-in big${bad ? ' bad' : ''}`}>
                      <input
                        inputMode="decimal"
                        enterKeyHint="next"
                        placeholder="0"
                        aria-label={`${m.name} – ${src.name}`}
                        aria-invalid={bad}
                        value={values[k] ?? ''}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => {
                          setValues((v) => ({ ...v, [k]: e.target.value }));
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
          </section>
        );
      })}

      <div className="day-total pad" style={{ marginTop: 12 }}>
        <span>סה״כ היום</span>
        <b>{shekelSmart(dayTotal)}</b>
      </div>

      {ms && (
        <section className="box net-box">
          <div>
            <span>הכנסות ברוטו החודש</span>
            <b>{shekelSmart(monthTotal)}</b>
          </div>
          {ms.bySource.length > 1 &&
            ms.bySource.map((s) => {
              // the month total of this source, with today's typed amounts instead of the saved ones
              const saved = [...savedDay.entries()].filter(([k]) => k.startsWith(`${s.id}|`)).reduce((t, [, a]) => t + a, 0);
              return (
                <div key={s.id} className="sub-line">
                  <span>· {s.name}</span>
                  <b>{shekelSmart(s.total - saved + sourceTotal(s.id))}</b>
                </div>
              );
            })}
          <div>
            <span>
              פחות: חיובי סוכנים
              {(ms.waiting > 0 || Math.abs(ms.byStock) > 0.004) && <small className="muted-tag">{Math.abs(ms.byInvoice) < 0.004 ? 'לפי מלאי' : 'חלק לפי מלאי'}</small>}
            </span>
            <b className="minus">{shekelSmart(-ms.goodsCost).replace('-', '−')}</b>
          </div>
          <div>
            <span>פחות: הוצאות (קבועות ופועלים)</span>
            <b className="minus">{shekelSmart(-ms.expenses).replace('-', '−')}</b>
          </div>
          <div className="total">
            <span>נשאר בקופה החודש</span>
            <b>{shekelSmart(monthTotal - ms.goodsCost - ms.expenses)}</b>
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
