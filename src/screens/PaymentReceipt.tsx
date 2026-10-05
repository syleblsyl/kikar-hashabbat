import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ReceiptDoc, receiptText } from '../components/AgentDocs';
import { DocShare } from '../components/DocShare';
import { Icon } from '../components/Icon';
import { SubBar } from '../components/SubBar';
import { getAgent, type Agent } from '../db/catalog';
import { paymentConfirmation, type PaymentConfirmation } from '../db/billing';
import { shekelSmart } from '../lib/money';
import { myBalanceWords } from '../components/AgentDocs';

/** Payment confirmation to send the agent: how much, when, and what is left after it. */
export function PaymentReceipt() {
  const { id, pid } = useParams();
  const [params] = useSearchParams();
  const fresh = params.get('new') === '1';
  const [agent, setAgent] = useState<Agent | null>(null);
  const [c, setC] = useState<PaymentConfirmation | null | undefined>(undefined);

  useEffect(() => {
    (async () => {
      const conf = Number.isFinite(Number(pid)) ? await paymentConfirmation(Number(pid)) : null;
      if (!conf || conf.agentId !== Number(id)) return setC(null);
      setAgent(await getAgent(conf.agentId));
      setC(conf);
    })();
  }, [id, pid]);

  if (c === undefined) return <SubBar title="אישור תשלום" />;
  if (c === null || !agent) {
    return (
      <>
        <SubBar title="אישור תשלום" />
        <div className="card empty-card">
          <p>התשלום הזה לא נמצא (אולי נמחק).</p>
        </div>
      </>
    );
  }

  const mine = myBalanceWords(c.after, agent.name);
  return (
    <>
      <SubBar title="אישור תשלום" sub={agent.name} />
      {fresh && (
        <div className={`banner ${mine.tone === 'owe' ? 'gold' : 'green'}`} style={{ margin: '0 16px 12px' }}>
          <span className="ic"><Icon name="check" /></span>
          <span className="txt">
            <b>התשלום נשמר · {shekelSmart(c.amount)}</b>
            <span>
              אחרי התשלום: {mine.label}
              {mine.tone === 'zero' ? '' : ` ${shekelSmart(Math.abs(c.after))}`}
            </span>
          </span>
        </div>
      )}
      <DocShare
        doc={<ReceiptDoc agent={agent} c={c} />}
        fileBase={`אישור-תשלום-${agent.name}-${c.date}`}
        title={`אישור תשלום – ${agent.name}`}
        text={receiptText(agent, c)}
        phone={agent.phone}
      />
    </>
  );
}
