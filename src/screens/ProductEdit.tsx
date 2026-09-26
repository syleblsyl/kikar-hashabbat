import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { ask } from '../components/Dialog';
import { canLeave, useLeaveGuard } from '../components/guard';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toast';
import { SubBar } from '../components/SubBar';
import { useBack } from '../components/useBack';
import {
  addCategory,
  getProduct,
  hideProduct,
  listAgents,
  listCategories,
  nameTaken,
  priceHistory,
  saveProduct,
  type Agent,
  type Category,
} from '../db/catalog';
import { photoToDataUrl } from '../lib/image';
import { parseAmountStrict, shekelCents } from '../lib/money';

type Row = { agent_id: number; name: string; color: string | null; cost: string };
type Snap = { name: string; catId: number | null; image: string | null; sale: string; returnable: boolean; rows: Row[] };
type Hist = { kind: string; price: number; changed_at: string; agent: string | null };

function priceText(n: number) {
  return n ? String(Number(n.toFixed(2))) : '';
}

export function ProductEdit() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const back = useBack();
  const nav = useNavigate();
  const isNew = !id || id === 'new';

  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [initial, setInitial] = useState('');
  const [bad, setBad] = useState<string | null>(null);
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
      let snap: Snap = { name: '', catId: null, image: null, sale: '', returnable: true, rows: [] };
      if (!isNew && id) {
        const p = Number.isFinite(Number(id)) ? await getProduct(Number(id)) : null;
        if (!p) return setState('missing');
        snap = {
          name: p.name,
          catId: p.category_id,
          image: p.image,
          sale: priceText(p.sale_price),
          returnable: !!p.returnable,
          rows: p.agents.map((x) => ({ agent_id: x.agent_id, name: x.name, color: x.color, cost: priceText(x.cost_price) })),
        };
        setHistory(await priceHistory(p.id));
      } else {
        const pre = Number(params.get('agent'));
        const ag = a.find((x) => x.id === pre);
        if (ag) snap.rows = [{ agent_id: ag.id, name: ag.name, color: ag.color, cost: '' }];
      }
      setName(snap.name);
      setCatId(snap.catId);
      setImage(snap.image);
      setSale(snap.sale);
      setReturnable(snap.returnable);
      setRows(snap.rows);
      setInitial(JSON.stringify(snap));
      setState('ready');
    })();
  }, [id, isNew, params]);

  const current: Snap = { name, catId, image, sale, returnable, rows };
  const dirty = state === 'ready' && JSON.stringify(current) !== initial;
  useLeaveGuard(dirty);

  /** Shows the problem at the top and moves to the field that needs fixing. */
  function problem(msg: string, fieldId?: string) {
    setError(msg);
    setBad(fieldId ?? null);
    toast(msg, 'err');
    if (fieldId) {
      const el = document.getElementById(fieldId);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus({ preventScroll: true });
    }
  }

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
    setBad(null);
    if (!name.trim()) return problem('צריך לכתוב שם למוצר', 'pname');
    const salePrice = parseAmountStrict(sale);
    if (salePrice === null) return problem('מחיר המכירה לא תקין. כותבים רק מספר, למשל 12.50', 'psale');
    if (salePrice <= 0) return problem('צריך לכתוב מחיר מכירה', 'psale');
    const costs = rows.map((r) => parseAmountStrict(r.cost));
    const badRow = costs.findIndex((c) => c === null || c <= 0);
    if (badRow >= 0) {
      return problem(
        costs[badRow] === null ? `מחיר הקנייה אצל ${rows[badRow].name} לא תקין` : `צריך לכתוב מחיר קנייה אצל ${rows[badRow].name}`,
        `cost-${rows[badRow].agent_id}`,
      );
    }
    if (
      (await nameTaken('products', name, isNew ? undefined : Number(id))) &&
      !(await ask({ title: `כבר יש מוצר בשם "${name.trim()}"`, text: 'לשמור בכל זאת מוצר נוסף עם אותו שם?', ok: 'לשמור בכל זאת', cancel: 'לשנות את השם' }))
    )
      return;
    if (rows.length === 0 && !(await ask({ title: 'לא נבחר סוכן', text: 'בלי סוכן המוצר לא יופיע בקבלת סחורה. לשמור בכל זאת?', ok: 'לשמור בלי סוכן', cancel: 'לבחור סוכן' })))
      return;
    setSaving(true);
    try {
      await saveProduct({
        id: isNew ? undefined : Number(id),
        name,
        category_id: catId,
        image,
        sale_price: salePrice,
        returnable,
        agents: rows.map((r, i) => ({ agent_id: r.agent_id, cost_price: costs[i] ?? 0 })),
      });
      toast(isNew ? `${name.trim()} נוסף למחירון` : 'המוצר נשמר');
      back({ force: true });
    } catch (e) {
      console.error(e);
      problem('השמירה נכשלה, נסה שוב');
      setSaving(false);
    }
  }

  async function hide() {
    const ok = await ask({
      title: `להסיר את "${name}" מהמחירון?`,
      text: 'המוצר לא יופיע יותר בקבלת סחורה. שבועות קודמים לא משתנים, ואפשר להחזיר אותו מתחתית המחירון.',
      ok: 'הסרה',
      danger: true,
    });
    if (!ok) return;
    await hideProduct(Number(id));
    toast(`${name} הוסר מהמחירון`);
    back({ force: true });
  }

  const available = agents.filter((a) => !rows.some((r) => r.agent_id === a.id));
  const tint = cats.find((c) => c.id === catId)?.color ?? '#F1EDE2';

  if (state === 'loading') return <SubBar title={isNew ? 'מוצר חדש' : 'עריכת מוצר'} />;
  if (state === 'missing') {
    return (
      <>
        <SubBar title="מוצר" />
        <div className="card empty-card">
          <p>המוצר הזה לא נמצא.</p>
          <Link to="/catalog" className="btn small" style={{ width: 'auto', padding: '0 20px' }}>למחירון</Link>
        </div>
      </>
    );
  }

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
          <input id="pname" className={`input${bad === 'pname' ? ' bad' : ''}`} enterKeyHint="next" value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: קוגל ירושלמי" />
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
          <div className={`money-in${bad === 'psale' ? ' bad' : ''}`}>
            <input id="psale" inputMode="decimal" enterKeyHint="next" value={sale} onChange={(e) => setSale(e.target.value)} placeholder="0.00" style={{ color: 'var(--primary)' }} />
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
              <span className={`money-in${bad === `cost-${r.agent_id}` ? ' bad' : ''}`}>
                <input
                  id={`cost-${r.agent_id}`}
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
              <button type="button" className="chip add" onClick={async () => (await canLeave()) && nav('/agent/new')}>+ סוכן חדש</button>
            </div>
          ) : agents.length === 0 ? (
            <button type="button" className="dashed-btn" onClick={async () => (await canLeave()) && nav('/agent/new')}>+ הוספת סוכן ראשון</button>
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

        {error && <div className="update-box err" role="alert"><p>{error}</p></div>}

        {!isNew && (
          <button type="button" className="danger-link end-link" onClick={hide}>הסרה מהמחירון</button>
        )}
      </div>

      <div className="sticky-save">
        <button type="button" className="btn" onClick={save} disabled={saving}>
          {saving ? 'שומר…' : 'שמירת המוצר'}
        </button>
      </div>
    </>
  );
}
