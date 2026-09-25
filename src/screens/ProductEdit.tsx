import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { SubBar } from '../components/SubBar';
import {
  addCategory,
  getProduct,
  hideProduct,
  listAgents,
  listCategories,
  priceHistory,
  saveProduct,
  type Agent,
  type Category,
} from '../db/catalog';
import { photoToDataUrl } from '../lib/image';
import { parseAmount, shekelCents } from '../lib/money';

type Row = { agent_id: number; name: string; color: string | null; cost: string };
type Hist = { kind: string; price: number; changed_at: string; agent: string | null };

function priceText(n: number) {
  return n ? String(Number(n.toFixed(2))) : '';
}

export function ProductEdit() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const isNew = id === 'new';

  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [catId, setCatId] = useState<number | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [sale, setSale] = useState('');
  const [returnable, setReturnable] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [newCat, setNewCat] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [history, setHistory] = useState<Hist[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [a, c] = await Promise.all([listAgents(), listCategories()]);
      setAgents(a);
      setCats(c);
      if (!isNew && id) {
        const p = await getProduct(Number(id));
        if (p) {
          setName(p.name);
          setCatId(p.category_id);
          setImage(p.image);
          setSale(priceText(p.sale_price));
          setReturnable(!!p.returnable);
          setRows(p.agents.map((x) => ({ agent_id: x.agent_id, name: x.name, color: x.color, cost: priceText(x.cost_price) })));
          setHistory(await priceHistory(p.id));
        }
      } else {
        const pre = Number(params.get('agent'));
        const ag = a.find((x) => x.id === pre);
        if (ag) setRows([{ agent_id: ag.id, name: ag.name, color: ag.color, cost: '' }]);
      }
      setLoaded(true);
    })();
  }, [id, isNew, params]);

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      setImage(await photoToDataUrl(f));
    } catch {
      setError('לא הצלחתי לקרוא את התמונה');
    }
  }

  async function createCategory() {
    const n = (newCat ?? '').trim();
    if (!n) return setNewCat(null);
    const cid = await addCategory(n);
    setCats(await listCategories());
    setCatId(cid);
    setNewCat(null);
  }

  function addAgent(a: Agent) {
    setRows((r) => [...r, { agent_id: a.id, name: a.name, color: a.color, cost: '' }]);
    setPicking(false);
  }

  async function save() {
    setError('');
    if (!name.trim()) return setError('צריך לכתוב שם למוצר');
    if (parseAmount(sale) <= 0) return setError('צריך לכתוב מחיר מכירה');
    if (rows.some((r) => parseAmount(r.cost) <= 0)) return setError('צריך לכתוב מחיר קנייה לכל סוכן');
    setSaving(true);
    try {
      await saveProduct({
        id: isNew ? undefined : Number(id),
        name,
        category_id: catId,
        image,
        sale_price: parseAmount(sale),
        returnable,
        agents: rows.map((r) => ({ agent_id: r.agent_id, cost_price: parseAmount(r.cost) })),
      });
      nav(-1);
    } catch (e) {
      console.error(e);
      setError('השמירה נכשלה, נסה שוב');
      setSaving(false);
    }
  }

  async function hide() {
    if (!window.confirm(`להסיר את "${name}" מהמחירון? הנתונים של שבועות קודמים נשמרים.`)) return;
    await hideProduct(Number(id));
    nav(-1);
  }

  const available = agents.filter((a) => !rows.some((r) => r.agent_id === a.id));
  const tint = cats.find((c) => c.id === catId)?.color ?? '#F1EDE2';

  if (!loaded) return <SubBar title={isNew ? 'מוצר חדש' : 'עריכת מוצר'} />;

  return (
    <>
      <SubBar title={isNew ? 'מוצר חדש' : 'עריכת מוצר'} />
      <div className="form">
        <div className="photo" style={{ background: tint }}>
          {image ? (
            <img src={image} alt="תמונת המוצר" />
          ) : (
            <div className="ph">
              <Icon name="image" size={40} stroke={1.6} />
              <span>אין עדיין תמונה</span>
            </div>
          )}
        </div>
        <div className="two">
          <label className="file-btn">
            <Icon name="camera" size={20} /> צילום
            <input type="file" accept="image/*" capture="environment" onChange={onPhoto} aria-label="צילום המוצר" />
          </label>
          <label className="file-btn">
            <Icon name="image" size={20} /> מהגלריה
            <input type="file" accept="image/*" onChange={onPhoto} aria-label="בחירת תמונה מהגלריה" />
          </label>
        </div>

        <div className="field">
          <label htmlFor="pname">שם המוצר</label>
          <input id="pname" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: קוגל ירושלמי" />
        </div>

        <div className="field">
          <span className="lbl">קטגוריה</span>
          <div className="chips">
            {cats.map((c) => (
              <button key={c.id} type="button" className={`chip${catId === c.id ? ' on' : ''}`} onClick={() => setCatId(catId === c.id ? null : c.id)}>
                {c.name}
              </button>
            ))}
            {newCat === null ? (
              <button type="button" className="chip add" onClick={() => setNewCat('')}>+ חדשה</button>
            ) : (
              <span style={{ display: 'flex', gap: 6, width: '100%' }}>
                <input
                  className="input"
                  style={{ height: 44, fontSize: 17 }}
                  autoFocus
                  placeholder="שם הקטגוריה"
                  value={newCat}
                  onChange={(e) => setNewCat(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createCategory()}
                />
                <button type="button" className="chip on" onClick={createCategory}>הוספה</button>
              </span>
            )}
          </div>
        </div>

        <div className="field">
          <label htmlFor="psale">מחיר מכירה בחנות</label>
          <div className="money-in">
            <input id="psale" inputMode="decimal" value={sale} onChange={(e) => setSale(e.target.value)} placeholder="0.00" style={{ color: 'var(--primary)' }} />
            <span>₪</span>
          </div>
        </div>

        <div className="box">
          <span className="lbl">מאיזה סוכן ובאיזה מחיר קנייה</span>
          {rows.length === 0 && <span className="hint">עוד לא נבחר סוכן למוצר הזה.</span>}
          {rows.map((r, i) => (
            <div key={r.agent_id} className="line">
              <span className="dot" style={{ background: r.color ?? 'var(--primary)', width: 12, height: 12, borderRadius: 6 }} />
              <span className="name">{r.name}</span>
              <span className="money-in">
                <input
                  inputMode="decimal"
                  aria-label={`מחיר קנייה אצל ${r.name}`}
                  value={r.cost}
                  placeholder="0.00"
                  onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))}
                />
                <span>₪</span>
              </span>
              <button type="button" className="x-btn" aria-label={`הסרת ${r.name}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                <Icon name="x" size={18} />
              </button>
            </div>
          ))}
          {picking ? (
            <div className="chips">
              {available.map((a) => (
                <button key={a.id} type="button" className="chip" onClick={() => addAgent(a)}>
                  <span className="dot" style={{ background: a.color ?? 'var(--primary)' }} />
                  {a.name}
                </button>
              ))}
              <Link to="/agent/new" className="chip add">+ סוכן חדש</Link>
            </div>
          ) : agents.length === 0 ? (
            <Link to="/agent/new" className="dashed-btn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+ הוספת סוכן ראשון</Link>
          ) : available.length > 0 ? (
            <button type="button" className="dashed-btn" onClick={() => setPicking(true)}>+ {rows.length ? 'סוכן נוסף' : 'בחירת סוכן'}</button>
          ) : null}
        </div>

        <div className="box" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <b style={{ fontSize: 17 }}>ניתן להחזרה לסוכן</b>
            <span className="hint">{returnable ? 'מה שנשאר חוזר לסוכן בזיכוי מלא' : 'המוצר לא יופיע במסך ההחזרות'}</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={returnable}
            aria-label="ניתן להחזרה"
            className={`switch${returnable ? ' on' : ''}`}
            onClick={() => setReturnable(!returnable)}
          >
            <span />
          </button>
        </div>

        {!isNew && history.length > 0 && (
          <div className="box">
            <button type="button" className="set-row" style={{ borderTop: 0, padding: 0, minHeight: 0, fontSize: 16 }} onClick={() => setShowHistory(!showHistory)}>
              <span className="grow">היסטוריית מחירים</span>
              <span className="hint">{showHistory ? 'הסתר' : `${history.length} שינויים`}</span>
            </button>
            {showHistory && (
              <div className="history">
                {history.map((h, i) => (
                  <div key={i}>
                    <span>{h.kind === 'sale' ? 'מכירה' : `קנייה · ${h.agent ?? ''}`}</span>
                    <span>
                      <b>{shekelCents(Number(h.price))}</b> · {h.changed_at.slice(0, 10).split('-').reverse().join('.')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <span className="hint">שינוי מחיר נשמר בהיסטוריה, ושבועות קודמים לא משתנים.</span>

        {error && <div className="update-box err"><p>{error}</p></div>}
      </div>

      <div className="sticky-save">
        <button type="button" className="btn" onClick={save} disabled={saving}>
          {saving ? 'שומר…' : 'שמירת המוצר'}
        </button>
        {!isNew && (
          <div style={{ textAlign: 'center' }}>
            <button type="button" className="danger-link" onClick={hide}>הסרה מהמחירון</button>
          </div>
        )}
      </div>
    </>
  );
}
