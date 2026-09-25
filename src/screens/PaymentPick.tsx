import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SubBar } from '../components/SubBar';
import { listAgents, type Agent } from '../db/catalog';
import { balances } from '../db/ops';
import { shekel } from '../lib/money';
import { initialOf } from './Agents';

export function PaymentPick() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [bal, setBal] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    Promise.all([listAgents(), balances()]).then(([a, b]) => {
      setAgents([...a].sort((x, y) => (b.get(y.id) ?? 0) - (b.get(x.id) ?? 0)));
      setBal(b);
    });
  }, []);

  const total = [...bal.entries()].filter(([id]) => agents?.some((a) => a.id === id)).reduce((s, [, v]) => s + Math.max(0, v), 0);

  return (
    <>
      <SubBar title="תשלום לסוכן" sub={agents ? `סה״כ חובות לסוכנים: ${shekel(total)}` : undefined} />
      <section className="card list" style={{ marginTop: 8 }}>
        {agents?.length === 0 && <div className="empty" style={{ borderTop: 0 }}>עוד אין סוכנים.</div>}
        {(agents ?? []).map((a, i) => {
          const b = bal.get(a.id) ?? 0;
          return (
            <Link key={a.id} to={`/agent/${a.id}?pay=1`} className="row" style={i === 0 ? { borderTop: 0 } : undefined}>
              <span className="avatar" style={{ background: a.color ?? 'var(--primary)' }}>{initialOf(a.name)}</span>
              <span className="grow">
                <b>{a.name}</b>
                <span>{b > 0.004 ? 'יתרה לתשלום' : b < -0.004 ? 'הסוכן חייב לך' : 'אין חוב'}</span>
              </span>
              <span className="amt" style={{ color: b > 0.004 ? 'var(--red)' : b < -0.004 ? 'var(--green)' : 'var(--ink2)' }}>{shekel(Math.abs(b))}</span>
            </Link>
          );
        })}
      </section>
    </>
  );
}
