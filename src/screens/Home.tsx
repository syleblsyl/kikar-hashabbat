import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { WeekBar } from '../components/WeekBar';
import { agentsForWeek, weekSummary, type AgentWeekRow, type WeekSummary } from '../db/repo';
import { pendingReturnsWeeks } from '../db/ops';
import { DAY_NAMES, fromIso, iso, longDate, shortDate, startOfWeek, today } from '../lib/dates';
import { dayEvents, hebDate, weekInfo } from '../lib/hebrew';
import { products, shekel } from '../lib/money';
import type { UpdateInfo } from '../lib/updater';
import { initialOf } from './Agents';

type Props = {
  update: UpdateInfo | null;
  weekStart: Date;
  setWeekStart: (d: Date) => void;
  onLock: () => void;
  lockOn: boolean;
  backupDue: boolean;
};

export function Home({ update, weekStart, setWeekStart, onLock, lockOn, backupDue }: Props) {
  const [sum, setSum] = useState<WeekSummary | null>(null);
  const [agents, setAgents] = useState<AgentWeekRow[]>([]);
  const [pending, setPending] = useState<{ week: string; agents: number }[]>([]);
  const now = today();
  const thisWeek = startOfWeek(now);
  const isCurrent = weekStart.getTime() === thisWeek.getTime();
  const todayEvents = dayEvents(now);
  const week = iso(weekStart);
  const incomeDate = isCurrent ? iso(now) : week;

  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, a, pw] = await Promise.all([weekSummary(weekStart), agentsForWeek(weekStart), pendingReturnsWeeks()]);
      if (!alive) return;
      setSum(s);
      setAgents(a);
      setPending(pw);
    })();
    return () => {
      alive = false;
    };
  }, [weekStart]);

  const tiles = [
    { to: `/delivery?week=${week}`, icon: 'truck', label: 'קבלת סחורה', bg: 'var(--primary-soft)', fg: 'var(--primary)' },
    { to: '/returns', icon: 'undo', label: 'החזרות', bg: 'var(--gold-soft)', fg: 'var(--gold-ink)' },
    { to: `/income?date=${incomeDate}`, icon: 'cash', label: 'הכנסה יומית', bg: 'var(--green-soft)', fg: 'var(--green)' },
    { to: '/payment', icon: 'wallet', label: 'תשלום לסוכן', bg: 'var(--blue-soft)', fg: 'var(--blue)' },
    { to: '/expense', icon: 'receipt', label: 'הוצאה כללית', bg: 'var(--red-soft)', fg: 'var(--red)' },
    { to: '/product/new', icon: 'tag', label: 'מוצר חדש', bg: 'var(--chip)', fg: 'var(--ink2)' },
  ];
  const delivered = agents.filter((a) => a.delivered).length;

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
        <div className="segment">
          <button type="button" className="on">שבוע</button>
          <Link to="/reports">חודש</Link>
        </div>
        <WeekBar weekStart={weekStart} onChange={setWeekStart} />
      </div>

      <section className="hero">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div className="k">{isCurrent ? 'רווח נקי השבוע' : `רווח נקי · ${weekInfo(weekStart).title}`}</div>
          <div className="big">{sum ? shekel(sum.net) : '…'}</div>
          <div className="note">
            {sum?.mode === 'paid'
              ? 'הכנסות פחות תשלומים לסוכנים והוצאות'
              : sum?.hasOpenReturns
                ? 'לפני החזרות · יתעדכן אחרי שירשמו'
                : 'הכנסות פחות סחורה נטו והוצאות'}
          </div>
        </div>
        <div className="minis">
          <Link to={`/income?date=${incomeDate}`} className="mini" style={{ color: '#fff' }}>
            <span>הכנסות</span>
            <b>{sum ? shekel(sum.income) : '…'}</b>
          </Link>
          {sum?.mode === 'paid' ? (
            <Link to="/payment" className="mini" style={{ color: '#fff' }}>
              <span>שולם לסוכנים</span>
              <b>{shekel(sum.paid)}</b>
            </Link>
          ) : (
            <Link to={`/delivery?week=${week}`} className="mini" style={{ color: '#fff' }}>
              <span>עלות סחורה</span>
              <b>{sum ? shekel(sum.goodsCost) : '…'}</b>
            </Link>
          )}
          <Link to="/expense" className="mini" style={{ color: '#fff' }}>
            <span>הוצאות</span>
            <b>{sum ? shekel(sum.expenses) : '…'}</b>
          </Link>
        </div>
      </section>

      {pending.length > 0 && (
        <Link to={`/returns?week=${pending[0].week}`} className="banner gold">
          <span className="ic"><Icon name="undo" /></span>
          <span className="txt">
            {pending.length === 1 ? (
              <>
                <b>החזרות · {weekInfo(fromIso(pending[0].week)).title}</b>
                <span>{pending[0].agents === 1 ? 'סוכן אחד עדיין לא נרשם' : `${pending[0].agents} סוכנים עדיין לא נרשמו`}</span>
              </>
            ) : (
              <>
                <b>החזרות פתוחות מ-{pending.length} שבועות</b>
                <span>{pending.reduce((n, w) => n + w.agents, 0)} אספקות מחכות לרישום ההחזרות</span>
              </>
            )}
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
          <h2>סוכנים {isCurrent ? 'השבוע' : 'בשבוע הזה'}</h2>
          {agents.length > 0 && <span>{`${delivered} מתוך ${agents.length} הגיעו`}</span>}
        </div>
        {agents.length === 0 ? (
          <div className="empty">
            עוד לא הוגדרו סוכנים.
            <br />
            <Link to="/agent/new" style={{ fontWeight: 800 }}>הוספת סוכן ראשון</Link>
          </div>
        ) : (
          agents.map((a) => (
            <Link key={a.id} to={a.delivered ? `/agent/${a.id}` : `/delivery?agent=${a.id}&week=${week}`} className="row">
              <span className="avatar" style={{ background: a.color ?? 'var(--primary)' }}>{initialOf(a.name)}</span>
              <span className="grow">
                <b>{a.name}</b>
                <span>
                  {a.delivered && a.deliveryDate
                    ? `הגיע ${shortDate(fromIso(a.deliveryDate))} · ${products(a.lines)}`
                    : a.deliveryDay != null
                      ? isCurrent && a.deliveryDay === now.getDay()
                        ? 'מגיע היום'
                        : `עוד לא הגיע · מגיע ביום ${DAY_NAMES[a.deliveryDay]}`
                      : 'עוד לא הגיע'}
                </span>
              </span>
              {a.delivered ? <span className="amt nowrap">{shekel(a.cost)}</span> : <span className="pill gold">לרישום</span>}
            </Link>
          ))
        )}
      </section>
    </>
  );
}
