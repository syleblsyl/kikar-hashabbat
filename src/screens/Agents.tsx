import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { MonthBar, ymKey, type YM } from '../components/MonthBar';
import { matches, SearchBox } from '../components/SearchBox';
import { listAgents, type Agent } from '../db/catalog';
import { balances } from '../db/ops';
import { agentMonthsWithState } from '../db/billing';
import { agentTotalsForMonth, type AgentMonthTotals } from '../db/repo';
import { DAY_NAMES, monthName, thisMonthKey } from '../lib/dates';
import { products, shekel, shekelSmart } from '../lib/money';
import { STOCK } from '../lib/features';

export function initialOf(name: string) {
  return name.trim().split(/\s+/).pop()?.charAt(0) ?? '?';
}

/** The agents, by month: how much I paid each one in the month I'm on. */
export function Agents({ ym, setYm }: { ym: YM; setYm: (ym: YM) => void }) {
  const mk = ymKey(ym);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [totals, setTotals] = useState<Map<number, AgentMonthTotals>>(new Map());
  const [hidden, setHidden] = useState<Agent[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [bal, setBal] = useState<Map<number, number>>(new Map());
  const [q, setQ] = useState('');
  /** agents with a past month that has goods but no invoice */
  const [missing, setMissing] = useState<Set<number>>(new Set());

  const shown = (agents ?? []).filter((a) => matches(a.name, q) || matches(a.phone, q));

  useEffect(() => {
    listAgents().then(async (list) => {
      setAgents(list);
      if (!STOCK) return;
      const states = await Promise.all(list.map((a) => agentMonthsWithState(a.id)));
      const now = thisMonthKey();
      setMissing(new Set(list.filter((_, i) => states[i].some((x) => x.state === 'waiting' && x.m.month < now)).map((a) => a.id)));
    });
    listAgents(true).then(setHidden);
    balances().then(setBal);
  }, []);

  useEffect(() => {
    agentTotalsForMonth(mk).then(setTotals);
  }, [mk]);

  const paidTotal = [...totals.values()].reduce((s, t) => s + t.paid, 0);

  return (
    <>
      <header className="cat-head">
        <div className="titles">
          <h1 className="page-title" style={{ fontSize: 26 }}>סוכנים</h1>
          <span className="sub" style={{ fontSize: 14 }}>{agents ? `${agents.length} סוכנים` : '…'}</span>
        </div>
        <Link to="/agent/new" className="add-btn">
          <Icon name="plus" size={20} stroke={2.6} /> סוכן חדש
        </Link>
      </header>

      {agents && agents.length === 0 ? (
        <div className="card empty-card">
          <img src="/logo.webp" alt="" style={{ height: 110 }} />
          <p>עוד לא הוספת סוכנים.<br />לכל סוכן רושמים שם, טלפון, צבע ויום אספקה, ואחר כך מוסיפים לו מוצרים.</p>
          <Link to="/agent/new" className="btn small" style={{ width: 'auto', padding: '0 20px' }}>
            <Icon name="plus" /> הוספת סוכן ראשון
          </Link>
        </div>
      ) : (
        <>
          <div className="agents-search">
            <SearchBox value={q} onChange={setQ} placeholder="חיפוש סוכן לפי שם" className="full" />
          </div>
          <div className="agents-month">
            <MonthBar ym={ym} onChange={setYm} />
          </div>
        <section className="card list">
          <div className="head">
            <h2>שולם ב{monthName(mk)}</h2>
            <span>{paidTotal > 0 ? `סה״כ ${shekel(paidTotal)}` : 'עוד לא שולם'}</span>
          </div>
          {shown.length === 0 && agents && <div className="empty">אין סוכן בשם "{q.trim()}".</div>}
          {shown.map((a) => {
            const t = totals.get(a.id);
            return (
              <Link key={a.id} to={`/agent/${a.id}?month=${mk}`} className="row">
                <span className="avatar" style={{ background: a.color ?? 'var(--primary)' }}>{initialOf(a.name)}</span>
                <span className="grow">
                  <b>{a.name}</b>
                  <span>
                    {t && t.debit > 0 ? `חובה ${shekelSmart(t.debit)}` : products(a.products ?? 0)}
                    {t && t.credits > 0 ? ` · זיכוי ${shekelSmart(t.credits)}` : !t?.debit && a.delivery_day != null ? ` · מגיע ביום ${DAY_NAMES[a.delivery_day]}` : ''}
                  </span>
                  {missing.has(a.id) && <span className="miss-line">חסרה חשבונית</span>}
                </span>
                {t && t.paid !== 0 ? (
                  <span className="amt-col">
                    <span className="amt nowrap">{shekel(t.paid)}</span>
                    <small>שולם</small>
                  </span>
                ) : (
                  <span className="amt-col">
                    <small className="not-paid">לא שולם</small>
                  </span>
                )}
              </Link>
            );
          })}
        </section>
        </>
      )}

      {hidden.length > 0 && (
        <section className="card list" style={{ marginTop: 12 }}>
          <button type="button" className="row hidden-toggle" style={{ borderTop: 0 }} aria-expanded={showHidden} onClick={() => setShowHidden((v) => !v)}>
            <span className="grow">
              <b>סוכנים מוסתרים ({hidden.length})</b>
              <span>לחיצה על סוכן פותחת את הכרטיס שלו, ומשם אפשר להחזיר אותו</span>
            </span>
            <span style={{ color: 'var(--ink2)', transform: showHidden ? 'rotate(90deg)' : undefined }}><Icon name="chevron" /></span>
          </button>
          {showHidden &&
            hidden.map((a) => {
              const b = bal.get(a.id) ?? 0;
              return (
                <Link key={a.id} to={`/agent/${a.id}`} className="row dimmed">
                  <span className="avatar" style={{ background: a.color ?? 'var(--primary)' }}>{initialOf(a.name)}</span>
                  <span className="grow">
                    <b>{a.name}</b>
                    <span>{Math.abs(b) > 0.004 ? (b > 0 ? 'נשארה יתרה לתשלום' : 'הסוכן חייב לך') : 'מוסתר'}</span>
                  </span>
                  {Math.abs(b) > 0.004 && <span className="amt nowrap" style={{ color: b > 0 ? 'var(--red)' : 'var(--green)' }}>{shekel(Math.abs(b))}</span>}
                </Link>
              );
            })}
        </section>
      )}
    </>
  );
}
