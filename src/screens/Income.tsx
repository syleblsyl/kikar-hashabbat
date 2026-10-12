import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { SellingDayBar } from '../components/SellingDayBar';
import { SubBar } from '../components/SubBar';
import { MethodBar, MethodSplit, methodColor } from '../components/MethodSplit';
import { dayTotalsBySource, incomeMonthsByMethod, incomeSplit, listSources, type IncomeSplit, type Source } from '../db/ops';
import { monthSummary, type MonthSummary } from '../db/repo';
import { fromIso, iso, monthFirst, monthKey, monthLast, monthName, parseIso, partNames, sellingDay } from '../lib/dates';
import { shekelSmart } from '../lib/money';

/** Income: choose the place (the store or the mikveh) for a selling day. */
export function Income() {
  const [params, setParams] = useSearchParams();
  const date = iso(parseIso(params.get('date')) ?? sellingDay());
  const day = fromIso(date);
  const names = partNames(day);
  const [sources, setSources] = useState<Source[]>([]);
  const [totals, setTotals] = useState<Map<number, { night: number; day: number }>>(new Map());
  const [ms, setMs] = useState<MonthSummary | null>(null);
  const mk = monthKey(day);
  const [daySplit, setDaySplit] = useState<IncomeSplit | null>(null);
  const [split, setSplit] = useState<{ month: IncomeSplit; all: IncomeSplit; months: Awaited<ReturnType<typeof incomeMonthsByMethod>> } | null>(null);
  const [splitTab, setSplitTab] = useState<'month' | 'all'>('month');

  useEffect(() => {
    Promise.all([listSources(), dayTotalsBySource(date), monthSummary(day.getFullYear(), day.getMonth()), incomeSplit(date, date)]).then(([s, t, m, d]) => {
      setSources(s);
      setTotals(t);
      setMs(m);
      setDaySplit(d);
    });
  }, [date]);

  useEffect(() => {
    Promise.all([incomeSplit(monthFirst(mk), monthLast(mk)), incomeSplit(), incomeMonthsByMethod()]).then(([month, all, months]) => setSplit({ month, all, months }));
  }, [mk]);

  function pick(d: string) {
    const p = new URLSearchParams(params);
    p.set('date', d);
    setParams(p, { replace: true });
  }

  const dayTotal = [...totals.values()].reduce((s, t) => s + t.night + t.day, 0);

  return (
    <>
      <SubBar title="הכנסות יומיות" sub="בוחרים מקום: החנות או המקווה" />
      <SellingDayBar date={date} onPick={pick} />

      {sources.map((src, i) => {
        const t = totals.get(src.id) ?? { night: 0, day: 0 };
        const has = t.night !== 0 || t.day !== 0;
        return (
          <Link key={src.id} to={`/income/${src.id}?date=${date}`} className={`src-btn s${i % 2}`}>
            <span className="ic">
              <Icon name={i === 0 ? 'store' : 'drop'} size={30} />
            </span>
            <span className="txt">
              <b>{src.name}</b>
              {has ? (
                <span>
                  {names.night} {shekelSmart(t.night)} · {names.day} {shekelSmart(t.day)}
                </span>
              ) : (
                <span className="todo">עוד לא נרשם · לחיצה לרישום</span>
              )}
            </span>
            <span className="sum">
              {has && <b>{shekelSmart(t.night + t.day)}</b>}
              <Icon name="chevron" size={22} />
            </span>
          </Link>
        );
      })}

      <div className="day-total pad" style={{ marginTop: 4 }}>
        <span>סה״כ {names.night} ו{names.day}</span>
        <b>{shekelSmart(dayTotal)}</b>
      </div>
      {daySplit && dayTotal !== 0 && (
        <p className="day-methods">
          {daySplit.methods
            .filter((m) => m.total !== 0)
            .map((m, i) => (
              <span key={m.id}>
                <i style={{ background: methodColor(m.name, i) }} />
                {m.name} {shekelSmart(m.total)}
              </span>
            ))}
        </p>
      )}

      {split && (split.all.total !== 0 || split.month.total !== 0) && (
        <section className="card box msplit-box">
          <div className="h2-row">
            <h2>מזומן ואשראי</h2>
          </div>
          <div className="segment" role="tablist">
            <button type="button" role="tab" aria-selected={splitTab === 'month'} className={splitTab === 'month' ? 'on' : ''} onClick={() => setSplitTab('month')}>
              {monthName(mk)}
            </button>
            <button type="button" role="tab" aria-selected={splitTab === 'all'} className={splitTab === 'all' ? 'on' : ''} onClick={() => setSplitTab('all')}>
              כללי
            </button>
          </div>
          {splitTab === 'month' ? (
            split.month.total === 0 ? (
              <p className="hint">אין הכנסות ב{monthName(mk)}.</p>
            ) : (
              <>
                <div className="msplit-total">
                  <span>הכנסות {monthName(mk)}</span>
                  <b>{shekelSmart(split.month.total)}</b>
                </div>
                <MethodSplit split={split.month} />
              </>
            )
          ) : (
            <>
              <div className="msplit-total">
                <span>כל ההכנסות שנרשמו</span>
                <b>{shekelSmart(split.all.total)}</b>
              </div>
              <MethodSplit split={split.all} />
              <span className="lbl" style={{ marginTop: 6 }}>לפי חודש</span>
              <div className="msplit-months">
                {split.months.map((m) => (
                  <div key={m.month} className="msplit-month">
                    <div className="mm-top">
                      <b>{monthName(m.month, true)}</b>
                      <span>{shekelSmart(m.total)}</span>
                    </div>
                    <MethodBar
                      compact
                      methods={split.all.methods.map((x) => ({ ...x, total: Math.round((m.methods.get(x.id) ?? 0) * 100) / 100 }))}
                      total={m.total}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {ms && (
        <section className="box net-box">
          <div>
            <span>הכנסות ברוטו החודש</span>
            <b>{shekelSmart(ms.income)}</b>
          </div>
          {ms.bySource.length > 1 &&
            ms.bySource.map((s) => (
              <div key={s.id} className="sub-line">
                <span>· {s.name}</span>
                <b>{shekelSmart(s.total)}</b>
              </div>
            ))}
          <div>
            <span>
              פחות: חובה לסוכנים
              {ms.waiting > 0 && <small className="muted-tag">חסרות {ms.waiting} חשבוניות</small>}
            </span>
            <b className="minus">{shekelSmart(-ms.goodsCost).replace('-', '−')}</b>
          </div>
          <div>
            <span>פחות: הוצאות (קבועות ופועלים)</span>
            <b className="minus">{shekelSmart(-ms.expenses).replace('-', '−')}</b>
          </div>
          <div className="total">
            <span>נשאר בקופה החודש</span>
            <b>{shekelSmart(ms.net)}</b>
          </div>
        </section>
      )}
      <div style={{ height: 24 }} />
    </>
  );
}
