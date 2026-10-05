import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { StatementDoc, statementText } from '../components/AgentDocs';
import { DocShare } from '../components/DocShare';
import { Icon } from '../components/Icon';
import { SubBar } from '../components/SubBar';
import { getAgent, type Agent } from '../db/catalog';
import { agentStatement, type Statement, type StatementRange } from '../db/billing';
import { iso, today } from '../lib/dates';

const RANGES: { k: StatementRange; label: string }[] = [
  { k: 'since-payment', label: 'מאז התשלום האחרון' },
  { k: 'month', label: 'החודש' },
  { k: '3months', label: '3 חודשים' },
  { k: 'all', label: 'הכול' },
];

/** Account statement to send the agent before paying him. */
export function AgentStatement() {
  const { id } = useParams();
  const agentId = Number(id);
  const [agent, setAgent] = useState<Agent | null | undefined>(undefined);
  const [range, setRange] = useState<StatementRange | null>(null);
  const [st, setSt] = useState<Statement | null>(null);
  const [details, setDetails] = useState(false);

  useEffect(() => {
    (async () => {
      const a = Number.isFinite(agentId) ? await getAgent(agentId) : null;
      setAgent(a);
      if (!a) return;
      // first time: since the last payment if there is one, otherwise everything
      const s = await agentStatement(agentId, 'since-payment');
      setRange(s.lastPayment ? 'since-payment' : 'all');
    })();
  }, [agentId]);

  useEffect(() => {
    if (!range) return;
    agentStatement(agentId, range).then(setSt);
  }, [agentId, range]);

  if (agent === undefined) return <SubBar title="דוח חשבון" />;
  if (agent === null) {
    return (
      <>
        <SubBar title="דוח חשבון" />
        <div className="card empty-card">
          <p>הסוכן הזה לא נמצא.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <SubBar title="דוח חשבון לסוכן" sub={agent.name} />
      <div className="pad doc-tools">
        <div className="chips scroll" role="radiogroup" aria-label="תקופה">
          {RANGES.filter((r) => r.k !== 'since-payment' || st?.lastPayment || range === 'since-payment').map((r) => (
            <button key={r.k} type="button" role="radio" aria-checked={range === r.k} className={`chip${range === r.k ? ' on' : ''}`} onClick={() => setRange(r.k)}>
              {r.label}
            </button>
          ))}
        </div>
        <button type="button" className={`chip${details ? ' on' : ''}`} aria-pressed={details} onClick={() => setDetails((d) => !d)}>
          פירוט
        </button>
      </div>

      {!st ? (
        <p className="hint" style={{ textAlign: 'center' }}>מכין…</p>
      ) : (
        <DocShare
          doc={<StatementDoc agent={agent} st={st} details={details} />}
          fileBase={`דוח-חשבון-${agent.name}-${iso(today())}`}
          title={`דוח חשבון – ${agent.name}`}
          text={statementText(agent, st)}
          phone={agent.phone}
        >
          <Link to={`/agent/${agentId}?pay=1`} className="btn" style={{ marginTop: 8 }}>
            <Icon name="wallet" size={20} /> לרישום תשלום
          </Link>
        </DocShare>
      )}
    </>
  );
}
