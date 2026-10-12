import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ask } from '../components/Dialog';
import { useLeaveGuard } from '../components/guard';
import { Icon } from '../components/Icon';
import { MonthBar, parseYM, ymKey, type YM } from '../components/MonthBar';
import { matches, SearchBox } from '../components/SearchBox';
import { toast } from '../components/Toast';
import { getAgent, productsOfAgent, unhideAgent, type Agent, type Product } from '../db/catalog';
import { pendingReturns, type StockRow } from '../db/ops';
import { agentLedger, agentMonthsWithState, balances, deleteAgentRow, saveAgentRow, type AgentMonth, type CheckState, type LedgerEntry, type RowKind } from '../db/billing';
import { CheckPill } from '../components/CheckPill';
import { addMonthKey, DAY_NAMES, dm, iso, monthName, startOfWeek, thisMonthKey, today } from '../lib/dates';
import { parseAmountStrict, products as productsLabel, shekelCents, shekelSmart } from '../lib/money';
import { initialOf } from './Agents';
import { useBack } from '../components/useBack';
import { myBalanceWords } from '../components/AgentDocs';
import { waLink } from '../lib/share';

const PAY_METHODS = ['מזומן', 'העברה', 'צ׳ק', 'אשראי'];

type Side = 'debit' | 'credit';
type Form = {
  side: Side;
  /** a זכות row: my payment, or a credit the agent gave */
  creditKind: 'payment' | 'credit';
  month: string;
  amount: string;
  number: string;
  method: string;
  note: string;
  /** the row being changed */
  was?: { kind: RowKind; id: number; date: string };
};

const kindOf = (f: Form): RowKind => (f.side === 'debit' ? 'invoice' : f.creditKind);

function newForm(side: Side, creditKind: 'payment' | 'credit' = 'payment', forMonth?: string): Form {
  // an invoice usually comes for last month; a payment is written on this month
  const month = forMonth ?? (side === 'debit' ? addMonthKey(thisMonthKey(), -1) : thisMonthKey());
  return { side, creditKind, month, amount: '', number: '', method: '', note: '' };
}

const rowTitle = (e: LedgerEntry) =>
  e.kind === 'invoice' ? `חשבונית${e.number ? ` מס׳ ${e.number}` : ''}` : e.kind === 'credit' ? `זיכוי מהסוכן${e.number ? ` מס׳ ${e.number}` : ''}` : `תשלום${e.method ? ` · ${e.method}` : ''}`;

/** The agent's card: what I owe him, and his rows by month – חובה (invoices) and זכות (payments, credits). */
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
  const [tab, setTab] = useState<'rows' | 'stock' | 'products'>('rows');
  const [months, setMonths] = useState<{ m: AgentMonth; state: CheckState; diff: number }[]>([]);
  const [pendingRet, setPendingRet] = useState<StockRow[]>([]);
  const [form, setForm] = useState<Form | null>(() => (params.get('pay') ? newForm('credit') : params.get('row') === 'invoice' ? newForm('debit') : null));
  const [formDirty, setFormDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [prodQ, setProdQ] = useState('');
  const formRef = useRef<HTMLElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  useLeaveGuard(!!form && formDirty);

  async function load() {
    if (!Number.isFinite(agentId) || agentId <= 0) return setAgent(null);
    const [a, l, b, p, ms, pr] = await Promise.all([getAgent(agentId), agentLedger(agentId), balances(), productsOfAgent(agentId), agentMonthsWithState(agentId), pendingReturns(false)]);
    setAgent(a);
    setLedger(l);
    setBalance(b.get(agentId) ?? 0);
    setProds(p);
    setMonths(ms);
    setPendingRet(pr.filter((r) => r.agent_id === agentId));
  }

  useEffect(() => {
    load();
  }, [agentId]);

  // the form opens in view, with the keyboard on the amount
  const formKey = form ? `${form.was?.kind ?? 'new'}${form.was?.id ?? ''}${form.side}` : '';
  useEffect(() => {
    if (!form || !agent) return;
    const t = setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      amountRef.current?.focus();
    }, 120);
    return () => clearTimeout(t);
  }, [formKey, !!agent]);

  function openForm(f: Form) {
    setForm(f);
    setFormDirty(false);
    setOpenRow(null);
  }

  function edit(e: LedgerEntry) {
    openForm({
      side: e.kind === 'invoice' ? 'debit' : 'credit',
      creditKind: e.kind === 'credit' ? 'credit' : 'payment',
      month: e.month,
      amount: String(Math.abs(e.amount)),
      number: e.number ?? '',
      method: e.method ?? '',
      note: e.note ?? '',
      was: { kind: e.kind, id: e.id, date: e.date },
    });
  }

  function change<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setFormDirty(true);
  }

  const parsed = form ? parseAmountStrict(form.amount) : 0;
  const sign = form ? (form.side === 'debit' ? 1 : -1) : 0;
  const wasAmount = form?.was ? ledger.find((e) => e.kind === form.was!.kind && e.id === form.was!.id)?.amount ?? 0 : 0;
  const after = balance - wasAmount + sign * (parsed ?? 0);
  const stockOfMonth = form ? months.find((x) => x.m.month === form.month)?.m : undefined;

  async function save() {
    if (!form || !agent) return;
    if (parsed === null) return toast('הסכום לא תקין. כותבים רק מספר, למשל 1200 או 350.50', 'err');
    if (parsed <= 0) {
      amountRef.current?.focus();
      return toast('צריך לכתוב סכום', 'err');
    }
    setSaving(true);
    try {
      const kind = kindOf(form);
      const res = await saveAgentRow({ agentId, kind, month: form.month, amount: parsed, number: form.number, method: form.method, note: form.note, was: form.was });
      setForm(null);
      setFormDirty(false);
      // a new payment: the payment confirmation, to send to the agent
      if (kind === 'payment' && !form.was) {
        nav(`/agent/${agentId}`, { replace: true });
        nav(`/agent/${agentId}/receipt/${res.id}?new=1`);
        return;
      }
      toast(kind === 'invoice' ? `נשמר ✓ חובה על ${monthName(form.month)}` : `נשמר ✓ זכות על ${monthName(form.month)}`);
      await load();
    } catch (e) {
      console.error(e);
      toast('השמירה נכשלה. נסה שוב.', 'err');
    }
    setSaving(false);
  }

  async function remove(e: LedgerEntry) {
    const ok = await ask({
      title: 'למחוק את השורה?',
      text: `${rowTitle(e)} · ${shekelSmart(Math.abs(e.amount))} · ${monthName(e.month, true)}.\nהיתרה לסוכן תשתנה בהתאם.`,
      ok: 'מחיקה',
      danger: true,
    });
    if (!ok) return;
    await deleteAgentRow(e.kind, e.id);
    toast('השורה נמחקה');
    setOpenRow(null);
    if (form?.was?.id === e.id && form.was.kind === e.kind) setForm(null);
    load();
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
  const mine = myBalanceWords(balance, agent.name);
  const lastPay = ledger.find((e) => e.kind === 'payment');
  const pendingPast = pendingRet.filter((r) => r.date < iso(startOfWeek(today())));
  const stateOfMonth = new Map(months.map((x) => [x.m.month, x]));
  // past months with goods and no invoice yet – the invoice is missing
  const missing = months.filter((x) => x.state === 'waiting' && x.m.month < thisMonthKey()).map((x) => x.m.month);
  // rows by month, newest month first (a month with a missing invoice shows even without rows)
  const groups: { month: string; rows: LedgerEntry[]; debit: number; credit: number }[] = missing.map((month) => ({ month, rows: [], debit: 0, credit: 0 }));
  for (const e of ledger) {
    let g = groups.find((x) => x.month === e.month);
    if (!g) {
      g = { month: e.month, rows: [], debit: 0, credit: 0 };
      groups.push(g);
    }
    g.rows.push(e);
    if (e.amount > 0) g.debit += e.amount;
    else g.credit -= e.amount;
  }
  groups.sort((a, b) => (a.month < b.month ? 1 : -1));

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
        <div className="acts four">
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
          <Link to={`/stock/new?agent=${agentId}`}><Icon name="truck" size={18} /> סחורה</Link>
          <Link to={`/agent/${agentId}/statement`}><Icon name="file" size={18} /> דוח</Link>
        </div>
      </section>

      <section className="card balance">
        <span className="k">{mine.label}</span>
        <span className={`v ${mine.tone}`}>{shekelSmart(Math.abs(balance))}</span>
        <span className="hint">חובה פחות זכות, מכל השורות</span>
        {missing.length > 0 && (
          <span className="hint miss-hint">
            {missing.length > 1 ? 'חסרות חשבוניות על' : 'חסרה חשבונית על'} {missing.map((m) => monthName(m)).join(', ')} –{' '}
            {missing.length > 1 ? 'עד שנרשמות, הן לא בחוב.' : 'עד שנרשמת, היא לא בחוב.'}
          </span>
        )}
        {lastPay && (
          <span className="hint">
            תשלום אחרון: {shekelSmart(-lastPay.amount)} על {monthName(lastPay.month, true)}
            {lastPay.method ? ` · ${lastPay.method}` : ''}
          </span>
        )}
        {pendingPast.map((p) => (
          <Link key={p.id} to={`/returns?invoice=${p.id}`} className="banner gold slim">
            <span className="ic"><Icon name="undo" size={18} /></span>
            <span className="txt">
              <b>החזרות · סחורה מ-{dm(p.date)}</b>
              <span>עוד לא נרשמו</span>
            </span>
            <span className="go">לרישום</span>
          </Link>
        ))}
        <div className="two side-btns" style={{ marginTop: 8 }}>
          <button type="button" className="btn small debit" onClick={() => openForm(newForm('debit'))}>
            <Icon name="plus" size={20} /> חובה
          </button>
          <button type="button" className="btn small credit" onClick={() => openForm(newForm('credit'))}>
            <Icon name="plus" size={20} /> זכות
          </button>
        </div>
        <span className="hint" style={{ textAlign: 'center' }}>חובה = חשבונית · זכות = תשלום או זיכוי</span>
      </section>

      {form && (
        <section ref={formRef} className="card box row-form">
          <div className="pay-head">
            <h2>{form.was ? 'עריכת שורה' : 'שורה חדשה'}</h2>
            <button
              type="button"
              className="x-btn"
              aria-label="סגירה"
              onClick={() => {
                setForm(null);
                setFormDirty(false);
              }}
            >
              <Icon name="x" size={20} />
            </button>
          </div>

          <div className="segment side-seg" role="radiogroup" aria-label="חובה או זכות">
            <button type="button" role="radio" aria-checked={form.side === 'debit'} className={`d${form.side === 'debit' ? ' on' : ''}`} onClick={() => change('side', 'debit')}>
              חובה
            </button>
            <button type="button" role="radio" aria-checked={form.side === 'credit'} className={`c${form.side === 'credit' ? ' on' : ''}`} onClick={() => change('side', 'credit')}>
              זכות
            </button>
          </div>
          {form.side === 'credit' && (
            <div className="chips" role="radiogroup" aria-label="סוג הזכות">
              <button type="button" role="radio" aria-checked={form.creditKind === 'payment'} className={`chip${form.creditKind === 'payment' ? ' on' : ''}`} onClick={() => change('creditKind', 'payment')}>
                תשלום שלי לסוכן
              </button>
              <button type="button" role="radio" aria-checked={form.creditKind === 'credit'} className={`chip${form.creditKind === 'credit' ? ' on' : ''}`} onClick={() => change('creditKind', 'credit')}>
                זיכוי מהסוכן
              </button>
            </div>
          )}

          <div className={`money-in big${parsed === null ? ' bad' : ''}`}>
            <input
              ref={amountRef}
              inputMode="decimal"
              enterKeyHint="done"
              aria-label="סכום"
              aria-invalid={parsed === null}
              placeholder="סכום"
              value={form.amount}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => change('amount', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
            <span>₪</span>
          </div>
          {parsed === null && <div className="field-err">כותבים רק מספר, למשל 1200 או 350.50</div>}

          <span className="lbl">לאיזה חודש?</span>
          <MonthBar ym={parseYM(form.month)!} onChange={(next: YM) => change('month', ymKey(next))} />
          {form.side === 'debit' && stockOfMonth && (stockOfMonth.stockCount > 0 || stockOfMonth.creditCount > 0) && (
            <span className="hint">לפי המלאי של {monthName(form.month)}: {shekelSmart(stockOfMonth.compare)}</span>
          )}

          {form.side === 'credit' && form.creditKind === 'payment' ? (
            <div className="chips" role="radiogroup" aria-label="אמצעי תשלום">
              {PAY_METHODS.map((m) => (
                <button key={m} type="button" role="radio" aria-checked={form.method === m} className={`chip${form.method === m ? ' on' : ''}`} onClick={() => change('method', form.method === m ? '' : m)}>
                  {m}
                </button>
              ))}
            </div>
          ) : (
            <input
              className="input"
              style={{ fontSize: 16, fontWeight: 600, height: 48 }}
              placeholder={form.side === 'debit' ? 'מספר חשבונית (לא חובה)' : 'מספר זיכוי (לא חובה)'}
              aria-label="מספר"
              value={form.number}
              onChange={(e) => change('number', e.target.value)}
            />
          )}
          <input className="input" style={{ fontSize: 16, fontWeight: 600, height: 48 }} placeholder="הערה (לא חובה)" aria-label="הערה" value={form.note} onChange={(e) => change('note', e.target.value)} />

          {(parsed ?? 0) > 0 && (
            <div className="after-row">
              <span>{after > 0.004 ? 'אחרי השורה אני חייב' : after < -0.004 ? `אחרי השורה ${agent.name} חייב לי` : 'אחרי השורה החשבון מאוזן'}</span>
              <b>{shekelSmart(Math.abs(after))}</b>
            </div>
          )}
          <button type="button" className="btn" onClick={save} disabled={saving}>
            {saving ? 'שומר…' : form.was ? 'שמירת השינוי' : kindOf(form) === 'payment' ? 'שמירה ואישור תשלום' : 'שמירה'}
          </button>
        </section>
      )}

      <div className="stack" style={{ margin: '12px 16px 0' }}>
        <div className="segment" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'rows'} className={tab === 'rows' ? 'on' : ''} onClick={() => setTab('rows')}>חובה וזכות</button>
          <button type="button" role="tab" aria-selected={tab === 'stock'} className={tab === 'stock' ? 'on' : ''} onClick={() => setTab('stock')}>מלאי</button>
          <button type="button" role="tab" aria-selected={tab === 'products'} className={tab === 'products' ? 'on' : ''} onClick={() => setTab('products')}>מוצרים ({prods.length})</button>
        </div>
      </div>

      {tab === 'rows' ? (
        <>
          {groups.length === 0 && (
            <div className="card empty-card">
              <p>עוד אין שורות. כשמגיעה חשבונית – "+ חובה". כשמשלמים – "+ זכות".</p>
            </div>
          )}
          {groups.map((g) => {
            const st = stateOfMonth.get(g.month);
            const miss = missing.includes(g.month);
            return (
              <section key={g.month} className={`card ledger rows-month${miss ? ' miss' : ''}`}>
                <div className="rm-head">
                  <b>{monthName(g.month, true)}</b>
                  {st && !miss && st.state !== 'empty' && st.state !== 'no-stock' && st.state !== 'waiting' && (
                    <Link to={`/check/${agentId}/${g.month}`} aria-label="בדיקה מול המלאי">
                      <CheckPill state={st.state} diff={st.diff} />
                    </Link>
                  )}
                  {miss && <span className="pill gold nowrap">חסרה חשבונית</span>}
                </div>
                <div className="rm-sum">
                  <span>חובה {shekelSmart(g.debit)}</span>
                  <span>זכות {shekelSmart(g.credit)}</span>
                  {miss ? (
                    <span className="wait">לפי המלאי {shekelSmart(st?.m.compare ?? 0)}</span>
                  ) : (
                    <span className={g.debit - g.credit > 0.004 ? 'owe' : g.debit - g.credit < -0.004 ? 'plus' : 'ok'}>
                      {Math.abs(g.debit - g.credit) < 0.005 ? 'סגור ✓' : g.debit > g.credit ? `נשאר ${shekelSmart(g.debit - g.credit)}` : `עודף ${shekelSmart(g.credit - g.debit)}`}
                    </span>
                  )}
                </div>
                {miss && (
                  <button type="button" className="dashed-btn miss-add" onClick={() => openForm(newForm('debit', 'payment', g.month))}>
                    <Icon name="plus" size={18} /> חובה – החשבונית של {monthName(g.month)}
                  </button>
                )}
                {g.rows.map((e) => {
                  const isDebit = e.amount > 0;
                  return (
                    <div key={e.key} className="entry-wrap">
                      <button type="button" className="entry row-entry" onClick={() => setOpenRow((k) => (k === e.key ? null : e.key))} aria-expanded={openRow === e.key}>
                        <span className={`side-tag ${isDebit ? 'd' : 'c'}`}>{isDebit ? 'חובה' : 'זכות'}</span>
                        <span className="what">
                          <b>{rowTitle(e)}</b>
                          {e.note && <span>{e.note}</span>}
                        </span>
                        <span className="amt-col">
                          <span className={`amt${isDebit ? '' : ' minus'}`}>{shekelSmart(Math.abs(e.amount))}</span>
                          <small className={e.balance > 0.004 ? 'owe' : e.balance < -0.004 ? 'credit' : ''}>
                            {e.balance > 0.004 ? `חוב ${shekelSmart(e.balance)}` : e.balance < -0.004 ? `פלוס ${shekelSmart(-e.balance)}` : 'מאוזן'}
                          </small>
                        </span>
                      </button>
                      {openRow === e.key && (
                        <div className="entry-more">
                          <button type="button" className="btn small" onClick={() => edit(e)}>
                            <Icon name="edit" size={18} /> עריכה
                          </button>
                          {e.kind === 'payment' && (
                            <Link to={`/agent/${agentId}/receipt/${e.id}`} className="btn small ghost">
                              <Icon name="receipt" size={18} /> אישור
                            </Link>
                          )}
                          <button type="button" className="danger-link" onClick={() => remove(e)}>
                            <Icon name="trash" size={18} /> מחיקה
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            );
          })}
          {groups.length > 0 && <p className="hint rows-key">מתחת לכל סכום: כמה החוב אחרי השורה. לחיצה על שורה – עריכה או מחיקה.</p>}
        </>
      ) : tab === 'stock' ? (
        <section className="card list" style={{ margin: '10px 16px 0', padding: '2px 14px' }}>
          <p className="hint" style={{ margin: '10px 0 4px' }}>המלאי לא נכנס לחוב – הוא רק לבדיקה שהחשבונית נכונה.</p>
          {months.length === 0 && <div className="empty">עוד לא נרשמה סחורה.</div>}
          {months.map(({ m, state, diff }) => (
            <Link key={m.month} to={`/check/${agentId}/${m.month}`} className="row">
              <span className="grow">
                <b>{monthName(m.month, true)}</b>
                <span>
                  {m.stockCount > 0 || m.creditCount > 0 ? `מלאי ${shekelSmart(m.expected)}` : 'בלי מלאי'}
                  {m.invoiceCount > 0 ? ` · חשבונית ${shekelSmart(m.invoiced)}` : ''}
                  {m.openReturns > 0 ? ' · מחכה להחזרות' : ''}
                </span>
              </span>
              <CheckPill state={state} diff={diff} waitingText="אין חשבונית" />
            </Link>
          ))}
          <Link to={`/stock/new?agent=${agentId}`} className="dashed-btn" style={{ margin: '6px 0 10px' }}>
            <Icon name="plus" size={18} /> קבלת סחורה
          </Link>
        </section>
      ) : (
        <section className="card" style={{ margin: '10px 16px 0', padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {prods.length > 6 && <SearchBox value={prodQ} onChange={setProdQ} placeholder="חיפוש מוצר" className="in-list" />}
          {prods.filter((p) => matches(p.name, prodQ)).map((p) => (
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
