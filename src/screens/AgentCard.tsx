import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ask } from '../components/Dialog';
import { useLeaveGuard } from '../components/guard';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toast';
import { getAgent, productsOfAgent, unhideAgent, type Agent, type Product } from '../db/catalog';
import { addPayment, agentLedger, balances, deletePayment, type LedgerEntry } from '../db/ops';
import { DAY_NAMES, DAY_SHORT, fromIso, iso, startOfWeek, today } from '../lib/dates';
import { weekInfo } from '../lib/hebrew';
import { parseAmountStrict, products as productsLabel, shekelCents, shekelSmart } from '../lib/money';
import { initialOf } from './Agents';
import { useBack } from '../components/useBack';
import { myBalanceWords } from '../components/AgentDocs';
import { waLink } from '../lib/share';

const PAY_METHODS = ['מזומן', 'העברה', 'צ׳ק', 'אחר'];


function fmtDate(s: string) {
  const d = fromIso(s);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

export function AgentCard() {
  const { id } = useParams();
  const agentId = Number(id);
  const [params] = useSearchParams();
  const nav = useNavigate();
  const back = useBack();
  const [agent, setAgent] = useState<Agent | null | undefined>(undefined);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [balance, setBalance] = useState(0);
  const [prods, setProds] = useState<Product[]>([]);
  const [tab, setTab] = useState<'ledger' | 'products'>('ledger');
  const [payOpen, setPayOpen] = useState(!!params.get('pay'));
  const [date, setDate] = useState(iso(today()));
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState(PAY_METHODS[0]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [openPayment, setOpenPayment] = useState<string | null>(null);
  const payRef = useRef<HTMLElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  useLeaveGuard(payOpen && (amount.trim() !== '' || note.trim() !== ''));

  async function load() {
    if (!Number.isFinite(agentId) || agentId <= 0) return setAgent(null);
    const [a, l, b, p] = await Promise.all([getAgent(agentId), agentLedger(agentId), balances(), productsOfAgent(agentId)]);
    setAgent(a);
    setLedger(l);
    setBalance(b.get(agentId) ?? 0);
    setProds(p);
  }

  useEffect(() => {
    load();
  }, [agentId]);

  useEffect(() => {
    if (!payOpen || !agent) return;
    const t = setTimeout(() => {
      payRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      amountRef.current?.focus();
    }, 120);
    return () => clearTimeout(t);
  }, [payOpen, !!agent]);

  const parsed = parseAmountStrict(amount);

  async function pay() {
    if (parsed === null) return toast('הסכום לא תקין. כותבים רק מספר, למשל 1200 או 350.50', 'err');
    if (parsed <= 0) {
      amountRef.current?.focus();
      return toast('צריך לכתוב סכום', 'err');
    }
    setSaving(true);
    try {
      const pid = await addPayment(agentId, date, parsed, method, note);
      setAmount('');
      setNote('');
      setPayOpen(false);
      // the card stays in history (without the open form), the confirmation opens on top of it
      nav(`/agent/${agentId}`, { replace: true });
      nav(`/agent/${agentId}/receipt/${pid}?new=1`);
      return;
    } catch (e) {
      console.error(e);
      toast('השמירה נכשלה. נסה שוב.', 'err');
    }
    setSaving(false);
  }

  async function removePayment(e: LedgerEntry) {
    const ok = await ask({
      title: 'למחוק את התשלום?',
      text: `${shekelSmart(-e.amount)} מ-${fmtDate(e.date)}${e.sub ? ` (${e.sub})` : ''}.\nהיתרה לסוכן תעלה בהתאם.`,
      ok: 'מחיקת התשלום',
      danger: true,
    });
    if (!ok) return;
    await deletePayment(e.id);
    toast('התשלום נמחק');
    setOpenPayment(null);
    load();
  }

  function open(e: LedgerEntry) {
    if (e.kind === 'delivery') nav(`/delivery?agent=${agentId}&week=${e.weekStart}`);
    else if (e.kind === 'returns') nav(`/returns?agent=${agentId}&week=${e.weekStart}`);
    else setOpenPayment((k) => (k === e.key ? null : e.key));
  }

  if (agent === undefined) return <header className="bar" />;
  if (agent === null) {
    return (
      <>
        <header className="bar">
          <button type="button" className="icon-btn" aria-label="חזרה" onClick={() => back()}>
            <Icon name="back" />
          </button>
          <h1 className="page-title">כרטיס סוכן</h1>
        </header>
        <div className="card empty-card">
          <p>הסוכן הזה לא נמצא.</p>
          <Link to="/agents" className="btn small" style={{ width: 'auto', padding: '0 20px' }}>לרשימת הסוכנים</Link>
        </div>
      </>
    );
  }

  const color = agent.color ?? 'var(--primary)';
  const after = balance - (parsed ?? 0);
  const mine = myBalanceWords(balance, agent.name);
  const lastPay = ledger.find((e) => e.kind === 'payment');
  const pending = ledger.filter((e) => e.pendingReturns);
  const pendingPast = pending.filter((e) => (e.weekStart ?? '') < iso(startOfWeek(today())));
  const pendingSum = pending.reduce((s, e) => s + e.amount, 0);

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

      {!agent.active && (
        <div className="banner gold" style={{ margin: '0 16px 8px' }}>
          <span className="txt">
            <b>הסוכן מוסתר</b>
            <span>לא מופיע ברשימות. היתרה וההיסטוריה נשמרו.</span>
          </span>
          <button
            type="button"
            className="btn small"
            style={{ width: 'auto', padding: '0 14px' }}
            onClick={async () => {
              await unhideAgent(agentId);
              toast(`${agent.name} חזר לרשימת הסוכנים`);
              load();
            }}
          >
            החזרה
          </button>
        </div>
      )}

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
        <span className="k">{mine.label}</span>
        <span className={`v ${mine.tone}`}>{shekelSmart(Math.abs(balance))}</span>
        {lastPay && (
          <span className="hint">
            תשלום אחרון: {shekelSmart(-lastPay.amount)} ב-{fmtDate(lastPay.date)}
            {lastPay.method ? ` · ${lastPay.method}` : ''}
          </span>
        )}
        {pending.length > 0 && balance > 0.004 && (
          <span className="hint">
            כולל {shekelSmart(pendingSum)} מאספקות שעוד לא נרשמו להן החזרות – אחרי הרישום היתרה תרד.
          </span>
        )}
        {pendingPast.map((p) => (
          <Link key={p.key} to={`/returns?agent=${agentId}&week=${p.weekStart}`} className="banner gold slim">
            <span className="ic"><Icon name="undo" size={18} /></span>
            <span className="txt">
              <b>החזרות · {p.weekStart ? weekInfo(fromIso(p.weekStart)).title : ''}</b>
              <span>עוד לא נרשמו</span>
            </span>
            <span className="go">לרישום</span>
          </Link>
        ))}
        <div className="two" style={{ marginTop: 8 }}>
          <Link to={`/agent/${agentId}/statement`} className="btn small ghost">
            <Icon name="receipt" size={20} /> דוח חשבון
          </Link>
          <button type="button" className="btn small" onClick={() => setPayOpen((o) => !o)} aria-expanded={payOpen}>
            <Icon name="wallet" size={20} /> תשלום
          </button>
        </div>
      </section>

      {payOpen && (
        <section ref={payRef} className="card box pay-box">
          <div className="pay-head">
            <h2>תשלום ל{agent.name}</h2>
            <button type="button" className="x-btn" aria-label="סגירה" onClick={() => setPayOpen(false)}>
              <Icon name="x" size={20} />
            </button>
          </div>
          <div className="two">
            <label className="date-chip" style={{ height: 52, fontSize: 17, justifyContent: 'center' }}>
              <Icon name="calendar" size={20} />
              {fmtDate(date)}
              <input type="date" aria-label="תאריך התשלום" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </label>
            <div className={`money-in${parsed === null ? ' bad' : ''}`}>
              <input
                ref={amountRef}
                inputMode="decimal"
                enterKeyHint="done"
                aria-label="סכום התשלום"
                aria-invalid={parsed === null}
                placeholder="סכום"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && pay()}
              />
              <span>₪</span>
            </div>
          </div>
          {balance > 0.004 && (
            <div className="chips">
              <button type="button" className="chip" onClick={() => setAmount(String(Math.round(balance * 100) / 100))}>
                כל היתרה · {shekelSmart(balance)}
              </button>
            </div>
          )}
          <div className="chips" role="radiogroup" aria-label="אמצעי תשלום">
            {PAY_METHODS.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={method === m} className={`chip${method === m ? ' on' : ''}`} onClick={() => setMethod(m)}>
                {m}
              </button>
            ))}
          </div>
          <input className="input" style={{ fontSize: 16, fontWeight: 600, height: 48 }} placeholder="הערה (לא חובה)" aria-label="הערה" value={note} onChange={(e) => setNote(e.target.value)} />
          {parsed === null && <div className="field-err">כותבים רק מספר, למשל 1200 או 350.50</div>}
          {(parsed ?? 0) > 0 && (
            <div className="after-row">
              <span>
                {after > 0.004 ? 'אחרי התשלום אני עדיין חייב' : after < -0.004 ? `אחרי התשלום יהיה לי פלוס אצל ${agent.name}` : 'אחרי התשלום החשבון מאוזן'}
              </span>
              <b>{shekelSmart(Math.abs(after))}</b>
            </div>
          )}
          <button type="button" className="btn" onClick={pay} disabled={saving}>{saving ? 'שומר…' : 'שמירת התשלום ואישור'}</button>
          <Link to={`/agent/${agentId}/statement`} className="hint center-link">
            רוצה לשלוח לסוכן דוח חשבון לפני התשלום? לחץ כאן
          </Link>
        </section>
      )}

      <div className="stack" style={{ margin: '12px 16px 0' }}>
        <div className="segment" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'ledger'} className={tab === 'ledger' ? 'on' : ''} onClick={() => setTab('ledger')}>תנועות</button>
          <button type="button" role="tab" aria-selected={tab === 'products'} className={tab === 'products' ? 'on' : ''} onClick={() => setTab('products')}>מוצרים ({prods.length})</button>
        </div>
      </div>

      {tab === 'ledger' ? (
        <section className="card ledger" style={{ margin: '10px 16px 0', padding: '2px 14px' }}>
          {ledger.length === 0 && <p className="hint" style={{ padding: '14px 0' }}>עוד אין תנועות. אחרי קבלת סחורה ותשלומים הם יופיעו כאן.</p>}
          {ledger.map((e) => {
            const d = fromIso(e.date);
            const noCredit = e.kind === 'returns' && Math.abs(e.amount) < 0.004;
            return (
              <div key={e.key} className="entry-wrap">
                <button type="button" className="entry" onClick={() => open(e)} aria-expanded={e.kind === 'payment' ? openPayment === e.key : undefined}>
                  <span className="when">
                    <small>{DAY_SHORT[d.getDay()]}</small>
                    <b>{d.getDate()}.{d.getMonth() + 1}</b>
                  </span>
                  <span className="what">
                    <b>{e.title}</b>
                    <span>
                      {e.kind === 'payment'
                        ? e.sub || 'תשלום'
                        : `${e.weekStart ? weekInfo(fromIso(e.weekStart)).title : ''}${
                            e.kind === 'delivery'
                              ? ` · ${e.manual ? `לפי סכום${e.note ? ` · ${e.note}` : ''}` : e.sub.split(' · ').pop()}`
                              : e.manual
                                ? ' · זיכוי לפי סכום'
                                : ''
                          }`}
                      {e.pendingReturns ? ' · ממתין להחזרות' : ''}
                    </span>
                  </span>
                  <span className="amt-col">
                    {noCredit ? (
                      <span className="amt muted">ללא זיכוי</span>
                    ) : (
                      <span className={`amt${e.amount < 0 ? ' minus' : ''}`}>{shekelSmart(e.amount, { signed: true }).replace('-', '−')}</span>
                    )}
                    <small className={e.balance > 0.004 ? 'owe' : e.balance < -0.004 ? 'credit' : ''}>
                      {e.balance > 0.004 ? `חוב ${shekelSmart(e.balance)}` : e.balance < -0.004 ? `פלוס ${shekelSmart(-e.balance)}` : 'מאוזן'}
                    </small>
                  </span>
                </button>
                {e.kind === 'payment' && openPayment === e.key && (
                  <div className="entry-more">
                    <Link to={`/agent/${agentId}/receipt/${e.id}`} className="btn small">
                      <Icon name="receipt" size={18} /> אישור תשלום
                    </Link>
                    <button type="button" className="danger-link" onClick={() => removePayment(e)}>
                      <Icon name="trash" size={18} /> מחיקה
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {ledger.length > 0 && <p className="hint ledger-key">+ סחורה (החוב שלי עולה) · − החזרות ותשלומים (החוב יורד) · מתחת לכל סכום: כמה החוב אחרי התנועה. לחיצה על תשלום – אישור תשלום לשליחה.</p>}
        </section>
      ) : (
        <section className="card" style={{ margin: '10px 16px 0', padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {prods.map((p) => (
            <Link key={p.id} to={`/product/${p.id}`} className="row" style={{ minHeight: 52 }}>
              <span className="grow">
                <b>{p.name}</b>
                <span>{p.returnable ? 'ניתן להחזרה' : 'ללא החזרה'}</span>
              </span>
              <span className="amt nowrap" style={{ fontSize: 15 }}>{shekelCents(p.agents.find((a) => a.agent_id === agentId)?.cost_price ?? 0)}</span>
            </Link>
          ))}
          <Link to={`/product/new?agent=${agentId}`} className="dashed-btn" style={{ margin: '6px 0' }}>
            <Icon name="plus" size={18} /> מוצר חדש לסוכן
          </Link>
        </section>
      )}
      <div style={{ height: 24 }} />
    </>
  );
}
