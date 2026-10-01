import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { MonthBar, sameYM, thisMonth, ymKey, type YM } from '../components/MonthBar';
import { matches, SearchBox } from '../components/SearchBox';
import { agentsForMonth, monthSummary, type AgentMonthRow, type MonthSummary } from '../db/repo';
import { ensureRecurring, pendingReturnInvoices, type InvoiceRow } from '../db/ops';
import { iso, longDate, today } from '../lib/dates';
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
  const [pending, setPending] = useState<InvoiceRow[]>([]);
  const [q, setQ] = useState('');
  const now = today();
  const isCurrent = sameYM(ym, thisMonth());
  const todayEvents = dayEvents(now);
  const incomeDate = isCurrent ? iso(now) : iso(new Date(ym.y, ym.m, 1));

  useEffect(() => {
    let alive = true;
    (async () => {
      await ensureRecurring().catch(() => undefined);
      const [s, a, p] = await Promise.all([monthSummary(ym.y, ym.m), agentsForMonth(ym.y, ym.m), pendingReturnInvoices()]);
      if (!alive) return;
      setSum(s);
      setAgents(a);
      setPending(p);
    })();
    return () => {
      alive = false;
    };
  }, [ym.y, ym.m]);

  const tiles = [
    { to: `/invoices?month=${ymKey(ym)}`, icon: 'receipt', label: 'חשבוניות', bg: 'var(--primary-soft)', fg: 'var(--primary)' },
    { to: '/returns', icon: 'undo', label: 'החזרות', bg: 'var(--gold-soft)', fg: 'var(--gold-ink)' },
    { to: `/income?date=${incomeDate}`, icon: 'cash', label: 'הכנסה יומית', bg: 'var(--green-soft)', fg: 'var(--green)' },
    { to: '/payment', icon: 'wallet', label: 'תשלום לסוכן', bg: 'var(--blue-soft)', fg: 'var(--blue)' },
    { to: `/expense?month=${ymKey(ym)}`, icon: 'sheet', label: 'הוצאות', bg: 'var(--red-soft)', fg: 'var(--red)' },
    { to: '/product/new', icon: 'tag', label: 'מוצר חדש', bg: 'var(--chip)', fg: 'var(--ink2)' },
  ];
  const shown = agents.filter((a) => matches(a.name, q));
  const owedTotal = agents.reduce((s, a) => s + Math.max(0, a.balance), 0);

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
          <div className="k">{isCurrent ? 'רווח נקי החודש' : 'רווח נקי בחודש'}</div>
          <div className="big">{sum ? shekel(sum.net) : '…'}</div>
          <div className="note">
            {sum?.mode === 'goods' ? 'הכנסות ברוטו פחות חשבוניות נטו והוצאות' : 'הכנסות ברוטו פחות תשלומים לסוכנים והוצאות'}
          </div>
        </div>
        <div className="minis">
          <Link to={`/income?date=${incomeDate}`} className="mini" style={{ color: '#fff' }}>
            <span>הכנסות ברוטו</span>
            <b>{sum ? shekel(sum.income) : '…'}</b>
          </Link>
          {sum?.mode === 'goods' ? (
            <Link to={`/invoices?month=${ymKey(ym)}`} className="mini" style={{ color: '#fff' }}>
              <span>חשבוניות נטו</span>
              <b>{shekel(sum.goodsCost)}</b>
            </Link>
          ) : (
            <Link to="/payment" className="mini" style={{ color: '#fff' }}>
              <span>שולם לסוכנים</span>
              <b>{sum ? shekel(sum.paid) : '…'}</b>
            </Link>
          )}
          <Link to={`/expense?month=${ymKey(ym)}`} className="mini" style={{ color: '#fff' }}>
            <span>הוצאות</span>
            <b>{sum ? shekel(sum.expenses) : '…'}</b>
          </Link>
        </div>
        {sum && sum.expenses > 0 && (
          <div className="note" style={{ marginTop: -6 }}>
            מתוך ההוצאות: קבועות {shekel(sum.fixed)} · פועלים {shekel(sum.workers)}
            {sum.expenses - sum.fixed - sum.workers > 0.5 ? ` · אחרות ${shekel(sum.expenses - sum.fixed - sum.workers)}` : ''}
          </div>
        )}
      </section>

      {pending.length > 0 && (
        <Link to="/returns" className="banner gold">
          <span className="ic"><Icon name="undo" /></span>
          <span className="txt">
            <b>{pending.length === 1 ? 'חשבונית אחת מחכה להחזרות' : `${pending.length} חשבוניות מחכות להחזרות`}</b>
            <span>{[...new Set(pending.map((p) => p.agent))].slice(0, 3).join(', ')}{new Set(pending.map((p) => p.agent)).size > 3 ? '…' : ''}</span>
          </span>
          <span className="go">לרישום</span>
        </Link>
      )}

      {backupDue && (
        <Link to="/settings/backup" className="banner gold">
          <span className="ic"><Icon name="upload" /></span>
          <span className="txt">
            <b>הגיע הזמן לגיבוי</b>
            <span>שמירת קובץ גיבוי ל-Drive או לוואטסאפ</span>
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
              <b>{t.label}</b>
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
                <span>
                  {a.invoices === 0
                    ? 'אין חשבוניות בחודש הזה'
                    : `${a.invoices === 1 ? 'חשבונית אחת' : `${a.invoices} חשבוניות`} · ${shekelSmart(a.invoiced)}`}
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
