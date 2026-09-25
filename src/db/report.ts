import { query } from './sqlite';
import { addDays, fromIso, iso, startOfWeek } from '../lib/dates';
import { hebMonthsOf, weekInfo } from '../lib/hebrew';

export type MonthReport = {
  year: number;
  month: number;
  from: string;
  to: string;
  hebMonths: string;
  income: number;
  byMethod: { name: string; total: number }[];
  received: number;
  credit: number;
  goodsNet: number;
  expenses: number;
  byType: { name: string; total: number }[];
  net: number;
  paid: number;
  weeks: { weekStart: string; title: string; from: string; to: string; income: number; goods: number; expenses: number; net: number }[];
  agents: { id: number; name: string; color: string | null; received: number; returned: number; net: number; paid: number }[];
  products: { id: number; name: string; received: number; returned: number; sold: number; cost: number }[];
  daily: { date: string; amounts: Record<string, number>; total: number }[];
  methods: string[];
  deliveryRows: { date: string; weekStart: string; agent: string; product: string; received: number; returned: number; unitCost: number; returnable: number; returnsDone: number }[];
  expenseRows: { date: string; type: string; amount: number; note: string }[];
  paymentRows: { date: string; agent: string; amount: number; method: string; note: string }[];
  openReturns: number;
};

const num = (v: unknown) => Number(v ?? 0);

export async function monthReport(year: number, month: number): Promise<MonthReport> {
  const from = iso(new Date(year, month, 1));
  const to = iso(new Date(year, month + 1, 0));

  const incomeRows = await query<{ date: string; name: string; amount: number }>(
    `SELECT i.date, m.name, i.amount FROM daily_income i JOIN payment_methods m ON m.id = i.method_id
      WHERE i.date BETWEEN ? AND ? ORDER BY i.date, m.sort, m.id`,
    [from, to],
  );
  const methodOrder = await query<{ name: string }>('SELECT name FROM payment_methods ORDER BY sort, id');
  const usedMethods = new Set(incomeRows.map((r) => r.name));
  const methods = methodOrder.map((m) => m.name).filter((n) => usedMethods.has(n));

  const byMethodMap = new Map<string, number>();
  const dailyMap = new Map<string, Record<string, number>>();
  for (const r of incomeRows) {
    byMethodMap.set(r.name, (byMethodMap.get(r.name) ?? 0) + num(r.amount));
    const d = dailyMap.get(r.date) ?? {};
    d[r.name] = (d[r.name] ?? 0) + num(r.amount);
    dailyMap.set(r.date, d);
  }
  const income = [...byMethodMap.values()].reduce((a, b) => a + b, 0);
  const daily = [...dailyMap.entries()].map(([date, amounts]) => ({ date, amounts, total: Object.values(amounts).reduce((a, b) => a + b, 0) }));

  const lines = await query<{ date: string; week_start: string; agent_id: number; agent: string; color: string | null; product_id: number; product: string; qty_received: number; qty_returned: number; unit_cost: number; returnable: number; returns_done: number }>(
    `SELECT d.delivery_date AS date, d.week_start, a.id AS agent_id, a.name AS agent, a.color, p.id AS product_id, p.name AS product,
            l.qty_received, l.qty_returned, l.unit_cost, l.returnable, d.returns_done
       FROM deliveries d
       JOIN delivery_lines l ON l.delivery_id = d.id
       JOIN agents a ON a.id = d.agent_id
       JOIN products p ON p.id = l.product_id
      WHERE d.delivery_date BETWEEN ? AND ?
      ORDER BY d.delivery_date, a.name, p.name`,
    [from, to],
  );
  let received = 0;
  let credit = 0;
  const agentMap = new Map<number, MonthReport['agents'][number]>();
  const prodMap = new Map<number, MonthReport['products'][number]>();
  const openDeliveries = new Set<string>();
  for (const l of lines) {
    const rec = num(l.qty_received) * num(l.unit_cost);
    const ret = num(l.qty_returned) * num(l.unit_cost);
    received += rec;
    credit += ret;
    const a = agentMap.get(l.agent_id) ?? { id: l.agent_id, name: l.agent, color: l.color, received: 0, returned: 0, net: 0, paid: 0 };
    a.received += rec;
    a.returned += ret;
    a.net += rec - ret;
    agentMap.set(l.agent_id, a);
    const p = prodMap.get(l.product_id) ?? { id: l.product_id, name: l.product, received: 0, returned: 0, sold: 0, cost: 0 };
    p.received += num(l.qty_received);
    p.returned += num(l.qty_returned);
    p.sold += num(l.qty_received) - num(l.qty_returned);
    p.cost += rec - ret;
    prodMap.set(l.product_id, p);
    if (!l.returns_done && l.returnable) openDeliveries.add(`${l.agent_id}-${l.week_start}`);
  }

  const payRows = await query<{ date: string; agent_id: number; agent: string; color: string | null; amount: number; method: string | null; note: string | null }>(
    `SELECT p.date, p.agent_id, a.name AS agent, a.color, p.amount, p.method, p.note
       FROM agent_payments p JOIN agents a ON a.id = p.agent_id
      WHERE p.date BETWEEN ? AND ? ORDER BY p.date`,
    [from, to],
  );
  let paid = 0;
  for (const p of payRows) {
    paid += num(p.amount);
    const a = agentMap.get(p.agent_id) ?? { id: p.agent_id, name: p.agent, color: p.color, received: 0, returned: 0, net: 0, paid: 0 };
    a.paid += num(p.amount);
    agentMap.set(p.agent_id, a);
  }

  const exp = await query<{ date: string; type: string | null; amount: number; note: string | null }>(
    `SELECT e.date, t.name AS type, e.amount, e.note FROM expenses e LEFT JOIN expense_types t ON t.id = e.type_id
      WHERE e.date BETWEEN ? AND ? ORDER BY e.date`,
    [from, to],
  );
  const byTypeMap = new Map<string, number>();
  for (const e of exp) byTypeMap.set(e.type ?? 'ללא סוג', (byTypeMap.get(e.type ?? 'ללא סוג') ?? 0) + num(e.amount));
  const expenses = [...byTypeMap.values()].reduce((a, b) => a + b, 0);

  // weeks (Sunday–Saturday) that touch the month, clipped to the month
  const weeks: MonthReport['weeks'] = [];
  for (let ws = startOfWeek(fromIso(from)); iso(ws) <= to; ws = addDays(ws, 7)) {
    const wf = iso(ws) < from ? from : iso(ws);
    const wt = iso(addDays(ws, 6)) > to ? to : iso(addDays(ws, 6));
    const inc = daily.filter((d) => d.date >= wf && d.date <= wt).reduce((s, d) => s + d.total, 0);
    const goods = lines.filter((l) => l.date >= wf && l.date <= wt).reduce((s, l) => s + (num(l.qty_received) - num(l.qty_returned)) * num(l.unit_cost), 0);
    const ex = exp.filter((e) => e.date >= wf && e.date <= wt).reduce((s, e) => s + num(e.amount), 0);
    weeks.push({ weekStart: iso(ws), title: weekInfo(ws).title, from: wf, to: wt, income: inc, goods, expenses: ex, net: inc - goods - ex });
  }

  const goodsNet = received - credit;
  return {
    year,
    month,
    from,
    to,
    hebMonths: hebMonthsOf(year, month),
    income,
    byMethod: methods.map((name) => ({ name, total: byMethodMap.get(name) ?? 0 })),
    received,
    credit,
    goodsNet,
    expenses,
    byType: [...byTypeMap.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
    net: income - goodsNet - expenses,
    paid,
    weeks,
    agents: [...agentMap.values()].sort((a, b) => b.net - a.net),
    products: [...prodMap.values()].sort((a, b) => b.sold - a.sold),
    daily,
    methods,
    deliveryRows: lines.map((l) => ({
      date: l.date,
      weekStart: l.week_start,
      agent: l.agent,
      product: l.product,
      received: num(l.qty_received),
      returned: num(l.qty_returned),
      unitCost: num(l.unit_cost),
      returnable: num(l.returnable),
      returnsDone: num(l.returns_done),
    })),
    expenseRows: exp.map((e) => ({ date: e.date, type: e.type ?? 'ללא סוג', amount: num(e.amount), note: e.note ?? '' })),
    paymentRows: payRows.map((p) => ({ date: p.date, agent: p.agent, amount: num(p.amount), method: p.method ?? '', note: p.note ?? '' })),
    openReturns: openDeliveries.size,
  };
}
