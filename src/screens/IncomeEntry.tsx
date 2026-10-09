import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ask } from '../components/Dialog';
import { useLeaveGuard } from '../components/guard';
import { Icon } from '../components/Icon';
import { SellingDayBar } from '../components/SellingDayBar';
import { SubBar } from '../components/SubBar';
import { toast } from '../components/Toast';
import { useBack } from '../components/useBack';
import { incomeForDay, incomeKey, listSources, methodsForDay, parseIncomeKey, PARTS, saveIncomeDay, type Method, type Part, type Source } from '../db/ops';
import { fromIso, iso, parseIso, partNames, sellingDay } from '../lib/dates';
import { parseAmountStrict, shekelSmart } from '../lib/money';

/** cash (green), card (blue), anything else */
function methodTone(name: string) {
  if (/מזומן/.test(name)) return { bg: 'var(--green-soft)', fg: 'var(--green)', icon: 'cash' };
  if (/אשראי|כרטיס/.test(name)) return { bg: 'var(--blue-soft)', fg: 'var(--blue)', icon: 'card' };
  return { bg: 'var(--chip)', fg: 'var(--ink2)', icon: 'dots' };
}

const fmtInput = (n: number) => (n ? String(Number(n.toFixed(2))) : '');

/** One place (the store or the mikveh), one selling day: the night before and the day itself, each cash and card. */
export function IncomeEntry() {
  const { source } = useParams();
  const sourceId = Number(source);
  const [params, setParams] = useSearchParams();
  const back = useBack();
  const date = iso(parseIso(params.get('date')) ?? sellingDay());
  const day = fromIso(date);
  const names = partNames(day);
  const [src, setSrc] = useState<Source | null | undefined>(undefined);
  const [index, setIndex] = useState(0);
  const [methods, setMethods] = useState<Method[]>([]);
  /** "source|part|method" → typed text (this source only) */
  const [values, setValues] = useState<Record<string, string>>({});
  /** hidden or other methods that already have an amount, shown with cash and card */
  const [extra, setExtra] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [all, mts, amounts] = await Promise.all([listSources(), methodsForDay(date), incomeForDay(date)]);
      const i = all.findIndex((s) => s.id === sourceId);
      setSrc(i >= 0 ? all[i] : null);
      setIndex(Math.max(0, i));
      setMethods(mts);
      const v: Record<string, string> = {};
      for (const part of PARTS) for (const m of mts) v[incomeKey(sourceId, part, m.id)] = fmtInput(amounts.get(incomeKey(sourceId, part, m.id)) ?? 0);
      setValues(v);
      setExtra(new Set([...amounts.entries()].filter(([k, a]) => a !== 0 && k.startsWith(`${sourceId}|`)).map(([k]) => k)));
      setDirty(false);
    })();
  }, [date, sourceId]);

  // cash and card (by name; the first two methods if they were renamed)
  const named = methods.filter((m) => m.active && (/מזומן/.test(m.name) || /אשראי|כרטיס/.test(m.name)));
  const mainIds = new Set((named.length ? named : methods.filter((m) => m.active).slice(0, 2)).map((m) => m.id));
  const keys = Object.keys(values);
  const parsed = new Map(keys.map((k) => [k, parseAmountStrict(values[k] ?? '')]));
  const invalid = keys.filter((k) => parsed.get(k) === null);
  const partTotal = (part: Part) => methods.reduce((s, m) => s + (parsed.get(incomeKey(sourceId, part, m.id)) ?? 0), 0);
  const total = partTotal('night') + partTotal('day');
  const nameOf = (k: string) => {
    const { part, methodId } = parseIncomeKey(k);
    return `${methods.find((m) => m.id === methodId)?.name ?? ''} של ${part === 'night' ? names.night : names.day}`;
  };

  async function persist(): Promise<boolean> {
    if (invalid.length > 0) {
      toast(`הסכום ב${nameOf(invalid[0])} לא תקין. כותבים רק מספר, למשל 350 או 12.50`, 'err');
      return false;
    }
    await saveIncomeDay(
      date,
      keys.map((k) => ({ ...parseIncomeKey(k), amount: parsed.get(k) ?? 0 })),
    );
    setDirty(false);
    return true;
  }

  // leaving saves what was typed; a bad amount asks first
  useLeaveGuard(dirty, async () => {
    if (invalid.length === 0) {
      try {
        return await persist();
      } catch {
        return ask({ title: 'השמירה נכשלה', text: 'לצאת בלי לשמור?', ok: 'לצאת בלי לשמור', cancel: 'להישאר', danger: true });
      }
    }
    return ask({
      title: 'יש סכום לא תקין',
      text: `הסכום ב${nameOf(invalid[0])} לא מספר, ולכן לא נשמר. לצאת בלי לשמור?`,
      ok: 'לצאת בלי לשמור',
      cancel: 'להישאר ולתקן',
      danger: true,
    });
  });

  async function pick(d: string) {
    if (d === date) return;
    if (dirty && !(await persist())) return;
    const p = new URLSearchParams(params);
    p.set('date', d);
    setParams(p, { replace: true });
  }

  async function save() {
    setSaving(true);
    try {
      if (await persist()) {
        toast(`נשמר ✓ ${src?.name}: ${shekelSmart(total)}`);
        back({ force: true });
      }
    } catch (e) {
      console.error(e);
      toast('השמירה נכשלה. נסה שוב.', 'err');
    }
    setSaving(false);
  }

  if (src === undefined) return <SubBar title="הכנסות" />;
  if (src === null) {
    return (
      <>
        <SubBar title="הכנסות" />
        <div className="card empty-card">
          <p>המקום הזה לא נמצא.</p>
          <Link to="/income" className="btn small" style={{ width: 'auto', padding: '0 20px' }}>להכנסות</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="bar">
        <button type="button" className="icon-btn" aria-label="חזרה" onClick={() => back()}>
          <Icon name="back" />
        </button>
        <span className={`bar-ic s${index % 2}`}>
          <Icon name={index === 0 ? 'store' : 'drop'} size={22} />
        </span>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <h1 className="page-title">{src.name}</h1>
          <span className="sub" style={{ fontSize: 14 }}>הכנסה – מזומן ואשראי</span>
        </div>
      </header>

      <SellingDayBar date={date} onPick={pick} />

      {PARTS.map((part) => {
        const shown = methods.filter((m) => mainIds.has(m.id) || extra.has(incomeKey(sourceId, part, m.id)));
        return (
          <section key={part} className={`src-card s${index % 2}`} aria-label={part === 'night' ? names.night : names.day}>
            <div className="src-head">
              <span className="ic">
                <Icon name={part === 'night' ? 'moon' : 'sun'} size={26} />
              </span>
              <span className="ttl">
                <b>{part === 'night' ? names.night : names.day}</b>
                <small>{part === 'night' ? names.nightWhen : names.dayWhen}</small>
              </span>
              <span className="src-total">{shekelSmart(partTotal(part))}</span>
            </div>
            {shown.map((m) => {
              const k = incomeKey(sourceId, part, m.id);
              const t = methodTone(m.name);
              const bad = parsed.get(k) === null;
              return (
                <div key={k}>
                  <label className="src-row">
                    <span className="mi" style={{ background: t.bg, color: t.fg }}>
                      <Icon name={t.icon} />
                    </span>
                    <span className="nm">
                      {m.name}
                      {!m.active && <small className="muted-tag">מוסתר</small>}
                    </span>
                    <span className={`money-in big${bad ? ' bad' : ''}`}>
                      <input
                        inputMode="decimal"
                        enterKeyHint="next"
                        placeholder="0"
                        aria-label={`${m.name} – ${part === 'night' ? names.night : names.day}`}
                        aria-invalid={bad}
                        value={values[k] ?? ''}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => {
                          setValues((v) => ({ ...v, [k]: e.target.value }));
                          setDirty(true);
                        }}
                      />
                      <span>₪</span>
                    </span>
                  </label>
                  {bad && <div className="field-err">כותבים רק מספר, למשל 350 או 12.50</div>}
                </div>
              );
            })}
          </section>
        );
      })}

      <div className="sticky-save">
        {dirty && <div className="unsaved">יש שינויים שעוד לא נשמרו · נשמרים גם ביציאה</div>}
        <div className="save-sum">
          <span>
            סה״כ {src.name}
          </span>
          <b>{shekelSmart(total)}</b>
        </div>
        <button type="button" className="btn" onClick={save} disabled={saving}>
          {saving ? 'שומר…' : 'שמירה'}
        </button>
      </div>
    </>
  );
}
