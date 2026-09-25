import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { CATEGORY_TINTS, listAgents, listCategories, listProducts, type Agent, type Category, type Product } from '../db/catalog';
import { shekelCents } from '../lib/money';

export function Catalog() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [cat, setCat] = useState<number | 'all'>('all');
  const [agent, setAgent] = useState<number | 'all'>('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      const [p, c, a] = await Promise.all([listProducts(), listCategories(), listAgents()]);
      setProducts(p);
      setCats(c);
      setAgents(a);
    })();
  }, []);

  const tintOf = useMemo(() => {
    const m = new Map<number, string>();
    cats.forEach((c, i) => m.set(c.id, c.color ?? CATEGORY_TINTS[i % CATEGORY_TINTS.length]));
    return (id: number | null) => (id != null ? m.get(id) : undefined) ?? '#F1EDE2';
  }, [cats]);

  const shown = (products ?? []).filter(
    (p) =>
      (cat === 'all' || p.category_id === cat) &&
      (agent === 'all' || p.agents.some((a) => a.agent_id === agent)) &&
      (q.trim() === '' || p.name.includes(q.trim())),
  );

  return (
    <>
      <header className="cat-head">
        <div className="titles">
          <h1 className="page-title" style={{ fontSize: 26 }}>מחירון</h1>
          <span className="sub" style={{ fontSize: 14 }}>
            {products ? `${products.length} מוצרים · ${agents.length} סוכנים` : '…'}
          </span>
        </div>
        <Link to="/product/new" className="add-btn">
          <Icon name="plus" size={20} stroke={2.6} /> מוצר חדש
        </Link>
      </header>

      {products && products.length === 0 ? (
        <div className="card empty-card">
          <img src="/logo.webp" alt="" style={{ height: 110 }} />
          <p>
            עוד אין מוצרים במחירון.
            <br />
            {agents.length === 0 ? 'כדאי להתחיל בהוספת הסוכנים, ואז להוסיף מוצרים עם תמונה ומחירים.' : 'לוחצים "מוצר חדש", מצלמים, ורושמים מחיר קנייה ומחיר מכירה.'}
          </p>
          {agents.length === 0 && (
            <Link to="/agent/new" className="btn small" style={{ width: 'auto', padding: '0 20px' }}>
              <Icon name="users" /> הוספת סוכן
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="search">
            <label>
              <Icon name="search" size={20} />
              <input type="search" placeholder="חיפוש מוצר" aria-label="חיפוש מוצר" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <select aria-label="סינון לפי סוכן" value={agent} onChange={(e) => setAgent(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
              <option value="all">כל הסוכנים</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div className="chips scroll" style={{ padding: '12px 16px' }}>
            <button type="button" className={`chip${cat === 'all' ? ' on' : ''}`} onClick={() => setCat('all')}>
              הכל {products?.length ?? ''}
            </button>
            {cats.map((c) => (
              <button key={c.id} type="button" className={`chip${cat === c.id ? ' on' : ''}`} onClick={() => setCat(c.id)}>
                {c.name} {c.count ?? 0}
              </button>
            ))}
          </div>

          <div className="pgrid">
            {shown.map((p) => {
              const costs = p.agents.map((a) => a.cost_price);
              const cost = costs.length ? Math.min(...costs) : null;
              const who = p.agents.length === 0 ? 'בלי סוכן' : p.agents.length === 1 ? p.agents[0].name : `${p.agents.length} סוכנים`;
              return (
                <Link key={p.id} to={`/product/${p.id}`} className="pcard">
                  <div className="img" style={{ background: tintOf(p.category_id) }}>
                    {p.image ? <img src={p.image} alt="" /> : <span className="letter">{p.name.charAt(0)}</span>}
                    <span className="badge" style={{ color: p.returnable ? 'var(--green)' : 'var(--ink2)' }}>
                      {p.returnable ? 'חזרה' : 'ללא חזרה'}
                    </span>
                  </div>
                  <div className="body">
                    <b>{p.name}</b>
                    <span className="price">{shekelCents(p.sale_price)}</span>
                    <span className="meta">{cost != null ? `קנייה ${p.agents.length > 1 ? 'מ־' : ''}${shekelCents(cost)} · ${who}` : who}</span>
                  </div>
                </Link>
              );
            })}
          </div>
          {products && shown.length === 0 && <p className="hint" style={{ textAlign: 'center' }}>לא נמצאו מוצרים</p>}
        </>
      )}
    </>
  );
}
