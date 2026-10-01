import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ask } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toast';
import { monthReport, type MonthReport } from '../db/report';
import { fromIso, MONTHS, today } from '../lib/dates';
import { hebDate } from '../lib/hebrew';
import { qty, shekel } from '../lib/money';
import { shareFile, ShareCancelled } from '../lib/share';

const dm = (s: string) => `${fromIso(s).getDate()}.${fromIso(s).getMonth() + 1}`;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

const METHOD_COLORS = ['var(--green)', 'var(--blue)', '#8a6a1a', '#6b4e9b', '#1f6f78', '#50606f'];

function HBar({ value, max, color = '#9c3b26' }: { value: number; max: number; color?: string }) {
  const w = max > 0 ? Math.max(2, (Math.abs(value) / max) * 100) : 0;
  return <span className="track">{Math.abs(value) >= 0.5 && <span className="fill" style={{ width: `${w}%`, background: value < 0 ? 'var(--red)' : color }} />}</span>;
}

/** In the first days of a month the report you want is usually last month's. */
function defaultMonth(now: Date) {
  const d = now.getDate() <= 5 ? new Date(now.getFullYear(), now.getMonth() - 1, 1) : now;
  return { y: d.getFullYear(), m: d.getMonth() };
}

export function Report() {
  const now = today();
  const nav = useNavigate();
  const [ym, setYm] = useState(() => defaultMonth(now));
  const [r, setR] = useState<MonthReport | null>(null);
  const [busy, setBusy] = useState<'' | 'xlsx' | 'pdf'>('');
  const [printing, setPrinting] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setR(null);
    monthReport(ym.y, ym.m).then(setR);
  }, [ym]);

  const isCurrent = ym.y === now.getFullYear() && ym.m === now.getMonth();
  const move = (d: number) => {
    const x = new Date(ym.y, ym.m + d, 1);
    setYm({ y: x.getFullYear(), m: x.getMonth() });
  };
  const fileBase = `דוח-כיכר-השבת-${MONTHS[ym.m]}-${ym.y}`;

  /** Before sending: if returns are still missing, the numbers will change – say so. */
  async function okToExport(): Promise<boolean> {
    // with net counted by payments, missing returns do not change the profit
    if (!r || r.openReturns === 0 || r.mode === 'paid') return true;
    const ok = await ask({
      title: 'ההחזרות עוד לא נרשמו',
      text: `ב-${r.openReturns === 1 ? 'אספקה אחת' : `${r.openReturns} אספקות`} של החודש ההחזרות עוד לא נרשמו, ולכן הרווח בדוח עוד ישתנה.`,
      ok: 'לשלוח בכל זאת',
      cancel: 'לרישום ההחזרות',
    });
    if (!ok) nav('/returns');
    return ok;
  }

  function exportFailed(e: unknown, what: string) {
    if (e instanceof ShareCancelled) return;
    console.error(e);
    toast(`יצירת ${what} נכשלה. נסה שוב.`, 'err');
  }

  async function excel() {
    if (!r || !(await okToExport())) return;
    setBusy('xlsx');
    try {
      const { buildMonthWorkbook } = await import('../lib/excel');
      await shareFile(`${fileBase}.xlsx`, await buildMonthWorkbook(r), `דוח ${MONTHS[ym.m]} ${ym.y}`);
    } catch (e) {
      exportFailed(e, 'קובץ האקסל');
    }
    setBusy('');
  }

  async function pdf() {
    if (!r || !(await okToExport())) return;
    setBusy('pdf');
    setPrinting(true);
    try {
      await new Promise((res) => setTimeout(res, 120));
      const { elementToPdf } = await import('../lib/pdf');
      const blob = await elementToPdf(printRef.current!);
      await shareFile(`${fileBase}.pdf`, blob, `דוח ${MONTHS[ym.m]} ${ym.y}`);
    } catch (e) {
      exportFailed(e, 'ה-PDF');
    }
    setPrinting(false);
    setBusy('');
  }

  const maxWeek = r ? Math.max(1, ...r.weeks.map((w) => Math.abs(w.net))) : 1;
  const maxMethod = r ? Math.max(1, ...r.byMethod.map((m) => m.total)) : 1;
  const empty = r && r.income === 0 && r.received === 0 && r.expenses === 0 && r.paid === 0;

  return (
    <>
      <header className="bar" style={{ paddingBottom: 4 }}>
        <h1 className="page-title" style={{ padding: '4px 4px 0', fontSize: 26 }}>דוחות</h1>
      </header>
      <div className="stack">
        <div className="segment">
          <Link to="/">שבוע</Link>
          <button type="button" className="on">חודש</button>
        </div>
        <div className="switcher">
          <button type="button" aria-label="החודש הקודם" onClick={() => move(-1)}>
            <Icon name="prev" stroke={2.5} />
          </button>
          <button type="button" className="label" onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() })}>
            <b>{MONTHS[ym.m]} {ym.y}</b>
            <span>{r?.hebMonths ?? ''}</span>
            {isCurrent && <em>החודש</em>}
          </button>
          <button type="button" aria-label="החודש הבא" disabled={isCurrent} onClick={() => move(1)}>
            <Icon name="next" stroke={2.5} />
          </button>
        </div>
      </div>

      {!r ? (
        <p className="hint" style={{ textAlign: 'center', marginTop: 30 }}>מחשב…</p>
      ) : empty ? (
        <div className="card empty-card">
          <p>אין עדיין נתונים לחודש הזה.</p>
        </div>
      ) : (
        <>
          <section className="hero">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div className="k">רווח נקי · {MONTHS[ym.m]}</div>
              <div className="big">{shekel(r.net)}</div>
              <div className="note">
                {r.mode === 'paid'
                  ? 'הכנסות פחות תשלומים לסוכנים והוצאות'
                  : r.openReturns > 0
                    ? 'לפני חלק מההחזרות · יתעדכן אחרי שירשמו'
                    : 'הכנסות פחות סחורה נטו והוצאות'}
              </div>
            </div>
            <div className="minis">
              <div className="mini"><span>הכנסות</span><b>{shekel(r.income)}</b></div>
              {r.mode === 'paid' ? (
                <div className="mini"><span>שולם לסוכנים</span><b>{shekel(r.paid)}</b></div>
              ) : (
                <div className="mini"><span>סחורה נטו</span><b>{shekel(r.goodsNet)}</b></div>
              )}
              <div className="mini"><span>הוצאות</span><b>{shekel(r.expenses)}</b></div>
            </div>
          </section>

          <section className="card rsec">
            <div className="kpis">
              <div><span>סחורה שהגיעה</span><b>{shekel(r.received)}</b></div>
              <div><span>זיכוי מהחזרות</span><b style={{ color: 'var(--green)' }}>{shekel(r.credit)}</b></div>
              {r.mode === 'paid' ? (
                <div><span>סחורה נטו (אחרי החזרות)</span><b>{shekel(r.goodsNet)}</b></div>
              ) : (
                <div><span>שולם לסוכנים</span><b>{shekel(r.paid)}</b></div>
              )}
              <div><span>ימים עם הכנסה</span><b>{r.daily.filter((d) => d.total > 0).length}</b></div>
            </div>
            {r.openReturns > 0 && (
              <Link to="/returns" className="banner gold slim" style={{ margin: 0 }}>
                <span className="ic"><Icon name="undo" size={18} /></span>
                <span className="txt">
                  <b>{r.openReturns === 1 ? 'אספקה אחת' : `${r.openReturns} אספקות`} בלי החזרות</b>
                  <span>{r.mode === 'paid' ? 'אחרי הרישום החוב לסוכנים ירד' : 'אחרי הרישום הרווח יעלה'}</span>
                </span>
                <span className="go">לרישום</span>
              </Link>
            )}
          </section>

          <section className="card rsec">
            <h2>רווח נקי לפי שבוע</h2>
            <div className="bars">
              {r.weeks.map((w) => (
                <div key={w.weekStart} className="bar-row wk">
                  <span className="d">
                    <b>{w.title.replace('פרשת ', '')}</b>
                    <small>{dm(w.from)}–{dm(w.to)}</small>
                  </span>
                  <HBar value={w.net} max={maxWeek} />
                  <span className="v" style={{ color: w.net < 0 ? 'var(--red)' : undefined }}>{shekel(w.net)}</span>
                </div>
              ))}
            </div>
          </section>

          {r.byMethod.length > 0 && (
            <section className="card rsec">
              <h2>הכנסות לפי אמצעי תשלום</h2>
              <div className="bars">
                {r.byMethod.map((m, i) => (
                  <div key={m.name} className="bar-row">
                    <span className="d" style={{ width: 64 }}>{m.name}</span>
                    <HBar value={m.total} max={maxMethod} color={METHOD_COLORS[i % METHOD_COLORS.length]} />
                    <span className="v nowrap" style={{ width: 118 }}>{shekel(m.total)} <small style={{ color: 'var(--ink2)' }}>{pct(m.total, r.income)}%</small></span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {r.agents.length > 0 && (
            <section className="card rsec">
              <div className="h2-row"><h2>לפי סוכן</h2><small>בש״ח</small></div>
              <div className="tbl">
                <div className="tr th"><span>סוכן</span><span>הגיע</span><span>חזר</span><span>נטו</span><span>שולם</span></div>
                {r.agents.map((a) => (
                  <Link key={a.id} to={`/agent/${a.id}`} className="tr">
                    <span className="nm"><i style={{ background: a.color ?? 'var(--primary)' }} />{a.name}</span>
                    <span>{Math.round(a.received).toLocaleString('en-US')}</span>
                    <span>{Math.round(a.returned).toLocaleString('en-US')}</span>
                    <span><b>{Math.round(a.net).toLocaleString('en-US')}</b></span>
                    <span>{Math.round(a.paid).toLocaleString('en-US')}</span>
                  </Link>
                ))}
                <div className="tr tt">
                  <span>סה״כ</span>
                  <span>{Math.round(r.received).toLocaleString('en-US')}</span>
                  <span>{Math.round(r.credit).toLocaleString('en-US')}</span>
                  <span>{Math.round(r.goodsNet).toLocaleString('en-US')}</span>
                  <span>{Math.round(r.paid).toLocaleString('en-US')}</span>
                </div>
              </div>
            </section>
          )}

          {r.products.length > 0 && (
            <section className="card rsec">
              <div className="h2-row"><h2>המוצרים הנמכרים ביותר</h2><small>עלות בש״ח</small></div>
              <div className="tbl p3">
                <div className="tr th"><span>מוצר</span><span>נמכר</span><span>הוחזר</span><span>עלות נטו</span></div>
                {r.products.slice(0, 10).map((p) => (
                  <div key={p.id} className="tr">
                    <span className="nm">{p.name}</span>
                    <span><b>{qty(p.sold)}</b></span>
                    <span>{qty(p.returned)}</span>
                    <span>{Math.round(p.cost).toLocaleString('en-US')}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {r.byType.length > 0 && (
            <section className="card rsec">
              <h2>הוצאות כלליות</h2>
              {r.byType.map((t) => (
                <div key={t.name} className="kv"><span>{t.name}</span><b>{shekel(t.total)}</b></div>
              ))}
            </section>
          )}

          <section className="rsec" style={{ background: 'transparent', border: 0, padding: '0 0 8px' }}>
            <div className="two">
              <button type="button" className="btn small" style={{ background: 'var(--green)' }} onClick={excel} disabled={!!busy}>
                <Icon name="sheet" size={20} /> {busy === 'xlsx' ? 'מכין…' : 'שליחת אקסל'}
              </button>
              <button type="button" className="btn small" onClick={pdf} disabled={!!busy}>
                <Icon name="file" size={20} /> {busy === 'pdf' ? 'מכין…' : 'שליחת PDF'}
              </button>
            </div>
            <p className="hint" style={{ textAlign: 'center', margin: '8px 0 0' }}>נפתח תפריט שיתוף: וואטסאפ, Drive, מייל או שמירה בטלפון</p>
          </section>
        </>
      )}

      {printing && r && (
        <div className="print-host" aria-hidden="true">
          <div ref={printRef} className="print">
            <PrintReport r={r} />
          </div>
        </div>
      )}
    </>
  );
}

function PrintReport({ r }: { r: MonthReport }) {
  const money = (n: number) => shekel(n);
  return (
    <>
      <div className="p-head">
        <img src="/logo.webp" alt="" />
        <div>
          <h1>דוח חודשי – {MONTHS[r.month]} {r.year}</h1>
          <p>{r.hebMonths} · הופק {today().toLocaleDateString('he-IL')} ({hebDate(today())})</p>
          {r.openReturns > 0 && r.mode === 'goods' && <p style={{ color: '#8a5a12', fontWeight: 700 }}>שים לב: ב-{r.openReturns} אספקות ההחזרות עוד לא נרשמו, הרווח עוד ישתנה.</p>}
        </div>
      </div>
      <table className="p-kpi">
        <tbody>
          <tr><td>הכנסות</td><td>{money(r.income)}</td><td>סחורה שהגיעה</td><td>{money(r.received)}</td></tr>
          <tr><td>זיכוי מהחזרות</td><td>{money(r.credit)}</td><td>עלות סחורה נטו</td><td>{money(r.goodsNet)}</td></tr>
          <tr><td>הוצאות כלליות</td><td>{money(r.expenses)}</td><td>שולם לסוכנים</td><td>{money(r.paid)}</td></tr>
          <tr className="net"><td>רווח נקי</td><td colSpan={3}>{money(r.net)} <small style={{ fontWeight: 400, fontSize: 12, color: '#6b5847' }}>({r.mode === 'paid' ? 'הכנסות − תשלומים לסוכנים − הוצאות' : 'הכנסות − סחורה נטו − הוצאות'})</small></td></tr>
        </tbody>
      </table>
      <h2>לפי שבועות</h2>
      <table>
        <thead><tr><th>שבוע</th><th>תאריכים</th><th>הכנסות</th><th>{r.mode === 'paid' ? 'שולם לסוכנים' : 'סחורה נטו'}</th><th>הוצאות</th><th>רווח נקי</th></tr></thead>
        <tbody>
          {r.weeks.map((w) => (
            <tr key={w.weekStart}><td>{w.title}</td><td>{dm(w.from)}–{dm(w.to)}</td><td>{money(w.income)}</td><td>{money(r.mode === 'paid' ? w.paid : w.goods)}</td><td>{money(w.expenses)}</td><td><b>{money(w.net)}</b></td></tr>
          ))}
        </tbody>
      </table>
      {r.byMethod.length > 0 && (
        <>
          <h2>הכנסות לפי אמצעי תשלום</h2>
          <table>
            <tbody>
              {r.byMethod.map((m) => (
                <tr key={m.name}><td>{m.name}</td><td>{money(m.total)}</td><td>{pct(m.total, r.income)}%</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {r.agents.length > 0 && (
        <>
          <h2>לפי סוכן</h2>
          <table>
            <thead><tr><th>סוכן</th><th>סחורה שהגיעה</th><th>זיכוי החזרות</th><th>עלות נטו</th><th>שולם החודש</th></tr></thead>
            <tbody>
              {r.agents.map((a) => (
                <tr key={a.id}><td>{a.name}</td><td>{money(a.received)}</td><td>{money(a.returned)}</td><td><b>{money(a.net)}</b></td><td>{money(a.paid)}</td></tr>
              ))}
              <tr className="p-total"><td>סה״כ</td><td>{money(r.received)}</td><td>{money(r.credit)}</td><td>{money(r.goodsNet)}</td><td>{money(r.paid)}</td></tr>
            </tbody>
          </table>
        </>
      )}
      {r.products.length > 0 && (
        <>
          <h2>לפי מוצר</h2>
          <table>
            <thead><tr><th>מוצר</th><th>הגיע</th><th>הוחזר</th><th>נמכר</th><th>עלות נטו</th></tr></thead>
            <tbody>
              {r.products.map((p) => (
                <tr key={p.id}><td>{p.name}</td><td>{qty(p.received)}</td><td>{qty(p.returned)}</td><td><b>{qty(p.sold)}</b></td><td>{money(p.cost)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {r.byType.length > 0 && (
        <>
          <h2>הוצאות כלליות</h2>
          <table>
            <tbody>
              {r.byType.map((t) => (
                <tr key={t.name}><td>{t.name}</td><td>{money(t.total)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="p-foot">כיכר השבת – יריד מעדני השבת</p>
    </>
  );
}
