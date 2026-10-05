import type { Agent } from '../db/catalog';
import type { PaymentConfirmation, Statement, StatementRow } from '../db/billing';
import { fromIso, monthName, today } from '../lib/dates';
import { hebDate } from '../lib/hebrew';
import { products, qty, shekelCents, shekelSmart } from '../lib/money';

/* Documents that are sent to the agent (picture / PDF), written from the store's side. */

const STORE = 'כיכר השבת';

export const fullDate = (s: string) => {
  const d = fromIso(s);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
};
const shortD = (s: string) => {
  const d = fromIso(s);
  return `${d.getDate()}.${d.getMonth() + 1}.${String(d.getFullYear()).slice(2)}`;
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
  if (st.range === 'since-payment' && st.lastPayment) return `מאז התשלום האחרון (${fullDate(st.lastPayment.date)})`;
  if (st.from) return `מ-${fullDate(st.from)} עד היום`;
  return 'כל התקופה';
}

/** Under an invoice: what our own stock says for that month. */
function StockLine({ r }: { r: StatementRow }) {
  if (!r.stock) return null;
  return (
    <small className="st-stock">
      לפי הרישום שלנו: סחורה {shekelSmart(r.stock.goods)} · החזרות {shekelSmart(r.stock.credit)} · {shekelSmart(r.stock.expected)}
    </small>
  );
}

function RowLines({ r }: { r: StatementRow }) {
  if (r.lines.length === 0) return null;
  return (
    <div className="st-lines">
      {r.lines.map((l, i) => (
        <div key={i}>
          <span className="n">{l.name}</span>
          <span className="q">
            {qty(l.qty)} × {shekelCents(l.unit_cost)}
          </span>
          <span className="t">{shekelSmart(l.qty * l.unit_cost)}</span>
        </div>
      ))}
    </div>
  );
}

function rowTitle(r: StatementRow) {
  if (r.kind === 'invoice') return `חשבונית על ${monthName(r.month!, true)}${r.number ? ` · מס׳ ${r.number}` : ''}`;
  if (r.kind === 'goods') return 'סחורה';
  if (r.kind === 'returns') return 'החזרות';
  return `תשלום${r.method ? ` · ${r.method}` : ''}`;
}

function rowSub(r: StatementRow) {
  if (r.kind === 'goods') return `${r.manual ? 'סכום בלי פירוט' : products(r.productCount ?? 0)} · עוד לא בחשבונית`;
  if (r.kind === 'returns') return `על סחורה מ-${shortD(r.goodsDate ?? r.date)}`;
  return r.note ?? '';
}

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
            <b>{shekelSmart(st.opening)}</b>
          </div>
        )}
        <div>
          <span>חשבוניות</span>
          <b>{shekelSmart(st.invoiced, { signed: true })}</b>
        </div>
        {Math.abs(st.estimated) > 0.004 && (
          <div>
            <span>סחורה שעוד לא בחשבונית (פחות החזרות)</span>
            <b>{shekelSmart(st.estimated, { signed: true }).replace('-', '−')}</b>
          </div>
        )}
        <div>
          <span>תשלומים</span>
          <b className="minus">{shekelSmart(-st.paid).replace('-', '−')}</b>
        </div>
        <div className={`total ${end.tone}`}>
          <span>{end.label}</span>
          <b>{shekelSmart(Math.abs(st.closing))}</b>
        </div>
      </div>

      <div className="st-table">
        <div className="st-row th">
          <span>תאריך</span>
          <span>פירוט</span>
          <span>סכום</span>
          <span>יתרה</span>
        </div>
        {st.from !== null && (
          <div className="st-row opening">
            <span>{st.from ? shortD(st.from) : ''}</span>
            <span>יתרה קודמת</span>
            <span />
            <span>{shekelSmart(st.opening)}</span>
          </div>
        )}
        {st.rows.length === 0 && <div className="st-empty">אין תנועות בתקופה הזו.</div>}
        {st.rows.map((r) => (
          <div key={r.key} className={`st-row ${r.kind}`}>
            <span>{shortD(r.date)}</span>
            <span className="what">
              <b>{rowTitle(r)}</b>
              {rowSub(r) && <small>{rowSub(r)}</small>}
              {r.pendingReturns && <small className="warn">החזרות עוד לא נרשמו</small>}
              {details && <StockLine r={r} />}
              {details && <RowLines r={r} />}
            </span>
            <span className={r.amount < 0 ? 'minus' : ''}>{shekelSmart(r.amount, { signed: true }).replace('-', '−')}</span>
            <span>{shekelSmart(r.balance).replace('-', '−')}</span>
          </div>
        ))}
      </div>

      {st.unbilled > 0.004 && st.closing > 0.004 && (
        <p className="doc-note">
          {st.unbilled < st.closing - 0.004 ? `מתוך היתרה, ${shekelSmart(st.unbilled)}` : 'כל היתרה'} לפי הרישום שלנו של סחורה שעוד לא הגיעה עליה חשבונית ({st.estimateMonths.slice(-3).map((m) => monthName(m)).join(', ')}). כשתגיע החשבונית, הסכום שלה יבוא במקום.
          {st.openReturns ? ' בחלק מהסחורה הזו ההחזרות עוד לא נרשמו.' : ''}
        </p>
      )}
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
          ביום {fullDate(c.date)} · {hebDate(fromIso(c.date))}
        </small>
      </div>
      <div className="doc-kv">
        <div>
          <span>לכבוד</span>
          <b>{agent.name}</b>
        </div>
        <div>
          <span>תאריך התשלום</span>
          <b>{fullDate(c.date)}</b>
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
      {c.unbilledAfter > 0.004 && c.after > 0.004 && (
        <p className="doc-note">
          {c.unbilledAfter < c.after - 0.004 ? `מתוך היתרה, ${shekelSmart(c.unbilledAfter)}` : 'כל היתרה'} סחורה שעוד לא הגיעה עליה חשבונית (לפי הרישום שלנו).
        </p>
      )}
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
    `חשבוניות: ${plain(shekelSmart(st.invoiced))}`,
    ...(Math.abs(st.estimated) > 0.004 ? [`סחורה שעוד לא בחשבונית (לפי הרישום שלנו): ${plain(shekelSmart(st.estimated))}`] : []),
    `תשלומים: ${plain(shekelSmart(st.paid))}`,
    `*${end.label}: ${plain(shekelSmart(Math.abs(st.closing)))}*`,
  ];
  if (st.unbilled > 0.004 && st.closing > 0.004) lines.push('', `${st.unbilled < st.closing - 0.004 ? `מתוך זה ${plain(shekelSmart(st.unbilled))}` : 'כל היתרה'} סחורה שעוד לא הגיעה עליה חשבונית.`);
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
    `תאריך: ${fullDate(c.date)}`,
    ...(c.method ? [`אמצעי תשלום: ${c.method}`] : []),
    ...(c.note ? [`הערה: ${c.note}`] : []),
    '',
    `*אחרי התשלום – ${after.label}${after.tone === 'zero' ? '' : `: ${plain(shekelSmart(Math.abs(c.after)))}`}*`,
    ...(c.unbilledAfter > 0.004 && c.after > 0.004
      ? [`(${c.unbilledAfter < c.after - 0.004 ? `מתוך זה ${plain(shekelSmart(c.unbilledAfter))}` : 'כל היתרה'} סחורה שעוד לא הגיעה עליה חשבונית)`]
      : []),
    '',
    'תודה!',
  ].join('\n');
}
