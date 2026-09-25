import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { listAgents, type Agent } from '../db/catalog';
import { DAY_NAMES } from '../lib/dates';
import { products } from '../lib/money';

export function initialOf(name: string) {
  return name.trim().split(/\s+/).pop()?.charAt(0) ?? '?';
}

export function Agents() {
  const [agents, setAgents] = useState<Agent[] | null>(null);

  useEffect(() => {
    listAgents().then(setAgents);
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
              <span style={{ color: 'var(--ink2)' }}><Icon name="chevron" /></span>
            </Link>
          ))}
        </section>
      )}
    </>
  );
}
