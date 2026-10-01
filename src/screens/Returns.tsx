import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ask } from '../components/Dialog';
import { useLeaveGuard } from '../components/guard';
import { Icon } from '../components/Icon';
import { matches, SearchBox } from '../components/SearchBox';
import { Stepper } from '../components/Stepper';
import { SubBar } from '../components/SubBar';
import { toast } from '../components/Toast';
import { pendingReturnInvoices, returnsForInvoice, saveReturns, saveReturnsAmount, type InvoiceRow, type ReturnsAgent } from '../db/ops';
import { DAY_SHORT, fromIso, iso, shortDate, startOfWeek, today } from '../lib/dates';
import { hebDayMonth } from '../lib/hebrew';
import { parseAmountStrict, qty, shekelCents, shekelSmart } from '../lib/money';
import { useBack } from '../components/useBack';
import { initialOf } from './Agents';

/** Returns: the list of invoices still waiting, or the form for one invoice (?invoice=id). */
export function Returns() {
  const [params] = useSearchParams();
  const invoiceId = Number(params.get('invoice')) || 0;
  return invoiceId ? <ReturnsForm key={invoiceId} invoiceId={invoiceId} /> : <ReturnsList />;
}

function ReturnsList() {
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    pendingReturnInvoices(false).then(setRows);
  }, []);
  const dueBefore = iso(startOfWeek(today()));
  const shown = (rows ?? []).filter((r) => matches(r.agent, q) || matches(r.note, q));

  return (
    <>
      <SubBar title="החזרות" sub="חשבוניות שעוד לא נרשמו להן החזרות" />
      {(rows?.length ?? 0) > 4 && <SearchBox value={q} onChange={setQ} placeholder="חיפוש סוכן" className="pad-x" />}
      {!rows ? (
        <p className="hint" style={{ textAlign: 'center' }}>טוען…</p>
      ) : rows.length === 0 ? (
        <div className="card empty-card">
          <p>אין חשבוניות שמחכות להחזרות.</p>
          <Link to="/invoices" className="btn small ghost" style={{ width: 'auto', padding: '0 20px' }}>
            לכל החשבוניות
          </Link>
        </div>
      ) : (
        <section className="card list" style={{ marginTop: 4 }}>
          {shown.map((r, i) => {
            const d = fromIso(r.date);
            const due = r.date < dueBefore;
            return (
              <Link key={r.id} to={`/returns?invoice=${r.id}`} className="row" style={i === 0 ? { borderTop: 0 } : undefined}>
                <span className="avatar" style={{ background: r.color ?? 'var(--primary)' }}>{initialOf(r.agent)}</span>
                <span className="grow">
                  <b>{r.agent}</b>
                  <span>
                    חשבונית {DAY_SHORT[d.getDay()]} {d.getDate()}.{d.getMonth() + 1} · {shekelSmart(r.received)}
                    {r.manual ? ' · לפי סכום' : ''}
                  </span>
                </span>
                <span className={`pill ${due ? 'gold' : ''}`} style={due ? undefined : { background: 'var(--chip)', color: 'var(--ink2)' }}>
                  {due ? 'לרישום' : 'השבוע'}
                </span>
              </Link>
            );
          })}
          {shown.length === 0 && <div className="empty">לא נמצא</div>}
        </section>
      )}
    </>
  );
}

function ReturnsForm({ invoiceId }: { invoiceId: number }) {
  const [, setParams] = useSearchParams();
  const back = useBack();
  const [cur, setCur] = useState<ReturnsAgent | null | undefined>(undefined);
  const [date, setDate] = useState(iso(today()));
  const [mode, setMode] = useState<'items' | 'amount'>('items');
  const [creditText, setCreditText] = useState('');
  const [productQ, setProductQ] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useLeaveGuard(dirty);

  useEffect(() => {
    returnsForInvoice(invoiceId).then((r) => {
      setCur(r);
      if (!r) return;
      const t = iso(today());
      setDate(r.returns_date ?? (t < r.delivery_date ? r.delivery_date : t));
      // an invoice recorded as a sum can only be credited as a sum; otherwise open the way it was saved
      setMode(r.manual_amount != null || r.manual_credit != null ? 'amount' : 'items');
      setCreditText(r.manual_credit != null && r.manual_credit > 0 ? String(r.manual_credit) : '');
    });
  }, [invoiceId]);

  if (cur === undefined) return <SubBar title="החזרות" />;
  if (cur === null) {
    return (
      <>
        <SubBar title="החזרות" />
        <div className="card empty-card">
          <p>החשבונית הזו לא נמצאה (אולי נמחקה).</p>
        </div>
      </>
    );
  }

  const returnable = cur.items.filter((i) => i.returnable);
  const fixed = cur.items.filter((i) => !i.returnable);
  const received = cur.received;
  const creditAmount = parseAmountStrict(creditText);
  const credit = mode === 'amount' ? creditAmount ?? 0 : returnable.reduce((s, i) => s + i.qty_returned * i.unit_cost, 0);
  const bySum = cur.manual_amount != null;
  const canReturn = cur.returnable;
  const shownReturnable = returnable.filter((i) => matches(i.name, productQ) || i.qty_returned > 0);
  const inv = fromIso(cur.delivery_date);

  function setRet(pid: number, n: number) {
    setCur((c) => (c ? { ...c, items: c.items.map((i) => (i.product_id === pid ? { ...i, qty_returned: n } : i)) } : c));
    setDirty(true);
  }

  async function save(nothingLeft = false) {
    if (!cur) return;
    if (mode === 'amount' && !nothingLeft) {
      if (creditAmount === null) return toast('הסכום לא תקין. כותבים רק מספר, למשל 300 או 120.50', 'err');
      if (creditAmount > cur.received + 0.004) return toast(`הזיכוי לא יכול להיות יותר מהחשבונית (${shekelSmart(cur.received)})`, 'err');
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
      // straight on to the next invoice that is due
      const next = (await pendingReturnInvoices()).find((r) => r.id !== cur.delivery_id);
      if (next) {
        toast(`נשמר ✓ עכשיו ${next.agent}`);
        setParams({ invoice: String(next.id) }, { replace: true });
      } else {
        toast('ההחזרות נשמרו ✓');
        back({ force: true });
      }
    } catch (e) {
      console.error(e);
      toast('השמירה נכשלה. נסה שוב.', 'err');
    }
    setSaving(false);
  }

  async function nothingLeft() {
    if (!cur) return;
    const ok = await ask({ title: `לא נשאר כלום מ${cur.name}?`, text: 'הכול נמכר, אין זיכוי על החשבונית הזו.', ok: 'כן, לא נשאר כלום' });
    if (ok) save(true);
  }

  return (
    <>
      <header className="bar">
        <button type="button" className="icon-btn" aria-label="חזרה" onClick={() => back()}>
          <Icon name="back" />
        </button>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <h1 className="page-title">החזרות · {cur.name}</h1>
          <span className="sub" style={{ fontSize: 14 }}>
            על חשבונית מ{DAY_SHORT[inv.getDay()]} {inv.getDate()}.{inv.getMonth() + 1} · {hebDayMonth(inv)}
          </span>
        </div>
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
                toast('ההחזרה לא יכולה להיות לפני תאריך החשבונית', 'err');
                return;
              }
              setDate(v);
              setDirty(true);
            }}
          />
        </label>
      </header>

      <div className="pad list-top">
        <span>
          חשבונית {shekelSmart(received)}
          {cur.returns_done ? ` · ההחזרות נרשמו ${cur.returns_date ? shortDate(fromIso(cur.returns_date)) : ''} · אפשר לתקן` : ''}
        </span>
        <b>נטו {shekelSmart(received - credit)}</b>
      </div>

      {!canReturn ? (
        <div className="card empty-card" style={{ marginTop: 0 }}>
          <p>בחשבונית הזו אין מה להחזיר{bySum ? ' (נרשם שאין עליה החזרות)' : ' (כל המוצרים בלי החזרה)'}.</p>
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
          {bySum && <p className="hint" style={{ margin: '6px 2px 0' }}>החשבונית נרשמה לפי סכום, ולכן גם ההחזרה נרשמת כסכום.</p>}
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
            החשבונית: {shekelSmart(received)} · אחרי הזיכוי: {shekelSmart(received - credit)}
          </span>
          {!cur.returns_done && credit === 0 && (
            <button type="button" className="btn ghost small" onClick={nothingLeft} disabled={saving}>
              <Icon name="check" size={18} /> לא נשאר כלום
            </button>
          )}
        </section>
      ) : canReturn ? (
        <>
          {returnable.length > 6 && <SearchBox value={productQ} onChange={setProductQ} placeholder="חיפוש מוצר" className="pad-x" />}
          <div className="items">
            {shownReturnable.map((i) => (
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
                <Icon name="check" size={18} /> לא נשאר כלום
              </button>
            )}
          </div>
        </>
      ) : null}

      <Link to={`/agent/${cur.agent_id}?pay=1`} className="center-link pay-link">
        <Icon name="wallet" size={18} /> שילמת ל{cur.name} בכסף? לרישום תשלום
      </Link>

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
    </>
  );
}
