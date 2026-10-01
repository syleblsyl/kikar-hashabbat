import { query, run } from './sqlite';
import { addDays, iso } from '../lib/dates';

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

export type WeekSummary = {
  income: number;
  goodsCost: number;
  paid: number;
  expenses: number;
  net: number;
  mode: NetMode;
  hasOpenReturns: boolean;
};

/** Totals for the week that starts on `weekStart` (a Sunday, yyyy-mm-dd). */
export async function weekSummary(weekStart: Date): Promise<WeekSummary> {
  const from = iso(weekStart);
  const to = iso(addDays(weekStart, 6));
  const [inc] = await query<{ total: number }>(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM daily_income WHERE date BETWEEN ? AND ?',
    [from, to],
  );
  const [goods] = await query<{ total: number; open: number }>(
    `SELECT COALESCE(SUM(t.received - t.credit), 0) AS total,
            COALESCE(SUM(CASE WHEN t.returns_done = 0 AND t.returnable_lines > 0 THEN 1 ELSE 0 END), 0) AS open
       FROM delivery_totals t WHERE t.week_start = ?`,
    [from],
  );
  const [exp] = await query<{ total: number }>(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE date BETWEEN ? AND ?',
    [from, to],
  );
  const [pay] = await query<{ total: number }>(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM agent_payments WHERE date BETWEEN ? AND ?',
    [from, to],
  );
  const mode = await getNetMode();
  const income = Number(inc?.total ?? 0);
  const goodsCost = Number(goods?.total ?? 0);
  const paid = Number(pay?.total ?? 0);
  const expenses = Number(exp?.total ?? 0);
  return {
    income,
    goodsCost,
    paid,
    expenses,
    mode,
    net: income - (mode === 'paid' ? paid : goodsCost) - expenses,
    hasOpenReturns: Number(goods?.open ?? 0) > 0,
  };
}

export type AgentWeekRow = {
  id: number;
  name: string;
  color: string | null;
  deliveryDay: number | null;
  delivered: number;
  deliveryDate: string | null;
  cost: number;
  lines: number;
  /** recorded as one sum, without products */
  manual: boolean;
};

export async function agentsForWeek(weekStart: Date): Promise<AgentWeekRow[]> {
  const rows = await query<{
    id: number;
    name: string;
    color: string | null;
    delivery_day: number | null;
    delivery_date: string | null;
    cost: number | null;
    lines: number | null;
    manual_amount: number | null;
  }>(
    `SELECT a.id, a.name, a.color, a.delivery_day, d.delivery_date,
            (SELECT t.received - t.credit FROM delivery_totals t WHERE t.id = d.id) AS cost,
            (SELECT COUNT(*) FROM delivery_lines l WHERE l.delivery_id = d.id AND l.qty_received > 0) AS lines,
            d.manual_amount
       FROM agents a
       LEFT JOIN deliveries d ON d.agent_id = a.id AND d.week_start = ?
      WHERE a.active = 1 OR d.id IS NOT NULL
      ORDER BY (d.id IS NULL), a.name`,
    [iso(weekStart)],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    deliveryDay: r.delivery_day,
    delivered: r.delivery_date ? 1 : 0,
    deliveryDate: r.delivery_date,
    cost: Number(r.cost ?? 0),
    lines: Number(r.lines ?? 0),
    manual: r.manual_amount != null,
  }));
}

/** Number of agents whose delivery in the given week still waits for returns. */
export async function openReturnsCount(weekStart: Date): Promise<number> {
  const [row] = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM delivery_totals t
      WHERE t.week_start = ? AND t.returns_done = 0 AND t.returnable_lines > 0 AND t.received > 0`,
    [iso(weekStart)],
  );
  return Number(row?.n ?? 0);
}

/* ======================= by month ======================= */

export function monthRange(year: number, month: number): { from: string; to: string } {
  return { from: iso(new Date(year, month, 1)), to: iso(new Date(year, month + 1, 0)) };
}

export type MonthSummary = {
  income: number;
  /** invoices minus return credits, by invoice date */
  goodsCost: number;
  paid: number;
  expenses: number;
  /** of which fixed monthly expenses */
  fixed: number;
  /** of which workers */
  workers: number;
  net: number;
  mode: NetMode;
  openReturns: number;
};

export async function monthSummary(year: number, month: number): Promise<MonthSummary> {
  const { from, to } = monthRange(year, month);
  const [inc] = await query<{ total: number }>('SELECT COALESCE(SUM(amount), 0) AS total FROM daily_income WHERE date BETWEEN ? AND ?', [from, to]);
  const [goods] = await query<{ total: number; open: number }>(
    `SELECT COALESCE(SUM(t.received - t.credit), 0) AS total,
            COALESCE(SUM(CASE WHEN t.returns_done = 0 AND t.returnable_lines > 0 AND t.received > 0 THEN 1 ELSE 0 END), 0) AS open
       FROM delivery_totals t WHERE t.delivery_date BETWEEN ? AND ?`,
    [from, to],
  );
  const [pay] = await query<{ total: number }>('SELECT COALESCE(SUM(amount), 0) AS total FROM agent_payments WHERE date BETWEEN ? AND ?', [from, to]);
  const [exp] = await query<{ total: number; fixed: number; workers: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total,
            COALESCE(SUM(CASE WHEN recurring_id IS NOT NULL THEN amount ELSE 0 END), 0) AS fixed,
            COALESCE(SUM(CASE WHEN kind = 'workers' THEN amount ELSE 0 END), 0) AS workers
       FROM expenses WHERE date BETWEEN ? AND ?`,
    [from, to],
  );
  const mode = await getNetMode();
  const income = Number(inc?.total ?? 0);
  const goodsCost = Number(goods?.total ?? 0);
  const paid = Number(pay?.total ?? 0);
  const expenses = Number(exp?.total ?? 0);
  return {
    income,
    goodsCost,
    paid,
    expenses,
    fixed: Number(exp?.fixed ?? 0),
    workers: Number(exp?.workers ?? 0),
    mode,
    net: income - (mode === 'paid' ? paid : goodsCost) - expenses,
    openReturns: Number(goods?.open ?? 0),
  };
}

export type AgentMonthRow = {
  id: number;
  name: string;
  color: string | null;
  invoices: number;
  /** invoices this month minus return credits */
  invoiced: number;
  paid: number;
  /** what I owe the agent today, everything included */
  balance: number;
};

export async function agentsForMonth(year: number, month: number): Promise<AgentMonthRow[]> {
  const { from, to } = monthRange(year, month);
  const rows = await query<{ id: number; name: string; color: string | null; invoices: number; invoiced: number; paid: number; balance: number }>(
    `SELECT a.id, a.name, a.color,
            (SELECT COUNT(*) FROM delivery_totals t WHERE t.agent_id = a.id AND t.delivery_date BETWEEN ? AND ?) AS invoices,
            (SELECT COALESCE(SUM(t.received - t.credit), 0) FROM delivery_totals t WHERE t.agent_id = a.id AND t.delivery_date BETWEEN ? AND ?) AS invoiced,
            (SELECT COALESCE(SUM(p.amount), 0) FROM agent_payments p WHERE p.agent_id = a.id AND p.date BETWEEN ? AND ?) AS paid,
            COALESCE((SELECT SUM(t.received - t.credit) FROM delivery_totals t WHERE t.agent_id = a.id), 0)
              - COALESCE((SELECT SUM(p.amount) FROM agent_payments p WHERE p.agent_id = a.id), 0) AS balance
       FROM agents a
      WHERE a.active = 1
         OR EXISTS (SELECT 1 FROM deliveries d WHERE d.agent_id = a.id AND d.delivery_date BETWEEN ? AND ?)`,
    [from, to, from, to, from, to, from, to],
  );
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      invoices: Number(r.invoices),
      invoiced: Number(r.invoiced),
      paid: Number(r.paid),
      balance: Number(r.balance),
    }))
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, 'he'));
}
