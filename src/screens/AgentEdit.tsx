import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { SubBar } from '../components/SubBar';
import { getAgent, hideAgent, nextAgentColor, PALETTE, productsOfAgent, saveAgent, type Product } from '../db/catalog';
import { DAY_SHORT } from '../lib/dates';
import { shekelCents } from '../lib/money';
import { useBack } from '../components/useBack';

function waLink(phone: string) {
  const digits = phone.replace(/\D/g, '');
  const intl = digits.startsWith('0') ? `972${digits.slice(1)}` : digits;
  return `https://wa.me/${intl}`;
}

export function AgentEdit() {
  const { id } = useParams();
  const nav = useNavigate();
  const back = useBack();
  const isNew = !id || id === 'new';
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [day, setDay] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      if (isNew) {
        setColor(await nextAgentColor());
      } else {
        const a = await getAgent(Number(id));
        if (a) {
          setName(a.name);
          setPhone(a.phone ?? '');
          setColor(a.color ?? PALETTE[0]);
          setDay(a.delivery_day);
          setNotes(a.notes ?? '');
          setProducts(await productsOfAgent(a.id));
        }
      }
      setLoaded(true);
    })();
  }, [id, isNew]);

  async function save() {
    setError('');
    if (!name.trim()) return setError('צריך לכתוב שם לסוכן');
    setSaving(true);
    try {
      const newId = await saveAgent({ id: isNew ? undefined : Number(id), name, phone, color, delivery_day: day, notes });
      if (isNew) nav(`/agent/${newId}`, { replace: true });
      else back();
    } catch (e) {
      console.error(e);
      setError('השמירה נכשלה, נסה שוב');
    }
    setSaving(false);
  }

  async function hide() {
    if (!window.confirm(`להסיר את "${name}" מרשימת הסוכנים? ההיסטוריה שלו נשמרת.`)) return;
    await hideAgent(Number(id));
    back();
  }

  if (!loaded) return <SubBar title={isNew ? 'סוכן חדש' : 'סוכן'} />;

  return (
    <>
      <SubBar title={isNew ? 'סוכן חדש' : name || 'סוכן'} />
      <div className="form">
        {!isNew && phone.trim() && (
          <div className="two">
            <a className="file-btn" href={`tel:${phone.replace(/[^\d+]/g, '')}`}><Icon name="phone" size={20} /> חיוג</a>
            <a className="file-btn" href={waLink(phone)} target="_blank" rel="noreferrer"><Icon name="message" size={20} /> וואטסאפ</a>
          </div>
        )}

        <div className="field">
          <label htmlFor="aname">שם הסוכן</label>
          <input id="aname" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: מאפיית לוי" />
        </div>
        <div className="field">
          <label htmlFor="aphone">טלפון</label>
          <input id="aphone" className="input" inputMode="tel" dir="ltr" style={{ textAlign: 'right' }} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="050-0000000" />
        </div>
        <div className="field">
          <span className="lbl">צבע</span>
          <div className="swatches">
            {PALETTE.map((c) => (
              <button key={c} type="button" aria-label={`צבע ${c}`} aria-pressed={color === c} className={`swatch${color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        <div className="field">
          <span className="lbl">יום אספקה קבוע</span>
          <div className="chips">
            {[3, 4, 5, 0, 1, 2].map((d) => (
              <button key={d} type="button" className={`chip${day === d ? ' on' : ''}`} onClick={() => setDay(day === d ? null : d)}>
                {DAY_SHORT[d]}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="anotes">הערות</label>
          <textarea id="anotes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {!isNew && (
          <div className="box">
            <span className="lbl">המוצרים של הסוכן ({products.length})</span>
            {products.map((p) => {
              const cost = p.agents.find((a) => a.agent_id === Number(id))?.cost_price ?? 0;
              return (
                <Link key={p.id} to={`/product/${p.id}`} className="line" style={{ color: 'var(--ink)' }}>
                  <span className="name">{p.name}</span>
                  <span className="hint">קנייה {shekelCents(cost)}</span>
                </Link>
              );
            })}
            <Link to={`/product/new?agent=${id}`} className="dashed-btn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+ מוצר חדש לסוכן</Link>
          </div>
        )}

        {error && <div className="update-box err"><p>{error}</p></div>}
      </div>
      <div className="sticky-save">
        <button type="button" className="btn" onClick={save} disabled={saving}>{saving ? 'שומר…' : 'שמירת הסוכן'}</button>
        {!isNew && (
          <div style={{ textAlign: 'center' }}>
            <button type="button" className="danger-link" onClick={hide}>הסרת הסוכן</button>
          </div>
        )}
      </div>
    </>
  );
}
