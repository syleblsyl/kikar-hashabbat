import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { MonthBar, parseYM, thisMonth, ymKey, type YM } from '../components/MonthBar';
import { matches, SearchBox } from '../components/SearchBox';
import { SubBar } from '../components/SubBar';
import { loadStock, type StockEntry } from '../db/billing';
import { creditMonth, goodsMonth, waitsForReturns } from '../db/money';
import { query } from '../db/sqlite';
import { DAY_SHORT, dm, fromIso, monthLast, monthName, thisMonthKey } from '../lib/dates';
import { hebDayMonth } from '../lib/hebrew';
import { products, shekelSmart } from '../lib/money';
import { initialOf } from './Agents';

type AgentInfo = { name: string; color: string | null };

/** Stock of a month: goods that arrived from the agents, and the returns recorded in it. */
export function Stock() {
  const [params, setParams] = useSearchParams();
  const ym: YM = parseYM(params.get('month')) ?? thisMonth();
  const mk = ymKey(ym);
  const [stock, setStock] = useState<StockEntry[] | null>(null);
  const [agents, setAgents] = useState<Map<number, AgentInfo>>(new Map());
  const [q, setQ] = useState('');

  useEffect(() => {
    setStock(null);
    Promise.all([loadStock(), query<{ id: number; name: string; color: string | null }>('SELECT id, name, color FROM agents')]).then(([s, a]) => {
      setAgents(new Map(a.map((x) => [Number(x.id), { name: x.name, color: x.color }])));
      setStock(s);
    });
  }, [mk]);

  function setMonth(next: YM) {
    const p = new URLSearchParams(params);
    p.set('month', ymKey(next));
    setParams(p, { replace: true });
  }

  const name = (e: StockEntry) => agents.get(e.agentId)?.name ?? '';
  const ok = (e: StockEntry) => matches(name(e), q) || matches(e.note, q);
  const goods = (stock ?? []).filter((e) => goodsMonth(e) === mk && ok(e)).reverse();
  const credits = (stock ?? []).filter((e) => Math.abs(e.credit) > 0.004 && creditMonth(e) === mk && ok(e));
  const goodsTotal = goods.reduce((s, e) => s + e.received, 0);
  const creditTotal = credits.reduce((s, e) => s + e.credit, 0);
  // returns recorded this month on goods from an earlier month
  const olderCredits = credits.filter((e) => goodsMonth(e) !== mk);

  return (
    <>
      <SubBar title="מלאי" sub="סחורה שהגיעה מהסוכנים והחזרות" />
      <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10 }}>
        <MonthBar ym={ym} onChange={setMonth} />
        <SearchBox value={q} onChange={setQ} placeholder="חיפוש סוכן או הערה" />
      </div>

      {stock && (goods.length > 0 || credits.length > 0) && (
        <section className="card box net-box" style={{ margin: '0 16px' }}>
          <div>
            <span>סחורה שהגיעה ב{monthName(mk)}</span>
            <b>{shekelSmart(goodsTotal)}</b>
          </div>
          <div>
            <span>פחות: החזרות שנרשמו ב{monthName(mk)}</span>
            <b className="minus">{shekelSmart(-creditTotal).replace('-', '−')}</b>
          </div>
          <div className="total">
            <span>{q ? 'לפי המלאי (בחיפוש)' : 'לפי המלאי'}</span>
            <b>{shekelSmart(goodsTotal - creditTotal)}</b>
          </div>
        </section>
      )}

      {!stock ? (
        <p className="hint" style={{ textAlign: 'center' }}>טוען…</p>
      ) : goods.length === 0 && credits.length === 0 ? (
        <div className="card empty-card">
          <p>{q ? 'לא נמצא' : `לא נרשמה סחורה ב${monthName(mk)}.`}</p>
        </div>
      ) : (
        <>
          {goods.length > 0 && (
            <section className="card list" style={{ marginTop: 12 }}>
              {goods.map((e, i) => {
                const d = fromIso(e.date);
                const a = agents.get(e.agentId);
                return (
                  <Link key={e.id} to={`/stock/${e.id}`} className="row" style={i === 0 ? { borderTop: 0 } : undefined}>
                    <span className="avatar" style={{ background: a?.color ?? 'var(--primary)' }}>{initialOf(a?.name ?? '')}</span>
                    <span className="grow">
                      <b>{a?.name}</b>
                      <span>
                        {DAY_SHORT[d.getDay()]} {d.getDate()}.{d.getMonth() + 1} · {hebDayMonth(d)} · {e.manual ? 'סכום בלי פירוט' : products(e.lines)}
                        {e.note ? ` · ${e.note}` : ''}
                      </span>
                      {waitsForReturns(e) && <span className="warn-txt">מחכה להחזרות</span>}
                      {Math.abs(e.credit) > 0.004 && (
                        <span className="ok-txt">
                          החזרות {e.returnsDate ? dm(e.returnsDate) : ''} · {shekelSmart(-e.credit).replace('-', '−')}
                          {creditMonth(e) !== mk ? ` (נרשמו על ${monthName(creditMonth(e))})` : ''}
                        </span>
                      )}
                    </span>
                    <span className="amt nowrap">{shekelSmart(e.received)}</span>
                  </Link>
                );
              })}
            </section>
          )}
          {olderCredits.length > 0 && (
            <section className="card list" style={{ marginTop: 12 }}>
              <div className="head" style={{ paddingTop: 8 }}>
                <h2 style={{ fontSize: 16 }}>החזרות ב{monthName(mk)} על סחורה מחודש קודם</h2>
              </div>
              {olderCredits.map((e) => {
                const a = agents.get(e.agentId);
                return (
                  <Link key={`c${e.id}`} to={`/returns?invoice=${e.id}`} className="row">
                    <span className="avatar" style={{ background: a?.color ?? 'var(--primary)' }}>{initialOf(a?.name ?? '')}</span>
                    <span className="grow">
                      <b>{a?.name}</b>
                      <span>
                        החזרות {e.returnsDate ? dm(e.returnsDate) : ''} · על סחורה מ-{dm(e.date)}
                      </span>
                    </span>
                    <span className="amt nowrap" style={{ color: 'var(--green)' }}>{shekelSmart(-e.credit).replace('-', '−')}</span>
                  </Link>
                );
              })}
            </section>
          )}
        </>
      )}

      <div className="sticky-save">
        <Link to={mk === thisMonthKey() ? '/stock/new' : `/stock/new?date=${monthLast(mk)}`} className="btn">
          <Icon name="plus" /> קבלת סחורה
        </Link>
      </div>
    </>
  );
}
