import { useEffect, useState } from 'react';
import { askText } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { SubBar } from '../components/SubBar';
import { toast } from '../components/Toast';

type Item = { id: number; name: string; active: number };
type Props = {
  title: string;
  hint: string;
  placeholder: string;
  load: () => Promise<Item[]>;
  add: (name: string) => Promise<unknown>;
  rename: (id: number, name: string) => Promise<void>;
  setActive: (id: number, active: boolean) => Promise<void>;
};

/** Add / rename / hide simple named lists (payment methods, expense types). */
export function ListManager({ title, hint, placeholder, load, add, rename, setActive }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState('');
  const refresh = async () => setItems(await load());

  useEffect(() => {
    refresh();
  }, []);

  async function onAdd() {
    const n = name.trim();
    if (!n) return;
    const same = items.find((i) => i.name.trim() === n);
    if (same) {
      toast(same.active ? `"${n}" כבר ברשימה` : `"${n}" כבר קיים ומוסתר – לוחצים "החזרה" לידו`, 'err');
      return;
    }
    await add(n);
    setName('');
    toast(`"${n}" נוסף`);
    refresh();
  }

  async function onRename(i: Item) {
    const n = await askText({ title: 'שם חדש', value: i.name });
    if (n && n !== i.name) {
      await rename(i.id, n);
      refresh();
    }
  }

  return (
    <>
      <SubBar title={title} />
      <div className="form">
        <p className="hint" style={{ margin: 0 }}>{hint}</p>
        <div className="box">
          {items.length === 0 && <span className="hint">הרשימה ריקה.</span>}
          {items.map((i) => (
            <div key={i.id} className="line">
              <span className="name" style={i.active ? undefined : { color: 'var(--ink2)' }}>
                {i.name}
                {!i.active && <small className="muted-tag">מוסתר</small>}
              </span>
              <button type="button" className="x-btn" aria-label={`שינוי שם ${i.name}`} onClick={() => onRename(i)}><Icon name="edit" size={18} /></button>
              <button
                type="button"
                className="chip"
                style={{ height: 44 }}
                onClick={async () => {
                  await setActive(i.id, !i.active);
                  refresh();
                }}
              >
                {i.active ? 'הסתרה' : 'החזרה'}
              </button>
            </div>
          ))}
        </div>
        <div className="field">
          <label htmlFor="lm-new">הוספה</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="lm-new" className="input" value={name} placeholder={placeholder} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onAdd()} />
            <button type="button" className="btn small" style={{ width: 110 }} onClick={onAdd}>הוספה</button>
          </div>
        </div>
      </div>
    </>
  );
}
