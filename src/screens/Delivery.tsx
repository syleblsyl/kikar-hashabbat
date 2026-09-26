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
import { deleteDelivery, deliveredAgents, deliveryItems, getDelivery, saveDelivery, type DeliveryItem } from '../db/ops';
import { addDays, fromIso, iso, parseIso, shortDate, startOfWeek, today } from '../lib/dates';
import { qty, shekelCents, shekelSmart } from '../lib/money';
import { useBack } from '../components/useBack';

/** Default delivery date inside a week: today if it is in that week, else the agent's usual day. */
function defaultDate(weekStart: Date, agent: Agent | undefined): string {
  const t = today();
  if (startOfWeek(t).getTime() === weekStart.getTime()) return iso(t);
  return iso(addDays(weekStart, agent?.delivery_day ?? 4));
}

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
  const [date, setDate] = useState('');
  const [existingId, setExistingId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const chipsRef = useRef<HTMLDivElement>(null);

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
  }, [weekStart, existingId]);

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
      const [its, d] = await Promise.all([deliveryItems(agentId, iso(weekStart)), getDelivery(agentId, iso(weekStart))]);
      if (!alive) return;
      setItems(its);
      setExistingId(d?.id ?? null);
      setDate(d?.delivery_date ?? defaultDate(weekStart, agents.find((a) => a.id === agentId)));
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
      !(await ask({ title: 'יש שינויים שלא נשמרו', text: 'לעבור בלי לשמור? הכמויות שהוקלדו יימחקו.', ok: 'לעבור בלי לשמור', cancel: 'להישאר', danger: true }))
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

  async function save() {
    if (!items || !agent) return;
    setSaving(true);
    try {
      await saveDelivery(agent.id, iso(weekStart), date, items);
      toast(`האספקה של ${agent.name} נשמרה`);
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
    if (!existingId || !agent) return;
    const ok = await ask({
      title: `למחוק את האספקה של ${agent.name}?`,
      text: 'כל הכמויות של השבוע הזה אצל הסוכן יימחקו, וגם ההחזרות שנרשמו עליהן.',
      ok: 'מחיקה',
      danger: true,
    });
    if (!ok) return;
    await deleteDelivery(existingId);
    toast('האספקה נמחקה');
    back({ force: true });
  }

  const total = (items ?? []).reduce((s, i) => s + i.qty_received * i.unit_cost, 0);
  const units = (items ?? []).reduce((s, i) => s + i.qty_received, 0);
  const canCopy = !existingId && units === 0 && (items ?? []).some((i) => i.prev_qty > 0);
  const minDate = iso(weekStart);
  const maxDate = iso(addDays(weekStart, 6));
  const todayDow = today().getDay();

  if (agents && agents.length === 0) {
    return (
      <>
        <SubBar title="קבלת סחורה" />
        <div className="card empty-card">
          <p>כדי לרשום סחורה צריך קודם להוסיף סוכן ואת המוצרים שלו.</p>
          <Link to="/agent/new" className="btn small" style={{ width: 'auto', padding: '0 20px' }}>
            <Icon name="plus" /> הוספת סוכן
          </Link>
        </div>
      </>
    );
  }

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

      {items && items.length === 0 ? (
        <div className="card empty-card">
          <p>ל{agent?.name} עוד אין מוצרים.</p>
          <Link to={`/product/new?agent=${agentId}`} className="btn small" style={{ width: 'auto', padding: '0 20px' }}>
            <Icon name="plus" /> מוצר חדש לסוכן
          </Link>
        </div>
      ) : (
        <>
          <div className="pad list-top">
            <span>{existingId ? 'אספקה שכבר נרשמה · אפשר לתקן' : 'כמה הגיע מכל מוצר?'}</span>
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
            {existingId && (
              <button type="button" className="danger-link end-link" onClick={remove}>
                <Icon name="trash" size={18} /> מחיקת כל האספקה של השבוע
              </button>
            )}
          </div>
        </>
      )}

      <div className="footer compact">
        <div className="sum">
          <span>סה״כ קנייה</span>
          <b>{shekelSmart(total)}</b>
        </div>
        <button type="button" className="btn" onClick={save} disabled={saving || !items || !agent || (!existingId && units === 0)}>
          {saving ? 'שומר…' : existingId ? 'שמירת השינויים' : 'שמירת האספקה'}
        </button>
      </div>
    </>
  );
}
