import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ask } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { matches, SearchBox } from '../components/SearchBox';
import { toast } from '../components/Toast';
import { monthReport, type MonthReport } from '../db/report';
import { fromIso, monthKey, MONTHS, today } from '../lib/dates';
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
  const [q, setQ] = useState('');
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

  /** Before sending: if invoices or returns are still missing, the numbers will change – say so. */
  async function okToExport(): Promise<boolean> {
    if (!r || (r.waiting === 0 && r.openReturns === 0)) return true;
    const parts = [
      r.waiting > 0 ? `${r.waiting === 1 ? 'חשבונית אחת' : `${r.waiting} חשבוניות`} על ${MONTHS[r.month]} עוד לא נרשמו – אצל הסוכנים האלה החיוב לפי המלאי.` : '',
      r.openReturns > 0 ? `ב-${r.openReturns === 1 ? 'סחורה אחת' : `${r.openReturns} קבלות סחורה`} ההחזרות עוד לא נרשמו.` : '',
    ].filter(Boolean);
    const ok = await ask({
      title: 'הדוח עוד לא סופי',
      text: `${parts.join('\n')}\nלכן הסכום בקופה עוד ישתנה.`,
      ok: 'לשלוח בכל זאת',
      cancel: r.waiting > 0 ? 'לחשבוניות' : 'לרישום ההחזרות',
    });
    if (!ok) nav(r.waiting > 0 ? `/invoices?month=${monthKey(new Date(r.year, r.month, 1))}` : '/returns');
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
  const empty = r && r.income === 0 && r.received === 0 && r.credit === 0 && r.invoiced === 0 && r.expenses === 0 && r.paid === 0;
  const mk = monthKey(new Date(ym.y, ym.m, 1));

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
              <div className="k">נשאר בקופה · {MONTHS[ym.m]}</div>
              <div className="big">{shekel(r.net)}</div>
              <div className="note">
                {r.waiting > 0
                  ? `עוד לא סופי · ${r.waiting === 1 ? 'סוכן אחד' : `${r.waiting} סוכנים`} בלי חשבונית – אצלם לפי המלאי`
                  : r.openReturns > 0
                    ? 'לפני חלק מההחזרות · יתעדכן אחרי שירשמו'
                    : 'הכנסות ברוטו פחות חיובי הסוכנים והוצאות · לא משנה אם שולם'}
              </div>
            </div>
            <div className="minis">
              <div className="mini"><span>הכנסות ברוטו</span><b>{shekel(r.income)}</b></div>
              <div className="mini"><span>חיובי סוכנים</span><b>{shekel(r.charges)}</b></div>
              <div className="mini"><span>הוצאות</span><b>{shekel(r.expenses)}</b></div>
            </div>
          </section>

          <section className="card rsec">
            <div className="kpis">
              <div><span>מלאי (סחורה פחות החזרות)</span><b>{shekel(r.expected)}</b></div>
              <div><span>חשבוניות</span><b>{shekel(r.invoiced)}</b></div>
              <div><span>שולם לסוכנים</span><b>{shekel(r.paid)}</b></div>
              <div><span>ימים עם הכנסה</span><b>{r.daily.filter((d) => d.total > 0).length}</b></div>
            </div>
            {(r.waiting > 0 || r.mismatches > 0) && (
              <Link to={`/invoices?month=${mk}`} className={`banner slim ${r.mismatches ? 'red' : 'gold'}`} style={{ margin: 0 }}>
                <span className="ic"><Icon name="receipt" size={18} /></span>
                <span className="txt">
                  <b>
                    {r.waiting > 0 ? `חסרות ${r.waiting} חשבוניות` : ''}
                    {r.waiting > 0 && r.mismatches > 0 ? ' · ' : ''}
                    {r.mismatches > 0 ? `${r.mismatches} לא תואמות` : ''}
                  </b>
                  <span>{r.waiting > 0 ? 'עד שיגיעו – החיוב לפי המלאי' : 'יש הפרש בין החשבונית למלאי'}</span>
                </span>
                <span className="go">{r.mismatches ? 'לבדיקה' : 'לרישום'}</span>
              </Link>
            )}
            {r.openReturns > 0 && (
              <Link to="/returns" className="banner gold slim" style={{ margin: 0 }}>
                <span className="ic"><Icon name="undo" size={18} /></span>
                <span className="txt">
                  <b>{r.openReturns === 1 ? 'סחורה אחת' : `${r.openReturns} קבלות סחורה`} בלי החזרות</b>
                  <span>אחרי הרישום הסכום בקופה יעלה</span>
                </span>
                <span className="go">לרישום</span>
              </Link>
            )}
          </section>

          <section className="card rsec">
            <h2>נשאר בקופה לפי שבוע</h2>
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
            {Math.abs(r.correction) >= 1 && (
              <div className="kv" style={{ marginTop: 6 }}>
                <span>תיקון לפי החשבוניות (מול המלאי)</span>
                <b style={{ color: r.correction > 0 ? 'var(--red)' : 'var(--green)' }}>{shekel(-r.correction)}</b>
              </div>
            )}
            <p className="hint" style={{ margin: '6px 0 0' }}>לפי שבוע – לפי המלאי (סחורה והחזרות של אותו שבוע)</p>
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
              {(r.agents.length > 6 || r.products.length > 10) && <SearchBox value={q} onChange={setQ} placeholder="חיפוש סוכן או מוצר" />}
              <div className="tbl">
                <div className="tr th"><span>סוכן</span><span>מלאי</span><span>חשבונית</span><span>חיוב</span><span>שולם</span></div>
                {r.agents.filter((a) => matches(a.name, q)).map((a) => (
                  <Link key={a.id} to={a.state === 'empty' ? `/agent/${a.id}` : `/check/${a.id}/${mk}`} className="tr">
                    <span className="nm"><i style={{ background: a.color ?? 'var(--primary)' }} />{a.name}</span>
                    <span>{Math.round(a.expected).toLocaleString('en-US')}</span>
                    <span className={a.state === 'mismatch' ? 'bad-txt' : undefined}>
                      {a.invoiceCount ? `${Math.round(a.invoiced).toLocaleString('en-US')}${a.state === 'match' ? ' ✓' : a.state === 'mismatch' ? ' ≠' : ''}` : '—'}
                    </span>
                    <span><b>{Math.round(a.charge).toLocaleString('en-US')}</b></span>
                    <span>{Math.round(a.paid).toLocaleString('en-US')}</span>
                  </Link>
                ))}
                <div className="tr tt">
                  <span>סה״כ</span>
                  <span>{Math.round(r.expected).toLocaleString('en-US')}</span>
                  <span>{Math.round(r.invoiced).toLocaleString('en-US')}</span>
                  <span>{Math.round(r.charges).toLocaleString('en-US')}</span>
                  <span>{Math.round(r.paid).toLocaleString('en-US')}</span>
                </div>
              </div>
              <p className="hint" style={{ margin: '6px 0 0' }}>
                חיוב = החשבונית של החודש, ואם עוד אין – לפי המלאי · ✓ תואם · ≠ יש הפרש
              </p>
            </section>
          )}

          {r.products.length > 0 && (
            <section className="card rsec">
              <div className="h2-row"><h2>{q ? 'מוצרים' : 'המוצרים הנמכרים ביותר'}</h2><small>עלות בש״ח</small></div>
              <div className="tbl p3">
                <div className="tr th"><span>מוצר</span><span>נמכר</span><span>הוחזר</span><span>עלות נטו</span></div>
                {(q ? r.products.filter((p) => matches(p.name, q)) : r.products.slice(0, 10)).map((p) => (
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
              <h2>הוצאות</h2>
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
          {r.waiting > 0 && <p style={{ color: '#8a5a12', fontWeight: 700 }}>שים לב: {r.waiting} חשבוניות על החודש עוד לא נרשמו – אצל הסוכנים האלה החיוב לפי המלאי, והסכום עוד ישתנה.</p>}
          {r.openReturns > 0 && <p style={{ color: '#8a5a12', fontWeight: 700 }}>שים לב: ב-{r.openReturns} קבלות סחורה ההחזרות עוד לא נרשמו, הסכום עוד ישתנה.</p>}
        </div>
      </div>
      <table className="p-kpi">
        <tbody>
          <tr><td>הכנסות ברוטו</td><td>{money(r.income)}</td><td>מלאי (סחורה פחות החזרות)</td><td>{money(r.expected)}</td></tr>
          <tr><td>חיובי סוכנים</td><td>{money(r.charges)}</td><td>חשבוניות</td><td>{money(r.invoiced)}</td></tr>
          <tr><td>הוצאות (קבועות ופועלים)</td><td>{money(r.expenses)}</td><td>שולם לסוכנים</td><td>{money(r.paid)}</td></tr>
          <tr className="net"><td>נשאר בקופה</td><td colSpan={3}>{money(r.net)} <small style={{ fontWeight: 400, fontSize: 12, color: '#6b5847' }}>(הכנסות − חיובי סוכנים − הוצאות · חיוב = החשבונית, ואם אין – לפי המלאי)</small></td></tr>
        </tbody>
      </table>
      <h2>לפי שבועות</h2>
      <table>
        <thead><tr><th>שבוע</th><th>תאריכים</th><th>הכנסות</th><th>מלאי</th><th>הוצאות</th><th>נשאר בקופה</th></tr></thead>
        <tbody>
          {r.weeks.map((w) => (
            <tr key={w.weekStart}><td>{w.title}</td><td>{dm(w.from)}–{dm(w.to)}</td><td>{money(w.income)}</td><td>{money(w.goods)}</td><td>{money(w.expenses)}</td><td><b>{money(w.net)}</b></td></tr>
          ))}
          {Math.abs(r.correction) >= 1 && (
            <tr><td colSpan={5}>תיקון לפי החשבוניות (מול המלאי)</td><td><b>{money(-r.correction)}</b></td></tr>
          )}
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
            <thead><tr><th>סוכן</th><th>סחורה</th><th>החזרות</th><th>לפי המלאי</th><th>חשבונית</th><th>חיוב</th><th>שולם החודש</th></tr></thead>
            <tbody>
              {r.agents.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td><td>{money(a.received)}</td><td>{money(a.returned)}</td><td>{money(a.expected)}</td>
                  <td>{a.invoiceCount ? `${money(a.invoiced)}${a.state === 'mismatch' ? ` (הפרש ${money(Math.abs(a.diff))})` : a.state === 'match' ? ' ✓' : ''}` : 'עוד לא הגיעה'}</td>
                  <td><b>{money(a.charge)}</b></td><td>{money(a.paid)}</td>
                </tr>
              ))}
              <tr className="p-total"><td>סה״כ</td><td>{money(r.received)}</td><td>{money(r.credit)}</td><td>{money(r.expected)}</td><td>{money(r.invoiced)}</td><td>{money(r.charges)}</td><td>{money(r.paid)}</td></tr>
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
          <h2>הוצאות</h2>
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
