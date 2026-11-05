import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MonthBar, parseYM, thisMonth, ymKey, type YM } from '../components/MonthBar';
import { matches, SearchBox } from '../components/SearchBox';
import { SubBar } from '../components/SubBar';
import { listAgents, type Agent } from '../db/catalog';
import { agentTotalsForMonth, type AgentMonthTotals } from '../db/repo';
import { monthName } from '../lib/dates';
import { shekel } from '../lib/money';

const fmt = (n: number) => (Math.abs(n) < 0.005 ? '—' : Math.round(n).toLocaleString('en-US'));

/** One month, all agents: the invoices for the month (חובה) and what I paid. */
export function AgentsMonth() {
  const [params, setParams] = useSearchParams();
  const ym: YM = parseYM(params.get('month')) ?? thisMonth();
  const mk = ymKey(ym);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [totals, setTotals] = useState<Map<number, AgentMonthTotals>>(new Map());
  const [q, setQ] = useState('');

  useEffect(() => {
    Promise.all([listAgents(), listAgents(true)]).then(([a, hidden]) => setAgents([...a, ...hidden]));
  }, []);
  useEffect(() => {
    agentTotalsForMonth(mk).then(setTotals);
  }, [mk]);

  const t = (id: number) => totals.get(id) ?? { paid: 0, debit: 0, credits: 0 };
  const has = (a: Agent) => t(a.id).paid !== 0 || t(a.id).debit !== 0 || t(a.id).credits !== 0;
  const list = (agents ?? [])
    .filter((a) => a.active || has(a))
    .filter((a) => matches(a.name, q))
    .sort((a, b) => t(b.id).paid - t(a.id).paid || t(b.id).debit - t(a.id).debit || a.name.localeCompare(b.name, 'he'));
  const active = list.filter(has);
  const quiet = list.filter((a) => !has(a));
  const sum = (k: keyof AgentMonthTotals) => [...totals.values()].reduce((s, x) => s + x[k], 0);
  const paid = sum('paid');
  const debit = sum('debit');
  const credits = sum('credits');

  const row = (a: Agent) => (
    <Link key={a.id} to={`/agent/${a.id}?month=${mk}`} className={`tr${has(a) ? '' : ' dim'}`}>
      <span className="nm">
        <i style={{ background: a.color ?? 'var(--primary)' }} />
        {a.name}
      </span>
      <span>{fmt(t(a.id).debit - t(a.id).credits)}</span>
      <span>
        <b>{fmt(t(a.id).paid)}</b>
      </span>
    </Link>
  );

  return (
    <>
      <SubBar title="סוכנים לפי חודש" sub="כמה שילמתי לכל סוכן, וכמה החשבוניות" />
      <div className="pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <MonthBar ym={ym} onChange={(next) => setParams({ month: ymKey(next) }, { replace: true })} />
        <section className="card am-sum">
          <div className="am-big">
            <span>שולם לסוכנים ב{monthName(mk)}</span>
            <b>{shekel(paid)}</b>
          </div>
          <div className="am-line">
            <span>חובה – חשבוניות על {monthName(mk)}</span>
            <b>{shekel(debit - credits)}</b>
          </div>
          {credits > 0.004 && (
            <div className="am-line sub">
              <span>מתוך זה זיכויים מהסוכנים</span>
              <b>{shekel(credits)}</b>
            </div>
          )}
        </section>
      </div>

      <section className="card rsec am-list">
        {(agents?.length ?? 0) > 6 && <SearchBox value={q} onChange={setQ} placeholder="חיפוש סוכן" />}
        <div className="tbl am">
          <div className="tr th">
            <span>סוכן</span>
            <span>חובה</span>
            <span>שולם</span>
          </div>
          {agents && list.length === 0 && <p className="hint" style={{ padding: '10px 0' }}>{q ? `אין סוכן בשם "${q.trim()}".` : 'עוד אין סוכנים.'}</p>}
          {active.map(row)}
          {active.length > 0 && (
            <div className="tr tt">
              <span>סה״כ</span>
              <span>{fmt(debit - credits)}</span>
              <span>{fmt(paid)}</span>
            </div>
          )}
          {active.length === 0 && agents && list.length > 0 && <p className="hint" style={{ padding: '8px 0' }}>ב{monthName(mk)} עוד לא נרשם כלום לסוכנים.</p>}
          {quiet.length > 0 && active.length > 0 && <div className="am-quiet">בלי תשלום ובלי חשבונית ב{monthName(mk)}</div>}
          {quiet.map(row)}
        </div>
        <p className="hint" style={{ margin: '6px 0 0' }}>חובה = החשבוניות על החודש (פחות זיכויים) · שולם = התשלומים שנרשמו על החודש · לחיצה על סוכן פותחת את הכרטיס שלו על החודש הזה</p>
      </section>
      <div style={{ height: 24 }} />
    </>
  );
}
