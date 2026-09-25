import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toast';
import { getAgent, productsOfAgent, type Agent, type Product } from '../db/catalog';
import { addPayment, agentLedger, balances, deletePayment, type LedgerEntry } from '../db/ops';
import { DAY_NAMES, DAY_SHORT, fromIso, iso, startOfWeek, today } from '../lib/dates';
import { weekInfo } from '../lib/hebrew';
import { parseAmount, products as productsLabel, shekel, shekelCents } from '../lib/money';
import { initialOf } from './Agents';
import { useBack } from '../components/useBack';

const PAY_METHODS = ['מזומן', 'העברה', 'צ׳ק', 'אחר'];

export function waLink(phone: string) {
  const digits = phone.replace(/\D/g, '');
  const intl = digits.startsWith('0') ? `972${digits.slice(1)}` : digits;
  return `https://wa.me/${intl}`;
}

export function AgentCard() {
  const { id } = useParams();
  const agentId = Number(id);
  const [params] = useSearchParams();
  const nav = useNavigate();
  const back = useBack();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [balance, setBalance] = useState(0);
  const [prods, setProds] = useState<Product[]>([]);
  const [tab, setTab] = useState<'ledger' | 'products'>('ledger');
  const [date, setDate] = useState(iso(today()));
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState(PAY_METHODS[0]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const payRef = useRef<HTMLElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  async function load() {
    const [a, l, b, p] = await Promise.all([getAgent(agentId), agentLedger(agentId), balances(), productsOfAgent(agentId)]);
    setAgent(a);
    setLedger(l);
    setBalance(b.get(agentId) ?? 0);
    setProds(p);
  }

  useEffect(() => {
    load().then(() => {
      if (params.get('pay')) {
        setTimeout(() => {
          payRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          amountRef.current?.focus();
        }, 150);
      }
    });
  }, [agentId]);

  async function pay() {
    const a = parseAmount(amount);
    if (a <= 0) return toast('צריך לכתוב סכום');
    setSaving(true);
    await addPayment(agentId, date, a, method, note);
    toast(`נרשם תשלום של ${shekel(a)} ל${agent?.name ?? 'סוכן'}`);
    setAmount('');
    setNote('');
    await load();
    setSaving(false);
  }

  async function open(e: LedgerEntry) {
    if (e.kind === 'delivery') nav(`/delivery?agent=${agentId}&week=${e.weekStart}`);
    else if (e.kind === 'returns') nav(`/returns?agent=${agentId}&week=${e.weekStart}`);
    else if (window.confirm(`למחוק את התשלום של ${shekel(-e.amount)} מ-${fromIso(e.date).toLocaleDateString('he-IL')}?`)) {
      await deletePayment(e.id);
      toast('התשלום נמחק');
      load();
    }
  }

  if (!agent) return <header className="bar" />;

  const color = agent.color ?? 'var(--primary)';
  const after = balance - parseAmount(amount);
  const currentWeek = iso(startOfWeek(today()));
  const pending = ledger.filter((e) => e.pendingReturns && (e.weekStart ?? '') < currentWeek);

  return (
    <>
      <header className="bar">
        <button type="button" className="icon-btn" aria-label="חזרה" onClick={() => back()}>
          <Icon name="back" />
        </button>
        <h1 className="page-title" style={{ flex: 1 }}>כרטיס סוכן</h1>
        <Link to={`/agent/${agentId}/edit`} className="icon-btn" aria-label="עריכת הסוכן" style={{ color: 'var(--ink)' }}>
          <Icon name="edit" />
        </Link>
      </header>

      <section className="agent-hero" style={{ background: color }}>
        <div className="who">
          <span className="big-av" style={{ color }}>{initialOf(agent.name)}</span>
          <div>
            <b>{agent.name}</b>
            <span>
              {productsLabel(prods.length)}
              {agent.delivery_day != null ? ` · מגיע ביום ${DAY_NAMES[agent.delivery_day]}` : ''}
            </span>
          </div>
        </div>
        <div className="acts">
          {agent.phone ? (
            <a href={`tel:${agent.phone.replace(/[^\d+]/g, '')}`}><Icon name="phone" size={18} /> חיוג</a>
          ) : (
            <Link to={`/agent/${agentId}/edit`}><Icon name="phone" size={18} /> טלפון</Link>
          )}
          {agent.phone ? (
            <a href={waLink(agent.phone)} target="_blank" rel="noreferrer"><Icon name="message" size={18} /> וואטסאפ</a>
          ) : (
            <span />
          )}
          <Link to={`/delivery?agent=${agentId}`}><Icon name="truck" size={18} /> סחורה</Link>
        </div>
      </section>

      <section className="card balance">
        <span className="k">{balance < -0.004 ? 'הסוכן חייב לך' : 'יתרה לתשלום לסוכן'}</span>
        <span className={`v ${balance > 0.004 ? 'owe' : balance < -0.004 ? 'credit' : 'zero'}`}>{shekel(Math.abs(balance))}</span>
        {pending.map((p) => (
          <Link key={p.key} to={`/returns?agent=${agentId}&week=${p.weekStart}`} className="banner gold" style={{ margin: '8px 0 0', padding: '10px 12px' }}>
            <span className="ic" style={{ width: 34, height: 34 }}><Icon name="undo" size={18} /></span>
            <span className="txt">
              <b style={{ fontSize: 15 }}>החזרות {p.weekStart ? weekInfo(fromIso(p.weekStart)).title : ''}</b>
              <span>עוד לא נרשמו · היתרה תרד אחרי הרישום</span>
            </span>
            <span className="go">לרישום</span>
          </Link>
        ))}
      </section>

      <div className="stack" style={{ margin: '12px 16px 0' }}>
        <div className="segment">
          <button type="button" className={tab === 'ledger' ? 'on' : ''} onClick={() => setTab('ledger')}>תנועות</button>
          <button type="button" className={tab === 'products' ? 'on' : ''} onClick={() => setTab('products')}>מוצרים ({prods.length})</button>
        </div>
      </div>

      {tab === 'ledger' ? (
        <section className="card ledger" style={{ margin: '10px 16px 0', padding: '2px 14px' }}>
          {ledger.length === 0 && <p className="hint" style={{ padding: '14px 0' }}>עוד אין תנועות. אחרי קבלת סחורה ותשלומים הם יופיעו כאן.</p>}
          {ledger.map((e) => {
            const d = fromIso(e.date);
            return (
              <button key={e.key} type="button" className="entry" onClick={() => open(e)}>
                <span className="when">
                  <small>{DAY_SHORT[d.getDay()]}</small>
                  <b>{d.getDate()}.{d.getMonth() + 1}</b>
                </span>
                <span className="what">
                  <b>{e.title}</b>
                  <span>
                    {e.kind === 'payment' ? e.sub || 'תשלום' : `${e.weekStart ? weekInfo(fromIso(e.weekStart)).title : ''} · ${e.sub.split(' · ').pop()}`}
                    {e.pendingReturns ? ' · ממתין להחזרות' : ''}
                  </span>
                </span>
                <span className={`amt${e.amount < 0 ? ' minus' : ''}`}>
                  {e.amount < 0 ? '−' : '+'}
                  {shekel(Math.abs(e.amount))}
                </span>
              </button>
            );
          })}
        </section>
      ) : (
        <section className="card" style={{ margin: '10px 16px 0', padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {prods.map((p) => (
            <Link key={p.id} to={`/product/${p.id}`} className="row" style={{ minHeight: 52 }}>
              <span className="grow">
                <b>{p.name}</b>
                <span>{p.returnable ? 'ניתן להחזרה' : 'ללא החזרה'}</span>
              </span>
              <span className="amt" style={{ fontSize: 15 }}>{shekelCents(p.agents.find((a) => a.agent_id === agentId)?.cost_price ?? 0)}</span>
            </Link>
          ))}
          <Link to={`/product/new?agent=${agentId}`} className="dashed-btn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '6px 0' }}>
            + מוצר חדש לסוכן
          </Link>
        </section>
      )}

      <section ref={payRef} className="card box" style={{ margin: '12px 16px 0', padding: 16, gap: 12 }}>
        <h2 style={{ fontSize: 19, fontWeight: 800 }}>רישום תשלום לסוכן</h2>
        <div className="two">
          <label className="date-chip" style={{ height: 52, fontSize: 17, justifyContent: 'center' }}>
            <Icon name="calendar" size={20} />
            {fromIso(date).getDate()}.{fromIso(date).getMonth() + 1}.{fromIso(date).getFullYear()}
            <input type="date" aria-label="תאריך התשלום" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <div className="money-in">
            <input ref={amountRef} inputMode="decimal" aria-label="סכום התשלום" placeholder="סכום" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <span>₪</span>
          </div>
        </div>
        <div className="chips">
          {PAY_METHODS.map((m) => (
            <button key={m} type="button" className={`chip${method === m ? ' on' : ''}`} onClick={() => setMethod(m)}>{m}</button>
          ))}
        </div>
        <input className="input" style={{ fontSize: 16, fontWeight: 600, height: 46 }} placeholder="הערה (לא חובה)" aria-label="הערה" value={note} onChange={(e) => setNote(e.target.value)} />
        {parseAmount(amount) > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: '1px solid var(--line-soft)', paddingTop: 10 }}>
            <span style={{ color: 'var(--ink2)' }}>{after < -0.004 ? 'אחרי התשלום הסוכן יהיה חייב לך' : 'יתרה אחרי התשלום'}</span>
            <b style={{ fontSize: 20 }}>{shekel(Math.abs(after))}</b>
          </div>
        )}
        <button type="button" className="btn" onClick={pay} disabled={saving}>{saving ? 'שומר…' : 'שמירת התשלום'}</button>
      </section>
      <div style={{ height: 24 }} />
    </>
  );
}
