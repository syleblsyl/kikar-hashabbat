import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { listAgents, type Agent } from '../db/catalog';
import { balances } from '../db/ops';
import { DAY_NAMES } from '../lib/dates';
import { products, shekel } from '../lib/money';

export function initialOf(name: string) {
  return name.trim().split(/\s+/).pop()?.charAt(0) ?? '?';
}

export function Agents() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [hidden, setHidden] = useState<Agent[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [bal, setBal] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    listAgents().then(setAgents);
    listAgents(true).then(setHidden);
    balances().then(setBal);
  }, []);

  return (
    <>
      <header className="cat-head">
        <div className="titles">
          <h1 className="page-title" style={{ fontSize: 26 }}>סוכנים</h1>
          <span className="sub" style={{ fontSize: 14 }}>{agents ? `${agents.length} סוכנים` : '…'}</span>
        </div>
        <Link to="/agent/new" className="add-btn">
          <Icon name="plus" size={20} stroke={2.6} /> סוכן חדש
        </Link>
      </header>

      {agents && agents.length === 0 ? (
        <div className="card empty-card">
          <img src="/logo.webp" alt="" style={{ height: 110 }} />
          <p>עוד לא הוספת סוכנים.<br />לכל סוכן רושמים שם, טלפון, צבע ויום אספקה, ואחר כך מוסיפים לו מוצרים.</p>
          <Link to="/agent/new" className="btn small" style={{ width: 'auto', padding: '0 20px' }}>
            <Icon name="plus" /> הוספת סוכן ראשון
          </Link>
        </div>
      ) : (
        <section className="card list" style={{ marginTop: 8 }}>
          {(agents ?? []).map((a, i) => (
            <Link key={a.id} to={`/agent/${a.id}`} className="row" style={i === 0 ? { borderTop: 0 } : undefined}>
              <span className="avatar" style={{ background: a.color ?? 'var(--primary)' }}>{initialOf(a.name)}</span>
              <span className="grow">
                <b>{a.name}</b>
                <span>
                  {products(a.products ?? 0)}
                  {a.delivery_day != null ? ` · מגיע ביום ${DAY_NAMES[a.delivery_day]}` : ''}
                </span>
              </span>
              {Math.abs(bal.get(a.id) ?? 0) > 0.004 ? (
                <span className="amt nowrap" style={{ color: (bal.get(a.id) ?? 0) > 0 ? 'var(--red)' : 'var(--green)' }}>{shekel(Math.abs(bal.get(a.id) ?? 0))}</span>
              ) : (
                <span style={{ color: 'var(--ink2)' }}><Icon name="chevron" /></span>
              )}
            </Link>
          ))}
        </section>
      )}

      {hidden.length > 0 && (
        <section className="card list" style={{ marginTop: 12 }}>
          <button type="button" className="row hidden-toggle" style={{ borderTop: 0 }} aria-expanded={showHidden} onClick={() => setShowHidden((v) => !v)}>
            <span className="grow">
              <b>סוכנים מוסתרים ({hidden.length})</b>
              <span>לחיצה על סוכן פותחת את הכרטיס שלו, ומשם אפשר להחזיר אותו</span>
            </span>
            <span style={{ color: 'var(--ink2)', transform: showHidden ? 'rotate(90deg)' : undefined }}><Icon name="chevron" /></span>
          </button>
          {showHidden &&
            hidden.map((a) => {
              const b = bal.get(a.id) ?? 0;
              return (
                <Link key={a.id} to={`/agent/${a.id}`} className="row dimmed">
                  <span className="avatar" style={{ background: a.color ?? 'var(--primary)' }}>{initialOf(a.name)}</span>
                  <span className="grow">
                    <b>{a.name}</b>
                    <span>{Math.abs(b) > 0.004 ? (b > 0 ? 'נשארה יתרה לתשלום' : 'הסוכן חייב לך') : 'מוסתר'}</span>
                  </span>
                  {Math.abs(b) > 0.004 && <span className="amt nowrap" style={{ color: b > 0 ? 'var(--red)' : 'var(--green)' }}>{shekel(Math.abs(b))}</span>}
                </Link>
              );
            })}
        </section>
      )}
    </>
  );
}
