import type { Agent } from '../db/catalog';
import type { PaymentConfirmation, Statement, StatementRow } from '../db/billing';
import { fromIso, monthName, today } from '../lib/dates';
import { hebDate } from '../lib/hebrew';
import { shekelSmart } from '../lib/money';

/* Documents that are sent to the agent (picture / PDF), written from the store's side. */

const STORE = 'כיכר השבת';

export const fullDate = (s: string) => {
  const d = fromIso(s);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
};
const todayText = () => {
  const t = today();
  return `${t.getDate()}.${t.getMonth() + 1}.${t.getFullYear()}`;
};

/** How a balance reads in a document for the agent. */
export function balanceWords(bal: number, agentName: string) {
  if (bal > 0.004) return { label: 'יתרה לתשלום לסוכן', who: `${STORE} חייבת ל${agentName}`, tone: 'owe' as const };
  if (bal < -0.004) return { label: `יתרת זכות ל${STORE}`, who: `${agentName} חייב ל${STORE}`, tone: 'credit' as const };
  return { label: 'החשבון מאוזן', who: 'אין חוב לאף צד', tone: 'zero' as const };
}

/** How a balance reads inside the app (the owner's point of view). */
export function myBalanceWords(bal: number, agentName: string) {
  if (bal > 0.004) return { label: `אני חייב ל${agentName}`, tone: 'owe' as const };
  if (bal < -0.004) return { label: `${agentName} חייב לי`, tone: 'credit' as const };
  return { label: 'אין חוב · החשבון מאוזן', tone: 'zero' as const };
}

function DocHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="doc-head">
      <img src="/logo.webp" alt="" />
      <div>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
    </div>
  );
}

export function rangeText(st: Statement) {
  if (st.range === 'since-payment' && st.lastPayment) return `מאז התשלום האחרון (${monthName(st.lastPayment.month, true)})`;
  if (st.from) return `מ${monthName(st.from, true)} עד היום`;
  return 'כל התקופה';
}

/** Under a חובה row: what our own stock says for that month. */
function StockLine({ r }: { r: StatementRow }) {
  if (!r.stock) return null;
  return (
    <small className="st-stock">
      לפי הרישום שלנו: סחורה {shekelSmart(r.stock.goods)} · החזרות {shekelSmart(r.stock.credit)} · {shekelSmart(r.stock.expected)}
    </small>
  );
}

const rowTitle = (r: StatementRow) =>
  r.kind === 'invoice' ? `חשבונית${r.number ? ` מס׳ ${r.number}` : ''}` : r.kind === 'credit' ? `זיכוי${r.number ? ` מס׳ ${r.number}` : ''}` : `תשלום${r.method ? ` · ${r.method}` : ''}`;

export function StatementDoc({ agent, st, details }: { agent: Agent; st: Statement; details: boolean }) {
  const end = balanceWords(st.closing, agent.name);
  return (
    <>
      <DocHead title="דוח חשבון" sub={`${STORE} · ${agent.name}`} />
      <div className="doc-meta">
        <span>תקופה: {rangeText(st)}</span>
        <span>הופק {todayText()}</span>
      </div>

      <div className="doc-sum">
        {st.from !== null && (
          <div>
            <span>יתרה קודמת</span>
            <b>{shekelSmart(st.opening).replace('-', '−')}</b>
          </div>
        )}
        <div>
          <span>חובה (חשבוניות)</span>
          <b>{shekelSmart(st.invoiced, { signed: true })}</b>
        </div>
        {st.credits > 0.004 && (
          <div>
            <span>זכות – זיכויים</span>
            <b className="minus">{shekelSmart(-st.credits).replace('-', '−')}</b>
          </div>
        )}
        <div>
          <span>זכות – תשלומים</span>
          <b className="minus">{shekelSmart(-st.paid).replace('-', '−')}</b>
        </div>
        <div className={`total ${end.tone}`}>
          <span>{end.label}</span>
          <b>{shekelSmart(Math.abs(st.closing))}</b>
        </div>
      </div>

      <div className="st-table">
        <div className="st-row th">
          <span>חודש</span>
          <span>פירוט</span>
          <span>סכום</span>
          <span>יתרה</span>
        </div>
        {st.from !== null && (
          <div className="st-row opening">
            <span />
            <span>יתרה קודמת</span>
            <span />
            <span>{shekelSmart(st.opening).replace('-', '−')}</span>
          </div>
        )}
        {st.rows.length === 0 && <div className="st-empty">אין שורות בתקופה הזו.</div>}
        {st.rows.map((r) => (
          <div key={r.key} className={`st-row ${r.kind}`}>
            <span>{monthName(r.month)}</span>
            <span className="what">
              <b>{rowTitle(r)}</b>
              {r.note && <small>{r.note}</small>}
              {details && <StockLine r={r} />}
            </span>
            <span className={r.amount < 0 ? 'minus' : ''}>{shekelSmart(r.amount, { signed: true }).replace('-', '−')}</span>
            <span>{shekelSmart(r.balance).replace('-', '−')}</span>
          </div>
        ))}
      </div>

      <p className="doc-note">
        {end.who}. אם משהו בדוח לא מסתדר לך – נשמח לבדוק יחד לפני התשלום.
      </p>
      <p className="doc-foot">{STORE} – יריד מעדני השבת</p>
    </>
  );
}

export function ReceiptDoc({ agent, c }: { agent: Agent; c: PaymentConfirmation }) {
  const after = balanceWords(c.after, agent.name);
  const before = balanceWords(c.before, agent.name);
  return (
    <>
      <DocHead title="אישור תשלום" sub={`${STORE} · מס׳ ${c.id}`} />
      <div className="doc-pay">
        <span>שולם ל{agent.name}</span>
        <b>{shekelSmart(c.amount)}</b>
        <small>
          על חשבון {monthName(c.month, true)} · נרשם ב-{fullDate(c.date)} · {hebDate(fromIso(c.date))}
        </small>
      </div>
      <div className="doc-kv">
        <div>
          <span>לכבוד</span>
          <b>{agent.name}</b>
        </div>
        <div>
          <span>חודש</span>
          <b>{monthName(c.month, true)}</b>
        </div>
        <div>
          <span>אמצעי תשלום</span>
          <b>{c.method || '—'}</b>
        </div>
        {c.note && (
          <div>
            <span>הערה</span>
            <b>{c.note}</b>
          </div>
        )}
      </div>
      <div className="doc-sum">
        <div>
          <span>לפני התשלום · {before.label}</span>
          <b>{shekelSmart(Math.abs(c.before))}</b>
        </div>
        <div>
          <span>התשלום</span>
          <b className="minus">{shekelSmart(-c.amount).replace('-', '−')}</b>
        </div>
        <div className={`total ${after.tone}`}>
          <span>אחרי התשלום · {after.label}</span>
          <b>{shekelSmart(Math.abs(c.after))}</b>
        </div>
      </div>
      <p className="doc-note">{after.tone === 'zero' ? 'החשבון סגור – אין חוב לאף צד.' : `${after.who}: ${shekelSmart(Math.abs(c.after))}.`}</p>
      <p className="doc-foot">
        {STORE} – יריד מעדני השבת · הופק {todayText()}
      </p>
    </>
  );
}

/* ---------- the same, as a short WhatsApp message ---------- */

const plain = (s: string) => s.replace(/[⁦-⁩]/g, '');

export function statementText(agent: Agent, st: Statement) {
  const end = balanceWords(st.closing, agent.name);
  const lines = [
    `שלום ${agent.name},`,
    `דוח חשבון מ${STORE}`,
    `תקופה: ${rangeText(st)}`,
    '',
    ...(st.from !== null ? [`יתרה קודמת: ${plain(shekelSmart(st.opening))}`] : []),
    `חובה (חשבוניות): ${plain(shekelSmart(st.invoiced))}`,
    ...(st.credits > 0.004 ? [`זכות – זיכויים: ${plain(shekelSmart(st.credits))}`] : []),
    `זכות – תשלומים: ${plain(shekelSmart(st.paid))}`,
    `*${end.label}: ${plain(shekelSmart(Math.abs(st.closing)))}*`,
  ];
  lines.push('', 'אם משהו לא מסתדר – נבדוק יחד לפני התשלום. תודה!');
  return lines.join('\n');
}

export function receiptText(agent: Agent, c: PaymentConfirmation) {
  const after = balanceWords(c.after, agent.name);
  return [
    `שלום ${agent.name},`,
    `אישור תשלום מ${STORE} (מס׳ ${c.id})`,
    '',
    `שולם: *${plain(shekelSmart(c.amount))}*`,
    `על חשבון: ${monthName(c.month, true)}`,
    ...(c.method ? [`אמצעי תשלום: ${c.method}`] : []),
    ...(c.note ? [`הערה: ${c.note}`] : []),
    '',
    `*אחרי התשלום – ${after.label}${after.tone === 'zero' ? '' : `: ${plain(shekelSmart(Math.abs(c.after)))}`}*`,
    '',
    'תודה!',
  ].join('\n');
}
