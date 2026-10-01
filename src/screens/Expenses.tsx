import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ask, askText, choose } from '../components/Dialog';
import { useLeaveGuard } from '../components/guard';
import { Icon } from '../components/Icon';
import { MonthBar, parseYM, sameYM, thisMonth, ymKey, type YM } from '../components/MonthBar';
import { matches, SearchBox } from '../components/SearchBox';
import { SubBar } from '../components/SubBar';
import { toast } from '../components/Toast';
import {
  addExpenseType,
  addRecurring,
  deleteExpense,
  ensureRecurring,
  listExpenses,
  listExpenseTypes,
  saveExpense,
  stopRecurring,
  updateRecurringFrom,
  type Expense,
  type ExpenseType,
} from '../db/ops';
import { monthRange } from '../db/repo';
import { DAY_SHORT, fromIso, iso, MONTHS, shortDate, today } from '../lib/dates';
import { parseAmountStrict, shekelSmart } from '../lib/money';

type Tab = 'fixed' | 'workers';

/** Fixed monthly expenses (repeat by themselves every month) and workers (paid when needed). */
export function Expenses() {
  const [params, setParams] = useSearchParams();
  const ym: YM = parseYM(params.get('month')) ?? thisMonth();
  const tab: Tab = params.get('tab') === 'workers' ? 'workers' : 'fixed';
  const [types, setTypes] = useState<ExpenseType[]>([]);
  const [list, setList] = useState<Expense[]>([]);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [amount, setAmount] = useState('');
  const [typeId, setTypeId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [recurring, setRecurring] = useState(true);
  const [date, setDate] = useState(iso(today()));
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const parsed = parseAmountStrict(amount);
  const isCurrent = sameYM(ym, thisMonth());
  const defaultDate = isCurrent ? iso(today()) : iso(new Date(ym.y, ym.m, 1));

  useLeaveGuard(amount.trim() !== '' && !editing ? true : !!editing && (amount !== String(editing.amount) || note !== (editing.note ?? '')));

  async function load() {
    await ensureRecurring();
    const { from, to } = monthRange(ym.y, ym.m);
    setList(await listExpenses(from, to));
  }

  useEffect(() => {
    listExpenseTypes().then((t) => {
      setTypes(t);
      setTypeId((cur) => cur ?? t[0]?.id ?? null);
    });
  }, []);

  useEffect(() => {
    load();
    reset();
  }, [ym.y, ym.m]);

  function go(next: { ym?: YM; tab?: Tab }) {
    const p = new URLSearchParams(params);
    if (next.ym) p.set('month', ymKey(next.ym));
    if (next.tab) p.set('tab', next.tab);
    setParams(p, { replace: true });
    reset();
  }

  function reset() {
    setEditing(null);
    setAmount('');
    setNote('');
    setRecurring(true);
    setDate(defaultDate);
  }

  function edit(e: Expense) {
    setEditing(e);
    setAmount(String(e.amount));
    setNote(e.note && e.note !== 'בוטל לחודש הזה' ? e.note : '');
    setTypeId(e.type_id);
    setDate(e.date);
    setRecurring(e.recurring_id != null);
    document.querySelector('.screen')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function newType() {
    const name = await askText({ title: 'סוג הוצאה חדש', placeholder: 'למשל: שכירות, חשמל, ארנונה', ok: 'הוספה' });
    if (!name) return;
    const all = await listExpenseTypes(true);
    const same = all.find((t) => t.name.trim() === name);
    if (same) {
      if (same.active) setTypeId(same.id);
      else toast(`"${name}" מוסתר. אפשר להחזיר אותו בהגדרות ← סוגי הוצאות`, 'err');
      return;
    }
    const id = await addExpenseType(name);
    setTypes(await listExpenseTypes());
    setTypeId(id);
  }

  async function save() {
    if (parsed === null) return toast('הסכום לא תקין. כותבים רק מספר, למשל 3500 או 120.50', 'err');
    if (parsed <= 0) return toast('צריך לכתוב סכום', 'err');
    setSaving(true);
    try {
      const month = ymKey(ym);
      if (tab === 'workers') {
        await saveExpense({ id: editing?.id, date, type_id: null, amount: parsed, note, kind: 'workers' });
        toast(editing ? 'עודכן' : `נרשם לפועלים: ${shekelSmart(parsed)}`);
      } else if (editing?.recurring_id) {
        const how = await choose({
          title: 'לשנות את ההוצאה הקבועה?',
          options: [
            { label: `רק ב${MONTHS[ym.m]}`, value: 'one' },
            { label: `מ${MONTHS[ym.m]} והלאה (כל החודשים הבאים)`, value: 'on' },
          ],
        });
        if (!how) return setSaving(false);
        if (how === 'one') await saveExpense({ id: editing.id, date: editing.date, type_id: typeId, amount: parsed, note });
        else await updateRecurringFrom(editing.recurring_id, month, { type_id: typeId, amount: parsed, note });
        toast('ההוצאה עודכנה');
      } else if (editing) {
        await saveExpense({ id: editing.id, date, type_id: typeId, amount: parsed, note });
        toast('ההוצאה עודכנה');
      } else if (recurring) {
        await addRecurring({ type_id: typeId, amount: parsed, note, startMonth: month });
        toast(`נוספה הוצאה קבועה: ${shekelSmart(parsed)} בכל חודש, החל מ${MONTHS[ym.m]}`);
      } else {
        await saveExpense({ date, type_id: typeId, amount: parsed, note, kind: 'general' });
        toast(`נרשמה הוצאה חד-פעמית של ${shekelSmart(parsed)}`);
      }
      reset();
      await load();
    } catch (e) {
      console.error(e);
      toast('השמירה נכשלה. נסה שוב.', 'err');
    }
    setSaving(false);
  }

  async function remove() {
    if (!editing) return;
    if (editing.recurring_id) {
      const how = await choose({
        title: 'למחוק את ההוצאה הקבועה?',
        text: `${editing.type ?? 'הוצאה'} · ${shekelSmart(editing.amount)}`,
        options: [
          { label: `לבטל רק ב${MONTHS[ym.m]}`, value: 'one' },
          { label: `להפסיק מ${MONTHS[ym.m]} והלאה`, value: 'stop', danger: true },
        ],
      });
      if (!how) return;
      if (how === 'one') await saveExpense({ id: editing.id, date: editing.date, type_id: editing.type_id, amount: 0, note: 'בוטל לחודש הזה' });
      else await stopRecurring(editing.recurring_id, ymKey(ym));
      toast(how === 'one' ? 'בוטל לחודש הזה' : 'ההוצאה הקבועה הופסקה');
    } else {
      if (!(await ask({ title: 'למחוק את ההוצאה?', text: `${shekelSmart(editing.amount)} · ${shortDate(fromIso(editing.date))}`, ok: 'מחיקה', danger: true }))) return;
      await deleteExpense(editing.id);
      toast('ההוצאה נמחקה');
    }
    reset();
    load();
  }

  const fixed = list.filter((e) => e.recurring_id != null);
  const oneOff = list.filter((e) => e.recurring_id == null && e.kind === 'general');
  const workers = list.filter((e) => e.kind === 'workers');
  const sum = (l: Expense[]) => l.reduce((s, e) => s + e.amount, 0);
  const total = sum(list);
  const shownWorkers = workers.filter((e) => matches(e.note, q));

  const row = (e: Expense) => {
    const d = fromIso(e.date);
    const canceled = e.recurring_id != null && e.amount === 0;
    return (
      <button key={e.id} type="button" className={`entry${editing?.id === e.id ? ' editing' : ''}`} onClick={() => edit(e)}>
        <span className="when">
          <small>{DAY_SHORT[d.getDay()]}</small>
          <b>{d.getDate()}.{d.getMonth() + 1}</b>
        </span>
        <span className="what">
          <b style={canceled ? { color: 'var(--ink2)', textDecoration: 'line-through' } : undefined}>
            {e.kind === 'workers' ? e.note || 'פועלים' : e.type ?? 'ללא סוג'}
          </b>
          <span>{canceled ? 'בוטל לחודש הזה' : e.kind === 'workers' ? 'פועלים' : e.recurring_id ? `קבועה כל חודש${e.note ? ` · ${e.note}` : ''}` : e.note || 'חד-פעמית'}</span>
        </span>
        <span className="amt">{shekelSmart(e.amount)}</span>
      </button>
    );
  };

  return (
    <>
      <SubBar title="הוצאות" sub="קבועות כל חודש · פועלים" />
      <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <MonthBar ym={ym} onChange={(next) => go({ ym: next })} />
        <section className="card exp-sum">
          <div className="inv-total">
            <span>סה״כ הוצאות ב{MONTHS[ym.m]}</span>
            <b>{shekelSmart(total)}</b>
          </div>
          <div className="inv-agents">
            <span>קבועות · {shekelSmart(sum(fixed))}</span>
            <span>פועלים · {shekelSmart(sum(workers))}</span>
            {oneOff.length > 0 && <span>חד-פעמיות · {shekelSmart(sum(oneOff))}</span>}
          </div>
        </section>
        <div className="segment" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'fixed'} className={tab === 'fixed' ? 'on' : ''} onClick={() => go({ tab: 'fixed' })}>
            הוצאות קבועות
          </button>
          <button type="button" role="tab" aria-selected={tab === 'workers'} className={tab === 'workers' ? 'on' : ''} onClick={() => go({ tab: 'workers' })}>
            פועלים
          </button>
        </div>
      </div>

      <div className="form">
        <section className="card box exp-form">
          <b style={{ fontSize: 17 }}>
            {editing ? 'עריכת הוצאה' : tab === 'workers' ? 'תשלום לפועלים' : 'הוצאה חדשה'}
          </b>
          <div className="two">
            {tab === 'workers' || !recurring || (editing && !editing.recurring_id) ? (
              <label className="date-chip" style={{ height: 52, fontSize: 17, justifyContent: 'center' }}>
                <Icon name="calendar" size={20} />
                {shortDate(fromIso(date))}
                <input type="date" aria-label="תאריך" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
              </label>
            ) : (
              <div className="date-chip fixed-note" style={{ height: 52, justifyContent: 'center' }}>
                <Icon name="refresh" size={18} /> כל 1 לחודש
              </div>
            )}
            <div className={`money-in${parsed === null ? ' bad' : ''}`}>
              <input inputMode="decimal" aria-label="סכום" aria-invalid={parsed === null} placeholder="סכום" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <span>₪</span>
            </div>
          </div>
          {parsed === null && <div className="field-err">כותבים רק מספר, למשל 3500 או 120.50</div>}

          {tab === 'fixed' && (
            <div className="field">
              <span className="lbl">סוג ההוצאה</span>
              <div className="chips">
                {types.map((t) => (
                  <button key={t.id} type="button" aria-pressed={typeId === t.id} className={`chip${typeId === t.id ? ' on' : ''}`} onClick={() => setTypeId(t.id)}>
                    {t.name}
                  </button>
                ))}
                <button type="button" className="chip add" onClick={newType}>+ סוג חדש</button>
              </div>
            </div>
          )}

          <input
            className="input"
            style={{ fontSize: 16, fontWeight: 600, height: 48 }}
            placeholder={tab === 'workers' ? 'שם הפועל / על מה (לא חובה)' : 'הערה (לא חובה)'}
            aria-label="הערה"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          {tab === 'fixed' && !editing && (
            <div className="line" style={{ gap: 12 }}>
              <span className="name" style={{ fontSize: 16 }}>
                חוזרת כל חודש
                <small className="hint" style={{ display: 'block', fontWeight: 500 }}>
                  {recurring ? `נרשמת לבד ב-1 לכל חודש, החל מ${MONTHS[ym.m]}` : 'הוצאה חד-פעמית, רק בתאריך שבחרת'}
                </small>
              </span>
              <button type="button" role="switch" aria-checked={recurring} aria-label="חוזרת כל חודש" className={`switch${recurring ? ' on' : ''}`} onClick={() => setRecurring((r) => !r)}>
                <span />
              </button>
            </div>
          )}

          <button type="button" className="btn" onClick={save} disabled={saving}>
            {saving ? 'שומר…' : editing ? 'שמירת השינויים' : tab === 'workers' ? 'רישום התשלום' : recurring ? 'הוספת הוצאה קבועה' : 'הוספת ההוצאה'}
          </button>
          {editing && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button type="button" className="danger-link" onClick={remove}>
                מחיקה
              </button>
              <button type="button" className="danger-link" style={{ color: 'var(--ink2)' }} onClick={reset}>
                ביטול עריכה
              </button>
            </div>
          )}
        </section>

        {tab === 'fixed' ? (
          <>
            <div className="box ledger" style={{ padding: '4px 14px' }}>
              <div className="list-head">
                <b>קבועות ב{MONTHS[ym.m]}</b>
                <span>{shekelSmart(sum(fixed))}</span>
              </div>
              {fixed.length === 0 && <p className="hint" style={{ padding: '6px 0 12px' }}>עוד אין הוצאות קבועות. מוסיפים למעלה שכירות, חשמל וכו׳ – והן יחזרו לבד כל חודש.</p>}
              {fixed.map(row)}
            </div>
            {oneOff.length > 0 && (
              <div className="box ledger" style={{ padding: '4px 14px' }}>
                <div className="list-head">
                  <b>חד-פעמיות</b>
                  <span>{shekelSmart(sum(oneOff))}</span>
                </div>
                {oneOff.map(row)}
              </div>
            )}
          </>
        ) : (
          <div className="box ledger" style={{ padding: '4px 14px' }}>
            <div className="list-head">
              <b>פועלים ב{MONTHS[ym.m]}</b>
              <span>{shekelSmart(sum(workers))}</span>
            </div>
            {workers.length > 6 && <SearchBox value={q} onChange={setQ} placeholder="חיפוש פועל" className="in-list" />}
            {workers.length === 0 && <p className="hint" style={{ padding: '6px 0 12px' }}>עוד לא נרשמו תשלומים לפועלים החודש.</p>}
            {shownWorkers.map(row)}
          </div>
        )}
      </div>
    </>
  );
}
