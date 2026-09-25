import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Stepper } from '../components/Stepper';
import { toast } from '../components/Toast';
import { WeekBar } from '../components/WeekBar';
import { pendingReturnsWeek, returnsForWeek, saveReturns, type ReturnsAgent } from '../db/ops';
import { addDays, fromIso, iso, shortDate, startOfWeek, today } from '../lib/dates';
import { shekelCents } from '../lib/money';
import { useBack } from '../components/useBack';

export function Returns() {
  const [params, setParams] = useSearchParams();
  const back = useBack();
  const [weekStart, setWeekStart] = useState<Date | null>(null);
  const [list, setList] = useState<ReturnsAgent[] | null>(null);
  const [date, setDate] = useState(iso(today()));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // choose the week: from the link, else the latest week still waiting for returns, else last week
  useEffect(() => {
    (async () => {
      const w = params.get('week') ?? (await pendingReturnsWeek()) ?? iso(addDays(startOfWeek(today()), -7));
      setWeekStart(startOfWeek(fromIso(w)));
    })();
  }, [params]);

  useEffect(() => {
    if (!weekStart) return;
    setList(null);
    returnsForWeek(iso(weekStart)).then((l) => {
      setList(l);
      setDirty(false);
    });
  }, [weekStart]);

  const agentId = Number(params.get('agent')) || list?.[0]?.agent_id || 0;
  const cur = list?.find((a) => a.agent_id === agentId) ?? list?.[0];

  useEffect(() => {
    if (cur) setDate(cur.returns_date ?? iso(today()));
  }, [cur?.delivery_id]);

  function go(next: { agent?: number; week?: Date }, force = false) {
    if (!force && dirty && !window.confirm('יש שינויים שלא נשמרו. לעבור בלי לשמור?')) return;
    const p = new URLSearchParams(params);
    if (next.agent) p.set('agent', String(next.agent));
    if (next.week) {
      p.set('week', iso(next.week));
      p.delete('agent');
    }
    setParams(p, { replace: true });
  }

  function setRet(pid: number, n: number) {
    setList((l) =>
      l?.map((a) => (a.agent_id !== cur?.agent_id ? a : { ...a, items: a.items.map((i) => (i.product_id === pid ? { ...i, qty_returned: n } : i)) })) ?? null,
    );
    setDirty(true);
  }

  async function save(nothingLeft = false) {
    if (!cur) return;
    setSaving(true);
    const items = cur.items.filter((i) => i.returnable).map((i) => ({ product_id: i.product_id, qty_returned: nothingLeft ? 0 : i.qty_returned }));
    await saveReturns(cur.delivery_id, date, items);
    toast(`ההחזרות של ${cur.name} נשמרו`);
    setDirty(false);
    const fresh = await returnsForWeek(iso(weekStart!));
    setList(fresh);
    const next = fresh.find((a) => !a.returns_done && a.items.some((i) => i.returnable));
    if (next) go({ agent: next.agent_id }, true);
    else back();
    setSaving(false);
  }

  const returnable = cur?.items.filter((i) => i.returnable) ?? [];
  const fixed = cur?.items.filter((i) => !i.returnable) ?? [];
  const received = cur?.items.reduce((s, i) => s + i.qty_received * i.unit_cost, 0) ?? 0;
  const credit = returnable.reduce((s, i) => s + i.qty_returned * i.unit_cost, 0);

  return (
    <>
      <header className="bar">
        <button type="button" className="icon-btn" aria-label="חזרה" onClick={() => back()}>
          <Icon name="back" />
        </button>
        <h1 className="page-title" style={{ flex: 1 }}>החזרות</h1>
        <label className="date-chip">
          <Icon name="calendar" size={18} />
          {shortDate(fromIso(date))}
          <input type="date" aria-label="תאריך ההחזרה" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
      </header>

      {weekStart && (
        <div className="pad" style={{ marginBottom: 8 }}>
          <WeekBar weekStart={weekStart} onChange={(w) => go({ week: w })} />
        </div>
      )}

      <div className="info-note">ביום ראשון הסוכן אוסף את מה שנשאר. רושמים כמה נשאר מכל מוצר, והזיכוי יורד מהחוב לסוכן.</div>

      {list && list.length === 0 ? (
        <div className="card empty-card">
          <p>בשבוע הזה לא נרשמה אספקה, אז אין מה להחזיר.</p>
          <Link to={`/delivery?week=${weekStart ? iso(weekStart) : ''}`} className="btn small ghost" style={{ width: 'auto', padding: '0 20px' }}>
            לקבלת סחורה בשבוע הזה
          </Link>
        </div>
      ) : (
        <>
          <div className="agent-chips">
            {(list ?? []).map((a) => {
              const on = a.agent_id === cur?.agent_id;
              return (
                <button
                  key={a.agent_id}
                  type="button"
                  className={`agent-chip${on ? ' on' : ''}`}
                  style={on ? { background: a.color ?? 'var(--primary)' } : undefined}
                  onClick={() => go({ agent: a.agent_id })}
                >
                  {!on && <span className="dot" style={{ background: a.color ?? 'var(--primary)' }} />}
                  {a.name}
                  {a.returns_done ? (
                    <span className="ok"><Icon name="check" size={18} stroke={3} /></span>
                  ) : (
                    <span style={{ fontSize: 13, opacity: 0.85 }}>· ממתין</span>
                  )}
                </button>
              );
            })}
          </div>

          {cur && (
            <>
              <div className="pad" style={{ fontSize: 14, color: 'var(--ink2)', marginBottom: 10 }}>
                הגיע {shortDate(fromIso(cur.delivery_date))}
                {cur.returns_done ? ` · ההחזרות נרשמו ${cur.returns_date ? shortDate(fromIso(cur.returns_date)) : ''} · אפשר לתקן` : ''}
              </div>
              <div className="items">
                {returnable.length === 0 && <p className="hint">אין באספקה הזו מוצרים שאפשר להחזיר.</p>}
                {returnable.map((i) => (
                  <div key={i.product_id} className="item">
                    <div className="thumb" style={{ background: i.tint ?? '#F1EDE2' }}>
                      {i.image ? <img src={i.image} alt="" /> : <span className="letter">{i.name.charAt(0)}</span>}
                    </div>
                    <div className="info">
                      <b>{i.name}</b>
                      <span className="s">
                        הגיע {i.qty_received} · נמכר {i.qty_received - i.qty_returned} · {shekelCents(i.unit_cost)}
                      </span>
                      <div className="foot">
                        <span className="credit">
                          <small>זיכוי</small>
                          <b>{shekelCents(i.qty_returned * i.unit_cost)}</b>
                        </span>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <Stepper value={i.qty_returned} max={i.qty_received} onChange={(n) => setRet(i.product_id, n)} label={`נשאר ${i.name}`} tone="gold" />
                          <small style={{ fontSize: 11, color: 'var(--ink2)' }}>נשאר</small>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {fixed.map((i) => (
                  <div key={i.product_id} className="item dim">
                    <div className="thumb" style={{ background: '#EDE3D3', opacity: 0.7 }}>
                      {i.image ? <img src={i.image} alt="" /> : <span className="letter">{i.name.charAt(0)}</span>}
                    </div>
                    <div className="info">
                      <b style={{ color: 'var(--ink2)' }}>{i.name}</b>
                      <span className="s">ללא החזרה · הגיע {i.qty_received}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {cur && (
        <div className="footer">
          <div className="sum">
            <span>זיכוי מהסוכן</span>
            <b style={{ color: 'var(--green)' }}>{shekelCents(credit)}</b>
          </div>
          <div className="sub-sum">
            <span style={{ color: 'var(--ink2)' }}>עלות נטו לשבוע (אחרי זיכוי)</span>
            <b>{shekelCents(received - credit)}</b>
          </div>
          <button type="button" className="btn" onClick={() => save(false)} disabled={saving}>
            {saving ? 'שומר…' : 'שמירת ההחזרות'}
          </button>
          {!cur.returns_done && credit === 0 && returnable.length > 0 && (
            <button type="button" className="btn ghost small" onClick={() => save(true)} disabled={saving}>
              לא נשאר כלום
            </button>
          )}
        </div>
      )}
    </>
  );
}
