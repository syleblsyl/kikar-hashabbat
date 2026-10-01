import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { MonthBar, parseYM, thisMonth, ymKey, type YM } from '../components/MonthBar';
import { matches, SearchBox } from '../components/SearchBox';
import { SubBar } from '../components/SubBar';
import { invoicesBetween, type InvoiceRow } from '../db/ops';
import { monthRange } from '../db/repo';
import { DAY_SHORT, fromIso } from '../lib/dates';
import { hebDayMonth } from '../lib/hebrew';
import { products, shekelSmart } from '../lib/money';
import { initialOf } from './Agents';

/** All invoices of a month, newest first, with totals per agent. */
export function Invoices() {
  const [params, setParams] = useSearchParams();
  const ym: YM = parseYM(params.get('month')) ?? thisMonth();
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    const { from, to } = monthRange(ym.y, ym.m);
    setRows(null);
    invoicesBetween(from, to).then(setRows);
  }, [ym.y, ym.m]);

  function setMonth(next: YM) {
    const p = new URLSearchParams(params);
    p.set('month', ymKey(next));
    setParams(p, { replace: true });
  }

  const shown = (rows ?? []).filter((r) => matches(r.agent, q) || matches(r.note, q));
  const total = shown.reduce((s, r) => s + r.received - r.credit, 0);
  const byAgent = new Map<string, { color: string | null; total: number; n: number }>();
  for (const r of shown) {
    const a = byAgent.get(r.agent) ?? { color: r.color, total: 0, n: 0 };
    a.total += r.received - r.credit;
    a.n += 1;
    byAgent.set(r.agent, a);
  }

  return (
    <>
      <SubBar title="חשבוניות" sub="מה שקיבלתי מהסוכנים – וכמה אני חייב על זה" />
      <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10 }}>
        <MonthBar ym={ym} onChange={setMonth} />
        <SearchBox value={q} onChange={setQ} placeholder="חיפוש סוכן או הערה" />
      </div>

      {rows && rows.length > 0 && (
        <section className="card inv-sum">
          <div className="inv-total">
            <span>{q ? 'סה״כ בחיפוש' : 'סה״כ חשבוניות החודש'} (אחרי החזרות)</span>
            <b>{shekelSmart(total)}</b>
          </div>
          {byAgent.size > 1 && (
            <div className="inv-agents">
              {[...byAgent.entries()]
                .sort((a, b) => b[1].total - a[1].total)
                .map(([name, a]) => (
                  <span key={name}>
                    <i style={{ background: a.color ?? 'var(--primary)' }} />
                    {name} · {shekelSmart(a.total)}
                  </span>
                ))}
            </div>
          )}
        </section>
      )}

      {!rows ? (
        <p className="hint" style={{ textAlign: 'center' }}>טוען…</p>
      ) : rows.length === 0 ? (
        <div className="card empty-card">
          <p>אין חשבוניות בחודש הזה.</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="hint" style={{ textAlign: 'center' }}>לא נמצאו חשבוניות</p>
      ) : (
        <section className="card list" style={{ marginTop: 12 }}>
          {shown.map((r, i) => {
            const d = fromIso(r.date);
            return (
              <Link key={r.id} to={`/invoice/${r.id}`} className="row" style={i === 0 ? { borderTop: 0 } : undefined}>
                <span className="avatar" style={{ background: r.color ?? 'var(--primary)' }}>{initialOf(r.agent)}</span>
                <span className="grow">
                  <b>{r.agent}</b>
                  <span>
                    {DAY_SHORT[d.getDay()]} {d.getDate()}.{d.getMonth() + 1} · {hebDayMonth(d)} · {r.manual ? 'לפי סכום' : products(r.lines)}
                    {r.note ? ` · ${r.note}` : ''}
                  </span>
                  {r.returnable && !r.returns_done && <span className="warn-txt">מחכה להחזרות</span>}
                  {r.credit > 0 && <span className="ok-txt">זיכוי החזרות {shekelSmart(r.credit)}</span>}
                </span>
                <span className="amt nowrap">{shekelSmart(r.received - r.credit)}</span>
              </Link>
            );
          })}
        </section>
      )}

      <div className="sticky-save">
        <Link to="/invoice/new" className="btn">
          <Icon name="plus" /> חשבונית חדשה
        </Link>
      </div>
    </>
  );
}
