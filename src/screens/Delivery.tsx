import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ask } from '../components/Dialog';
import { useLeaveGuard } from '../components/guard';
import { Icon } from '../components/Icon';
import { Stepper } from '../components/Stepper';
import { SubBar } from '../components/SubBar';
import { toast } from '../components/Toast';
import { WeekBar } from '../components/WeekBar';
import { getAgent, listAgents, type Agent } from '../db/catalog';
import {
  balanceOf,
  deleteDelivery,
  deliveredAgents,
  deliveryItems,
  getDelivery,
  lastDeliveryOf,
  saveDelivery,
  saveDeliveryAmount,
  type Delivery as DeliveryRow,
  type DeliveryItem,
} from '../db/ops';
import { addDays, fromIso, iso, parseIso, shortDate, startOfWeek, today } from '../lib/dates';
import { parseAmountStrict, qty, shekelCents, shekelSmart } from '../lib/money';
import { useBack } from '../components/useBack';

/** Default delivery date inside a week: today if it is in that week, else the agent's usual day. */
function defaultDate(weekStart: Date, agent: Agent | undefined): string {
  const t = today();
  if (startOfWeek(t).getTime() === weekStart.getTime()) return iso(t);
  return iso(addDays(weekStart, agent?.delivery_day ?? 4));
}

type Mode = 'items' | 'amount';

export function Delivery() {
  const [params, setParams] = useSearchParams();
  const back = useBack();
  const weekParam = params.get('week');
  const weekStart = useMemo(() => startOfWeek(parseIso(weekParam) ?? today()), [weekParam]);
  const isThisWeek = weekStart.getTime() === startOfWeek(today()).getTime();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [done, setDone] = useState<Set<number> | null>(null);
  const agentId = Number(params.get('agent')) || 0;
  const [items, setItems] = useState<DeliveryItem[] | null>(null);
  const [existing, setExisting] = useState<DeliveryRow | null>(null);
  const [date, setDate] = useState('');
  const [mode, setMode] = useState<Mode>('items');
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');
  const [returnable, setReturnable] = useState(true);
  const [prevSum, setPrevSum] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const chipsRef = useRef<HTMLDivElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  useLeaveGuard(dirty);

  useEffect(() => {
    (async () => {
      const list = await listAgents();
      // an agent that was hidden can still be opened from an old link (to fix or delete its delivery)
      if (agentId && !list.some((a) => a.id === agentId)) {
        const hidden = await getAgent(agentId);
        if (hidden) list.push(hidden);
      }
      setAgents(list);
    })();
  }, []);

  useEffect(() => {
    deliveredAgents(iso(weekStart)).then(setDone);
  }, [weekStart, existing?.id]);

  // who comes first: due today and not delivered yet, then the rest by their usual day, delivered ones last
  const ordered = useMemo(() => {
    if (!agents) return [];
    const td = today().getDay();
    const rank = (a: Agent) => (done?.has(a.id) ? 2 : isThisWeek && a.delivery_day === td ? 0 : 1);
    return [...agents].sort(
      (x, y) => rank(x) - rank(y) || (x.delivery_day ?? 9) - (y.delivery_day ?? 9) || x.name.localeCompare(y.name, 'he'),
    );
  }, [agents, done, isThisWeek]);

  // no agent in the link: the first one in that order
  useEffect(() => {
    if (agentId || !done || ordered.length === 0) return;
    const p = new URLSearchParams(params);
    p.set('agent', String(ordered[0].id));
    setParams(p, { replace: true });
  }, [agentId, ordered, done]);

  const agent = agents?.find((a) => a.id === agentId);

  useEffect(() => {
    if (!agentId || !agents) return;
    let alive = true;
    (async () => {
      const week = iso(weekStart);
      const [its, d, last] = await Promise.all([deliveryItems(agentId, week), getDelivery(agentId, week), lastDeliveryOf(agentId, week)]);
      if (!alive) return;
      setItems(its);
      setExisting(d);
      setDate(d?.delivery_date ?? defaultDate(weekStart, agents.find((a) => a.id === agentId)));
      setPrevSum(last?.received ?? 0);
      // open the way this agent was recorded before; an agent without products can only be a sum
      const m: Mode = d ? (d.manual_amount != null ? 'amount' : 'items') : last?.manual || its.length === 0 ? 'amount' : 'items';
      setMode(m);
      setAmountText(d?.manual_amount != null ? String(Number(d.manual_amount)) : '');
      setNote(d?.note ?? '');
      setReturnable(d ? !!Number(d.manual_returnable ?? 1) : (last?.returnable ?? true));
      setDirty(false);
    })();
    return () => {
      alive = false;
    };
  }, [agentId, weekStart, agents]);

  useEffect(() => {
    chipsRef.current?.querySelector('.agent-chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [agentId, ordered.length]);

  async function go(next: { agent?: number; week?: Date }) {
    if (next.agent === agentId && !next.week) return;
    if (
      dirty &&
      !(await ask({ title: 'יש שינויים שלא נשמרו', text: 'לעבור בלי לשמור? מה שהוקלד יימחק.', ok: 'לעבור בלי לשמור', cancel: 'להישאר', danger: true }))
    )
      return;
    setDirty(false);
    const p = new URLSearchParams(params);
    if (next.agent) p.set('agent', String(next.agent));
    if (next.week) p.set('week', iso(next.week));
    setParams(p, { replace: true });
  }

  function setQty(pid: number, n: number) {
    setItems((its) => its?.map((i) => (i.product_id === pid ? { ...i, qty_received: n } : i)) ?? null);
    setDirty(true);
  }

  function copyLastWeek() {
    setItems((its) => its?.map((i) => ({ ...i, qty_received: i.prev_qty })) ?? null);
    setDirty(true);
  }

  function chooseMode(m: Mode) {
    if (m === mode) return;
    setMode(m);
    setDirty(true);
    if (m === 'amount') setTimeout(() => amountRef.current?.focus(), 50);
  }

  const total = (items ?? []).reduce((s, i) => s + i.qty_received * i.unit_cost, 0);
  const units = (items ?? []).reduce((s, i) => s + i.qty_received, 0);
  const amount = parseAmountStrict(amountText);
  const owedNow = mode === 'amount' ? amount ?? 0 : total;
  const canCopy = !existing && units === 0 && (items ?? []).some((i) => i.prev_qty > 0);
  const minDate = iso(weekStart);
  const maxDate = iso(addDays(weekStart, 6));
  const todayDow = today().getDay();
  const hadLines = !!existing && existing.manual_amount == null;
  const hadSum = !!existing && existing.manual_amount != null;

  async function save() {
    if (!items || !agent) return;
    if (mode === 'amount') {
      if (amount === null) return toast('הסכום לא תקין. כותבים רק מספר, למשל 2500 או 1250.50', 'err');
      if (amount <= 0 && !existing) {
        amountRef.current?.focus();
        return toast('צריך לכתוב כמה צריך לשלם לסוכן', 'err');
      }
      if (hadLines && !(await ask({ title: 'לעבור לסכום?', text: 'הכמויות שנרשמו למוצרים בשבוע הזה יימחקו, ובמקומן יישמר רק הסכום.', ok: 'כן, לשמור כסכום' })))
        return;
    } else if (hadSum && !(await ask({ title: 'לעבור לפי מוצרים?', text: 'הסכום שנרשם יוחלף בחישוב לפי הכמויות של המוצרים.', ok: 'כן, לפי מוצרים' }))) {
      return;
    }
    setSaving(true);
    try {
      if (mode === 'amount') await saveDeliveryAmount(agent.id, iso(weekStart), date, amount ?? 0, note, returnable);
      else await saveDelivery(agent.id, iso(weekStart), date, items);
      const bal = await balanceOf(agent.id);
      toast(
        bal > 0.004
          ? `נשמר ✓ עכשיו אני חייב ל${agent.name} ${shekelSmart(bal)}`
          : bal < -0.004
            ? `נשמר ✓ יש לי פלוס של ${shekelSmart(-bal)} אצל ${agent.name}`
            : 'נשמר ✓ החשבון עם הסוכן מאוזן',
      );
      setDirty(false);
      back({ force: true });
    } catch (e) {
      console.error(e);
      if (String((e as Error)?.message).includes('date-outside-week')) toast('תאריך האספקה חייב להיות בתוך השבוע שנבחר', 'err');
      else toast('השמירה נכשלה. נסה שוב.', 'err');
    }
    setSaving(false);
  }

  async function remove() {
    if (!existing || !agent) return;
    const ok = await ask({
      title: `למחוק את האספקה של ${agent.name}?`,
      text: 'האספקה של השבוע הזה אצל הסוכן תימחק, וגם ההחזרות שנרשמו עליה. החוב לסוכן יירד בהתאם.',
      ok: 'מחיקה',
      danger: true,
    });
    if (!ok) return;
    await deleteDelivery(existing.id);
    toast('האספקה נמחקה');
    back({ force: true });
  }

  if (agents && agents.length === 0) {
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

  const saveDisabled = saving || !items || !agent || (mode === 'items' ? !existing && units === 0 : amount === null || (!existing && (amount ?? 0) <= 0));

  return (
    <>
      <header className="bar">
        <button type="button" className="icon-btn" aria-label="חזרה" onClick={() => back()}>
          <Icon name="back" />
        </button>
        <h1 className="page-title" style={{ flex: 1 }}>קבלת סחורה</h1>
        <label className="date-chip">
          <Icon name="calendar" size={18} />
          {date ? shortDate(fromIso(date)) : ''}
          <input
            type="date"
            aria-label="תאריך האספקה"
            value={date}
            min={minDate}
            max={maxDate}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              if (v < minDate || v > maxDate) {
                toast('אפשר לבחור רק יום בתוך השבוע שנבחר. לשבוע אחר – מחליפים שבוע למטה.', 'err');
                return;
              }
              setDate(v);
              setDirty(true);
            }}
          />
        </label>
      </header>

      <div className="pad">
        <WeekBar weekStart={weekStart} onChange={(w) => go({ week: w })} />
      </div>

      <div className="agent-chips" ref={chipsRef}>
        {ordered.map((a) => {
          const on = a.id === agentId;
          const isDone = done?.has(a.id);
          return (
            <button
              key={a.id}
              type="button"
              className={`agent-chip${on ? ' on' : ''}`}
              style={on ? { background: a.color ?? 'var(--primary)' } : undefined}
              aria-pressed={on}
              onClick={() => go({ agent: a.id })}
            >
              {!on && <span className="dot" style={{ background: a.color ?? 'var(--primary)' }} />}
              {a.name}
              {isDone ? (
                <span className="ok" aria-label="נרשם">
                  <Icon name="check" size={18} stroke={3} />
                </span>
              ) : (
                isThisWeek && a.delivery_day === todayDow && <span className="tag-today">היום</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="pad" style={{ marginBottom: 10 }}>
        <div className="segment" role="radiogroup" aria-label="איך לרשום את הסחורה">
          <button type="button" role="radio" aria-checked={mode === 'items'} className={mode === 'items' ? 'on' : ''} onClick={() => chooseMode('items')}>
            לפי מוצרים
          </button>
          <button type="button" role="radio" aria-checked={mode === 'amount'} className={mode === 'amount' ? 'on' : ''} onClick={() => chooseMode('amount')}>
            לפי סכום
          </button>
        </div>
      </div>

      {mode === 'amount' ? (
        <section className="card box sum-box">
          <label className="lbl" htmlFor="dsum">
            כמה אני צריך לשלם ל{agent?.name ?? 'סוכן'} על הסחורה הזו?
          </label>
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
            placeholder="הערה, למשל מספר חשבונית (לא חובה)"
            aria-label="הערה"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setDirty(true);
            }}
          />
          <div className="line" style={{ gap: 12 }}>
            <span className="name" style={{ fontSize: 16 }}>
              יש החזרות ביום ראשון
              <small className="hint" style={{ display: 'block', fontWeight: 500 }}>
                {returnable ? 'במסך ההחזרות רושמים כמה זיכוי מגיע' : 'לא יופיע במסך ההחזרות'}
              </small>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={returnable}
              aria-label="יש החזרות ביום ראשון"
              className={`switch${returnable ? ' on' : ''}`}
              onClick={() => {
                setReturnable((r) => !r);
                setDirty(true);
              }}
            >
              <span />
            </button>
          </div>
          {existing && (
            <button type="button" className="danger-link end-link" onClick={remove}>
              <Icon name="trash" size={18} /> מחיקת האספקה של השבוע
            </button>
          )}
        </section>
      ) : items && items.length === 0 ? (
        <div className="card empty-card">
          <p>ל{agent?.name} עוד אין מוצרים במחירון. אפשר לרשום את הסחורה לפי סכום, או להוסיף לו מוצרים.</p>
          <button type="button" className="btn small" style={{ width: 'auto', padding: '0 20px' }} onClick={() => chooseMode('amount')}>
            רישום לפי סכום
          </button>
          <Link to={`/product/new?agent=${agentId}`} className="btn small ghost" style={{ width: 'auto', padding: '0 20px' }}>
            <Icon name="plus" /> מוצר חדש לסוכן
          </Link>
        </div>
      ) : (
        <>
          <div className="pad list-top">
            <span>{existing && !hadSum ? 'אספקה שכבר נרשמה · אפשר לתקן' : 'כמה הגיע מכל מוצר?'}</span>
            <b>{qty(units)} יח׳</b>
          </div>
          {canCopy && (
            <div className="pad" style={{ marginBottom: 10 }}>
              <button type="button" className="dashed-btn" onClick={copyLastWeek}>
                <Icon name="refresh" size={18} /> למלא כמו בשבוע שעבר
              </button>
            </div>
          )}
          <div className="items">
            {(items ?? []).map((i) => (
              <div key={i.product_id} className="item">
                <div className="thumb" style={{ background: i.tint ?? '#F1EDE2' }}>
                  {i.image ? <img src={i.image} alt="" /> : <span className="letter">{i.name.charAt(0)}</span>}
                </div>
                <div className="info">
                  <b>{i.name}</b>
                  <span className="s">
                    {shekelCents(i.unit_cost)} ליח׳{i.returnable ? '' : ' · ללא החזרה'}
                    {i.prev_qty > 0 ? ` · שבוע שעבר: ${qty(i.prev_qty)}` : ''}
                  </span>
                  <div className="foot">
                    <span className="line-total">{i.qty_received > 0 ? shekelCents(i.qty_received * i.unit_cost) : ''}</span>
                    <Stepper value={i.qty_received} onChange={(n) => setQty(i.product_id, n)} label={i.name} />
                  </div>
                </div>
              </div>
            ))}
            {existing && (
              <button type="button" className="danger-link end-link" onClick={remove}>
                <Icon name="trash" size={18} /> מחיקת כל האספקה של השבוע
              </button>
            )}
          </div>
        </>
      )}

      <div className="footer compact">
        <div className="sum">
          <span>חוב לסוכן על זה</span>
          <b>{shekelSmart(owedNow)}</b>
        </div>
        <button type="button" className="btn" onClick={save} disabled={saveDisabled}>
          {saving ? 'שומר…' : existing ? 'שמירת השינויים' : 'שמירת האספקה'}
        </button>
      </div>
    </>
  );
}
