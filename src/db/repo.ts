import { query, run } from './sqlite';
import { addDays, iso } from '../lib/dates';

export async function getSetting(key: string): Promise<string | null> {
  const rows = await query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  await run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

export type WeekSummary = {
  income: number;
  goodsCost: number;
  expenses: number;
  net: number;
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
    `SELECT COALESCE(SUM((l.qty_received - l.qty_returned) * l.unit_cost), 0) AS total,
            COALESCE(SUM(CASE WHEN d.returns_done = 0 AND l.returnable = 1 THEN 1 ELSE 0 END), 0) AS open
       FROM deliveries d JOIN delivery_lines l ON l.delivery_id = d.id
      WHERE d.week_start = ?`,
    [from],
  );
  const [exp] = await query<{ total: number }>(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE date BETWEEN ? AND ?',
    [from, to],
  );
  const income = Number(inc?.total ?? 0);
  const goodsCost = Number(goods?.total ?? 0);
  const expenses = Number(exp?.total ?? 0);
  return { income, goodsCost, expenses, net: income - goodsCost - expenses, hasOpenReturns: Number(goods?.open ?? 0) > 0 };
}

export type AgentWeekRow = {
  id: number;
  name: string;
  color: string | null;
  delivered: number;
  deliveryDate: string | null;
  cost: number;
  lines: number;
};

export async function agentsForWeek(weekStart: Date): Promise<AgentWeekRow[]> {
  const rows = await query<{
    id: number;
    name: string;
    color: string | null;
    delivery_date: string | null;
    cost: number | null;
    lines: number | null;
  }>(
    `SELECT a.id, a.name, a.color, d.delivery_date,
            (SELECT SUM(l.qty_received * l.unit_cost) FROM delivery_lines l WHERE l.delivery_id = d.id) AS cost,
            (SELECT COUNT(*) FROM delivery_lines l WHERE l.delivery_id = d.id AND l.qty_received > 0) AS lines
       FROM agents a
       LEFT JOIN deliveries d ON d.agent_id = a.id AND d.week_start = ?
      WHERE a.active = 1
      ORDER BY (d.id IS NULL), a.name`,
    [iso(weekStart)],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    delivered: r.delivery_date ? 1 : 0,
    deliveryDate: r.delivery_date,
    cost: Number(r.cost ?? 0),
    lines: Number(r.lines ?? 0),
  }));
}

/** Number of agents whose delivery in the given week still waits for returns. */
export async function openReturnsCount(weekStart: Date): Promise<number> {
  const [row] = await query<{ n: number }>(
    `SELECT COUNT(DISTINCT d.id) AS n
       FROM deliveries d JOIN delivery_lines l ON l.delivery_id = d.id
      WHERE d.week_start = ? AND d.returns_done = 0 AND l.returnable = 1 AND l.qty_received > 0`,
    [iso(weekStart)],
  );
  return Number(row?.n ?? 0);
}
