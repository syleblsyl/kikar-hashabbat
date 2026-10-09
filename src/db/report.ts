import { type NetMode } from './repo';
import { monthAgents, loadInvoices, type CheckState } from './billing';
import { query } from './sqlite';
import { incomeBySource, type SourceTotal } from './ops';
import { addDays, fromIso, iso, monthKey, startOfWeek } from '../lib/dates';
import { hebMonthsOf, weekInfo } from '../lib/hebrew';

export type ReportAgent = {
  id: number;
  name: string;
  color: string | null;
  /** stock of the month */
  received: number;
  returned: number;
  expected: number;
  /** the agent's invoices for the month (0 when none yet) */
  invoiced: number;
  invoiceCount: number;
  /** what the month costs: the invoice, or the stock while there is none */
  charge: number;
  source: 'invoice' | 'stock';
  state: CheckState;
  diff: number;
  paid: number;
};

export type MonthReport = {
  year: number;
  month: number;
  from: string;
  to: string;
  hebMonths: string;
  income: number;
  /** per income column (method, or source – method) */
  byMethod: { name: string; total: number }[];
  /** per source (store / mikveh), with its methods */
  bySource: SourceTotal[];
  /** stock: goods that arrived this month, and return credits dated this month */
  received: number;
  credit: number;
  expected: number;
  /** agents' invoices for this month */
  invoiced: number;
  /** what agents cost this month (invoices, or stock where there is no invoice yet) */
  charges: number;
  /** of charges: still by stock */
  byStock: number;
  waiting: number;
  mismatches: number;
  expenses: number;
  byType: { name: string; total: number }[];
  net: number;
  paid: number;
  /** weeks by stock; `correction` brings the weeks to the month's total when invoices differ from stock */
  weeks: { weekStart: string; title: string; from: string; to: string; income: number; goods: number; paid: number; expenses: number; net: number }[];
  correction: number;
  agents: ReportAgent[];
  products: { id: number; name: string; received: number; returned: number; sold: number; cost: number }[];
  daily: { date: string; amounts: Record<string, number>; total: number }[];
  methods: string[];
  /** stock lines, plus one row for every delivery recorded as a sum (no products) */
  deliveryRows: { date: string; weekStart: string; agent: string; product: string; received: number; returned: number; unitCost: number; returnable: number; returnsDone: number; net: number; sum: boolean }[];
  /** returns recorded this month (also on goods from an earlier month) */
  creditRows: { date: string; agent: string; goodsDate: string; credit: number; sum: boolean }[];
  invoiceRows: { date: string; agent: string; amount: number; number: string; note: string; state: CheckState; diff: number }[];
  expenseRows: { date: string; type: string; amount: number; note: string }[];
  paymentRows: { date: string; agent: string; amount: number; method: string; note: string }[];
  /** goods of the month still waiting for returns (in months still counted by stock) */
  openReturns: number;
  mode: NetMode;
};

const num = (v: unknown) => Number(v ?? 0);
const cents = (n: number) => Math.round(n * 100);

export async function monthReport(year: number, month: number): Promise<MonthReport> {
  const from = iso(new Date(year, month, 1));
  const to = iso(new Date(year, month + 1, 0));
  const mk = monthKey(new Date(year, month, 1));

  // income: one column per source and method ("מקווה ויזניץ – מזומן"); just the method while only one source is used
  const incomeRows = await query<{ date: string; source: string; ssort: number; sid: number; method: string; msort: number; mid: number; amount: number }>(
    `SELECT i.date, s.name AS source, s.sort AS ssort, s.id AS sid, m.name AS method, m.sort AS msort, m.id AS mid, i.amount
       FROM daily_income i JOIN payment_methods m ON m.id = i.method_id JOIN income_sources s ON s.id = i.source_id
      WHERE i.date BETWEEN ? AND ? ORDER BY i.date, s.sort, s.id, m.sort, m.id`,
    [from, to],
  );
  const manySources = new Set(incomeRows.map((r) => r.sid)).size > 1;
  const colOf = (r: (typeof incomeRows)[number]) => (manySources ? `${r.source} – ${r.method}` : r.method);
  const columns = [...new Map(
    [...incomeRows]
      .sort((a, b) => a.ssort - b.ssort || a.sid - b.sid || a.msort - b.msort || a.mid - b.mid)
      .map((r) => [colOf(r), true] as const),
  ).keys()];
  const methods = columns;

  const byMethodMap = new Map<string, number>();
  const dailyMap = new Map<string, Record<string, number>>();
  for (const r of incomeRows) {
    const col = colOf(r);
    byMethodMap.set(col, (byMethodMap.get(col) ?? 0) + num(r.amount));
    const d = dailyMap.get(r.date) ?? {};
    d[col] = (d[col] ?? 0) + num(r.amount);
    dailyMap.set(r.date, d);
  }
  const income = [...byMethodMap.values()].reduce((a, b) => a + b, 0);
  const daily = [...dailyMap.entries()].map(([date, amounts]) => ({ date, amounts, total: Object.values(amounts).reduce((a, b) => a + b, 0) }));
  const bySource = (await incomeBySource(from, to)).filter((x) => Math.abs(x.total) > 0.004);

  const lines = await query<{ date: string; week_start: string; product_id: number; agent: string; product: string; qty_received: number; qty_returned: number; unit_cost: number; returnable: number; returns_done: number }>(
    `SELECT d.delivery_date AS date, d.week_start, p.id AS product_id, a.name AS agent, p.name AS product,
            l.qty_received, l.qty_returned, l.unit_cost, l.returnable, d.returns_done
       FROM deliveries d
       JOIN delivery_lines l ON l.delivery_id = d.id
       JOIN agents a ON a.id = d.agent_id
       JOIN products p ON p.id = l.product_id
      WHERE d.delivery_date BETWEEN ? AND ?
      ORDER BY d.delivery_date, a.name, p.name`,
    [from, to],
  );
  // goods of the month (by delivery date)
  const goods = await query<{ id: number; date: string; week_start: string; agent: string; received: number; returnable_lines: number; returns_done: number; manual_amount: number | null; note: string | null }>(
    `SELECT t.id, t.delivery_date AS date, t.week_start, a.name AS agent, t.received, t.returnable_lines, t.returns_done, t.manual_amount, t.note
       FROM delivery_totals t JOIN agents a ON a.id = t.agent_id
      WHERE t.delivery_date BETWEEN ? AND ? ORDER BY t.delivery_date, a.name`,
    [from, to],
  );
  // return credits of the month (by the date of the returns)
  const credits = await query<{ date: string; goods_date: string; agent: string; credit: number; manual_credit: number | null }>(
    `SELECT COALESCE(t.returns_date, t.delivery_date) AS date, t.delivery_date AS goods_date, a.name AS agent, t.credit, t.manual_credit
       FROM delivery_totals t JOIN agents a ON a.id = t.agent_id
      WHERE t.credit <> 0 AND COALESCE(t.returns_date, t.delivery_date) BETWEEN ? AND ?
      ORDER BY 1, a.name`,
    [from, to],
  );

  const prodMap = new Map<number, MonthReport['products'][number]>();
  for (const l of lines) {
    const rec = num(l.qty_received) * num(l.unit_cost);
    const ret = num(l.qty_returned) * num(l.unit_cost);
    const p = prodMap.get(l.product_id) ?? { id: l.product_id, name: l.product, received: 0, returned: 0, sold: 0, cost: 0 };
    p.received += num(l.qty_received);
    p.returned += num(l.qty_returned);
    p.sold += num(l.qty_received) - num(l.qty_returned);
    p.cost += rec - ret;
    prodMap.set(l.product_id, p);
  }

  const payRows = await query<{ date: string; agent_id: number; agent: string; color: string | null; amount: number; method: string | null; note: string | null }>(
    `SELECT p.date, p.agent_id, a.name AS agent, a.color, p.amount, p.method, p.note
       FROM agent_payments p JOIN agents a ON a.id = p.agent_id
      WHERE p.date BETWEEN ? AND ? ORDER BY p.date`,
    [from, to],
  );
  const paidBy = new Map<number, number>();
  let paid = 0;
  for (const p of payRows) {
    paid += num(p.amount);
    paidBy.set(p.agent_id, (paidBy.get(p.agent_id) ?? 0) + num(p.amount));
  }

  // per agent: stock, invoice, charge and the check
  const monthRows = await monthAgents(mk);
  const agents: ReportAgent[] = monthRows.map((r) => ({
    id: r.agentId,
    name: r.name,
    color: r.color,
    received: r.m.goods,
    returned: r.m.credit,
    expected: r.m.expected,
    invoiced: r.m.invoiced,
    invoiceCount: r.m.invoiceCount,
    charge: r.m.charge,
    source: r.m.source,
    state: r.state,
    diff: r.diff,
    paid: paidBy.get(r.agentId) ?? 0,
  }));
  // agents paid this month without goods or an invoice in it
  for (const p of payRows) {
    if (agents.some((a) => a.id === p.agent_id)) continue;
    agents.push({ id: p.agent_id, name: p.agent, color: p.color, received: 0, returned: 0, expected: 0, invoiced: 0, invoiceCount: 0, charge: 0, source: 'stock', state: 'empty', diff: 0, paid: paidBy.get(p.agent_id) ?? 0 });
  }
  const total = (f: (a: ReportAgent) => number) => agents.reduce((s, a) => s + cents(f(a)), 0) / 100;
  const received = total((a) => a.received);
  const credit = total((a) => a.returned);
  const charges = total((a) => a.charge);

  const invoices = await loadInvoices({ month: mk });
  const names = new Map(monthRows.map((r) => [r.agentId, r]));
  const invoiceRows = invoices.map((i) => ({
    date: i.date,
    agent: names.get(i.agentId)?.name ?? '',
    amount: i.amount,
    number: i.number ?? '',
    note: i.note ?? '',
    state: names.get(i.agentId)?.state ?? ('no-stock' as CheckState),
    diff: names.get(i.agentId)?.diff ?? 0,
  }));

  const exp = (
    await query<{ date: string; type: string | null; amount: number; note: string | null; kind: string; recurring_id: number | null }>(
      `SELECT e.date, t.name AS type, e.amount, e.note, e.kind, e.recurring_id FROM expenses e LEFT JOIN expense_types t ON t.id = e.type_id
        WHERE e.date BETWEEN ? AND ? AND e.amount <> 0 ORDER BY e.date`,
      [from, to],
    )
  ).map((e) => ({ ...e, type: e.kind === 'workers' ? 'פועלים' : e.type ? `${e.type}${e.recurring_id ? ' (קבועה)' : ''}` : null }));
  const byTypeMap = new Map<string, number>();
  for (const e of exp) byTypeMap.set(e.type ?? 'ללא סוג', (byTypeMap.get(e.type ?? 'ללא סוג') ?? 0) + num(e.amount));
  const expenses = [...byTypeMap.values()].reduce((a, b) => a + b, 0);

  // weeks (Sunday–Saturday) that touch the month, clipped to the month; goods by stock
  const weeks: MonthReport['weeks'] = [];
  for (let ws = startOfWeek(fromIso(from)); iso(ws) <= to; ws = addDays(ws, 7)) {
    const wf = iso(ws) < from ? from : iso(ws);
    const wt = iso(addDays(ws, 6)) > to ? to : iso(addDays(ws, 6));
    const inc = daily.filter((d) => d.date >= wf && d.date <= wt).reduce((s, d) => s + d.total, 0);
    const g =
      goods.filter((t) => t.date >= wf && t.date <= wt).reduce((s, t) => s + num(t.received), 0) -
      credits.filter((t) => t.date >= wf && t.date <= wt).reduce((s, t) => s + num(t.credit), 0);
    const ex = exp.filter((e) => e.date >= wf && e.date <= wt).reduce((s, e) => s + num(e.amount), 0);
    const pd = payRows.filter((p) => p.date >= wf && p.date <= wt).reduce((s, p) => s + num(p.amount), 0);
    weeks.push({ weekStart: iso(ws), title: weekInfo(ws).title, from: wf, to: wt, income: inc, goods: g, paid: pd, expenses: ex, net: inc - g - ex });
  }
  const correction = Math.round((charges - (received - credit)) * 100) / 100;

  return {
    year,
    month,
    from,
    to,
    hebMonths: hebMonthsOf(year, month),
    income,
    byMethod: methods.map((name) => ({ name, total: byMethodMap.get(name) ?? 0 })),
    bySource,
    received,
    credit,
    expected: Math.round((received - credit) * 100) / 100,
    invoiced: total((a) => a.invoiced),
    charges,
    byStock: total((a) => (a.source === 'stock' ? a.charge : 0)),
    waiting: agents.filter((a) => a.state === 'waiting').length,
    mismatches: agents.filter((a) => a.state === 'mismatch').length,
    expenses,
    byType: [...byTypeMap.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
    net: income - charges - expenses,
    mode: 'goods',
    paid,
    weeks,
    correction,
    agents: agents.sort((a, b) => b.charge - a.charge || a.name.localeCompare(b.name, 'he')),
    products: [...prodMap.values()].sort((a, b) => b.sold - a.sold),
    daily,
    methods,
    deliveryRows: [
      ...lines.map((l) => ({
        date: l.date,
        weekStart: l.week_start,
        agent: l.agent,
        product: l.product,
        received: num(l.qty_received),
        returned: num(l.qty_returned),
        unitCost: num(l.unit_cost),
        returnable: num(l.returnable),
        returnsDone: num(l.returns_done),
        net: num(l.qty_received) * num(l.unit_cost),
        sum: false,
      })),
      ...goods
        .filter((t) => t.manual_amount != null)
        .map((t) => ({
          date: t.date,
          weekStart: t.week_start,
          agent: t.agent,
          product: `סחורה בסכום, בלי פירוט${t.note ? ` (${t.note})` : ''}`,
          received: 0,
          returned: 0,
          unitCost: 0,
          returnable: num(t.returnable_lines) > 0 ? 1 : 0,
          returnsDone: num(t.returns_done),
          net: num(t.received),
          sum: true,
        })),
    ].sort((a, b) => (a.date === b.date ? a.agent.localeCompare(b.agent, 'he') : a.date < b.date ? -1 : 1)),
    creditRows: credits.map((t) => ({ date: t.date, agent: t.agent, goodsDate: t.goods_date, credit: num(t.credit), sum: t.manual_credit != null })),
    invoiceRows,
    expenseRows: exp.map((e) => ({ date: e.date, type: e.type ?? 'ללא סוג', amount: num(e.amount), note: e.note ?? '' })),
    paymentRows: payRows.map((p) => ({ date: p.date, agent: p.agent, amount: num(p.amount), method: p.method ?? '', note: p.note ?? '' })),
    openReturns: monthRows.filter((r) => r.m.source === 'stock').reduce((s, r) => s + r.m.openReturns, 0),
  };
}
