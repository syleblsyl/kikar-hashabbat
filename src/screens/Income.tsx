import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { SellingDayBar } from '../components/SellingDayBar';
import { SubBar } from '../components/SubBar';
import { dayTotalsBySource, listSources, type Source } from '../db/ops';
import { monthSummary, type MonthSummary } from '../db/repo';
import { fromIso, iso, parseIso, partNames, sellingDay } from '../lib/dates';
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

  useEffect(() => {
    Promise.all([listSources(), dayTotalsBySource(date), monthSummary(day.getFullYear(), day.getMonth())]).then(([s, t, m]) => {
      setSources(s);
      setTotals(t);
      setMs(m);
    });
  }, [date]);

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
            <b>{shekelSmart(ms.net)}</b>
          </div>
        </section>
      )}
      <div style={{ height: 24 }} />
    </>
  );
}
