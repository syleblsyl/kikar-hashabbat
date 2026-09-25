import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { SubBar } from '../components/SubBar';
import { toast } from '../components/Toast';
import { addExpenseType, deleteExpense, listExpenses, listExpenseTypes, saveExpense, type Expense, type ExpenseType } from '../db/ops';
import { fromIso, iso, MONTHS, shortDate, today } from '../lib/dates';
import { parseAmount, shekel } from '../lib/money';

export function Expenses() {
  const now = today();
  const [month, setMonth] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [types, setTypes] = useState<ExpenseType[]>([]);
  const [list, setList] = useState<Expense[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [date, setDate] = useState(iso(now));
  const [typeId, setTypeId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const from = iso(month);
  const to = iso(new Date(month.getFullYear(), month.getMonth() + 1, 0));

  const load = async () => setList(await listExpenses(from, to));

  useEffect(() => {
    listExpenseTypes().then((t) => {
      setTypes(t);
      setTypeId((cur) => cur ?? t[0]?.id ?? null);
    });
  }, []);

  useEffect(() => {
    load();
  }, [from]);

  function reset() {
    setEditId(null);
    setAmount('');
    setNote('');
    setDate(iso(today()));
  }

  async function newType() {
    const name = window.prompt('סוג הוצאה חדש (למשל: שכירות, חשמל, ניקיון)');
    if (!name?.trim()) return;
    const id = await addExpenseType(name);
    setTypes(await listExpenseTypes());
    setTypeId(id);
  }

  async function save() {
    const a = parseAmount(amount);
    if (a <= 0) return toast('צריך לכתוב סכום');
    setSaving(true);
    await saveExpense({ id: editId ?? undefined, date, type_id: typeId, amount: a, note });
    toast(editId ? 'ההוצאה עודכנה' : `נשמרה הוצאה של ${shekel(a)}`);
    const d = fromIso(date);
    reset();
    if (d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear()) setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    else load();
    setSaving(false);
  }

  function edit(e: Expense) {
    setEditId(e.id);
    setDate(e.date);
    setTypeId(e.type_id);
    setAmount(String(e.amount));
    setNote(e.note ?? '');
    document.querySelector('.screen')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function remove() {
    if (!editId || !window.confirm('למחוק את ההוצאה?')) return;
    await deleteExpense(editId);
    toast('ההוצאה נמחקה');
    reset();
    load();
  }

  const total = list.reduce((s, e) => s + e.amount, 0);
  const byType = new Map<string, number>();
  for (const e of list) byType.set(e.type ?? 'ללא סוג', (byType.get(e.type ?? 'ללא סוג') ?? 0) + e.amount);

  return (
    <>
      <SubBar title={editId ? 'עריכת הוצאה' : 'הוצאה כללית'} />
      <div className="form">
        <div className="two">
          <label className="date-chip" style={{ height: 52, fontSize: 17, justifyContent: 'center' }}>
            <Icon name="calendar" size={20} />
            {shortDate(fromIso(date))}
            <input type="date" aria-label="תאריך ההוצאה" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <div className="money-in">
            <input inputMode="decimal" aria-label="סכום" placeholder="סכום" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <span>₪</span>
          </div>
        </div>
        <div className="field">
          <span className="lbl">סוג ההוצאה</span>
          <div className="chips">
            {types.map((t) => (
              <button key={t.id} type="button" className={`chip${typeId === t.id ? ' on' : ''}`} onClick={() => setTypeId(t.id)}>
                {t.name}
              </button>
            ))}
            <button type="button" className="chip add" onClick={newType}>+ סוג חדש</button>
          </div>
          {types.length === 0 && <span className="hint">עוד אין סוגי הוצאות. לוחצים "+ סוג חדש" ומוסיפים שכירות, חשמל וכו׳.</span>}
        </div>
        <div className="field">
          <label htmlFor="enote">הערה (לא חובה)</label>
          <input id="enote" className="input" style={{ fontSize: 17, fontWeight: 600 }} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button type="button" className="btn" onClick={save} disabled={saving}>
          {saving ? 'שומר…' : editId ? 'שמירת השינויים' : 'הוספת ההוצאה'}
        </button>
        {editId && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button type="button" className="danger-link" onClick={remove}>מחיקה</button>
            <button type="button" className="danger-link" style={{ color: 'var(--ink2)' }} onClick={reset}>ביטול עריכה</button>
          </div>
        )}

        <div className="switcher" style={{ marginTop: 8 }}>
          <button type="button" aria-label="החודש הקודם" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
            <Icon name="prev" stroke={2.5} />
          </button>
          <div className="label" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <b>{MONTHS[month.getMonth()]} {month.getFullYear()}</b>
            <span>סה״כ {shekel(total)}</span>
          </div>
          <button
            type="button"
            aria-label="החודש הבא"
            disabled={month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth()}
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          >
            <Icon name="next" stroke={2.5} />
          </button>
        </div>

        {byType.size > 0 && (
          <div className="week-notes" style={{ justifyContent: 'flex-start' }}>
            {[...byType.entries()].map(([k, v]) => (
              <span key={k}>{k}: {shekel(v)}</span>
            ))}
          </div>
        )}

        <div className="box ledger" style={{ padding: '4px 14px' }}>
          {list.length === 0 && <p className="hint" style={{ padding: '12px 0' }}>אין הוצאות בחודש הזה.</p>}
          {list.map((e) => (
            <button key={e.id} type="button" className="entry" onClick={() => edit(e)}>
              <span className="when">
                <small>{shortDate(fromIso(e.date)).split(' ')[0]}</small>
                <b>{fromIso(e.date).getDate()}.{fromIso(e.date).getMonth() + 1}</b>
              </span>
              <span className="what">
                <b>{e.type ?? 'ללא סוג'}</b>
                {e.note && <span>{e.note}</span>}
              </span>
              <span className="amt">{shekel(e.amount)}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
