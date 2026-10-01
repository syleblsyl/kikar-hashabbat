import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ask } from '../components/Dialog';
import { useLeaveGuard } from '../components/guard';
import { Icon } from '../components/Icon';
import { Stepper } from '../components/Stepper';
import { toast } from '../components/Toast';
import { WeekBar } from '../components/WeekBar';
import { pendingReturnsWeeks, returnsForWeek, saveReturns, saveReturnsAmount, type ReturnsAgent } from '../db/ops';
import { addDays, fromIso, iso, parseIso, shortDate, startOfWeek, today, weekLabel } from '../lib/dates';
import { parseAmountStrict, qty, shekelCents, shekelSmart } from '../lib/money';
import { useBack } from '../components/useBack';

export function Returns() {
  const [params, setParams] = useSearchParams();
  const back = useBack();
  const [weekStart, setWeekStart] = useState<Date | null>(null);
  const [list, setList] = useState<ReturnsAgent[] | null>(null);
  const [date, setDate] = useState(iso(today()));
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<'items' | 'amount'>('items');
  const [creditText, setCreditText] = useState('');
  const [saving, setSaving] = useState(false);
  const chipsRef = useRef<HTMLDivElement>(null);

  useLeaveGuard(dirty);

  // choose the week: from the link, else the latest week still waiting for returns, else last week
  const weekParam = params.get('week');
  useEffect(() => {
    (async () => {
      const fromLink = parseIso(weekParam);
      const w = fromLink ?? parseIso((await pendingReturnsWeeks())[0]?.week) ?? addDays(startOfWeek(today()), -7);
      setWeekStart(startOfWeek(w));
    })();
  }, [weekParam]);

  useEffect(() => {
    if (!weekStart) return;
    setList(null);
    returnsForWeek(iso(weekStart)).then((l) => {
      setList(l);
      setDirty(false);
    });
  }, [weekStart]);

  // no agent in the link: the first one still waiting
  const fromLink = Number(params.get('agent')) || 0;
  const cur =
    list?.find((a) => a.agent_id === fromLink) ??
    list?.find((a) => !a.returns_done && a.returnable) ??
    list?.[0];

  useEffect(() => {
    if (!cur) return;
    const t = iso(today());
    setDate(cur.returns_date ?? (t < cur.delivery_date ? cur.delivery_date : t));
    // a delivery recorded as a sum can only be credited as a sum; otherwise open the way it was saved
    const m = cur.manual_amount != null || cur.manual_credit != null ? 'amount' : 'items';
    setMode(m);
    setCreditText(cur.manual_credit != null && cur.manual_credit > 0 ? String(cur.manual_credit) : '');
  }, [cur?.delivery_id]);

  useEffect(() => {
    chipsRef.current?.querySelector('.agent-chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [cur?.agent_id, list?.length]);

  async function go(next: { agent?: number; week?: Date }, force = false) {
    if (next.agent && next.agent === cur?.agent_id && !next.week) return;
    if (
      !force &&
      dirty &&
      !(await ask({ title: 'יש שינויים שלא נשמרו', text: 'לעבור בלי לשמור? מה שהוקלד יימחק.', ok: 'לעבור בלי לשמור', cancel: 'להישאר', danger: true }))
    )
      return;
    setDirty(false);
    const p = new URLSearchParams(params);
    if (next.agent) p.set('agent', String(next.agent));
    if (next.week) {
      p.set('week', iso(next.week));
      p.delete('agent');
    }
    setParams(p, { replace: true });
  }

  function setRet(pid: number, n: number) {
    setList(
      (l) =>
        l?.map((a) => (a.agent_id !== cur?.agent_id ? a : { ...a, items: a.items.map((i) => (i.product_id === pid ? { ...i, qty_returned: n } : i)) })) ??
        null,
    );
    setDirty(true);
  }

  async function save(nothingLeft = false) {
    if (!cur || !weekStart) return;
    if (mode === 'amount' && !nothingLeft) {
      if (creditAmount === null) return toast('הסכום לא תקין. כותבים רק מספר, למשל 300 או 120.50', 'err');
      if (creditAmount > cur.received + 0.004) return toast(`הזיכוי לא יכול להיות יותר מהסחורה שהגיעה (${shekelSmart(cur.received)})`, 'err');
    }
    setSaving(true);
    try {
      if (mode === 'amount') {
        await saveReturnsAmount(cur.delivery_id, date, nothingLeft ? 0 : creditAmount ?? 0);
      } else {
        const items = cur.items.filter((i) => i.returnable).map((i) => ({ product_id: i.product_id, qty_returned: nothingLeft ? 0 : i.qty_returned }));
        await saveReturns(cur.delivery_id, date, items);
      }
      setDirty(false);
      const fresh = await returnsForWeek(iso(weekStart));
      setList(fresh);
      const next = fresh.find((a) => !a.returns_done && a.returnable);
      if (next) {
        toast(`נשמר ✓ עכשיו ${next.name}`);
        await go({ agent: next.agent_id }, true);
      } else {
        const other = (await pendingReturnsWeeks()).find((w) => w.week !== iso(weekStart));
        if (other) {
          toast(`נשמר ✓ נשארו החזרות משבוע ${weekLabel(fromIso(other.week))}`);
          await go({ week: fromIso(other.week) }, true);
        } else {
          toast('כל ההחזרות נרשמו ✓');
          back({ force: true });
        }
      }
    } catch (e) {
      console.error(e);
      toast('השמירה נכשלה. נסה שוב.', 'err');
    }
    setSaving(false);
  }

  async function nothingLeft() {
    if (!cur) return;
    const ok = await ask({ title: `לא נשאר כלום אצל ${cur.name}?`, text: 'הכול נמכר, אין זיכוי השבוע.', ok: 'כן, לא נשאר כלום' });
    if (ok) save(true);
  }

  const returnable = cur?.items.filter((i) => i.returnable) ?? [];
  const fixed = cur?.items.filter((i) => !i.returnable) ?? [];
  const received = cur?.received ?? 0;
  const creditAmount = parseAmountStrict(creditText);
  const credit = mode === 'amount' ? creditAmount ?? 0 : returnable.reduce((s, i) => s + i.qty_returned * i.unit_cost, 0);
  const bySum = cur?.manual_amount != null;
  const canReturn = !!cur?.returnable;

  return (
    <>
      <header className="bar">
        <button type="button" className="icon-btn" aria-label="חזרה" onClick={() => back()}>
          <Icon name="back" />
        </button>
        <h1 className="page-title" style={{ flex: 1 }}>החזרות</h1>
        {cur && (
          <label className="date-chip">
            <Icon name="calendar" size={18} />
            {shortDate(fromIso(date))}
            <input
              type="date"
              aria-label="תאריך ההחזרה"
              value={date}
              min={cur.delivery_date}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                if (v < cur.delivery_date) {
                  toast('ההחזרה לא יכולה להיות לפני יום האספקה', 'err');
                  return;
                }
                setDate(v);
                setDirty(true);
              }}
            />
          </label>
        )}
      </header>

      {weekStart && (
        <div className="pad" style={{ marginBottom: 8 }}>
          <WeekBar weekStart={weekStart} onChange={(w) => go({ week: w })} />
        </div>
      )}

      {list && list.length === 0 ? (
        <div className="card empty-card">
          <p>בשבוע הזה לא נרשמה אספקה, אז אין מה להחזיר.</p>
          <Link to={`/delivery?week=${weekStart ? iso(weekStart) : ''}`} className="btn small ghost" style={{ width: 'auto', padding: '0 20px' }}>
            לקבלת סחורה בשבוע הזה
          </Link>
        </div>
      ) : (
        <>
          <div className="agent-chips" ref={chipsRef}>
            {(list ?? []).map((a) => {
              const on = a.agent_id === cur?.agent_id;
              const hasReturnable = a.returnable;
              return (
                <button
                  key={a.agent_id}
                  type="button"
                  className={`agent-chip${on ? ' on' : ''}`}
                  style={on ? { background: a.color ?? 'var(--primary)' } : undefined}
                  aria-pressed={on}
                  onClick={() => go({ agent: a.agent_id })}
                >
                  {!on && <span className="dot" style={{ background: a.color ?? 'var(--primary)' }} />}
                  {a.name}
                  {a.returns_done || !hasReturnable ? (
                    <span className="ok" aria-label="נרשם">
                      <Icon name="check" size={18} stroke={3} />
                    </span>
                  ) : (
                    <span className="tag-today">ממתין</span>
                  )}
                </button>
              );
            })}
          </div>

          {cur && (
            <>
              <div className="pad list-top">
                <span>
                  הגיע {shortDate(fromIso(cur.delivery_date))} · {shekelSmart(received)}
                  {cur.returns_done ? ` · נרשם ${cur.returns_date ? shortDate(fromIso(cur.returns_date)) : ''} · אפשר לתקן` : ''}
                </span>
                <b>נטו {shekelSmart(received - credit)}</b>
              </div>

              {!canReturn ? (
                <div className="card empty-card" style={{ marginTop: 0 }}>
                  <p>באספקה הזו אין מה להחזיר{bySum ? ' (נרשם שאין החזרות מהסוכן הזה)' : ' (כל המוצרים בלי החזרה)'}.</p>
                </div>
              ) : (
                <div className="pad" style={{ marginBottom: 10 }}>
                  <div className="segment" role="radiogroup" aria-label="איך לרשום את ההחזרה">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={mode === 'items'}
                      className={mode === 'items' ? 'on' : ''}
                      disabled={bySum}
                      onClick={() => {
                        setMode('items');
                        setDirty(true);
                      }}
                    >
                      לפי מוצרים
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={mode === 'amount'}
                      className={mode === 'amount' ? 'on' : ''}
                      onClick={() => {
                        setMode('amount');
                        setDirty(true);
                      }}
                    >
                      לפי סכום
                    </button>
                  </div>
                  {bySum && <p className="hint" style={{ margin: '6px 2px 0' }}>הסחורה נרשמה לפי סכום, ולכן גם ההחזרה נרשמת כסכום.</p>}
                </div>
              )}

              {canReturn && mode === 'amount' ? (
                <section className="card box sum-box">
                  <label className="lbl" htmlFor="rsum">
                    כמה זיכוי מגיע לי מ{cur.name} על מה שהחזרתי?
                  </label>
                  <div className={`money-in big${creditAmount === null ? ' bad' : ''}`}>
                    <input
                      id="rsum"
                      inputMode="decimal"
                      enterKeyHint="done"
                      placeholder="0"
                      aria-invalid={creditAmount === null}
                      value={creditText}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => {
                        setCreditText(e.target.value);
                        setDirty(true);
                      }}
                    />
                    <span>₪</span>
                  </div>
                  {creditAmount === null && <div className="field-err">כותבים רק מספר, למשל 300 או 120.50</div>}
                  <span className="hint">
                    הסחורה שהגיעה: {shekelSmart(received)} · אחרי הזיכוי: {shekelSmart(received - credit)}
                  </span>
                  {!cur.returns_done && credit === 0 && (
                    <button type="button" className="btn ghost small" onClick={nothingLeft} disabled={saving}>
                      <Icon name="check" size={18} /> לא נשאר כלום אצל {cur.name}
                    </button>
                  )}
                </section>
              ) : canReturn ? (
                <div className="items">
                  {returnable.map((i) => (
                    <div key={i.product_id} className="item">
                      <div className="thumb" style={{ background: i.tint ?? '#F1EDE2' }}>
                        {i.image ? <img src={i.image} alt="" /> : <span className="letter">{i.name.charAt(0)}</span>}
                      </div>
                      <div className="info">
                        <b>{i.name}</b>
                        <span className="s">
                          הגיע {qty(i.qty_received)} · נמכר {qty(i.qty_received - i.qty_returned)} · {shekelCents(i.unit_cost)}
                        </span>
                        <div className="foot">
                          <span className="credit">
                            <small>זיכוי</small>
                            <b>{shekelCents(i.qty_returned * i.unit_cost)}</b>
                          </span>
                          <div className="step-col">
                            <Stepper value={i.qty_returned} max={i.qty_received} onChange={(n) => setRet(i.product_id, n)} label={`נשאר ${i.name}`} tone="gold" />
                            <small>נשאר</small>
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
                        <span className="s">ללא החזרה · הגיע {qty(i.qty_received)}</span>
                      </div>
                    </div>
                  ))}
                  {!cur.returns_done && credit === 0 && returnable.length > 0 && (
                    <button type="button" className="btn ghost small end-btn" onClick={nothingLeft} disabled={saving}>
                      <Icon name="check" size={18} /> לא נשאר כלום אצל {cur.name}
                    </button>
                  )}
                </div>
              ) : null}

              <Link to={`/agent/${cur.agent_id}?pay=1`} className="center-link pay-link">
                <Icon name="wallet" size={18} /> שילמת ל{cur.name} בכסף? לרישום תשלום
              </Link>
            </>
          )}
        </>
      )}

      {cur && (
        <div className="footer compact">
          <div className="sum">
            <span>זיכוי מהסוכן</span>
            <b style={{ color: 'var(--green)' }}>{shekelSmart(credit)}</b>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => save(false)}
            disabled={saving || !canReturn || (mode === 'items' && returnable.length === 0) || (mode === 'amount' && creditAmount === null)}
          >
            {saving ? 'שומר…' : cur.returns_done ? 'שמירת התיקון' : 'שמירת ההחזרות'}
          </button>
        </div>
      )}
    </>
  );
}
