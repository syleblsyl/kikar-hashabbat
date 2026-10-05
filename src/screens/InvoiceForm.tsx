import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ask } from '../components/Dialog';
import { useLeaveGuard } from '../components/guard';
import { Icon } from '../components/Icon';
import { matches, SearchBox } from '../components/SearchBox';
import { SubBar } from '../components/SubBar';
import { toast } from '../components/Toast';
import { useBack } from '../components/useBack';
import { getAgent, listAgents, type Agent } from '../db/catalog';
import { allMonths, deleteAgentInvoice, getAgentInvoice, loadInvoices, monthAgents, saveAgentInvoice, similarInvoice, stateOf, type InvoiceRec, type MonthAgentRow } from '../db/billing';
import { MATCH, type AgentMonth } from '../db/money';
import { addMonthKey, fromIso, iso, monthName, monthOf, parseIso, shortDate, today } from '../lib/dates';
import { parseAmountStrict, shekelSmart } from '../lib/money';
import { parseYM } from '../components/MonthBar';

/** One monthly invoice from an agent: the sum on it, and the month of goods it is for. */
export function InvoiceForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const back = useBack();
  const isNew = !id || id === 'new';
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [existing, setExisting] = useState<InvoiceRec | null>(null);
  const [agentId, setAgentId] = useState(0);
  const [agentQ, setAgentQ] = useState('');
  const [picking, setPicking] = useState(false);
  const [date, setDate] = useState(iso(today()));
  // the month chosen (by a tap, a link or the saved invoice); without one it is the month before the date
  const [wantMonth, setWantMonth] = useState<string | null>(null);
  const [amountText, setAmountText] = useState('');
  const [number, setNumber] = useState('');
  const [note, setNote] = useState('');
  const [stock, setStock] = useState<AgentMonth | null>(null);
  const [others, setOthers] = useState<InvoiceRec[]>([]);
  const [monthRows, setMonthRows] = useState<MonthAgentRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  useLeaveGuard(dirty);

  useEffect(() => {
    (async () => {
      const list = await listAgents();
      let inv: InvoiceRec | null = null;
      if (!isNew) {
        inv = Number.isFinite(Number(id)) ? await getAgentInvoice(Number(id)) : null;
        if (!inv) return setState('missing');
      }
      const want = inv?.agentId ?? (Number(params.get('agent')) || 0);
      if (want && !list.some((a) => a.id === want)) {
        const hidden = await getAgent(want);
        if (hidden) list.push(hidden);
      }
      setAgents(list);
      setExisting(inv);
      if (inv) {
        setDate(inv.date);
        setWantMonth(inv.month);
        setAmountText(String(inv.amount));
        setNumber(inv.number ?? '');
        setNote(inv.note ?? '');
      } else {
        const m = params.get('month');
        if (m && parseYM(m) && m <= monthOf(iso(today()))) setWantMonth(m);
        const a = params.get('amount');
        if (a !== null && parseAmountStrict(a) !== null) setAmountText(a);
      }
      setAgentId(want && list.some((a) => a.id === want) ? want : 0);
      setState('ready');
    })();
  }, [id]);

  const dateMonth = monthOf(date);
  const month = wantMonth ? (wantMonth <= dateMonth ? wantMonth : dateMonth) : addMonthKey(dateMonth, -1);

  // which agents still owe an invoice for the month (for the picker)
  useEffect(() => {
    let alive = true;
    monthAgents(month).then((r) => alive && setMonthRows(r));
    return () => {
      alive = false;
    };
  }, [month]);

  // the agent's stock for that month, and his other invoices for it
  useEffect(() => {
    setStock(null);
    setOthers([]);
    if (!agentId) return;
    let alive = true;
    Promise.all([allMonths(agentId), loadInvoices({ agentId, month })]).then(([ms, inv]) => {
      if (!alive) return;
      setStock(ms.find((m) => m.month === month) ?? null);
      setOthers(inv.filter((i) => i.id !== existing?.id));
    });
    return () => {
      alive = false;
    };
  }, [agentId, month, existing?.id]);

  const agent = agents.find((a) => a.id === agentId);
  const amount = parseSigned(amountText);
  const monthOptions = useMemo(() => {
    const opts = [addMonthKey(dateMonth, -2), addMonthKey(dateMonth, -1), dateMonth];
    if (!opts.includes(month)) opts.unshift(month);
    return opts;
  }, [dateMonth, month]);
  const rowOf = new Map(monthRows.map((r) => [r.agentId, r]));
  const shownAgents = agents
    .filter((a) => matches(a.name, agentQ))
    .sort((a, b) => {
      // agents still waiting for this month's invoice first
      const wa = rowOf.get(a.id)?.state === 'waiting' ? 0 : 1;
      const wb = rowOf.get(b.id)?.state === 'waiting' ? 0 : 1;
      return wa - wb || a.name.localeCompare(b.name, 'he');
    });
  const hasStock = !!stock && (stock.stockCount > 0 || stock.creditCount > 0 || Math.abs(stock.carried) > 0.004);
  const othersSum = others.reduce((s, i) => s + i.amount, 0);
  const diff = (amount ?? 0) + othersSum - (stock?.compare ?? 0);
  const fromCheck = params.get('from') === 'check';

  function changeDate(v: string) {
    if (v > iso(today())) return toast('אי אפשר לרשום חשבונית בתאריך שעוד לא הגיע', 'err');
    setDate(v);
    setDirty(true);
  }

  function pickAgent(a: number) {
    setAgentId(a);
    setAgentQ('');
    setPicking(false);
    setDirty(true);
    setTimeout(() => amountRef.current?.focus(), 80);
  }

  async function save() {
    if (!agent) return;
    if (amount === null) return toast('הסכום לא תקין. כותבים רק מספר, למשל 12400 או 980.50', 'err');
    if (month > dateMonth || date > iso(today())) return toast('חשבונית לא יכולה להיות על חודש שעוד לא התחיל', 'err');
    if (
      amount === 0 &&
      others.length === 0 &&
      !(await ask({
        title: 'חשבונית של 0 ₪?',
        text: `ל${monthName(month)} לא יהיה חיוב משלו: הסוכן חייב אותו יחד עם ${monthName(addMonthKey(month, 1))}, והמלאי שלו ייבדק מול החשבונית של ${monthName(addMonthKey(month, 1))}.`,
        ok: 'כן, 0 ₪',
      }))
    )
      return;
    const similar = await similarInvoice(agent.id, month, amount, number, existing?.id ?? 0);
    if (
      similar &&
      !(await ask({
        title: 'כבר רשומה חשבונית כזו',
        text: `ל${agent.name} על ${monthName(month)} כבר רשומה חשבונית${similar.number ? ` מס׳ ${similar.number}` : ''} של ${shekelSmart(similar.amount)}.\nלרשום עוד אחת? הסכומים יתחברו.`,
        ok: 'לרשום עוד אחת',
        cancel: 'לא',
      }))
    )
      return;
    setSaving(true);
    try {
      await saveAgentInvoice({ id: existing?.id, agentId: agent.id, month, date, amount, number, note });
      setDirty(false);
      const st = await stateOf(agent.id, month);
      if (st.state === 'mismatch') {
        toast(`נשמר · יש הפרש של ${shekelSmart(Math.abs(st.diff))} מול המלאי`);
        // opened from the check screen: going back shows it again (fresh)
        if (fromCheck) back({ force: true });
        else nav(`/check/${agent.id}/${month}`, { replace: true });
      } else {
        toast(st.state === 'match' ? 'נשמר ✓ תואם למלאי' : 'החשבונית נשמרה ✓');
        back({ force: true });
      }
    } catch (e) {
      console.error(e);
      toast('השמירה נכשלה. נסה שוב.', 'err');
    }
    setSaving(false);
  }

  async function remove() {
    if (!existing || !agent) return;
    const ok = await ask({
      title: `למחוק את החשבונית של ${agent.name} על ${monthName(existing.month)}?`,
      text: others.length > 0 ? 'החיוב לחודש יהיה לפי החשבוניות האחרות שלו.' : 'החיוב לחודש הזה יחזור להיות לפי המלאי.',
      ok: 'מחיקה',
      danger: true,
    });
    if (!ok) return;
    await deleteAgentInvoice(existing.id);
    toast('החשבונית נמחקה');
    setDirty(false);
    back({ force: true });
  }

  if (state === 'missing') {
    return (
      <>
        <SubBar title="חשבונית" />
        <div className="card empty-card">
          <p>החשבונית הזו לא נמצאה (אולי נמחקה).</p>
          <Link to="/invoices" className="btn small" style={{ width: 'auto', padding: '0 20px' }}>לחשבוניות</Link>
        </div>
      </>
    );
  }
  if (state === 'ready' && agents.length === 0) {
    return (
      <>
        <SubBar title="חשבונית מסוכן" />
        <div className="card empty-card">
          <p>כדי לרשום חשבונית צריך קודם להוסיף סוכן.</p>
          <Link to="/agent/new" className="btn small" style={{ width: 'auto', padding: '0 20px' }}>
            <Icon name="plus" /> הוספת סוכן
          </Link>
        </div>
      </>
    );
  }

  const saveDisabled = saving || !agent || amount === null || amountText.trim() === '';

  return (
    <>
      <header className="bar">
        <button type="button" className="icon-btn" aria-label="חזרה" onClick={() => back()}>
          <Icon name="back" />
        </button>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <h1 className="page-title">{existing ? 'חשבונית' : 'חשבונית מסוכן'}</h1>
          {agent && <span className="sub" style={{ fontSize: 14 }}>{agent.name}</span>}
        </div>
        <label className="date-chip">
          <Icon name="calendar" size={18} />
          {shortDate(fromIso(date))}
          <input type="date" aria-label="התאריך שקיבלתי את החשבונית" value={date} max={iso(today())} onChange={(e) => parseIso(e.target.value) && changeDate(e.target.value)} />
        </label>
      </header>

      {!existing && (!agentId || picking) ? (
        <section className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
          <b style={{ fontSize: 17 }}>מאיזה סוכן החשבונית?</b>
          {agents.length > 6 && <SearchBox value={agentQ} onChange={setAgentQ} placeholder="חיפוש סוכן" />}
          <div className="agent-pick">
            {shownAgents.map((a) => {
              const r = rowOf.get(a.id);
              const has = !!r && r.m.invoiceCount > 0;
              return (
                <button key={a.id} type="button" className={`agent-chip${a.id === agentId ? ' on' : ''}`} style={a.id === agentId ? { background: a.color ?? 'var(--primary)' } : undefined} onClick={() => pickAgent(a.id)}>
                  {a.id !== agentId && <span className="dot" style={{ background: a.color ?? 'var(--primary)' }} />}
                  {a.name}
                  {has && (
                    <span className="ok" aria-label="כבר יש חשבונית">
                      <Icon name="check" size={16} />
                    </span>
                  )}
                </button>
              );
            })}
            {shownAgents.length === 0 && <span className="hint">לא נמצא סוכן בשם הזה</span>}
          </div>
          {monthRows.some((r) => r.state === 'waiting') && <span className="hint">קודם מופיעים הסוכנים שעוד לא נרשמה להם חשבונית על {monthName(month)} · ✓ = כבר נרשמה</span>}
        </section>
      ) : (
        !existing && (
          <div className="pad chosen-agent">
            <span className="dot" style={{ background: agent?.color ?? 'var(--primary)', width: 12, height: 12, borderRadius: 6 }} />
            <b>{agent?.name}</b>
            <button type="button" className="chip" onClick={() => setPicking(true)}>
              החלפת סוכן
            </button>
          </div>
        )
      )}

      {agent && (
        <div className="form" style={{ paddingTop: 0 }}>
          <div className="field">
            <span className="lbl">על איזה חודש?</span>
            <div className="segment" role="radiogroup" aria-label="החודש של הסחורה">
              {monthOptions.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={month === m}
                  className={month === m ? 'on' : ''}
                  onClick={() => {
                    setWantMonth(m);
                    setDirty(true);
                  }}
                >
                  {monthName(m)}
                </button>
              ))}
            </div>
            <span className="hint">חשבונית שמגיעה ב{monthName(dateMonth)} היא בדרך כלל על {monthName(addMonthKey(dateMonth, -1))}</span>
          </div>

          {others.length > 0 && (
            <div className="info-note" style={{ margin: 0 }}>
              כבר רשומה ל{agent.name} {others.length === 1 ? 'חשבונית' : `${others.length} חשבוניות`} על {monthName(month)} ({shekelSmart(othersSum)}). אם זו חשבונית נוספת – הסכומים יתחברו.
            </div>
          )}

          <section className="box sum-box" style={{ margin: 0 }}>
            <label className="lbl" htmlFor="isum">
              כמה לשלם לפי החשבונית?
            </label>
            <div className={`money-in big${amount === null ? ' bad' : ''}`}>
              <input
                id="isum"
                ref={amountRef}
                inputMode="decimal"
                enterKeyHint="done"
                placeholder="0"
                aria-invalid={amount === null}
                value={amountText}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => {
                  setAmountText(e.target.value);
                  setDirty(true);
                }}
                onKeyDown={(e) => e.key === 'Enter' && !saveDisabled && save()}
              />
              <span>₪</span>
            </div>
            {amount === null && <div className="field-err">כותבים רק מספר, למשל 12400 או 980.50</div>}
            <span className="hint">הסכום הסופי שכתוב בחשבונית, אחרי ההחזרות · זיכוי מהסוכן: עם מינוס, למשל ‎-300</span>
            {!hasStock ? (
              <div className="cmp mute">אין מלאי ל{monthName(month)} – אין עם מה להשוות</div>
            ) : (
              <>
                <div className="after-row">
                  <span>
                    לפי המלאי של {monthName(month)}
                    {stock && Math.abs(stock.carried) > 0.004 ? ` (כולל ${monthName(addMonthKey(month, -1))})` : ''}
                  </span>
                  <b>{shekelSmart(stock?.compare ?? 0).replace('-', '−')}</b>
                </div>
                {amountText.trim() !== '' && amount !== null && (
                  <div className={`cmp ${Math.abs(diff) < MATCH ? 'ok' : 'bad'}`}>
                    {Math.abs(diff) < MATCH
                      ? '✓ תואם למלאי'
                      : `הפרש ${shekelSmart(Math.abs(diff))} · ${others.length ? 'בחשבוניות' : 'בחשבונית'} ${diff > 0 ? 'יותר' : 'פחות'} מהמלאי`}
                  </div>
                )}
              </>
            )}
          </section>

          <div className="field">
            <label htmlFor="inum">מספר חשבונית (לא חובה)</label>
            <input
              id="inum"
              className="input"
              value={number}
              onChange={(e) => {
                setNumber(e.target.value);
                setDirty(true);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="inote">הערה (לא חובה)</label>
            <input
              id="inote"
              className="input"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setDirty(true);
              }}
            />
          </div>

          {existing && (
            <button type="button" className="danger-link end-link" onClick={remove}>
              <Icon name="trash" size={18} /> מחיקת החשבונית
            </button>
          )}
        </div>
      )}

      <div className="footer compact">
        <div className="sum">
          <span>החשבונית</span>
          <b>{shekelSmart(amount ?? 0).replace('-', '−')}</b>
        </div>
        <button type="button" className="btn" onClick={save} disabled={saveDisabled}>
          {saving ? 'שומר…' : existing ? 'שמירת השינויים' : 'שמירת החשבונית'}
        </button>
      </div>
    </>
  );
}

/** An amount that may be negative (a credit note from the agent): "-300", "−300". */
function parseSigned(text: string): number | null {
  const t = text.trim();
  if (/^[-−]/.test(t)) {
    const v = parseAmountStrict(t.slice(1));
    return v === null ? null : -v;
  }
  return parseAmountStrict(t);
}
