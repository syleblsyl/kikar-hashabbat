/*
 * Agent invoices, monthly charges, balances and the invoice check – reading and writing the database.
 * The calculations themselves are in money.ts.
 */
import { dataVersion, query, run } from './sqlite';
import {
  balancesOf,
  buildLedger,
  isStock,
  buildMonths,
  checkOf,
  creditMonth,
  goodsMonth,
  invoiceHints,
  type AgentMonth,
  type CheckState,
  type Hint,
  type InvoiceRec,
  type LedgerEntry,
  type PaymentRec,
  type PriceChange,
  type StockEntry,
} from './money';
import { iso, today, monthOf, monthFirst, monthLast } from '../lib/dates';

export type { AgentMonth, CheckState, Hint, InvoiceRec, LedgerEntry, StockEntry } from './money';

/* ---------- loading ---------- */

type StockSql = {
  id: number;
  agent_id: number;
  delivery_date: string;
  received: number;
  credit: number;
  returns_done: number;
  returns_date: string | null;
  returnable_lines: number;
  manual_amount: number | null;
  lines: number;
  note: string | null;
};

const toStock = (r: StockSql): StockEntry => ({
  id: Number(r.id),
  agentId: Number(r.agent_id),
  date: r.delivery_date,
  received: Number(r.received),
  credit: Number(r.credit),
  returnsDone: !!Number(r.returns_done),
  returnsDate: r.returns_date,
  returnable: Number(r.returnable_lines) > 0,
  manual: r.manual_amount != null,
  lines: Number(r.lines),
  note: r.note,
});

export async function loadStock(agentId?: number): Promise<StockEntry[]> {
  const rows = await query<StockSql>(
    `SELECT id, agent_id, delivery_date, received, credit, returns_done, returns_date, returnable_lines, manual_amount, lines, note
       FROM delivery_totals ${agentId ? 'WHERE agent_id = ?' : ''} ORDER BY delivery_date, id`,
    agentId ? [agentId] : [],
  );
  return rows.map(toStock);
}

type InvoiceSql = { id: number; agent_id: number; month: string; date: string; amount: number; number: string | null; note: string | null };
const toInvoice = (r: InvoiceSql): InvoiceRec => ({
  id: Number(r.id),
  agentId: Number(r.agent_id),
  month: r.month,
  date: r.date,
  amount: Number(r.amount),
  number: r.number,
  note: r.note,
});

export async function loadInvoices(opts: { agentId?: number; month?: string } = {}): Promise<InvoiceRec[]> {
  const where: string[] = [];
  const vals: unknown[] = [];
  if (opts.agentId) {
    where.push('agent_id = ?');
    vals.push(opts.agentId);
  }
  if (opts.month) {
    where.push('month = ?');
    vals.push(opts.month);
  }
  const rows = await query<InvoiceSql>(
    `SELECT id, agent_id, month, date, amount, number, note FROM agent_invoices ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY date, id`,
    vals,
  );
  return rows.map(toInvoice);
}

export async function loadPayments(agentId?: number): Promise<PaymentRec[]> {
  const rows = await query<{ id: number; agent_id: number; date: string; amount: number; method: string | null; note: string | null }>(
    `SELECT id, agent_id, date, amount, method, note FROM agent_payments ${agentId ? 'WHERE agent_id = ?' : ''} ORDER BY date, id`,
    agentId ? [agentId] : [],
  );
  return rows.map((r) => ({ id: Number(r.id), agentId: Number(r.agent_id), date: r.date, amount: Number(r.amount), method: r.method, note: r.note }));
}

/** Every agent-month that has goods, credits or an invoice. (All agents: cached until the next write.) */
let cache: { version: number; months: Promise<AgentMonth[]> } | null = null;
export async function allMonths(agentId?: number): Promise<AgentMonth[]> {
  if (!agentId) {
    if (!cache || cache.version !== dataVersion()) {
      const version = dataVersion();
      const months = Promise.all([loadStock(), loadInvoices()]).then(([stock, invoices]) => buildMonths(stock, invoices));
      cache = { version, months };
      months.catch(() => {
        if (cache?.months === months) cache = null;
      });
    }
    return cache.months;
  }
  const [stock, invoices] = await Promise.all([loadStock(agentId), loadInvoices({ agentId })]);
  return buildMonths(stock, invoices);
}

/** Differences I marked as "checked – fine", by "agent|month". */
async function loadChecks(opts: { agentId?: number; month?: string } = {}): Promise<Map<string, number>> {
  const where: string[] = [];
  const vals: unknown[] = [];
  if (opts.agentId) {
    where.push('agent_id = ?');
    vals.push(opts.agentId);
  }
  if (opts.month) {
    where.push('month = ?');
    vals.push(opts.month);
  }
  const rows = await query<{ agent_id: number; month: string; diff: number }>(
    `SELECT agent_id, month, diff FROM invoice_checks ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
    vals,
  );
  return new Map(rows.map((r) => [`${r.agent_id}|${r.month}`, Number(r.diff)]));
}

/* ---------- balances ---------- */

/** What I owe each agent right now (negative = the agent owes me). */
export async function balances(): Promise<Map<number, number>> {
  const [months, pays] = await Promise.all([allMonths(), loadPayments()]);
  const b = balancesOf(months, pays);
  const agents = await query<{ id: number }>('SELECT id FROM agents');
  for (const a of agents) if (!b.has(Number(a.id))) b.set(Number(a.id), 0);
  return b;
}

export async function balanceOf(agentId: number): Promise<number> {
  const [months, pays] = await Promise.all([allMonths(agentId), loadPayments(agentId)]);
  return balancesOf(months, pays).get(agentId) ?? 0;
}

/* ---------- agent invoices ---------- */

export async function getAgentInvoice(id: number): Promise<InvoiceRec | null> {
  const rows = await query<InvoiceSql>('SELECT id, agent_id, month, date, amount, number, note FROM agent_invoices WHERE id = ?', [id]);
  return rows[0] ? toInvoice(rows[0]) : null;
}

export async function saveAgentInvoice(x: { id?: number; agentId: number; month: string; date: string; amount: number; number: string; note: string }): Promise<number> {
  const vals = [x.agentId, x.month, x.date, Math.round(x.amount * 100) / 100, x.number.trim() || null, x.note.trim() || null];
  if (x.id) {
    await run('UPDATE agent_invoices SET agent_id = ?, month = ?, date = ?, amount = ?, number = ?, note = ? WHERE id = ?', [...vals, x.id]);
    return x.id;
  }
  const res = await run('INSERT INTO agent_invoices (agent_id, month, date, amount, number, note) VALUES (?, ?, ?, ?, ?, ?)', vals);
  return res.lastId;
}

export async function deleteAgentInvoice(id: number) {
  await run('DELETE FROM agent_invoices WHERE id = ?', [id]);
}

/** An invoice already recorded for the same agent and month with the same number or about the same amount. */
export async function similarInvoice(agentId: number, month: string, amount: number, number: string, exceptId = 0): Promise<InvoiceRec | null> {
  const list = (await loadInvoices({ agentId, month })).filter((i) => i.id !== exceptId);
  const n = number.trim();
  return list.find((i) => (n && i.number?.trim() === n) || Math.abs(i.amount - amount) < 1) ?? null;
}

/** "I checked it, the invoice is right": the difference stops showing as a problem until it changes. */
export async function markChecked(agentId: number, month: string, diff: number) {
  await run(
    `INSERT INTO invoice_checks (agent_id, month, diff, checked_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(agent_id, month) DO UPDATE SET diff = excluded.diff, checked_at = excluded.checked_at`,
    [agentId, month, diff, iso(today())],
  );
}

export async function clearChecked(agentId: number, month: string) {
  await run('DELETE FROM invoice_checks WHERE agent_id = ? AND month = ?', [agentId, month]);
}

/* ---------- one month, all agents (invoices list, home) ---------- */

export type MonthAgentRow = {
  agentId: number;
  name: string;
  color: string | null;
  active: boolean;
  m: AgentMonth;
  state: CheckState;
  diff: number;
  invoices: InvoiceRec[];
};

const STATE_ORDER: Record<CheckState, number> = { mismatch: 0, waiting: 1, 'no-stock': 2, checked: 3, merged: 4, match: 5, empty: 6 };

export async function monthAgents(month: string): Promise<MonthAgentRow[]> {
  const [months, invoices, checks, agents] = await Promise.all([
    allMonths(),
    loadInvoices({ month }),
    loadChecks({ month }),
    query<{ id: number; name: string; color: string | null; active: number }>('SELECT id, name, color, active FROM agents'),
  ]);
  const byId = new Map(agents.map((a) => [Number(a.id), a]));
  const rows: MonthAgentRow[] = [];
  for (const m of months) {
    if (m.month !== month) continue;
    const a = byId.get(m.agentId);
    if (!a) continue;
    const { state, diff } = checkOf(m, checks.get(`${m.agentId}|${month}`));
    if (state === 'empty') continue;
    rows.push({ agentId: m.agentId, name: a.name, color: a.color, active: !!Number(a.active), m, state, diff, invoices: invoices.filter((i) => i.agentId === m.agentId) });
  }
  return rows.sort(
    (x, y) =>
      STATE_ORDER[x.state] - STATE_ORDER[y.state] ||
      (x.state === 'mismatch' ? Math.abs(y.diff) - Math.abs(x.diff) : x.state === 'waiting' ? y.m.expected - x.m.expected : 0) ||
      x.name.localeCompare(y.name, 'he'),
  );
}

/* ---------- one agent and month: the check screen ---------- */

export type Check = {
  agent: { id: number; name: string; color: string | null; phone: string | null };
  month: string;
  m: AgentMonth | null;
  state: CheckState;
  diff: number;
  invoices: InvoiceRec[];
  /** goods that arrived this month */
  goods: StockEntry[];
  /** returns recorded this month (also on goods from an earlier month) */
  credits: StockEntry[];
  hints: Hint[];
  ack: number | null;
};

async function priceChanges(agentId: number, month: string): Promise<PriceChange[]> {
  const rows = await query<{ product_id: number; name: string; unit_cost: number; qty: number; now: number }>(
    `SELECT l.product_id, p.name, l.unit_cost, (l.qty_received - l.qty_returned) AS qty, ap.cost_price AS now
       FROM delivery_lines l
       JOIN deliveries d ON d.id = l.delivery_id
       JOIN products p ON p.id = l.product_id
       JOIN agent_products ap ON ap.agent_id = d.agent_id AND ap.product_id = l.product_id
      WHERE d.agent_id = ? AND d.delivery_date BETWEEN ? AND ? AND abs(ap.cost_price - l.unit_cost) > 0.004`,
    [agentId, monthFirst(month), monthLast(month)],
  );
  const map = new Map<number, PriceChange>();
  for (const r of rows) {
    const p = map.get(Number(r.product_id)) ?? { productId: Number(r.product_id), name: r.name, recorded: Number(r.unit_cost), now: Number(r.now), qty: 0 };
    p.qty += Number(r.qty);
    map.set(p.productId, p);
  }
  return [...map.values()].filter((p) => p.qty > 0);
}

export async function checkFor(agentId: number, month: string): Promise<Check | null> {
  const [agentRow] = await query<{ id: number; name: string; color: string | null; phone: string | null }>('SELECT id, name, color, phone FROM agents WHERE id = ?', [agentId]);
  if (!agentRow) return null;
  const [stock, invoices, checks, prices] = await Promise.all([loadStock(agentId), loadInvoices({ agentId }), loadChecks({ agentId, month }), priceChanges(agentId, month)]);
  const months = buildMonths(stock, invoices);
  const m = months.find((x) => x.month === month) ?? null;
  const ack = checks.get(`${agentId}|${month}`) ?? null;
  const { state, diff } = checkOf(m ?? undefined, ack);
  const monthInvoices = invoices.filter((i) => i.month === month);
  return {
    agent: { id: Number(agentRow.id), name: agentRow.name, color: agentRow.color, phone: agentRow.phone },
    month,
    m,
    state,
    diff,
    invoices: monthInvoices,
    goods: stock.filter((e) => goodsMonth(e) === month),
    credits: stock.filter((e) => Math.abs(e.credit) > 0.004 && creditMonth(e) === month),
    hints: state === 'mismatch' || state === 'checked' ? invoiceHints({ agentId, month, diff, stock, months, invoices: monthInvoices, prices }) : [],
    ack,
  };
}

/** One agent's months, newest first (the stock tab of the agent card). */
export async function agentMonthsWithState(agentId: number): Promise<{ m: AgentMonth; state: CheckState; diff: number }[]> {
  const [months, checks] = await Promise.all([allMonths(agentId), loadChecks({ agentId })]);
  return months
    .map((m) => ({ m, ...checkOf(m, checks.get(`${agentId}|${m.month}`)) }))
    .filter((x) => x.state !== 'empty')
    .reverse();
}

/** The state of one agent's month (after saving stock or an invoice). */
export async function stateOf(agentId: number, month: string): Promise<{ m: AgentMonth | null; state: CheckState; diff: number }> {
  const [months, checks] = await Promise.all([allMonths(agentId), loadChecks({ agentId, month })]);
  const m = months.find((x) => x.month === month) ?? null;
  return { m, ...checkOf(m ?? undefined, checks.get(`${agentId}|${month}`)) };
}

/* ---------- ledger, statement, payment confirmation ---------- */

/** Money: invoices, the stock of months without an invoice yet, payments. Newest first. */
export async function agentLedger(agentId: number): Promise<LedgerEntry[]> {
  const [stock, invoices, pays] = await Promise.all([loadStock(agentId), loadInvoices({ agentId }), loadPayments(agentId)]);
  return buildLedger(buildMonths(stock, invoices), stock, invoices, pays).reverse();
}

export type DocLine = { name: string; qty: number; unit_cost: number };
export type StatementRange = 'since-payment' | 'month' | '3months' | 'all';
export type StatementRow = LedgerEntry & {
  /** invoices: my stock for that month, to compare */
  stock: { goods: number; credit: number; expected: number } | null;
  state?: CheckState;
  /** goods / returns recorded per product */
  lines: DocLine[];
};
export type Statement = {
  range: StatementRange;
  /** first day shown, null = from the beginning */
  from: string | null;
  opening: number;
  rows: StatementRow[];
  closing: number;
  invoiced: number;
  /** goods − returns shown that no invoice covers yet */
  estimated: number;
  paid: number;
  /** months in the closing balance still counted by stock (no invoice yet) */
  estimateMonths: string[];
  /** of the closing balance, what is still by stock */
  unbilled: number;
  /** some of that stock still waits for its returns */
  openReturns: boolean;
  lastPayment: { date: string; amount: number } | null;
};

async function linesOf(ids: number[]): Promise<Map<number, { name: string; qty_received: number; qty_returned: number; unit_cost: number }[]>> {
  const map = new Map<number, { name: string; qty_received: number; qty_returned: number; unit_cost: number }[]>();
  if (ids.length === 0) return map;
  const rows = await query<{ delivery_id: number; name: string; qty_received: number; qty_returned: number; unit_cost: number }>(
    `SELECT l.delivery_id, p.name, l.qty_received, l.qty_returned, l.unit_cost
       FROM delivery_lines l JOIN products p ON p.id = l.product_id
      WHERE l.delivery_id IN (${ids.map(() => '?').join(',')}) ORDER BY p.name`,
    ids,
  );
  for (const r of rows) {
    const list = map.get(Number(r.delivery_id)) ?? [];
    list.push({ name: r.name, qty_received: Number(r.qty_received), qty_returned: Number(r.qty_returned), unit_cost: Number(r.unit_cost) });
    map.set(Number(r.delivery_id), list);
  }
  return map;
}

/** Account statement for one agent, oldest first, from the chosen point until today. */
export async function agentStatement(agentId: number, range: StatementRange): Promise<Statement> {
  const [stock, invoices, pays, checks] = await Promise.all([loadStock(agentId), loadInvoices({ agentId }), loadPayments(agentId), loadChecks({ agentId })]);
  const months = buildMonths(stock, invoices);
  const all = buildLedger(months, stock, invoices, pays);
  const lastPayIdx = all.map((e) => e.kind).lastIndexOf('payment');
  const t = today();
  let start = 0;
  let from: string | null = null;
  if (range === 'since-payment' && lastPayIdx >= 0) {
    start = lastPayIdx + 1;
    from = all[lastPayIdx].date;
  } else if (range === 'month' || range === '3months') {
    from = iso(new Date(t.getFullYear(), t.getMonth() - (range === 'month' ? 0 : 2), 1));
    start = all.findIndex((e) => e.date >= from!);
    if (start < 0) start = all.length;
  }
  const shown = all.slice(start);
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const lines = await linesOf([...new Set(shown.filter(isStock).map((e) => e.id))]);
  const rows: StatementRow[] = shown.map((e) => {
    const m = e.kind === 'invoice' && e.month ? byMonth.get(e.month) : undefined;
    const ls = isStock(e) ? lines.get(e.id) ?? [] : [];
    return {
      ...e,
      stock: m && (m.stockCount > 0 || m.creditCount > 0) ? { goods: m.goods, credit: m.credit, expected: m.expected } : null,
      state: m ? checkOf(m, checks.get(`${agentId}|${m.month}`)).state : undefined,
      lines:
        e.kind === 'goods'
          ? ls.filter((l) => l.qty_received > 0).map((l) => ({ name: l.name, qty: l.qty_received, unit_cost: l.unit_cost }))
          : e.kind === 'returns'
            ? ls.filter((l) => l.qty_returned > 0).map((l) => ({ name: l.name, qty: l.qty_returned, unit_cost: l.unit_cost }))
            : [],
    };
  });
  const last = lastPayIdx >= 0 ? all[lastPayIdx] : null;
  const end = all.length ? all[all.length - 1] : null;
  const unbilledEntries = all.filter(isStock);
  return {
    range,
    from,
    opening: start > 0 ? all[start - 1].balance : 0,
    rows,
    closing: end?.balance ?? 0,
    invoiced: shown.filter((e) => e.kind === 'invoice').reduce((s, e) => s + e.amount, 0),
    estimated: Math.round(shown.filter(isStock).reduce((s, e) => s + e.amount, 0) * 100) / 100,
    paid: shown.filter((e) => e.kind === 'payment').reduce((s, e) => s - e.amount, 0),
    estimateMonths: [...new Set(unbilledEntries.map((e) => e.month!))].sort(),
    unbilled: Math.round(((end?.balance ?? 0) - (end?.billed ?? 0)) * 100) / 100,
    openReturns: unbilledEntries.some((e) => e.pendingReturns),
    lastPayment: last ? { date: last.date, amount: -last.amount } : null,
  };
}

export type PaymentConfirmation = {
  id: number;
  agentId: number;
  date: string;
  amount: number;
  method: string | null;
  note: string | null;
  /** what I owed the agent just before / just after this payment, stock of un-invoiced months included */
  before: number;
  after: number;
  /** of `after`, what is still by stock (no invoice yet) */
  unbilledAfter: number;
  /** what I owe the agent today, after everything recorded since */
  now: number;
};

export async function paymentConfirmation(paymentId: number): Promise<PaymentConfirmation | null> {
  const [p] = await query<{ agent_id: number }>('SELECT agent_id FROM agent_payments WHERE id = ?', [paymentId]);
  if (!p) return null;
  const ledger = await agentLedger(Number(p.agent_id));
  const e = ledger.find((x) => x.kind === 'payment' && x.id === paymentId);
  if (!e) return null;
  return {
    id: paymentId,
    agentId: Number(p.agent_id),
    date: e.date,
    amount: -e.amount,
    method: e.method ?? null,
    note: e.note ?? null,
    before: Math.round((e.balance - e.amount) * 100) / 100,
    after: e.balance,
    unbilledAfter: Math.round((e.balance - e.billed) * 100) / 100,
    now: ledger[0]?.balance ?? 0,
  };
}

/** The month a stock entry's goods count in, and the month its returns count in – for messages after saving. */
export const monthsOfEntry = (date: string, returnsDate: string | null) => ({ goods: monthOf(date), credit: monthOf(returnsDate ?? date) });
