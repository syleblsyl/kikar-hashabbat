import { query, run, runSet } from './sqlite';
import { addDays, fromIso, iso, startOfWeek, weekLabel } from '../lib/dates';

/* ======================= deliveries ======================= */

export type Delivery = { id: number; agent_id: number; week_start: string; delivery_date: string; returns_done: number; returns_date: string | null };

export type DeliveryItem = {
  product_id: number;
  name: string;
  image: string | null;
  tint: string | null;
  unit_cost: number;
  returnable: number;
  qty_received: number;
  qty_returned: number;
  inLine: boolean;
};

export async function getDelivery(agentId: number, weekStart: string): Promise<Delivery | null> {
  const rows = await query<Delivery>('SELECT * FROM deliveries WHERE agent_id = ? AND week_start = ?', [agentId, weekStart]);
  return rows[0] ?? null;
}

/**
 * Everything the agent supplies (at today's cost) plus anything already recorded in this week's delivery
 * (at the cost that was saved then — later price changes never rewrite old weeks).
 */
export async function deliveryItems(agentId: number, weekStart: string): Promise<DeliveryItem[]> {
  const d = await getDelivery(agentId, weekStart);
  const lines = d
    ? await query<{ product_id: number; unit_cost: number; returnable: number; qty_received: number; qty_returned: number }>(
        'SELECT product_id, unit_cost, returnable, qty_received, qty_returned FROM delivery_lines WHERE delivery_id = ?',
        [d.id],
      )
    : [];
  const current = await query<{ product_id: number; cost_price: number; returnable: number }>(
    `SELECT ap.product_id, ap.cost_price, p.returnable
       FROM agent_products ap JOIN products p ON p.id = ap.product_id
      WHERE ap.agent_id = ? AND ap.active = 1 AND p.active = 1`,
    [agentId],
  );
  const ids = new Set<number>([...current.map((c) => c.product_id), ...lines.map((l) => l.product_id)]);
  if (ids.size === 0) return [];
  const products = await query<{ id: number; name: string; image: string | null; tint: string | null; sort: number }>(
    `SELECT p.id, p.name, p.image, c.color AS tint, COALESCE(c.sort, 999) AS sort
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id IN (${[...ids].map(() => '?').join(',')})`,
    [...ids],
  );
  const items = products.map((p) => {
    const line = lines.find((l) => l.product_id === p.id);
    const cur = current.find((c) => c.product_id === p.id);
    return {
      product_id: p.id,
      name: p.name,
      image: p.image,
      tint: p.tint,
      unit_cost: Number(line ? line.unit_cost : cur?.cost_price ?? 0),
      returnable: Number(line ? line.returnable : cur?.returnable ?? 1),
      qty_received: Number(line?.qty_received ?? 0),
      qty_returned: Number(line?.qty_returned ?? 0),
      inLine: !!line,
      sort: p.sort,
    };
  });
  items.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'he'));
  return items.map(({ sort: _s, ...rest }) => rest);
}

/** Saves the quantities that arrived. Lines at 0 are removed; an empty delivery is removed. */
export async function saveDelivery(agentId: number, deliveryDate: string, items: DeliveryItem[]) {
  const weekStart = iso(startOfWeek(fromIso(deliveryDate)));
  let d = await getDelivery(agentId, weekStart);
  const withQty = items.filter((i) => i.qty_received > 0);
  if (!d && withQty.length === 0) return;
  if (!d) {
    await run('INSERT INTO deliveries (agent_id, week_start, delivery_date) VALUES (?, ?, ?)', [agentId, weekStart, deliveryDate]);
    d = await getDelivery(agentId, weekStart);
  }
  if (!d) throw new Error('delivery not created');
  const set: { statement: string; values?: unknown[] }[] = [
    { statement: 'UPDATE deliveries SET delivery_date = ? WHERE id = ?', values: [deliveryDate, d.id] },
  ];
  for (const i of items) {
    if (i.qty_received > 0) {
      set.push({
        statement: `INSERT INTO delivery_lines (delivery_id, product_id, qty_received, qty_returned, unit_cost, returnable)
                    VALUES (?, ?, ?, 0, ?, ?)
                    ON CONFLICT(delivery_id, product_id) DO UPDATE SET qty_received = excluded.qty_received,
                      qty_returned = MIN(delivery_lines.qty_returned, excluded.qty_received)`,
        values: [d.id, i.product_id, i.qty_received, i.unit_cost, i.returnable],
      });
    } else if (i.inLine) {
      set.push({ statement: 'DELETE FROM delivery_lines WHERE delivery_id = ? AND product_id = ?', values: [d.id, i.product_id] });
    }
  }
  if (withQty.length === 0) set.push({ statement: 'DELETE FROM deliveries WHERE id = ?', values: [d.id] });
  await runSet(set);
}

export async function deleteDelivery(id: number) {
  await runSet([
    { statement: 'DELETE FROM delivery_lines WHERE delivery_id = ?', values: [id] },
    { statement: 'DELETE FROM deliveries WHERE id = ?', values: [id] },
  ]);
}

/** Agent ids that already have a delivery in the week. */
export async function deliveredAgents(weekStart: string): Promise<Set<number>> {
  const rows = await query<{ agent_id: number }>('SELECT agent_id FROM deliveries WHERE week_start = ?', [weekStart]);
  return new Set(rows.map((r) => r.agent_id));
}

/* ======================= returns ======================= */

export type ReturnsAgent = {
  delivery_id: number;
  agent_id: number;
  name: string;
  color: string | null;
  delivery_date: string;
  returns_done: number;
  returns_date: string | null;
  items: DeliveryItem[];
};

export async function returnsForWeek(weekStart: string): Promise<ReturnsAgent[]> {
  const ds = await query<{ id: number; agent_id: number; name: string; color: string | null; delivery_date: string; returns_done: number; returns_date: string | null }>(
    `SELECT d.id, d.agent_id, a.name, a.color, d.delivery_date, d.returns_done, d.returns_date
       FROM deliveries d JOIN agents a ON a.id = d.agent_id
      WHERE d.week_start = ? ORDER BY d.returns_done, a.name`,
    [weekStart],
  );
  const out: ReturnsAgent[] = [];
  for (const d of ds) {
    const items = (await deliveryItems(d.agent_id, weekStart)).filter((i) => i.inLine);
    out.push({ delivery_id: d.id, agent_id: d.agent_id, name: d.name, color: d.color, delivery_date: d.delivery_date, returns_done: d.returns_done, returns_date: d.returns_date, items });
  }
  return out;
}

export async function saveReturns(deliveryId: number, returnsDate: string, items: { product_id: number; qty_returned: number }[]) {
  await runSet([
    ...items.map((i) => ({
      statement: 'UPDATE delivery_lines SET qty_returned = MIN(?, qty_received) WHERE delivery_id = ? AND product_id = ? AND returnable = 1',
      values: [Math.max(0, i.qty_returned), deliveryId, i.product_id],
    })),
    { statement: 'UPDATE deliveries SET returns_done = 1, returns_date = ? WHERE id = ?', values: [returnsDate, deliveryId] },
  ]);
}

/**
 * The oldest week before the current one that still waits for returns (agents collect on Sunday,
 * so the current week's returns are normally recorded next week).
 */
export async function pendingReturnsWeek(): Promise<string | null> {
  const current = iso(startOfWeek(new Date()));
  const rows = await query<{ week_start: string }>(
    `SELECT d.week_start FROM deliveries d
      WHERE d.returns_done = 0 AND d.week_start < ?
        AND EXISTS (SELECT 1 FROM delivery_lines l WHERE l.delivery_id = d.id AND l.returnable = 1 AND l.qty_received > 0)
      ORDER BY d.week_start ASC LIMIT 1`,
    [current],
  );
  return rows[0]?.week_start ?? null;
}

/* ======================= payment methods & income ======================= */

export type Method = { id: number; name: string; sort: number; active: number };

export async function listMethods(includeHidden = false): Promise<Method[]> {
  return query<Method>(`SELECT * FROM payment_methods ${includeHidden ? '' : 'WHERE active = 1'} ORDER BY sort, id`);
}

export async function addMethod(name: string) {
  const [row] = await query<{ n: number }>('SELECT COALESCE(MAX(sort), 0) AS n FROM payment_methods');
  await run('INSERT INTO payment_methods (name, sort) VALUES (?, ?)', [name.trim(), Number(row?.n ?? 0) + 1]);
}

export async function renameMethod(id: number, name: string) {
  await run('UPDATE payment_methods SET name = ? WHERE id = ?', [name.trim(), id]);
}

export async function setMethodActive(id: number, active: boolean) {
  await run('UPDATE payment_methods SET active = ? WHERE id = ?', [active ? 1 : 0, id]);
}

export async function incomeForDay(date: string): Promise<Map<number, number>> {
  const rows = await query<{ method_id: number; amount: number }>('SELECT method_id, amount FROM daily_income WHERE date = ?', [date]);
  return new Map(rows.map((r) => [r.method_id, Number(r.amount)]));
}

export async function saveIncomeDay(date: string, amounts: Map<number, number>) {
  const set: { statement: string; values?: unknown[] }[] = [];
  for (const [methodId, amount] of amounts) {
    if (amount > 0) {
      set.push({
        statement: `INSERT INTO daily_income (date, method_id, amount) VALUES (?, ?, ?)
                    ON CONFLICT(date, method_id) DO UPDATE SET amount = excluded.amount`,
        values: [date, methodId, amount],
      });
    } else {
      set.push({ statement: 'DELETE FROM daily_income WHERE date = ? AND method_id = ?', values: [date, methodId] });
    }
  }
  await runSet(set);
}

export async function incomeByDay(from: string, to: string): Promise<Map<string, number>> {
  const rows = await query<{ date: string; total: number }>(
    'SELECT date, SUM(amount) AS total FROM daily_income WHERE date BETWEEN ? AND ? GROUP BY date',
    [from, to],
  );
  return new Map(rows.map((r) => [r.date, Number(r.total)]));
}

export async function incomeByMethod(from: string, to: string): Promise<{ id: number; name: string; total: number }[]> {
  const rows = await query<{ id: number; name: string; total: number }>(
    `SELECT m.id, m.name, COALESCE(SUM(i.amount), 0) AS total
       FROM payment_methods m LEFT JOIN daily_income i ON i.method_id = m.id AND i.date BETWEEN ? AND ?
      GROUP BY m.id HAVING m.active = 1 OR total > 0 ORDER BY m.sort, m.id`,
    [from, to],
  );
  return rows.map((r) => ({ ...r, total: Number(r.total) }));
}

/* ======================= expenses ======================= */

export type ExpenseType = { id: number; name: string; sort: number; active: number };
export type Expense = { id: number; date: string; type_id: number | null; type: string | null; amount: number; note: string | null };

export async function listExpenseTypes(includeHidden = false): Promise<ExpenseType[]> {
  return query<ExpenseType>(`SELECT * FROM expense_types ${includeHidden ? '' : 'WHERE active = 1'} ORDER BY sort, id`);
}

export async function addExpenseType(name: string): Promise<number> {
  const [row] = await query<{ n: number }>('SELECT COALESCE(MAX(sort), 0) AS n FROM expense_types');
  const res = await run('INSERT INTO expense_types (name, sort) VALUES (?, ?)', [name.trim(), Number(row?.n ?? 0) + 1]);
  return res.lastId;
}

export async function renameExpenseType(id: number, name: string) {
  await run('UPDATE expense_types SET name = ? WHERE id = ?', [name.trim(), id]);
}

export async function setExpenseTypeActive(id: number, active: boolean) {
  await run('UPDATE expense_types SET active = ? WHERE id = ?', [active ? 1 : 0, id]);
}

export async function listExpenses(from: string, to: string): Promise<Expense[]> {
  const rows = await query<Expense>(
    `SELECT e.id, e.date, e.type_id, t.name AS type, e.amount, e.note
       FROM expenses e LEFT JOIN expense_types t ON t.id = e.type_id
      WHERE e.date BETWEEN ? AND ? ORDER BY e.date DESC, e.id DESC`,
    [from, to],
  );
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

export async function saveExpense(e: { id?: number; date: string; type_id: number | null; amount: number; note: string }) {
  if (e.id) {
    await run('UPDATE expenses SET date = ?, type_id = ?, amount = ?, note = ? WHERE id = ?', [e.date, e.type_id, e.amount, e.note.trim(), e.id]);
  } else {
    await run('INSERT INTO expenses (date, type_id, amount, note) VALUES (?, ?, ?, ?)', [e.date, e.type_id, e.amount, e.note.trim()]);
  }
}

export async function deleteExpense(id: number) {
  await run('DELETE FROM expenses WHERE id = ?', [id]);
}

/* ======================= agent payments, ledger, balance ======================= */

export async function addPayment(agentId: number, date: string, amount: number, method: string, note: string) {
  await run('INSERT INTO agent_payments (agent_id, date, amount, method, note) VALUES (?, ?, ?, ?, ?)', [agentId, date, amount, method, note.trim()]);
}

export async function deletePayment(id: number) {
  await run('DELETE FROM agent_payments WHERE id = ?', [id]);
}

export type LedgerEntry = {
  key: string;
  kind: 'delivery' | 'returns' | 'payment';
  id: number;
  date: string;
  amount: number;
  title: string;
  sub: string;
  pendingReturns?: boolean;
  weekStart?: string;
};

export async function agentLedger(agentId: number): Promise<LedgerEntry[]> {
  const ds = await query<{ id: number; week_start: string; delivery_date: string; returns_done: number; returns_date: string | null; received: number; credit: number; lines: number; returnable: number }>(
    `SELECT d.id, d.week_start, d.delivery_date, d.returns_done, d.returns_date,
            COALESCE(SUM(l.qty_received * l.unit_cost), 0) AS received,
            COALESCE(SUM(l.qty_returned * l.unit_cost), 0) AS credit,
            COUNT(l.id) AS lines,
            COALESCE(SUM(CASE WHEN l.returnable = 1 THEN 1 ELSE 0 END), 0) AS returnable
       FROM deliveries d LEFT JOIN delivery_lines l ON l.delivery_id = d.id
      WHERE d.agent_id = ? GROUP BY d.id`,
    [agentId],
  );
  const pays = await query<{ id: number; date: string; amount: number; method: string | null; note: string | null }>(
    'SELECT id, date, amount, method, note FROM agent_payments WHERE agent_id = ?',
    [agentId],
  );
  const out: LedgerEntry[] = [];
  for (const d of ds) {
    const wl = weekLabel(fromIso(d.week_start));
    out.push({
      key: `d${d.id}`,
      kind: 'delivery',
      id: d.id,
      date: d.delivery_date,
      amount: Number(d.received),
      title: 'אספקה',
      sub: `שבוע ${wl} · ${Number(d.lines) === 1 ? 'מוצר אחד' : `${d.lines} מוצרים`}`,
      pendingReturns: !d.returns_done && Number(d.returnable) > 0,
      weekStart: d.week_start,
    });
    if (d.returns_done) {
      out.push({
        key: `r${d.id}`,
        kind: 'returns',
        id: d.id,
        date: d.returns_date ?? d.delivery_date,
        amount: -Number(d.credit),
        title: 'החזרות',
        sub: `שבוע ${wl}`,
        weekStart: d.week_start,
      });
    }
  }
  for (const p of pays) {
    out.push({
      key: `p${p.id}`,
      kind: 'payment',
      id: p.id,
      date: p.date,
      amount: -Number(p.amount),
      title: 'תשלום',
      sub: [p.method, p.note].filter(Boolean).join(' · '),
    });
  }
  const order = { payment: 0, returns: 1, delivery: 2 };
  out.sort((a, b) => (a.date === b.date ? order[a.kind] - order[b.kind] : a.date < b.date ? 1 : -1));
  return out;
}

export async function balances(): Promise<Map<number, number>> {
  const rows = await query<{ agent_id: number; bal: number }>(
    `SELECT a.id AS agent_id,
            COALESCE((SELECT SUM((l.qty_received - l.qty_returned) * l.unit_cost)
                        FROM deliveries d JOIN delivery_lines l ON l.delivery_id = d.id WHERE d.agent_id = a.id), 0)
          - COALESCE((SELECT SUM(p.amount) FROM agent_payments p WHERE p.agent_id = a.id), 0) AS bal
       FROM agents a`,
  );
  return new Map(rows.map((r) => [r.agent_id, Number(r.bal)]));
}

/* ======================= helpers for screens ======================= */

export function weekDays(weekStart: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => iso(addDays(weekStart, i)));
}
