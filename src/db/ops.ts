import { query, run, runSet } from './sqlite';
import { addDays, addMonthKey, fromIso, iso, monthKey, startOfWeek } from '../lib/dates';

export { balances, balanceOf } from './billing';

/* ======================= stock: goods from an agent ("מלאי") ======================= */
// Stored in the "deliveries" table. Any number per agent; each is either per product (delivery_lines)
// or one sum (manual_amount). Returns are recorded on the goods, per product or as one credit sum, and count
// in the month of their date. The agent's monthly invoice is something else: see billing.ts.

export type Delivery = {
  id: number;
  agent_id: number;
  week_start: string;
  delivery_date: string;
  returns_done: number;
  returns_date: string | null;
  /** set when the invoice was recorded as one sum instead of per product */
  manual_amount: number | null;
  /** set when the returns were recorded as one credit sum instead of per product */
  manual_credit: number | null;
  manual_returnable: number;
  note: string | null;
};

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
  /** quantity in this agent's previous goods (0 if none) */
  prev_qty: number;
};

export async function getStock(id: number): Promise<Delivery | null> {
  const rows = await query<Delivery>('SELECT * FROM deliveries WHERE id = ?', [id]);
  return rows[0] ?? null;
}

/**
 * Everything the agent supplies (at today's cost) plus anything already in this invoice
 * (at the cost that was saved then — later price changes never rewrite old invoices).
 */
export async function stockItems(agentId: number, invoiceId: number | null): Promise<DeliveryItem[]> {
  const inv = invoiceId ? await getStock(invoiceId) : null;
  const lines = inv
    ? await query<{ product_id: number; unit_cost: number; returnable: number; qty_received: number; qty_returned: number }>(
        'SELECT product_id, unit_cost, returnable, qty_received, qty_returned FROM delivery_lines WHERE delivery_id = ?',
        [inv.id],
      )
    : [];
  const current = await query<{ product_id: number; cost_price: number; returnable: number }>(
    `SELECT ap.product_id, ap.cost_price, p.returnable
       FROM agent_products ap JOIN products p ON p.id = ap.product_id
      WHERE ap.agent_id = ? AND ap.active = 1 AND p.active = 1`,
    [agentId],
  );
  // the agent's previous invoice that was recorded per product
  const prevRows = await query<{ product_id: number; qty_received: number }>(
    `SELECT l.product_id, l.qty_received FROM delivery_lines l
      WHERE l.delivery_id = (SELECT d.id FROM deliveries d
                              WHERE d.agent_id = ? AND d.id <> ? AND d.manual_amount IS NULL AND d.delivery_date <= ?
                              ORDER BY d.delivery_date DESC, d.id DESC LIMIT 1)`,
    [agentId, inv?.id ?? 0, inv?.delivery_date ?? '9999-12-31'],
  );
  const prev = new Map(prevRows.map((r) => [r.product_id, Number(r.qty_received)]));
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
      prev_qty: prev.get(p.id) ?? 0,
      sort: p.sort,
    };
  });
  items.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'he'));
  return items.map(({ sort: _s, ...rest }) => rest);
}

/** Saves goods per product. Lines at 0 are removed; an invoice left empty is removed. Returns its id (0 if removed). */
export async function saveStockItems(invoiceId: number | null, agentId: number, date: string, items: DeliveryItem[]): Promise<number> {
  const withQty = items.filter((i) => i.qty_received > 0);
  let id = invoiceId ?? 0;
  if (!id) {
    if (withQty.length === 0) return 0;
    const res = await run('INSERT INTO deliveries (agent_id, week_start, delivery_date) VALUES (?, ?, ?)', [agentId, iso(startOfWeek(fromIso(date))), date]);
    id = res.lastId;
  }
  const set: { statement: string; values?: unknown[] }[] = [
    // per product from now on (a sum entered before is replaced, and so is a credit sum)
    {
      statement: `UPDATE deliveries SET agent_id = ?, delivery_date = ?, week_start = ?,
                    manual_credit = CASE WHEN manual_amount IS NOT NULL THEN NULL ELSE manual_credit END, manual_amount = NULL,
                    returns_date = CASE WHEN returns_date IS NOT NULL AND returns_date < ? THEN ? ELSE returns_date END WHERE id = ?`,
      values: [agentId, date, iso(startOfWeek(fromIso(date))), date, date, id],
    },
  ];
  for (const i of items) {
    if (i.qty_received > 0) {
      set.push({
        statement: `INSERT INTO delivery_lines (delivery_id, product_id, qty_received, qty_returned, unit_cost, returnable)
                    VALUES (?, ?, ?, 0, ?, ?)
                    ON CONFLICT(delivery_id, product_id) DO UPDATE SET qty_received = excluded.qty_received,
                      qty_returned = MIN(delivery_lines.qty_returned, excluded.qty_received)`,
        values: [id, i.product_id, i.qty_received, i.unit_cost, i.returnable],
      });
    } else if (i.inLine) {
      set.push({ statement: 'DELETE FROM delivery_lines WHERE delivery_id = ? AND product_id = ?', values: [id, i.product_id] });
    }
  }
  if (withQty.length === 0) {
    set.push({ statement: 'DELETE FROM delivery_lines WHERE delivery_id = ?', values: [id] });
    set.push({ statement: 'DELETE FROM deliveries WHERE id = ?', values: [id] });
  }
  await runSet(set);
  return withQty.length === 0 ? 0 : id;
}

/** Saves goods as one sum (what they are worth), without products. Returns its id. */
export async function saveStockAmount(
  invoiceId: number | null,
  agentId: number,
  date: string,
  amount: number,
  note: string,
  returnable: boolean,
): Promise<number> {
  const week = iso(startOfWeek(fromIso(date)));
  const inv = invoiceId ? await getStock(invoiceId) : null;
  if (!inv) {
    const res = await run(
      'INSERT INTO deliveries (agent_id, week_start, delivery_date, manual_amount, manual_returnable, note, returns_done) VALUES (?, ?, ?, ?, ?, ?, 0)',
      [agentId, week, date, amount, returnable ? 1 : 0, note.trim() || null],
    );
    return res.lastId;
  }
  // returns already recorded per product keep their value as a credit sum (the product lines go away)
  const [t] = await query<{ credit: number }>('SELECT credit FROM delivery_totals WHERE id = ?', [inv.id]);
  const credit = inv.returns_done ? Math.min(Number(t?.credit ?? 0), amount) : null;
  await runSet([
    { statement: 'DELETE FROM delivery_lines WHERE delivery_id = ?', values: [inv.id] },
    {
      statement:
        `UPDATE deliveries SET agent_id = ?, delivery_date = ?, week_start = ?, manual_amount = ?, manual_returnable = ?, note = ?, manual_credit = ?,
           returns_date = CASE WHEN returns_date IS NOT NULL AND returns_date < ? THEN ? ELSE returns_date END WHERE id = ?`,
      values: [agentId, date, week, amount, returnable ? 1 : 0, note.trim() || null, credit, date, date, inv.id],
    },
  ]);
  return inv.id;
}

/** How this agent's previous goods were recorded, to open new ones the same way. */
export async function lastStockOf(agentId: number, exceptId = 0): Promise<{ manual: boolean; received: number; returnable: boolean } | null> {
  const [r] = await query<{ manual_amount: number | null; received: number; manual_returnable: number }>(
    'SELECT manual_amount, received, manual_returnable FROM delivery_totals WHERE agent_id = ? AND id <> ? ORDER BY delivery_date DESC, id DESC LIMIT 1',
    [agentId, exceptId],
  );
  return r ? { manual: r.manual_amount != null, received: Number(r.received), returnable: !!Number(r.manual_returnable) } : null;
}

export async function deleteDelivery(id: number) {
  await runSet([
    { statement: 'DELETE FROM delivery_lines WHERE delivery_id = ?', values: [id] },
    { statement: 'DELETE FROM deliveries WHERE id = ?', values: [id] },
  ]);
}

export type StockRow = {
  id: number;
  agent_id: number;
  agent: string;
  color: string | null;
  date: string;
  received: number;
  credit: number;
  lines: number;
  manual: boolean;
  note: string | null;
  returns_done: boolean;
  returnable: boolean;
};

const STOCK_ROW_SQL = `SELECT t.id, t.agent_id, a.name AS agent, a.color, t.delivery_date AS date, t.received, t.credit, t.lines,
        t.manual_amount, t.note, t.returns_done, t.returnable_lines
   FROM delivery_totals t JOIN agents a ON a.id = t.agent_id`;

type StockSqlRow = {
  id: number;
  agent_id: number;
  agent: string;
  color: string | null;
  date: string;
  received: number;
  credit: number;
  lines: number;
  manual_amount: number | null;
  note: string | null;
  returns_done: number;
  returnable_lines: number;
};

const toStockRow = (r: StockSqlRow): StockRow => ({
  id: r.id,
  agent_id: r.agent_id,
  agent: r.agent,
  color: r.color,
  date: r.date,
  received: Number(r.received),
  credit: Number(r.credit),
  lines: Number(r.lines),
  manual: r.manual_amount != null,
  note: r.note,
  returns_done: !!Number(r.returns_done),
  returnable: Number(r.returnable_lines) > 0,
});

export async function stockBetween(from: string, to: string): Promise<StockRow[]> {
  const rows = await query<StockSqlRow>(`${STOCK_ROW_SQL} WHERE t.delivery_date BETWEEN ? AND ? ORDER BY t.delivery_date DESC, t.id DESC`, [from, to]);
  return rows.map(toStockRow);
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
  /** the invoice was one sum (no products), so returns can only be a sum too */
  manual_amount: number | null;
  /** the returns were recorded as one credit sum */
  manual_credit: number | null;
  received: number;
  credit: number;
  /** anything that can come back at all */
  returnable: boolean;
  note: string | null;
};

export async function returnsFor(id: number): Promise<ReturnsAgent | null> {
  const [d] = await query<{
    id: number;
    agent_id: number;
    name: string;
    color: string | null;
    delivery_date: string;
    returns_done: number;
    returns_date: string | null;
    manual_amount: number | null;
    manual_credit: number | null;
    received: number;
    credit: number;
    returnable_lines: number;
    note: string | null;
  }>(
    `SELECT t.id, t.agent_id, a.name, a.color, t.delivery_date, t.returns_done, t.returns_date,
            t.manual_amount, t.manual_credit, t.received, t.credit, t.returnable_lines, t.note
       FROM delivery_totals t JOIN agents a ON a.id = t.agent_id WHERE t.id = ?`,
    [id],
  );
  if (!d) return null;
  const items = d.manual_amount != null ? [] : (await stockItems(d.agent_id, d.id)).filter((i) => i.inLine);
  return {
    delivery_id: d.id,
    agent_id: d.agent_id,
    name: d.name,
    color: d.color,
    delivery_date: d.delivery_date,
    returns_done: d.returns_done,
    returns_date: d.returns_date,
    items,
    manual_amount: d.manual_amount == null ? null : Number(d.manual_amount),
    manual_credit: d.manual_credit == null ? null : Number(d.manual_credit),
    received: Number(d.received),
    credit: Number(d.credit),
    returnable: Number(d.returnable_lines) > 0,
    note: d.note,
  };
}

export async function saveReturns(deliveryId: number, returnsDate: string, items: { product_id: number; qty_returned: number }[]) {
  await runSet([
    ...items.map((i) => ({
      statement: 'UPDATE delivery_lines SET qty_returned = MIN(?, qty_received) WHERE delivery_id = ? AND product_id = ? AND returnable = 1',
      values: [Math.max(0, i.qty_returned), deliveryId, i.product_id],
    })),
    { statement: 'UPDATE deliveries SET returns_done = 1, returns_date = ?, manual_credit = NULL WHERE id = ?', values: [returnsDate, deliveryId] },
  ]);
}

/** Records the returns as one credit sum, without saying which products came back. */
export async function saveReturnsAmount(deliveryId: number, returnsDate: string, credit: number) {
  await runSet([
    { statement: 'UPDATE delivery_lines SET qty_returned = 0 WHERE delivery_id = ?', values: [deliveryId] },
    { statement: 'UPDATE deliveries SET returns_done = 1, returns_date = ?, manual_credit = ? WHERE id = ?', values: [returnsDate, Math.max(0, credit), deliveryId] },
  ]);
}

/**
 * Goods still waiting for returns, oldest first. Agents collect on Sunday, so an invoice is due
 * from the Sunday after it (`dueOnly`); otherwise every open one is listed.
 */
export async function pendingReturns(dueOnly = true): Promise<StockRow[]> {
  const before = dueOnly ? iso(startOfWeek(new Date())) : '9999-12-31';
  const rows = await query<StockSqlRow>(
    `${STOCK_ROW_SQL}
      WHERE t.returns_done = 0 AND t.returnable_lines > 0 AND t.received > 0 AND t.delivery_date < ?
      ORDER BY t.delivery_date, a.name`,
    [before],
  );
  return rows.map(toStockRow);
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

/* ---------- where the money comes in: the store and the mikveh ---------- */

export type Source = { id: number; name: string; sort: number; active: number };

export async function listSources(): Promise<Source[]> {
  return query<Source>('SELECT * FROM income_sources WHERE active = 1 ORDER BY sort, id');
}

/** The two parts of a selling day: the night before it ("ליל שישי") and the day itself ("יום שישי"). Both are dated with the day. */
export type Part = 'night' | 'day';
export const PARTS: Part[] = ['night', 'day'];

/** "source|part|method" → amount */
export const incomeKey = (sourceId: number, part: Part, methodId: number) => `${sourceId}|${part}|${methodId}`;
export function parseIncomeKey(k: string): { sourceId: number; part: Part; methodId: number } {
  const [s, p, m] = k.split('|');
  return { sourceId: Number(s), part: p === 'night' ? 'night' : 'day', methodId: Number(m) };
}

/** Payment methods to show for a day: the active ones, plus hidden ones that already have an amount that day. */
export async function methodsForDay(date: string): Promise<Method[]> {
  return query<Method>(
    `SELECT * FROM payment_methods m
      WHERE m.active = 1 OR EXISTS (SELECT 1 FROM daily_income i WHERE i.method_id = m.id AND i.date = ? AND i.amount <> 0)
      ORDER BY m.sort, m.id`,
    [date],
  );
}

/** The day's amounts by "source|part|method". */
export async function incomeForDay(date: string): Promise<Map<string, number>> {
  const rows = await query<{ source_id: number; part: string; method_id: number; amount: number }>(
    'SELECT source_id, part, method_id, amount FROM daily_income WHERE date = ?',
    [date],
  );
  return new Map(rows.map((r) => [incomeKey(Number(r.source_id), r.part === 'night' ? 'night' : 'day', Number(r.method_id)), Number(r.amount)]));
}

/** Saves amounts of one day (only the ones given – another source's amounts stay as they are). */
export async function saveIncomeDay(date: string, amounts: { sourceId: number; part: Part; methodId: number; amount: number }[]) {
  const set: { statement: string; values?: unknown[] }[] = [];
  for (const { sourceId, part, methodId, amount } of amounts) {
    if (amount > 0) {
      set.push({
        statement: `INSERT INTO daily_income (date, source_id, part, method_id, amount) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(date, source_id, part, method_id) DO UPDATE SET amount = excluded.amount`,
        values: [date, sourceId, part, methodId, amount],
      });
    } else {
      set.push({ statement: 'DELETE FROM daily_income WHERE date = ? AND source_id = ? AND part = ? AND method_id = ?', values: [date, sourceId, part, methodId] });
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

/** Income of a period per source (store / mikveh), with its methods and its two parts. */
export type SourceTotal = {
  id: number;
  name: string;
  total: number;
  methods: { name: string; total: number }[];
  night: number;
  day: number;
};
export async function incomeBySource(from: string, to: string): Promise<SourceTotal[]> {
  const [sources, rows] = await Promise.all([
    query<Source>('SELECT * FROM income_sources ORDER BY sort, id'),
    query<{ source_id: number; part: string; method: string; total: number }>(
      `SELECT i.source_id, i.part, m.name AS method, SUM(i.amount) AS total
         FROM daily_income i JOIN payment_methods m ON m.id = i.method_id
        WHERE i.date BETWEEN ? AND ? GROUP BY i.source_id, i.part, m.id ORDER BY m.sort, m.id`,
      [from, to],
    ),
  ]);
  return sources
    .map((s) => {
      const mine = rows.filter((r) => Number(r.source_id) === Number(s.id));
      const methods = new Map<string, number>();
      for (const r of mine) methods.set(r.method, (methods.get(r.method) ?? 0) + Number(r.total));
      const sum = (part: string) => mine.filter((r) => r.part === part).reduce((t, r) => t + Number(r.total), 0);
      return {
        id: Number(s.id),
        name: s.name,
        total: mine.reduce((t, r) => t + Number(r.total), 0),
        methods: [...methods.entries()].map(([name, total]) => ({ name, total })),
        night: sum('night'),
        day: sum('day'),
      };
    })
    .filter((s) => s.total !== 0 || sources.find((x) => x.id === s.id)?.active);
}

/** Per source, its total for one selling day (night + day), for the choice buttons. */
export async function dayTotalsBySource(date: string): Promise<Map<number, { night: number; day: number }>> {
  const rows = await query<{ source_id: number; part: string; total: number }>(
    'SELECT source_id, part, SUM(amount) AS total FROM daily_income WHERE date = ? GROUP BY source_id, part',
    [date],
  );
  const map = new Map<number, { night: number; day: number }>();
  for (const r of rows) {
    const t = map.get(Number(r.source_id)) ?? { night: 0, day: 0 };
    if (r.part === 'night') t.night += Number(r.total);
    else t.day += Number(r.total);
    map.set(Number(r.source_id), t);
  }
  return map;
}

/* ======================= expenses ======================= */

export type ExpenseType = { id: number; name: string; sort: number; active: number };
export type ExpenseKind = 'general' | 'workers';
export type Expense = {
  id: number;
  date: string;
  type_id: number | null;
  type: string | null;
  amount: number;
  note: string | null;
  /** the fixed monthly expense this month's row came from */
  recurring_id: number | null;
  kind: ExpenseKind;
};

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

export async function listExpenses(from: string, to: string, kind?: ExpenseKind): Promise<Expense[]> {
  const rows = await query<Expense>(
    `SELECT e.id, e.date, e.type_id, t.name AS type, e.amount, e.note, e.recurring_id, e.kind
       FROM expenses e LEFT JOIN expense_types t ON t.id = e.type_id
      WHERE e.date BETWEEN ? AND ? ${kind ? 'AND e.kind = ?' : ''}
      ORDER BY e.date DESC, e.id DESC`,
    kind ? [from, to, kind] : [from, to],
  );
  return rows.map((r) => ({ ...r, amount: Number(r.amount), kind: r.kind === 'workers' ? 'workers' : 'general' }));
}

export async function saveExpense(e: { id?: number; date: string; type_id: number | null; amount: number; note: string; kind?: ExpenseKind }) {
  if (e.id) {
    await run('UPDATE expenses SET date = ?, type_id = ?, amount = ?, note = ? WHERE id = ?', [e.date, e.type_id, e.amount, e.note.trim(), e.id]);
  } else {
    await run('INSERT INTO expenses (date, type_id, amount, note, kind) VALUES (?, ?, ?, ?, ?)', [e.date, e.type_id, e.amount, e.note.trim(), e.kind ?? 'general']);
  }
}

export async function deleteExpense(id: number) {
  await run('DELETE FROM expenses WHERE id = ?', [id]);
}

/* ---------- fixed monthly expenses ---------- */
// A fixed expense (rent…) is a template; every month gets its own row in "expenses", dated the 1st,
// so each month starts already minus its fixed costs. Months are "yyyy-mm".

export type Recurring = { id: number; type_id: number | null; type: string | null; amount: number; note: string | null; start_month: string; end_month: string | null };

export { monthKey };
const nextMonth = (m: string) => addMonthKey(m, 1);
const prevMonth = (m: string) => addMonthKey(m, -1);

export async function listRecurring(): Promise<Recurring[]> {
  const rows = await query<Recurring>(
    `SELECT r.id, r.type_id, t.name AS type, r.amount, r.note, r.start_month, r.end_month
       FROM recurring_expenses r LEFT JOIN expense_types t ON t.id = r.type_id
      ORDER BY (r.end_month IS NOT NULL), r.amount DESC`,
  );
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

/** Creates the month rows that are missing, from each fixed expense's first month up to this month. Safe to call any time. */
export async function ensureRecurring(): Promise<void> {
  const now = monthKey(new Date());
  const templates = await query<Recurring>('SELECT * FROM recurring_expenses');
  if (templates.length === 0) return;
  const have = await query<{ recurring_id: number; m: string }>(
    "SELECT recurring_id, substr(date, 1, 7) AS m FROM expenses WHERE recurring_id IS NOT NULL",
  );
  const exists = new Set(have.map((h) => `${h.recurring_id}:${h.m}`));
  const set: { statement: string; values?: unknown[] }[] = [];
  for (const t of templates) {
    const last = t.end_month && t.end_month < now ? t.end_month : now;
    for (let m = t.start_month; m <= last; m = nextMonth(m)) {
      if (exists.has(`${t.id}:${m}`)) continue;
      set.push({
        statement: "INSERT INTO expenses (date, type_id, amount, note, recurring_id, kind) VALUES (?, ?, ?, ?, ?, 'general')",
        values: [`${m}-01`, t.type_id, t.amount, t.note ?? '', t.id],
      });
    }
  }
  if (set.length) await runSet(set);
}

/** A new fixed monthly expense, starting in `startMonth`. */
export async function addRecurring(r: { type_id: number | null; amount: number; note: string; startMonth: string }) {
  await run('INSERT INTO recurring_expenses (type_id, amount, note, start_month) VALUES (?, ?, ?, ?)', [r.type_id, r.amount, r.note.trim() || null, r.startMonth]);
  await ensureRecurring();
}

/** Changes a fixed expense from `fromMonth` on (that month and later rows change too, earlier months stay as they were). */
export async function updateRecurringFrom(id: number, fromMonth: string, r: { type_id: number | null; amount: number; note: string }) {
  await runSet([
    { statement: 'UPDATE recurring_expenses SET type_id = ?, amount = ?, note = ? WHERE id = ?', values: [r.type_id, r.amount, r.note.trim() || null, id] },
    {
      statement: 'UPDATE expenses SET type_id = ?, amount = ?, note = ? WHERE recurring_id = ? AND date >= ?',
      values: [r.type_id, r.amount, r.note.trim(), id, `${fromMonth}-01`],
    },
  ]);
}

/** Stops a fixed expense: `fromMonth` and later no longer get it (their rows are removed). */
export async function stopRecurring(id: number, fromMonth: string) {
  await runSet([
    { statement: 'UPDATE recurring_expenses SET end_month = ? WHERE id = ?', values: [prevMonth(fromMonth), id] },
    { statement: 'DELETE FROM expenses WHERE recurring_id = ? AND date >= ?', values: [id, `${fromMonth}-01`] },
  ]);
}

/* ======================= agent payments ======================= */
// Balances, the money ledger, statements and payment confirmations are in billing.ts.

/** Records a payment to the agent and returns its id (for the payment confirmation). */
export async function addPayment(agentId: number, date: string, amount: number, method: string, note: string): Promise<number> {
  const res = await run('INSERT INTO agent_payments (agent_id, date, amount, method, note) VALUES (?, ?, ?, ?, ?)', [agentId, date, amount, method, note.trim()]);
  return res.lastId;
}

export async function deletePayment(id: number) {
  await run('DELETE FROM agent_payments WHERE id = ?', [id]);
}

/* ======================= helpers for screens ======================= */

export function weekDays(weekStart: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => iso(addDays(weekStart, i)));
}
