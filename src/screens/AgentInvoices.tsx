import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckPill } from '../components/CheckPill';
import { Icon } from '../components/Icon';
import { addMonths, MonthBar, parseYM, thisMonth, ymKey, type YM } from '../components/MonthBar';
import { matches, SearchBox } from '../components/SearchBox';
import { SubBar } from '../components/SubBar';
import { monthAgents, type MonthAgentRow } from '../db/billing';
import { addMonthKey, monthName } from '../lib/dates';
import { shekelSmart } from '../lib/money';
import { initialOf } from './Agents';

/** The agents' monthly invoices for one month of goods, each checked against the stock. */
export function AgentInvoices() {
  const [params, setParams] = useSearchParams();
  // invoices that arrive now are for last month's goods
  const anchor = addMonths(thisMonth(), -1);
  const ym: YM = parseYM(params.get('month')) ?? anchor;
  const mk = ymKey(ym);
  const [rows, setRows] = useState<MonthAgentRow[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    setRows(null);
    monthAgents(mk).then(setRows);
  }, [mk]);

  function setMonth(next: YM) {
    const p = new URLSearchParams(params);
    p.set('month', ymKey(next));
    setParams(p, { replace: true });
  }

  const all = rows ?? [];
  const shown = all.filter((r) => matches(r.name, q));
  const arrived = all.filter((r) => r.m.invoiceCount > 0);
  const waiting = all.filter((r) => r.state === 'waiting').length;
  const bad = all.filter((r) => r.state === 'mismatch').length;
  const good = all.filter((r) => r.state === 'match').length;
  const invoicedTotal = arrived.reduce((s, r) => s + r.m.invoiced, 0);

  return (
    <>
      <SubBar title="חשבוניות מהסוכנים" sub="כל חשבונית נרשמת על החודש של הסחורה" />
      <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
        <MonthBar ym={ym} onChange={setMonth} anchor={anchor} tag="מגיעות עכשיו" />
        <p className="hint" style={{ margin: '0 2px', textAlign: 'center' }}>
          חשבוניות על סחורה של {monthName(mk)} · מגיעות בדרך כלל ב{monthName(addMonthKey(mk, 1))}
        </p>
        {all.length > 6 && <SearchBox value={q} onChange={setQ} placeholder="חיפוש סוכן" />}
      </div>

      {rows && all.length > 0 && (
        <section className="card inv-sum">
          <div className="inv-total">
            <span>
              הגיעו {arrived.length} מתוך {all.length}
            </span>
            <b>{shekelSmart(invoicedTotal)}</b>
          </div>
          {(bad > 0 || waiting > 0 || good > 0) && (
            <div className="inv-agents">
              {bad > 0 && <span className="bad">{bad === 1 ? 'הפרש אחד' : `${bad} הפרש`}</span>}
              {waiting > 0 && <span className="wait">{waiting === 1 ? 'אחת ממתינה' : `${waiting} ממתינות`}</span>}
              {good > 0 && <span className="good">{good === 1 ? 'אחת תואמת' : `${good} תואמות`}</span>}
            </div>
          )}
        </section>
      )}

      {!rows ? (
        <p className="hint" style={{ textAlign: 'center' }}>טוען…</p>
      ) : all.length === 0 ? (
        <div className="card empty-card">
          <p>אין סחורה או חשבוניות על {monthName(mk)}.</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="hint" style={{ textAlign: 'center' }}>לא נמצא סוכן בשם הזה</p>
      ) : (
        <section className="card list" style={{ marginTop: 12 }}>
          {shown.map((r, i) => {
            const inv = r.m.invoiceCount > 1 ? `${r.m.invoiceCount} חשבוניות · ${shekelSmart(r.m.invoiced)}` : `חשבונית ${shekelSmart(r.m.invoiced)}`;
            const line =
              r.state === 'waiting'
                ? `עוד אין חשבונית · לפי המלאי ${shekelSmart(r.m.compare).replace('-', '−')}`
                : r.state === 'no-stock'
                  ? `${inv} · לא נרשם מלאי`
                  : r.state === 'merged'
                    ? `חשבונית 0 ₪ · המלאי נבדק מול ${monthName(r.m.mergedInto!)}`
                    : `${inv} · מלאי ${shekelSmart(r.m.compare).replace('-', '−')}`;
            const to = r.state === 'waiting' ? `/invoices/new?agent=${r.agentId}&month=${mk}` : `/check/${r.agentId}/${mk}`;
            return (
              <Link key={r.agentId} to={to} className="row" style={i === 0 ? { borderTop: 0 } : undefined}>
                <span className="avatar" style={{ background: r.color ?? 'var(--primary)' }}>{initialOf(r.name)}</span>
                <span className="grow">
                  <b>
                    {r.name}
                    {!r.active && <small className="muted-tag">מוסתר</small>}
                  </b>
                  <span>{line}</span>
                </span>
                <CheckPill state={r.state} diff={r.diff} waitingText="+ חשבונית" />
              </Link>
            );
          })}
        </section>
      )}

      <div className="sticky-save">
        <Link to={`/invoices/new?month=${mk}`} className="btn">
          <Icon name="plus" /> חשבונית
        </Link>
      </div>
    </>
  );
}
