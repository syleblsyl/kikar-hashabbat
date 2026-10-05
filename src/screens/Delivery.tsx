import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ask } from '../components/Dialog';
import { useLeaveGuard } from '../components/guard';
import { Icon } from '../components/Icon';
import { matches, SearchBox } from '../components/SearchBox';
import { Stepper } from '../components/Stepper';
import { SubBar } from '../components/SubBar';
import { toast } from '../components/Toast';
import { getAgent, listAgents, type Agent } from '../db/catalog';
import { deleteDelivery, getStock, lastStockOf, saveStockAmount, saveStockItems, stockItems, type Delivery as Goods, type DeliveryItem } from '../db/ops';
import { loadInvoices, stateOf } from '../db/billing';
import { addMonthKey, dm, fromIso, iso, monthName, monthOf, parseIso, shortDate, today } from '../lib/dates';
import { hebDayMonth } from '../lib/hebrew';
import { parseAmountStrict, qty, shekelCents, shekelSmart } from '../lib/money';
import { useBack } from '../components/useBack';

type Mode = 'items' | 'amount';

/** Goods that arrived from an agent (stock): per product, or just what they are worth. */
export function Delivery() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const back = useBack();
  const isNew = !id || id === 'new';
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [existing, setExisting] = useState<Goods | null>(null);
  const [agentId, setAgentId] = useState(0);
  const [agentQ, setAgentQ] = useState('');
  const [picking, setPicking] = useState(false);
  const [items, setItems] = useState<DeliveryItem[] | null>(null);
  const [productQ, setProductQ] = useState('');
  const [date, setDate] = useState(iso(parseIso(params.get('date')) ?? today()));
  const [mode, setMode] = useState<Mode>('items');
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');
  const [returnable, setReturnable] = useState(true);
  const [prevSum, setPrevSum] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  useLeaveGuard(dirty);

  // the goods (when editing) and the agents to choose from
  useEffect(() => {
    (async () => {
      const list = await listAgents();
      let inv: Goods | null = null;
      if (!isNew) {
        inv = Number.isFinite(Number(id)) ? await getStock(Number(id)) : null;
        if (!inv) return setState('missing');
      }
      const want = inv?.agent_id ?? (Number(params.get('agent')) || 0);
      // a hidden agent can still be opened (to fix or delete old goods)
      if (want && !list.some((a) => a.id === want)) {
        const hidden = await getAgent(want);
        if (hidden) list.push(hidden);
      }
      setAgents(list);
      setExisting(inv);
      if (inv) {
        setDate(inv.delivery_date);
        setNote(inv.note ?? '');
        setReturnable(!!Number(inv.manual_returnable ?? 1));
        setMode(inv.manual_amount != null ? 'amount' : 'items');
        setAmountText(inv.manual_amount != null ? String(Number(inv.manual_amount)) : '');
      }
      setAgentId(want && list.some((a) => a.id === want) ? want : list.length === 1 ? list[0].id : 0);
      setState('ready');
    })();
  }, [id]);

  // the agent's products, and how he was recorded last time
  useEffect(() => {
    if (!agentId || state !== 'ready') return;
    let alive = true;
    (async () => {
      const [its, last] = await Promise.all([stockItems(agentId, existing?.id ?? null), lastStockOf(agentId, existing?.id ?? 0)]);
      if (!alive) return;
      setItems(its);
      setPrevSum(last?.received ?? 0);
      if (!existing) {
        setMode(last?.manual || its.length === 0 ? 'amount' : 'items');
        setReturnable(last?.returnable ?? true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [agentId, state]);

  const agent = agents.find((a) => a.id === agentId);
  const total = (items ?? []).reduce((s, i) => s + i.qty_received * i.unit_cost, 0);
  const units = (items ?? []).reduce((s, i) => s + i.qty_received, 0);
  const amount = parseAmountStrict(amountText);
  const owedNow = mode === 'amount' ? amount ?? 0 : total;
  const canCopy = !existing && units === 0 && (items ?? []).some((i) => i.prev_qty > 0);
  const hadLines = !!existing && existing.manual_amount == null;
  const hadSum = !!existing && existing.manual_amount != null;
  const shownAgents = useMemo(() => agents.filter((a) => matches(a.name, agentQ)), [agents, agentQ]);
  const shownItems = (items ?? []).filter((i) => matches(i.name, productQ) || i.qty_received > 0);

  function pickAgent(a: number) {
    if (a === agentId) return setPicking(false);
    setAgentId(a);
    setItems(null);
    setAgentQ('');
    setPicking(false);
    setDirty(true);
  }

  function setQty(pid: number, n: number) {
    setItems((its) => its?.map((i) => (i.product_id === pid ? { ...i, qty_received: n } : i)) ?? null);
    setDirty(true);
  }

  function copyLast() {
    setItems((its) => its?.map((i) => ({ ...i, qty_received: i.prev_qty })) ?? null);
    setDirty(true);
  }

  function chooseMode(m: Mode) {
    if (m === mode) return;
    setMode(m);
    setDirty(true);
    if (m === 'amount') setTimeout(() => amountRef.current?.focus(), 50);
  }

  async function save() {
    if (!items || !agent) return;
    if (mode === 'amount') {
      if (amount === null) return toast('הסכום לא תקין. כותבים רק מספר, למשל 2500 או 1250.50', 'err');
      if (amount <= 0) {
        amountRef.current?.focus();
        return toast('צריך לכתוב כמה שווה הסחורה', 'err');
      }
      // the agent's monthly invoice typed in here by habit would be counted twice
      const near = (await loadInvoices({ agentId: agent.id })).filter((i) => i.month >= addMonthKey(monthOf(date), -2) && Math.abs(i.amount - amount) < 1).pop();
      if (
        near &&
        !(await ask({
          title: 'זו החשבונית החודשית?',
          text: `הסכום שווה לחשבונית של ${agent.name} על ${monthName(near.month)}.\nאת החשבונית החודשית רושמים ב"חשבוניות", לא במלאי – אחרת היא נספרת פעמיים.`,
          ok: 'זה מלאי, לשמור',
          cancel: 'לא לשמור',
        }))
      )
        return;
      if (hadLines && !(await ask({ title: 'לעבור לסכום?', text: 'הכמויות שנרשמו למוצרים יימחקו, ובמקומן יישמר רק הסכום.', ok: 'כן, לשמור כסכום' })))
        return;
    } else {
      if (!existing && units === 0) return toast('צריך לרשום כמה הגיע לפחות ממוצר אחד', 'err');
      if (hadSum && !(await ask({ title: 'לעבור לפי מוצרים?', text: 'הסכום שנרשם יוחלף בחישוב לפי הכמויות של המוצרים.', ok: 'כן, לפי מוצרים' }))) return;
      if (existing && units === 0 && !(await ask({ title: 'למחוק את הסחורה?', text: 'כל הכמויות אפס, ולכן הרישום יימחק.', ok: 'מחיקה', danger: true })))
        return;
    }
    setSaving(true);
    try {
      if (mode === 'amount') await saveStockAmount(existing?.id ?? null, agent.id, date, amount ?? 0, note, returnable);
      else await saveStockItems(existing?.id ?? null, agent.id, date, items);
      const mk = monthOf(date);
      const st = await stateOf(agent.id, mk);
      toast(
        st.state === 'match'
          ? `נשמר ✓ המלאי של ${monthName(mk)} תואם לחשבונית`
          : st.state === 'mismatch'
            ? `נשמר · הפרש מול החשבונית של ${monthName(mk)}: ${shekelSmart(Math.abs(st.diff))}`
            : `נשמר ✓ נכנס למלאי של ${monthName(mk)}`,
      );
      setDirty(false);
      back({ force: true });
    } catch (e) {
      console.error(e);
      toast('השמירה נכשלה. נסה שוב.', 'err');
    }
    setSaving(false);
  }

  async function remove() {
    if (!existing || !agent) return;
    const ok = await ask({
      title: `למחוק את הסחורה של ${agent.name} מ-${dm(existing.delivery_date)}?`,
      text: 'הרישום יימחק, וגם ההחזרות שנרשמו עליו.',
      ok: 'מחיקה',
      danger: true,
    });
    if (!ok) return;
    await deleteDelivery(existing.id);
    toast('הסחורה נמחקה');
    setDirty(false);
    back({ force: true });
  }

  if (state === 'missing') {
    return (
      <>
        <SubBar title="סחורה" />
        <div className="card empty-card">
          <p>הסחורה הזו לא נמצאה (אולי נמחקה).</p>
          <Link to="/stock" className="btn small" style={{ width: 'auto', padding: '0 20px' }}>למלאי</Link>
        </div>
      </>
    );
  }
  if (state === 'ready' && agents.length === 0) {
    return (
      <>
        <SubBar title="קבלת סחורה" />
        <div className="card empty-card">
          <p>כדי לרשום סחורה צריך קודם להוסיף סוכן.</p>
          <Link to="/agent/new" className="btn small" style={{ width: 'auto', padding: '0 20px' }}>
            <Icon name="plus" /> הוספת סוכן
          </Link>
        </div>
      </>
    );
  }

  const saveDisabled =
    saving || !items || !agent || (mode === 'items' ? !existing && units === 0 : amount === null || (amount ?? 0) <= 0);

  return (
    <>
      <header className="bar">
        <button type="button" className="icon-btn" aria-label="חזרה" onClick={() => back()}>
          <Icon name="back" />
        </button>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <h1 className="page-title">{existing ? 'סחורה' : 'קבלת סחורה'}</h1>
          {agent && <span className="sub" style={{ fontSize: 14 }}>{agent.name}</span>}
        </div>
        <label className="date-chip">
          <Icon name="calendar" size={18} />
          {shortDate(fromIso(date))}
          <input
            type="date"
            aria-label="התאריך שהסחורה הגיעה"
            value={date}
            onChange={(e) => {
              if (!e.target.value) return;
              setDate(e.target.value);
              setDirty(true);
            }}
          />
        </label>
      </header>
      <p className="mode-note">
        {hebDayMonth(fromIso(date))} · נכנס למלאי של {monthName(monthOf(date))}
      </p>

      {/* which agent */}
      {!existing && (!agentId || picking) ? (
        <section className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
          <b style={{ fontSize: 17 }}>מאיזה סוכן הסחורה?</b>
          {agents.length > 6 && <SearchBox value={agentQ} onChange={setAgentQ} placeholder="חיפוש סוכן" />}
          <div className="agent-pick">
            {shownAgents.map((a) => (
              <button key={a.id} type="button" className={`agent-chip${a.id === agentId ? ' on' : ''}`} style={a.id === agentId ? { background: a.color ?? 'var(--primary)' } : undefined} onClick={() => pickAgent(a.id)}>
                {a.id !== agentId && <span className="dot" style={{ background: a.color ?? 'var(--primary)' }} />}
                {a.name}
              </button>
            ))}
            {shownAgents.length === 0 && <span className="hint">לא נמצא סוכן בשם הזה</span>}
          </div>
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
        <>
          <div className="pad" style={{ marginBottom: 10 }}>
            <div className="segment" role="radiogroup" aria-label="איך לרשום את הסחורה">
              <button type="button" role="radio" aria-checked={mode === 'items'} className={mode === 'items' ? 'on' : ''} onClick={() => chooseMode('items')}>
                לפי מוצרים
              </button>
              <button type="button" role="radio" aria-checked={mode === 'amount'} className={mode === 'amount' ? 'on' : ''} onClick={() => chooseMode('amount')}>
                סכום בלי פירוט
              </button>
            </div>
          </div>

          {mode === 'amount' ? (
            <section className="card box sum-box">
              <label className="lbl" htmlFor="dsum">
                כמה שווה הסחורה הזו?
              </label>
              <span className="hint" style={{ marginTop: -6 }}>זה לא החשבונית החודשית – אותה רושמים ב״חשבוניות״</span>
              <div className={`money-in big${amount === null ? ' bad' : ''}`}>
                <input
                  id="dsum"
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
              {amount === null && <div className="field-err">כותבים רק מספר, למשל 2500 או 1250.50</div>}
              {prevSum > 0 && !amountText && (
                <div className="chips">
                  <button
                    type="button"
                    className="chip"
                    onClick={() => {
                      setAmountText(String(Math.round(prevSum * 100) / 100));
                      setDirty(true);
                    }}
                  >
                    כמו בפעם הקודמת · {shekelSmart(prevSum)}
                  </button>
                </div>
              )}
              <input
                className="input"
                style={{ fontSize: 16, fontWeight: 600, height: 48 }}
                placeholder="הערה (לא חובה)"
                aria-label="הערה"
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setDirty(true);
                }}
              />
              <div className="line" style={{ gap: 12 }}>
                <span className="name" style={{ fontSize: 16 }}>
                  יש החזרות על הסחורה
                  <small className="hint" style={{ display: 'block', fontWeight: 500 }}>
                    {returnable ? 'במסך ההחזרות רושמים כמה זיכוי מגיע' : 'לא יופיע במסך ההחזרות'}
                  </small>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={returnable}
                  aria-label="יש החזרות על הסחורה"
                  className={`switch${returnable ? ' on' : ''}`}
                  onClick={() => {
                    setReturnable((r) => !r);
                    setDirty(true);
                  }}
                >
                  <span />
                </button>
              </div>
            </section>
          ) : items && items.length === 0 ? (
            <div className="card empty-card">
              <p>ל{agent.name} עוד אין מוצרים במחירון. אפשר לרשום את הסחורה כסכום בלי פירוט, או להוסיף לו מוצרים.</p>
              <button type="button" className="btn small" style={{ width: 'auto', padding: '0 20px' }} onClick={() => chooseMode('amount')}>
                רישום כסכום
              </button>
              <Link to={`/product/new?agent=${agentId}`} className="btn small ghost" style={{ width: 'auto', padding: '0 20px' }}>
                <Icon name="plus" /> מוצר חדש לסוכן
              </Link>
            </div>
          ) : (
            <>
              <div className="pad list-top">
                <span>כמה הגיע מכל מוצר?</span>
                <b>{qty(units)} יח׳</b>
              </div>
              {(items?.length ?? 0) > 6 && <SearchBox value={productQ} onChange={setProductQ} placeholder="חיפוש מוצר" className="pad-x" />}
              {canCopy && (
                <div className="pad" style={{ marginBottom: 10 }}>
                  <button type="button" className="dashed-btn" onClick={copyLast}>
                    <Icon name="refresh" size={18} /> למלא כמו בפעם הקודמת
                  </button>
                </div>
              )}
              <div className="items">
                {shownItems.map((i) => (
                  <div key={i.product_id} className="item">
                    <div className="thumb" style={{ background: i.tint ?? '#F1EDE2' }}>
                      {i.image ? <img src={i.image} alt="" /> : <span className="letter">{i.name.charAt(0)}</span>}
                    </div>
                    <div className="info">
                      <b>{i.name}</b>
                      <span className="s">
                        {shekelCents(i.unit_cost)} ליח׳{i.returnable ? '' : ' · ללא החזרה'}
                        {i.prev_qty > 0 ? ` · בפעם הקודמת: ${qty(i.prev_qty)}` : ''}
                      </span>
                      <div className="foot">
                        <span className="line-total">{i.qty_received > 0 ? shekelCents(i.qty_received * i.unit_cost) : ''}</span>
                        <Stepper value={i.qty_received} onChange={(n) => setQty(i.product_id, n)} label={i.name} />
                      </div>
                    </div>
                  </div>
                ))}
                {shownItems.length === 0 && <p className="hint" style={{ textAlign: 'center' }}>לא נמצא מוצר בשם הזה</p>}
              </div>
            </>
          )}

          {existing && (
            <div className="pad inv-actions">
              <Link to={`/returns?invoice=${existing.id}`} className="btn small ghost">
                <Icon name="undo" size={18} /> החזרות על הסחורה
              </Link>
              <button type="button" className="danger-link end-link" onClick={remove}>
                <Icon name="trash" size={18} /> מחיקת הסחורה
              </button>
            </div>
          )}
        </>
      )}

      <div className="footer compact">
        <div className="sum">
          <span>שווי הסחורה</span>
          <b>{shekelSmart(owedNow)}</b>
        </div>
        <button type="button" className="btn" onClick={save} disabled={saveDisabled}>
          {saving ? 'שומר…' : existing ? 'שמירת השינויים' : 'שמירת הסחורה'}
        </button>
      </div>
    </>
  );
}
