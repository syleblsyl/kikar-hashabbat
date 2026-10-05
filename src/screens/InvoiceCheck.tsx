import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ask } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { SubBar } from '../components/SubBar';
import { toast } from '../components/Toast';
import { checkFor, clearChecked, markChecked, type Check } from '../db/billing';
import { creditMonth, MATCH, waitsForReturns, type StockEntry } from '../db/money';
import { parseYM } from '../components/MonthBar';
import { addMonthKey, dm, iso, monthLast, monthName, thisMonthKey, today } from '../lib/dates';
import { products, shekelSmart } from '../lib/money';
import { sendText, ShareCancelled } from '../lib/share';

const minus = (n: number) => shekelSmart(-n).replace('-', '−');

/** One agent and one month of goods: the invoice against the stock, and if they differ – why. */
export function InvoiceCheck() {
  const { agent, month } = useParams();
  const agentId = Number(agent);
  const mk = parseYM(month) ? String(month) : '';
  const [c, setC] = useState<Check | null | undefined>(undefined);
  const [more, setMore] = useState(false);

  async function load() {
    if (!Number.isFinite(agentId) || !mk) return setC(null);
    setC(await checkFor(agentId, mk));
  }

  useEffect(() => {
    load();
  }, [agentId, mk]);

  if (c === undefined) return <SubBar title="בדיקת חשבונית" />;
  if (c === null) {
    return (
      <>
        <SubBar title="בדיקת חשבונית" />
        <div className="card empty-card">
          <p>לא נמצא.</p>
        </div>
      </>
    );
  }

  const m = c.m;
  const mName = monthName(mk);
  const newStockDate = mk === thisMonthKey() ? iso(today()) : monthLast(mk);
  const hints = more ? c.hints : c.hints.slice(0, 3);
  const olderCredits = c.credits.filter((e) => !c.goods.some((g) => g.id === e.id));

  async function checked() {
    if (!c) return;
    const total = c.invoices.reduce((s, i) => s + i.amount, 0);
    const ok = await ask({
      title: 'בדקתי – זה בסדר',
      text: `החשבונית קובעת: ${shekelSmart(total)}.\nההפרש של ${shekelSmart(Math.abs(c.diff))} לא יופיע יותר כבעיה (אלא אם משהו ישתנה).`,
      ok: 'אישור',
    });
    if (!ok) return;
    await markChecked(c.agent.id, mk, c.diff);
    toast('סומן כנבדק');
    load();
  }

  async function uncheck() {
    if (!c) return;
    await clearChecked(c.agent.id, mk);
    load();
  }

  async function share() {
    if (!c) return;
    try {
      await sendText(stockText(c), c.agent.phone);
    } catch (e) {
      if (!(e instanceof ShareCancelled)) toast('השליחה נכשלה', 'err');
    }
  }

  return (
    <>
      <SubBar title="בדיקת חשבונית" sub={`${c.agent.name} · ${monthName(mk, true)}`} />

      <div className="pad">
        {c.state === 'match' && (
          <div className="update-box ok check-status">
            <b>✓ החשבונית תואמת למלאי</b>
            {Math.abs(c.diff) >= 0.01 && <p>הפרש עיגול של {shekelSmart(Math.abs(c.diff))} בלבד.</p>}
          </div>
        )}
        {c.state === 'mismatch' && (
          <div className="update-box err check-status">
            <b>יש הפרש של {shekelSmart(Math.abs(c.diff))}</b>
            <p>
              בחשבונית {shekelSmart(Math.abs(c.diff))} {c.diff > 0 ? 'יותר' : 'פחות'} ממה שרשמתי במלאי. החוב לסוכן הוא לפי החשבונית.
            </p>
          </div>
        )}
        {c.state === 'checked' && (
          <div className="update-box check-status mute">
            <b>הפרש של {shekelSmart(Math.abs(c.diff))} · בדקתי, זה בסדר</b>
            <p>החוב לסוכן הוא לפי החשבונית.</p>
            <button type="button" className="center-link" onClick={uncheck} style={{ background: 'none', border: 0 }}>
              לבטל את הסימון
            </button>
          </div>
        )}
        {c.state === 'waiting' && (
          <div className="update-box check-status">
            <b>עוד לא הגיעה חשבונית על {mName}</b>
            <p>עד שתגיע, החוב והקופה מחושבים לפי המלאי: {shekelSmart(m?.expected ?? 0)}.</p>
            <Link to={`/invoices/new?agent=${c.agent.id}&month=${mk}&from=check`} className="btn small">
              <Icon name="plus" size={18} /> רישום החשבונית
            </Link>
          </div>
        )}
        {c.state === 'merged' && m?.mergedInto && (
          <div className="update-box ok check-status">
            <b>✓ נכלל בחשבונית של {monthName(m.mergedInto)}</b>
            <p>
              ל{mName} נרשמה חשבונית של 0 ₪: הסוכן חייב אותו יחד עם {monthName(m.mergedInto)}, והמלאי שלו נבדק שם.
            </p>
            <Link to={`/check/${c.agent.id}/${m.mergedInto}`} className="btn small ghost">
              לבדיקה של {monthName(m.mergedInto)}
            </Link>
          </div>
        )}
        {c.state === 'no-stock' && (
          <div className="update-box check-status mute">
            <b>לא נרשם מלאי ל{mName}</b>
            <p>אין עם מה להשוות. החוב לסוכן הוא לפי החשבונית.</p>
          </div>
        )}
        {c.state === 'empty' && (
          <div className="update-box check-status mute">
            <b>אין סחורה או חשבונית ל{mName}</b>
          </div>
        )}
      </div>

      {m && c.state !== 'empty' && (
        <section className="card box net-box">
          <div>
            <span>סחורה שהגיעה ב{mName}</span>
            <b>{shekelSmart(m.goods)}</b>
          </div>
          <div>
            <span>פחות: החזרות ב{mName}</span>
            <b className="minus">{minus(m.credit)}</b>
          </div>
          {Math.abs(m.carried) > 0.004 && (
            <div>
              <span>ועוד: המלאי של {monthName(addMonthKey(mk, -1))} (חשבונית 0 ₪)</span>
              <b>{shekelSmart(m.carried).replace('-', '−')}</b>
            </div>
          )}
          <div className="strong">
            <span>לפי המלאי</span>
            <b>{shekelSmart(m.compare).replace('-', '−')}</b>
          </div>
          {c.invoices.map((i) => (
            <Link key={i.id} to={`/invoices/${i.id}?from=check`} className="inv-line">
              <span>
                חשבונית{i.number ? ` מס׳ ${i.number}` : ''} · {dm(i.date)}
                <small>עריכה</small>
              </span>
              <b>{shekelSmart(i.amount)}</b>
            </Link>
          ))}
          {c.invoices.length > 0 && (c.state === 'mismatch' || c.state === 'checked' || c.state === 'match') && (
            <div className="total">
              <span>{Math.abs(c.diff) < MATCH ? 'תואם' : 'הפרש'}</span>
              <b className={Math.abs(c.diff) < MATCH ? 'ok' : 'bad'}>{Math.abs(c.diff) < MATCH ? '✓' : shekelSmart(Math.abs(c.diff))}</b>
            </div>
          )}
        </section>
      )}

      {(c.state === 'mismatch' || c.state === 'checked') && (
        <section className="pad" style={{ marginTop: 14 }}>
          <h2 className="sec-h">למה זה יכול להיות?</h2>
          {c.hints.length === 0 && <p className="hint">לא מצאתי סיבה ברורה. אפשר לשלוח לסוכן את פירוט המלאי ולבקש שיבדוק.</p>}
          {hints.map((h) =>
            h.link ? (
              <Link key={h.key} to={h.link.to} className={`banner slim ${h.strong ? 'gold' : 'plain'}`}>
                <span className="txt">
                  <b>{h.title}</b>
                  <span>{h.text}</span>
                </span>
                <span className="go">{h.link.label}</span>
              </Link>
            ) : (
              <div key={h.key} className={`banner slim ${h.strong ? 'gold' : 'plain'}`}>
                <span className="txt">
                  <b>{h.title}</b>
                  <span>{h.text}</span>
                </span>
              </div>
            ),
          )}
          {c.hints.length > 3 && (
            <button type="button" className="center-link" style={{ background: 'none', border: 0, width: '100%' }} onClick={() => setMore((x) => !x)}>
              {more ? 'פחות' : `עוד סיבות (${c.hints.length - 3})`}
            </button>
          )}
          <div className="two" style={{ marginTop: 10 }}>
            {c.state === 'mismatch' && (
              <button type="button" className="btn small ghost" onClick={checked}>
                <Icon name="check" size={18} /> בדקתי – זה בסדר
              </button>
            )}
            <button type="button" className="btn small ghost wa" onClick={share}>
              <Icon name="message" size={18} /> פירוט לסוכן
            </button>
          </div>
        </section>
      )}

      <section className="card list" style={{ marginTop: 14 }}>
        <div className="head">
          <h2>
            המלאי של {c.agent.name} ב{mName}
          </h2>
        </div>
        {c.goods.length === 0 && olderCredits.length === 0 && <div className="empty">לא נרשמה סחורה ב{mName}.</div>}
        {c.goods.map((e) => (
          <GoodsRow key={e.id} e={e} month={mk} />
        ))}
        {olderCredits.length > 0 && (
          <>
            <div className="sub-head">החזרות ב{mName} על סחורה מחודש קודם</div>
            {olderCredits.map((e) => (
              <Link key={`c${e.id}`} to={`/returns?invoice=${e.id}`} className="row">
                <span className="grow">
                  <b>החזרות {e.returnsDate ? dm(e.returnsDate) : ''}</b>
                  <span>על סחורה מ-{dm(e.date)}</span>
                </span>
                <span className="amt nowrap" style={{ color: 'var(--green)' }}>{minus(e.credit)}</span>
              </Link>
            ))}
          </>
        )}
        <Link to={`/stock/new?agent=${c.agent.id}&date=${newStockDate}`} className="dashed-btn" style={{ margin: '8px 0 12px' }}>
          <Icon name="plus" size={18} /> סחורה שלא נרשמה
        </Link>
      </section>
      <div style={{ height: 24 }} />
    </>
  );
}

function GoodsRow({ e, month }: { e: StockEntry; month: string }) {
  const cm = creditMonth(e);
  return (
    <Link to={`/stock/${e.id}`} className="row">
      <span className="grow">
        <b>
          סחורה {dm(e.date)} · {e.manual ? 'סכום בלי פירוט' : products(e.lines)}
        </b>
        {Math.abs(e.credit) > 0.004 ? (
          <span className="ok-txt">
            החזרות {e.returnsDate ? dm(e.returnsDate) : ''} · {minus(e.credit)}
            {cm !== month ? ` · נרשמו על ${monthName(cm)}` : ''}
          </span>
        ) : waitsForReturns(e) ? (
          <span className="warn-txt">עוד לא נרשמו החזרות</span>
        ) : e.returnsDone ? (
          <span>בלי החזרות</span>
        ) : null}
      </span>
      <span className="amt nowrap">{shekelSmart(e.received)}</span>
    </Link>
  );
}

/** The month's stock as a message for the agent, to check together. */
function stockText(c: Check): string {
  const m = c.m;
  const plain = (s: string) => s.replace(/[⁦-⁩]/g, '');
  const lines = [`שלום ${c.agent.name},`, `פירוט הסחורה שרשמנו ב${monthName(c.month, true)} – כיכר השבת`, ''];
  for (const e of c.goods) lines.push(`${dm(e.date)}: סחורה ${plain(shekelSmart(e.received))}`);
  for (const e of c.credits) lines.push(`${dm(e.returnsDate ?? e.date)}: החזרות ${plain(shekelSmart(-e.credit))} (על סחורה מ-${dm(e.date)})`);
  lines.push('');
  if (m) lines.push(`*לפי הרישום שלנו: ${plain(shekelSmart(m.compare))}*`);
  if (c.invoices.length) lines.push(`בחשבונית: ${plain(shekelSmart(c.invoices.reduce((s, i) => s + i.amount, 0)))}`);
  if (Math.abs(c.diff) >= MATCH) lines.push(`הפרש: ${plain(shekelSmart(Math.abs(c.diff)))}`);
  lines.push('', 'אפשר לבדוק יחד? תודה!');
  return lines.join('\n');
}
