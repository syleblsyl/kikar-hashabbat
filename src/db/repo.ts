import { query, run } from './sqlite';
import { balances, monthAgents, type CheckState } from './billing';
import { iso, monthKey } from '../lib/dates';

export async function getSetting(key: string): Promise<string | null> {
  const rows = await query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  await run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

/**
 * How net profit is counted:
 * 'paid'  – income − what was paid to agents − expenses (money that actually left the store)
 * 'goods' – income − goods kept (received − returned, at cost) − expenses
 */
export type NetMode = 'paid' | 'goods';

/** Since 1.0.12 always 'goods' (Yosel: every agent charge is minus, paid or not). Kept as a value for the code paths. */
export async function getNetMode(): Promise<NetMode> {
  return 'goods';
}

/* ======================= by month ======================= */

export function monthRange(year: number, month: number): { from: string; to: string } {
  return { from: iso(new Date(year, month, 1)), to: iso(new Date(year, month + 1, 0)) };
}

export type MonthSummary = {
  income: number;
  /** what the month's goods cost: each agent's invoice for the month, or its stock while there is no invoice */
  goodsCost: number;
  /** of goodsCost: by invoices / still by stock */
  byInvoice: number;
  byStock: number;
  /** agents whose month is still counted by stock (no invoice yet) */
  waiting: number;
  /** agents whose invoice does not match the stock (and was not marked as checked) */
  mismatches: number;
  paid: number;
  expenses: number;
  /** of which fixed monthly expenses */
  fixed: number;
  /** of which workers */
  workers: number;
  net: number;
  mode: NetMode;
  /** goods of the month still waiting for returns, in months still counted by stock */
  openReturns: number;
};

export async function monthSummary(year: number, month: number): Promise<MonthSummary> {
  const { from, to } = monthRange(year, month);
  const mk = monthKey(new Date(year, month, 1));
  const [inc] = await query<{ total: number }>('SELECT COALESCE(SUM(amount), 0) AS total FROM daily_income WHERE date BETWEEN ? AND ?', [from, to]);
  const rows = await monthAgents(mk);
  const [pay] = await query<{ total: number }>('SELECT COALESCE(SUM(amount), 0) AS total FROM agent_payments WHERE date BETWEEN ? AND ?', [from, to]);
  const [exp] = await query<{ total: number; fixed: number; workers: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total,
            COALESCE(SUM(CASE WHEN recurring_id IS NOT NULL THEN amount ELSE 0 END), 0) AS fixed,
            COALESCE(SUM(CASE WHEN kind = 'workers' THEN amount ELSE 0 END), 0) AS workers
       FROM expenses WHERE date BETWEEN ? AND ?`,
    [from, to],
  );
  const cents = (n: number) => Math.round(n * 100);
  const byInvoice = rows.filter((r) => r.m.source === 'invoice').reduce((s, r) => s + cents(r.m.charge), 0) / 100;
  const byStock = rows.filter((r) => r.m.source === 'stock').reduce((s, r) => s + cents(r.m.charge), 0) / 100;
  const income = Number(inc?.total ?? 0);
  const goodsCost = Math.round((byInvoice + byStock) * 100) / 100;
  const expenses = Number(exp?.total ?? 0);
  return {
    income,
    goodsCost,
    byInvoice,
    byStock,
    waiting: rows.filter((r) => r.state === 'waiting').length,
    mismatches: rows.filter((r) => r.state === 'mismatch').length,
    paid: Number(pay?.total ?? 0),
    expenses,
    fixed: Number(exp?.fixed ?? 0),
    workers: Number(exp?.workers ?? 0),
    mode: 'goods',
    net: income - goodsCost - expenses,
    openReturns: rows.filter((r) => r.m.source === 'stock').reduce((s, r) => s + r.m.openReturns, 0),
  };
}

export type AgentMonthRow = {
  id: number;
  name: string;
  color: string | null;
  /** this month: what it costs, and where that number comes from */
  charge: number;
  source: 'invoice' | 'stock' | 'none';
  state: CheckState;
  diff: number;
  invoiced: number;
  invoiceCount: number;
  /** stock of the month: goods − returns */
  expected: number;
  stockCount: number;
  paid: number;
  /** what I owe the agent today, everything included */
  balance: number;
};

export async function agentsForMonth(year: number, month: number): Promise<AgentMonthRow[]> {
  const { from, to } = monthRange(year, month);
  const mk = monthKey(new Date(year, month, 1));
  const [agents, rows, bal, pays] = await Promise.all([
    query<{ id: number; name: string; color: string | null; active: number }>('SELECT id, name, color, active FROM agents'),
    monthAgents(mk),
    balances(),
    query<{ agent_id: number; total: number }>('SELECT agent_id, SUM(amount) AS total FROM agent_payments WHERE date BETWEEN ? AND ? GROUP BY agent_id', [from, to]),
  ]);
  const byAgent = new Map(rows.map((r) => [r.agentId, r]));
  const paid = new Map(pays.map((p) => [Number(p.agent_id), Number(p.total)]));
  return agents
    .filter((a) => !!Number(a.active) || byAgent.has(Number(a.id)) || Math.abs(bal.get(Number(a.id)) ?? 0) > 0.004 || paid.has(Number(a.id)))
    .map((a) => {
      const r = byAgent.get(Number(a.id));
      return {
        id: Number(a.id),
        name: a.name,
        color: a.color,
        charge: r?.m.charge ?? 0,
        source: r ? r.m.source : ('none' as const),
        state: r?.state ?? ('empty' as const),
        diff: r?.diff ?? 0,
        invoiced: r?.m.invoiced ?? 0,
        invoiceCount: r?.m.invoiceCount ?? 0,
        expected: r?.m.expected ?? 0,
        stockCount: r?.m.stockCount ?? 0,
        paid: paid.get(Number(a.id)) ?? 0,
        balance: bal.get(Number(a.id)) ?? 0,
      };
    })
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, 'he'));
}
