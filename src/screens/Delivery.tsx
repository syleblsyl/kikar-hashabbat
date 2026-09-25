import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Stepper } from '../components/Stepper';
import { SubBar } from '../components/SubBar';
import { toast } from '../components/Toast';
import { WeekBar } from '../components/WeekBar';
import { listAgents, type Agent } from '../db/catalog';
import { deleteDelivery, deliveredAgents, deliveryItems, getDelivery, saveDelivery, type DeliveryItem } from '../db/ops';
import { addDays, fromIso, iso, shortDate, startOfWeek, today } from '../lib/dates';
import { shekelCents } from '../lib/money';
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
  const weekStart = useMemo(() => startOfWeek(params.get('week') ? fromIso(params.get('week')!) : today()), [params]);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [done, setDone] = useState<Set<number> | null>(null);
  // no agent in the link: the one due today who has not delivered yet, else the first still missing
  const agentId = Number(params.get('agent')) || 0;
  useEffect(() => {
    if (agentId || !agents || !done || agents.length === 0) return;
    const pick =
      agents.find((a) => a.delivery_day === today().getDay() && !done.has(a.id)) ?? agents.find((a) => !done.has(a.id)) ?? agents[0];
    const p = new URLSearchParams(params);
    p.set('agent', String(pick.id));
    setParams(p, { replace: true });
  }, [agentId, agents, done]);
  const agent = agents?.find((a) => a.id === agentId);
  const [items, setItems] = useState<DeliveryItem[] | null>(null);
  const [date, setDate] = useState('');
  const [existingId, setExistingId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listAgents().then(setAgents);
  }, []);

  useEffect(() => {
    deliveredAgents(iso(weekStart)).then(setDone);
  }, [weekStart, existingId]);

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

  function go(next: { agent?: number; week?: Date }) {
    if (dirty && !window.confirm('יש שינויים שלא נשמרו. לעבור בלי לשמור?')) return;
    const p = new URLSearchParams(params);
    if (next.agent) p.set('agent', String(next.agent));
    if (next.week) p.set('week', iso(next.week));
    setParams(p, { replace: true });
  }

  function setQty(pid: number, qty: number) {
    setItems((its) => its?.map((i) => (i.product_id === pid ? { ...i, qty_received: qty } : i)) ?? null);
    setDirty(true);
  }

  async function save() {
    if (!items || !agent) return;
    setSaving(true);
    try {
      await saveDelivery(agent.id, date, items);
      toast(`האספקה של ${agent.name} נשמרה`);
      setDirty(false);
      back();
    } catch (e) {
      console.error(e);
      toast('השמירה נכשלה');
    }
    setSaving(false);
  }

  async function remove() {
    if (!existingId || !agent) return;
    if (!window.confirm(`למחוק את האספקה של ${agent.name} בשבוע הזה?`)) return;
    await deleteDelivery(existingId);
    toast('האספקה נמחקה');
    back();
  }

  const total = (items ?? []).reduce((s, i) => s + i.qty_received * i.unit_cost, 0);
  const units = (items ?? []).reduce((s, i) => s + i.qty_received, 0);
  const minDate = iso(weekStart);
  const maxDate = iso(addDays(weekStart, 6));

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
              if (e.target.value) {
                setDate(e.target.value);
                setDirty(true);
              }
            }}
          />
        </label>
      </header>

      <div className="pad">
        <WeekBar weekStart={weekStart} onChange={(w) => go({ week: w })} />
      </div>

      <div className="agent-chips">
        {(agents ?? []).map((a) => (
          <button
            key={a.id}
            type="button"
            className={`agent-chip${a.id === agentId ? ' on' : ''}`}
            style={a.id === agentId ? { background: a.color ?? 'var(--primary)' } : undefined}
            onClick={() => go({ agent: a.id })}
          >
            {a.id !== agentId && <span className="dot" style={{ background: a.color ?? 'var(--primary)' }} />}
            {a.name}
            {done?.has(a.id) && (
              <span className="ok">
                <Icon name="check" size={18} stroke={3} />
              </span>
            )}
          </button>
        ))}
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
          <div className="pad" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--ink2)', marginBottom: 10 }}>
            <span>{existingId ? 'אספקה שכבר נרשמה · אפשר לתקן' : 'כמה הגיע מכל מוצר?'}</span>
            <b>{units} יחידות</b>
          </div>
          <div className="items">
            {(items ?? []).map((i) => (
              <div key={i.product_id} className="item">
                <div className="thumb" style={{ background: i.tint ?? '#F1EDE2' }}>
                  {i.image ? <img src={i.image} alt="" /> : <span className="letter">{i.name.charAt(0)}</span>}
                </div>
                <div className="info">
                  <b>{i.name}</b>
                  <span className="s">
                    {shekelCents(i.unit_cost)} ליחידה{i.returnable ? '' : ' · ללא החזרה'}
                  </span>
                  <div className="foot">
                    <span className="line-total">{shekelCents(i.qty_received * i.unit_cost)}</span>
                    <Stepper value={i.qty_received} onChange={(n) => setQty(i.product_id, n)} label={i.name} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="footer">
        <div className="sum">
          <span>סה״כ לפי מחיר קנייה</span>
          <b>{shekelCents(total)}</b>
        </div>
        <button type="button" className="btn" onClick={save} disabled={saving || !items || (!existingId && units === 0)}>
          {saving ? 'שומר…' : existingId ? 'שמירת השינויים' : 'שמירת האספקה'}
        </button>
        {existingId && (
          <button type="button" className="danger-link" onClick={remove}>
            מחיקת האספקה
          </button>
        )}
      </div>
    </>
  );
}
