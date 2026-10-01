import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ask } from '../components/Dialog';
import { useLeaveGuard } from '../components/guard';
import { Icon } from '../components/Icon';
import { SubBar } from '../components/SubBar';
import { toast } from '../components/Toast';
import { getAgent, hideAgent, nameTaken, nextAgentColor, PALETTE, productsOfAgent, saveAgent, unhideAgent, type Product } from '../db/catalog';
import { balances } from '../db/ops';
import { DAY_SHORT } from '../lib/dates';
import { shekel, shekelCents } from '../lib/money';
import { useBack } from '../components/useBack';
import { waLink } from '../lib/share';


type Form = { name: string; phone: string; color: string; day: number | null; notes: string };

export function AgentEdit() {
  const { id } = useParams();
  const nav = useNavigate();
  const back = useBack();
  const isNew = !id || id === 'new';
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [f, setF] = useState<Form>({ name: '', phone: '', color: PALETTE[0], day: null, notes: '' });
  const [initial, setInitial] = useState('');
  const [active, setActive] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const dirty = state === 'ready' && JSON.stringify(f) !== initial;
  useLeaveGuard(dirty);

  useEffect(() => {
    (async () => {
      let form: Form = { name: '', phone: '', color: PALETTE[0], day: null, notes: '' };
      if (isNew) {
        form.color = await nextAgentColor();
      } else {
        const a = Number.isFinite(Number(id)) ? await getAgent(Number(id)) : null;
        if (!a) return setState('missing');
        form = { name: a.name, phone: a.phone ?? '', color: a.color ?? PALETTE[0], day: a.delivery_day, notes: a.notes ?? '' };
        setActive(!!a.active);
        setProducts(await productsOfAgent(a.id));
      }
      setF(form);
      setInitial(JSON.stringify(form));
      setState('ready');
    })();
  }, [id, isNew]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    setError('');
    if (!f.name.trim()) {
      setError('צריך לכתוב שם לסוכן');
      document.getElementById('aname')?.focus();
      return;
    }
    if (
      (await nameTaken('agents', f.name, isNew ? undefined : Number(id))) &&
      !(await ask({ title: `כבר יש סוכן בשם "${f.name.trim()}"`, text: 'לשמור בכל זאת סוכן נוסף עם אותו שם?', ok: 'לשמור בכל זאת', cancel: 'לשנות את השם' }))
    )
      return;
    setSaving(true);
    try {
      const newId = await saveAgent({ id: isNew ? undefined : Number(id), name: f.name, phone: f.phone, color: f.color, delivery_day: f.day, notes: f.notes });
      setInitial(JSON.stringify(f));
      toast(isNew ? `הסוכן ${f.name.trim()} נוסף` : 'הפרטים נשמרו');
      if (isNew) nav(`/agent/${newId}`, { replace: true });
      else back({ force: true });
    } catch (e) {
      console.error(e);
      setError('השמירה נכשלה, נסה שוב');
    }
    setSaving(false);
  }

  async function hide() {
    const bal = (await balances()).get(Number(id)) ?? 0;
    const owes = Math.abs(bal) > 0.004;
    const ok = await ask({
      title: `להסתיר את "${f.name}"?`,
      text: owes
        ? `שים לב: ${bal > 0 ? `נשארה יתרה לתשלום לסוכן של ${shekel(bal)}` : `הסוכן עדיין חייב לך ${shekel(-bal)}`}.\nהסוכן לא יופיע ברשימות, אבל כל ההיסטוריה והיתרה נשמרות, ואפשר להחזיר אותו בכל רגע מרשימת הסוכנים.`
        : 'הסוכן לא יופיע יותר ברשימות. כל ההיסטוריה שלו נשמרת, ואפשר להחזיר אותו בכל רגע מרשימת הסוכנים.',
      ok: 'להסתיר',
      danger: true,
    });
    if (!ok) return;
    await hideAgent(Number(id));
    toast(`${f.name} הוסתר`);
    back({ force: true });
  }

  async function restore() {
    await unhideAgent(Number(id));
    setActive(true);
    toast(`${f.name} חזר לרשימת הסוכנים`);
  }

  if (state === 'loading') return <SubBar title={isNew ? 'סוכן חדש' : 'סוכן'} />;
  if (state === 'missing') {
    return (
      <>
        <SubBar title="סוכן" />
        <div className="card empty-card">
          <p>הסוכן הזה לא נמצא.</p>
          <Link to="/agents" className="btn small" style={{ width: 'auto', padding: '0 20px' }}>לרשימת הסוכנים</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <SubBar title={isNew ? 'סוכן חדש' : f.name || 'סוכן'} />
      <div className="form">
        {!active && (
          <div className="banner gold" style={{ margin: 0 }}>
            <span className="txt">
              <b>הסוכן מוסתר</b>
              <span>הוא לא מופיע ברשימות ובקבלת סחורה</span>
            </span>
            <button type="button" className="btn small" style={{ width: 'auto', padding: '0 14px' }} onClick={restore}>החזרה</button>
          </div>
        )}
        {!isNew && f.phone.trim() && (
          <div className="two">
            <a className="file-btn" href={`tel:${f.phone.replace(/[^\d+]/g, '')}`}><Icon name="phone" size={20} /> חיוג</a>
            <a className="file-btn" href={waLink(f.phone)} target="_blank" rel="noreferrer"><Icon name="message" size={20} /> וואטסאפ</a>
          </div>
        )}

        <div className="field">
          <label htmlFor="aname">שם הסוכן</label>
          <input
            id="aname"
            className={`input${error && !f.name.trim() ? ' bad' : ''}`}
            value={f.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="למשל: מאפיית לוי"
            enterKeyHint="next"
          />
        </div>
        <div className="field">
          <label htmlFor="aphone">טלפון</label>
          <input id="aphone" className="input" type="tel" inputMode="tel" dir="ltr" style={{ textAlign: 'right' }} value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="050-0000000" />
        </div>
        <div className="field">
          <span className="lbl">צבע</span>
          <div className="swatches">
            {PALETTE.map((c, i) => (
              <button key={c} type="button" aria-label={`צבע ${i + 1}`} aria-pressed={f.color === c} className={`swatch${f.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => set('color', c)} />
            ))}
          </div>
        </div>
        <div className="field">
          <span className="lbl">יום אספקה קבוע</span>
          <div className="chips">
            {[3, 4, 5, 0, 1, 2].map((d) => (
              <button key={d} type="button" aria-pressed={f.day === d} className={`chip${f.day === d ? ' on' : ''}`} onClick={() => set('day', f.day === d ? null : d)}>
                {DAY_SHORT[d]}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="anotes">הערות</label>
          <textarea id="anotes" className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>

        {!isNew && (
          <div className="box">
            <span className="lbl">המוצרים של הסוכן ({products.length})</span>
            {products.map((p) => {
              const cost = p.agents.find((a) => a.agent_id === Number(id))?.cost_price ?? 0;
              return (
                <Link key={p.id} to={`/product/${p.id}`} className="line" style={{ color: 'var(--ink)', minHeight: 44 }}>
                  <span className="name">{p.name}</span>
                  <span className="hint nowrap">קנייה {shekelCents(cost)}</span>
                </Link>
              );
            })}
            <Link to={`/product/new?agent=${id}`} className="dashed-btn">
              <Icon name="plus" size={18} /> מוצר חדש לסוכן
            </Link>
          </div>
        )}

        {error && <div className="update-box err" role="alert"><p>{error}</p></div>}

        {!isNew && active && (
          <button type="button" className="danger-link end-link" onClick={hide}>
            הסתרת הסוכן
          </button>
        )}
      </div>
      <div className="sticky-save">
        <button type="button" className="btn" onClick={save} disabled={saving}>{saving ? 'שומר…' : 'שמירת הסוכן'}</button>
      </div>
    </>
  );
}
