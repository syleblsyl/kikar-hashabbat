import { useEffect, useState } from 'react';
import { ask, askText } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { toast } from '../components/Toast';
import { SubBar } from '../components/SubBar';
import { products } from '../lib/money';
import { addCategory, listCategories, removeCategory, renameCategory, type Category } from '../db/catalog';

export function Categories() {
  const [cats, setCats] = useState<Category[]>([]);
  const [name, setName] = useState('');

  const load = () => listCategories().then(setCats);
  useEffect(() => {
    load();
  }, []);

  async function add() {
    if (!name.trim()) return;
    if (cats.some((c) => c.name.trim() === name.trim())) return toast(`הקטגוריה "${name.trim()}" כבר קיימת`, 'err');
    await addCategory(name);
    setName('');
    load();
  }

  async function rename(c: Category) {
    const n = await askText({ title: 'שם חדש לקטגוריה', value: c.name });
    if (n && n !== c.name) {
      await renameCategory(c.id, n);
      load();
    }
  }

  async function remove(c: Category) {
    const ok = await ask({
      title: `למחוק את הקטגוריה "${c.name}"?`,
      text: c.count ? `${products(c.count)} יישארו בלי קטגוריה (המוצרים עצמם לא נמחקים).` : undefined,
      ok: 'מחיקה',
      danger: true,
    });
    if (!ok) return;
    await removeCategory(c.id);
    load();
  }

  return (
    <>
      <SubBar title="קטגוריות" />
      <div className="form">
        <div className="box">
          {cats.length === 0 && <span className="hint">עוד אין קטגוריות.</span>}
          {cats.map((c) => (
            <div key={c.id} className="line">
              <span className="dot" style={{ background: c.color ?? '#F1EDE2', width: 22, height: 22, borderRadius: 6, border: '1px solid var(--line)' }} />
              <span className="name">{c.name} <span className="hint">· {products(c.count ?? 0)}</span></span>
              <button type="button" className="x-btn" aria-label={`שינוי שם ${c.name}`} onClick={() => rename(c)}><Icon name="edit" size={18} /></button>
              <button type="button" className="x-btn" aria-label={`מחיקת ${c.name}`} onClick={() => remove(c)}><Icon name="trash" size={18} /></button>
            </div>
          ))}
        </div>
        <div className="field">
          <label htmlFor="cname">קטגוריה חדשה</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="cname" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: קוגלים" onKeyDown={(e) => e.key === 'Enter' && add()} />
            <button type="button" className="btn small" style={{ width: 110 }} onClick={add}>הוספה</button>
          </div>
        </div>
      </div>
    </>
  );
}
