import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { agentsForWeek, openReturnsCount, weekSummary, type AgentWeekRow, type WeekSummary } from '../db/repo';
import { addDays, longDate, shortDate, fromIso, startOfWeek, today, weekLabel } from '../lib/dates';
import { shekel } from '../lib/money';
import type { UpdateInfo } from '../lib/updater';

const TILES = [
  { to: '/delivery', icon: 'truck', label: 'קבלת סחורה', bg: 'var(--primary-soft)', fg: 'var(--primary)' },
  { to: '/returns', icon: 'undo', label: 'החזרות', bg: 'var(--gold-soft)', fg: 'var(--gold-ink)' },
  { to: '/income', icon: 'cash', label: 'הכנסה יומית', bg: 'var(--green-soft)', fg: 'var(--green)' },
  { to: '/payment', icon: 'wallet', label: 'תשלום לסוכן', bg: 'var(--blue-soft)', fg: 'var(--blue)' },
  { to: '/expense', icon: 'receipt', label: 'הוצאה כללית', bg: 'var(--red-soft)', fg: 'var(--red)' },
  { to: '/catalog', icon: 'tag', label: 'מוצר חדש', bg: 'var(--chip)', fg: 'var(--ink2)' },
];

type Props = { update: UpdateInfo | null; weekStart: Date; setWeekStart: (d: Date) => void; onLock: () => void };

export function Home({ update, weekStart, setWeekStart, onLock }: Props) {
  const [sum, setSum] = useState<WeekSummary | null>(null);
  const [agents, setAgents] = useState<AgentWeekRow[]>([]);
  const [openReturns, setOpenReturns] = useState(0);
  const now = today();
  const thisWeek = startOfWeek(now);
  const isCurrent = weekStart.getTime() === thisWeek.getTime();

  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, a, r] = await Promise.all([weekSummary(weekStart), agentsForWeek(weekStart), openReturnsCount(addDays(weekStart, -7))]);
      if (!alive) return;
      setSum(s);
      setAgents(a);
      setOpenReturns(r);
    })();
    return () => {
      alive = false;
    };
  }, [weekStart]);

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
        </div>
        <button type="button" className="icon-btn" aria-label="נעילה" onClick={onLock}>
          <Icon name="lock" />
        </button>
      </header>

      {update?.available && (
        <Link to="/settings" className="banner green" style={{ marginTop: 0, marginBottom: 12 }}>
          <span className="ic">
            <Icon name="download" />
          </span>
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
        <div className="switcher">
          <button type="button" aria-label="השבוע הקודם" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            <Icon name="prev" stroke={2.5} />
          </button>
          <button type="button" className="label" style={{ width: 'auto', background: 'transparent', color: 'inherit' }} onClick={() => setWeekStart(thisWeek)}>
            <b>{weekLabel(weekStart)}</b>
            <span>{isCurrent ? 'ראשון עד שבת · השבוע הנוכחי' : `ראשון עד שבת · ${weekStart.getFullYear()}`}</span>
          </button>
          <button type="button" aria-label="השבוע הבא" disabled={isCurrent} onClick={() => setWeekStart(addDays(weekStart, 7))}>
            <Icon name="next" stroke={2.5} />
          </button>
        </div>
      </div>

      <section className="hero">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div className="k">{isCurrent ? 'רווח נקי השבוע' : 'רווח נקי בשבוע'}</div>
          <div className="big">{sum ? shekel(sum.net) : '…'}</div>
          <div className="note">
            {sum?.hasOpenReturns ? 'לפני החזרות · יתעדכן אחרי יום ראשון' : 'הכנסות פחות סחורה נטו והוצאות'}
          </div>
        </div>
        <div className="minis">
          <div className="mini">
            <span>הכנסות</span>
            <b>{sum ? shekel(sum.income) : '…'}</b>
          </div>
          <div className="mini">
            <span>עלות סחורה</span>
            <b>{sum ? shekel(sum.goodsCost) : '…'}</b>
          </div>
          <div className="mini">
            <span>הוצאות</span>
            <b>{sum ? shekel(sum.expenses) : '…'}</b>
          </div>
        </div>
      </section>

      {openReturns > 0 && (
        <Link to="/returns" className="banner gold">
          <span className="ic">
            <Icon name="undo" />
          </span>
          <span className="txt">
            <b>החזרות משבוע שעבר</b>
            <span>{openReturns === 1 ? 'סוכן אחד עדיין לא נרשם' : `${openReturns} סוכנים עדיין לא נרשמו`}</span>
          </span>
          <span className="go">לרישום</span>
        </Link>
      )}

      <section className="section">
        <h2>מה רושמים עכשיו?</h2>
        <div className="tiles">
          {TILES.map((t) => (
            <Link key={t.to + t.label} to={t.to} className="tile">
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
          <h2>סוכנים השבוע</h2>
          {agents.length > 0 && <span>{`${delivered} מתוך ${agents.length} הגיעו`}</span>}
        </div>
        {agents.length === 0 ? (
          <div className="empty">עוד לא הוגדרו סוכנים.<br />הוספת סוכנים ומוצרים תגיע בעדכון הבא.</div>
        ) : (
          agents.map((a) => (
            <Link key={a.id} to={a.delivered ? `/agents/${a.id}` : '/delivery'} className="row">
              <span className="avatar" style={{ background: a.color ?? 'var(--primary)' }}>{a.name.trim().split(' ').pop()?.charAt(0)}</span>
              <span className="grow">
                <b>{a.name}</b>
                <span>{a.delivered && a.deliveryDate ? `הגיע ${shortDate(fromIso(a.deliveryDate))} · ${a.lines} מוצרים` : 'עוד לא הגיע השבוע'}</span>
              </span>
              {a.delivered ? <span className="amt">{shekel(a.cost)}</span> : <span className="pill gold">לרישום</span>}
            </Link>
          ))
        )}
      </section>
    </>
  );
}
