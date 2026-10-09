import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { MonthBar, sameYM, thisMonth, ymKey, type YM } from '../components/MonthBar';
import { matches, SearchBox } from '../components/SearchBox';
import { agentsForMonth, getSetting, monthSummary, setSetting, type AgentMonthRow, type MonthSummary } from '../db/repo';
import { ensureRecurring, pendingReturns, type StockRow } from '../db/ops';
import { monthAgents, type MonthAgentRow } from '../db/billing';
import { ask } from '../components/Dialog';
import { addMonthKey, iso, longDate, monthName, thisMonthKey, today } from '../lib/dates';
import { dayEvents, hebDate } from '../lib/hebrew';
import { shekel, shekelSmart } from '../lib/money';
import type { UpdateInfo } from '../lib/updater';
import { initialOf } from './Agents';

type Props = {
  update: UpdateInfo | null;
  ym: YM;
  setYm: (ym: YM) => void;
  onLock: () => void;
  lockOn: boolean;
  backupDue: boolean;
};

export function Home({ update, ym, setYm, onLock, lockOn, backupDue }: Props) {
  const [sum, setSum] = useState<MonthSummary | null>(null);
  const [agents, setAgents] = useState<AgentMonthRow[]>([]);
  const [pending, setPending] = useState<StockRow[]>([]);
  const [lastMonth, setLastMonth] = useState<MonthAgentRow[]>([]);
  const [intro, setIntro] = useState(false);
  const [q, setQ] = useState('');
  const prevKey = addMonthKey(thisMonthKey(), -1);
  const now = today();
  const isCurrent = sameYM(ym, thisMonth());
  const todayEvents = dayEvents(now);
  const incomeDate = isCurrent ? iso(now) : iso(new Date(ym.y, ym.m, 1));

  useEffect(() => {
    let alive = true;
    (async () => {
      await ensureRecurring().catch(() => undefined);
      const [s, a, p, lm, seen] = await Promise.all([monthSummary(ym.y, ym.m), agentsForMonth(ym.y, ym.m), pendingReturns(), monthAgents(prevKey), getSetting('intro_1015')]);
      if (!alive) return;
      setSum(s);
      setAgents(a);
      setPending(p);
      setLastMonth(lm);
      setIntro(!seen);
    })();
    return () => {
      alive = false;
    };
  }, [ym.y, ym.m]);

  const tiles = [
    { to: `/stock?month=${ymKey(ym)}`, icon: 'truck', label: 'מלאי', sub: 'סחורה שהגיעה', bg: 'var(--primary-soft)', fg: 'var(--primary)' },
    { to: '/returns', icon: 'undo', label: 'החזרות', sub: 'מה שהסוכן לקח', bg: 'var(--gold-soft)', fg: 'var(--gold-ink)' },
    { to: `/income?date=${incomeDate}`, icon: 'cash', label: 'הכנסה יומית', sub: 'מה נכנס לקופה', bg: 'var(--green-soft)', fg: 'var(--green)' },
    { to: '/payment', icon: 'wallet', label: 'תשלום לסוכן', sub: 'כסף ששילמתי', bg: 'var(--blue-soft)', fg: 'var(--blue)' },
    { to: `/expense?month=${ymKey(ym)}`, icon: 'sheet', label: 'הוצאות', sub: 'קבועות ופועלים', bg: 'var(--red-soft)', fg: 'var(--red)' },
    { to: '/invoices', icon: 'receipt', label: 'חשבוניות', sub: 'פעם בחודש מכל סוכן', bg: 'var(--chip)', fg: 'var(--ink2)' },
  ];
  const shown = agents.filter((a) => matches(a.name, q));
  const owedTotal = agents.reduce((s, a) => s + Math.max(0, a.balance), 0);
  // last month's invoices: still missing, or not matching the stock
  const missing = lastMonth.filter((r) => r.state === 'waiting');
  const bad = lastMonth.filter((r) => r.state === 'mismatch');
  const retAgents = [...new Set(pending.map((p) => p.agent))];
  const mk = ymKey(ym);
  const estimate = !!sum && (sum.waiting > 0 || Math.abs(sum.byStock) > 0.004);
  const heroNote = !sum
    ? ''
    : !estimate
      ? sum.goodsCost !== 0
        ? 'הכנסות ברוטו פחות חשבוניות הסוכנים והוצאות · סופי ✓'
        : 'הכנסות ברוטו פחות חיובי הסוכנים והוצאות'
      : Math.abs(sum.byInvoice) < 0.004 && sum.mismatches === 0
        ? isCurrent
          ? `חיובי הסוכנים לפי המלאי. החשבוניות על ${monthName(mk)} יגיעו ב${monthName(addMonthKey(mk, 1))}, ואז המספר יתעדכן.`
          : `חיובי הסוכנים לפי המלאי – עוד לא נרשמו חשבוניות על ${monthName(mk)}.`
        : `${sum.waiting === 1 ? 'סוכן אחד עוד בלי חשבונית' : `${sum.waiting} סוכנים עוד בלי חשבונית`} – אצלם החיוב לפי המלאי (${shekel(sum.byStock)}).`;

  async function explain() {
    await ask({
      title: 'חדש: מלאי וחשבוניות',
      text:
        'מלאי – מה שהגיע מהסוכן במשך החודש, ומה שהוא לקח בחזרה.\n\n' +
        'חשבונית – הסכום שהסוכן שולח פעם בחודש, על החודש הקודם. היא קובעת כמה אני חייב.\n\n' +
        'בדיקה – האפליקציה משווה ביניהם, ואם יש הפרש מראה למה.\n\n' +
        'עד שהחשבונית מגיעה – החוב והקופה מחושבים לפי המלאי.',
      ok: 'הבנתי',
      cancel: 'סגירה',
    });
    await setSetting('intro_1015', '1');
    setIntro(false);
  }

  return (
    <>
      <header className="top">
        <div className="logo">
          <img src="/logo.webp" alt="לוגו כיכר השבת" />
        </div>
        <div className="titles">
          <div className="brand">כיכר השבת</div>
          <div className="sub">{longDate(now)}</div>
          <div className="sub" style={{ fontSize: 14 }}>
            {hebDate(now)}
            {todayEvents.length > 0 && <b style={{ color: 'var(--primary)' }}> · {todayEvents.map((e) => e.name).join(', ')}</b>}
          </div>
        </div>
        {lockOn && (
          <button type="button" className="icon-btn" aria-label="נעילה" onClick={onLock}>
            <Icon name="lock" />
          </button>
        )}
      </header>

      {update?.available && (
        <Link to="/settings" className="banner green" style={{ marginTop: 0, marginBottom: 12 }}>
          <span className="ic"><Icon name="download" /></span>
          <span className="txt">
            <b>גרסה חדשה {update.latestName}</b>
            <span>לחץ כדי לעדכן · הנתונים נשארים</span>
          </span>
          <span className="go">עדכון</span>
        </Link>
      )}

      <div className="stack">
        <MonthBar ym={ym} onChange={setYm} />
      </div>

      <section className="hero">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div className="k">
            {isCurrent ? 'נשאר בקופה החודש' : 'נשאר בקופה בחודש'}
            {estimate && <span className="tag">עוד לא סופי</span>}
          </div>
          <div className="big">{sum ? shekel(sum.net) : '…'}</div>
          <div className="note">{heroNote}</div>
        </div>
        <div className="minis">
          <Link to={`/income?date=${incomeDate}`} className="mini" style={{ color: '#fff' }}>
            <span>הכנסות ברוטו</span>
            <b>{sum ? shekel(sum.income) : '…'}</b>
          </Link>
          <Link to={`/invoices?month=${mk}`} className="mini" style={{ color: '#fff' }}>
            <span>חיובי סוכנים</span>
            <b>{sum ? shekel(sum.goodsCost) : '…'}</b>
            {estimate && <small>{Math.abs(sum!.byInvoice) < 0.004 ? 'לפי מלאי' : 'חלק לפי מלאי'}</small>}
          </Link>
          <Link to={`/expense?month=${ymKey(ym)}`} className="mini" style={{ color: '#fff' }}>
            <span>הוצאות</span>
            <b>{sum ? shekel(sum.expenses) : '…'}</b>
          </Link>
        </div>
        {sum && sum.bySource.filter((s) => Math.abs(s.total) > 0.004).length > 1 && (
          <div className="note" style={{ marginTop: -6 }}>
            מתוך ההכנסות: {sum.bySource.map((s) => `${s.name} ${shekel(s.total)}`).join(' · ')}
          </div>
        )}
        {sum && sum.expenses > 0 && (
          <div className="note" style={{ marginTop: -6 }}>
            מתוך ההוצאות: קבועות {shekel(sum.fixed)} · פועלים {shekel(sum.workers)}
            {sum.expenses - sum.fixed - sum.workers > 0.5 ? ` · אחרות ${shekel(sum.expenses - sum.fixed - sum.workers)}` : ''}
          </div>
        )}
      </section>

      {intro && (
        <button type="button" className="banner green" onClick={explain} style={{ width: 'calc(100% - 32px)', textAlign: 'right', font: 'inherit' }}>
          <span className="ic"><Icon name="info" /></span>
          <span className="txt">
            <b>חדש: מלאי וחשבוניות</b>
            <span>הסבר קצר איך זה עובד עכשיו</span>
          </span>
          <span className="go">הסבר</span>
        </button>
      )}

      {(missing.length > 0 || bad.length > 0) && (
        <Link to={`/invoices?month=${prevKey}`} className={`banner ${bad.length ? 'red' : 'gold'}`}>
          <span className="ic"><Icon name="receipt" /></span>
          <span className="txt">
            <b>
              חשבוניות {monthName(prevKey)}:{missing.length ? ` חסרות ${missing.length}` : ''}
              {missing.length && bad.length ? ' ·' : ''}
              {bad.length ? ` ${bad.length === 1 ? 'אחת לא תואמת' : `${bad.length} לא תואמות`}` : ''}
            </b>
            <span>
              {[...bad, ...missing].slice(0, 3).map((r) => r.name).join(', ')}
              {bad.length + missing.length > 3 ? '…' : ''}
            </span>
          </span>
          <span className="go">{bad.length ? 'לבדיקה' : 'לרישום'}</span>
        </Link>
      )}

      {pending.length > 0 && (
        <Link to="/returns" className="banner gold">
          <span className="ic"><Icon name="undo" /></span>
          <span className="txt">
            <b>החזרות לרישום · {retAgents.length === 1 ? 'סוכן אחד' : `${retAgents.length} סוכנים`}</b>
            <span>{retAgents.slice(0, 3).join(', ')}{retAgents.length > 3 ? '…' : ''}</span>
          </span>
          <span className="go">לרישום</span>
        </Link>
      )}

      {backupDue && (
        <Link to="/settings/backup" className="banner gold">
          <span className="ic"><Icon name="upload" /></span>
          <span className="txt">
            <b>הגיע הזמן לגיבוי</b>
            <span>שמירת קובץ גיבוי בהורדות של הטלפון</span>
          </span>
          <span className="go">לגיבוי</span>
        </Link>
      )}

      <section className="section">
        <h2>מה רושמים עכשיו?</h2>
        <div className="tiles">
          {tiles.map((t) => (
            <Link key={t.label} to={t.to} className="tile">
              <span className="ic" style={{ background: t.bg, color: t.fg }}>
                <Icon name={t.icon} size={24} />
              </span>
              <span className="tl">
                <b>{t.label}</b>
                <small>{t.sub}</small>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="card list">
        <div className="head">
          <h2>סוכנים</h2>
          {owedTotal > 0 && <span>סה״כ אני חייב {shekel(owedTotal)}</span>}
        </div>
        {agents.length > 6 && <SearchBox value={q} onChange={setQ} placeholder="חיפוש סוכן" className="in-list" />}
        {agents.length === 0 ? (
          <div className="empty">
            עוד לא הוגדרו סוכנים.
            <br />
            <Link to="/agent/new" style={{ fontWeight: 800 }}>הוספת סוכן ראשון</Link>
          </div>
        ) : shown.length === 0 ? (
          <div className="empty">לא נמצא סוכן בשם הזה</div>
        ) : (
          shown.map((a) => (
            <Link key={a.id} to={`/agent/${a.id}`} className="row">
              <span className="avatar" style={{ background: a.color ?? 'var(--primary)' }}>{initialOf(a.name)}</span>
              <span className="grow">
                <b>{a.name}</b>
                <span className={a.state === 'mismatch' ? 'bad-txt' : undefined}>
                  {a.source === 'none'
                    ? 'אין סחורה בחודש הזה'
                    : a.source === 'invoice'
                      ? `חשבונית ${shekelSmart(a.invoiced)}${a.state === 'match' ? ' ✓' : a.state === 'mismatch' ? ` · הפרש ${shekelSmart(Math.abs(a.diff))}` : ''}`
                      : `סחורה ${shekelSmart(a.charge)}${isCurrent ? '' : ' · ממתין לחשבונית'}`}
                  {a.paid > 0 ? ` · שולם ${shekelSmart(a.paid)}` : ''}
                </span>
              </span>
              {Math.abs(a.balance) > 0.004 ? (
                <span className="amt-col">
                  <span className="amt nowrap" style={{ color: a.balance > 0 ? 'var(--red)' : 'var(--green)' }}>{shekel(Math.abs(a.balance))}</span>
                  <small>{a.balance > 0 ? 'אני חייב' : 'פלוס שלי'}</small>
                </span>
              ) : (
                <span className="pill gold" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>מאוזן</span>
              )}
            </Link>
          ))
        )}
      </section>
    </>
  );
}
