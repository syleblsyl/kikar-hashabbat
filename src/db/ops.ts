import { query, run, runSet } from './sqlite';
import { addDays, fromIso, iso, startOfWeek, weekLabel } from '../lib/dates';

/* ======================= deliveries ======================= */

export type Delivery = {
  id: number;
  agent_id: number;
  week_start: string;
  delivery_date: string;
  returns_done: number;
  returns_date: string | null;
  /** set when the delivery was recorded as one sum instead of per product */
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
  /** quantity that arrived in this agent's previous delivery (0 if none) */
  prev_qty: number;
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
  const prevRows = await query<{ product_id: number; qty_received: number }>(
    `SELECT l.product_id, l.qty_received FROM delivery_lines l
      WHERE l.delivery_id = (SELECT id FROM deliveries WHERE agent_id = ? AND week_start < ? ORDER BY week_start DESC LIMIT 1)`,
    [agentId, weekStart],
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

function checkWeek(weekStart: string, date: string) {
  const end = iso(addDays(fromIso(weekStart), 6));
  if (date < weekStart || date > end) throw new Error('date-outside-week');
}

/** Saves the quantities that arrived. Lines at 0 are removed; an empty delivery is removed. */
export async function saveDelivery(agentId: number, weekStart: string, deliveryDate: string, items: DeliveryItem[]) {
  checkWeek(weekStart, deliveryDate);
  let d = await getDelivery(agentId, weekStart);
  const withQty = items.filter((i) => i.qty_received > 0);
  if (!d && withQty.length === 0) return;
  if (!d) {
    await run('INSERT INTO deliveries (agent_id, week_start, delivery_date) VALUES (?, ?, ?)', [agentId, weekStart, deliveryDate]);
    d = await getDelivery(agentId, weekStart);
  }
  if (!d) throw new Error('delivery not created');
  const set: { statement: string; values?: unknown[] }[] = [
    // per product from now on (a sum entered before is replaced, and so is a credit sum)
    { statement: 'UPDATE deliveries SET delivery_date = ?, manual_amount = NULL, manual_credit = NULL WHERE id = ?', values: [deliveryDate, d.id] },
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

/** Saves a delivery as one sum (what I owe the agent for it), without products. 0 removes it. */
export async function saveDeliveryAmount(agentId: number, weekStart: string, deliveryDate: string, amount: number, note: string, returnable: boolean) {
  checkWeek(weekStart, deliveryDate);
  const d = await getDelivery(agentId, weekStart);
  if (amount <= 0) {
    if (d) await deleteDelivery(d.id);
    return;
  }
  if (!d) {
    await run(
      'INSERT INTO deliveries (agent_id, week_start, delivery_date, manual_amount, manual_returnable, note, returns_done) VALUES (?, ?, ?, ?, ?, ?, 0)',
      [agentId, weekStart, deliveryDate, amount, returnable ? 1 : 0, note.trim() || null],
    );
    return;
  }
  // returns already recorded per product keep their value as a credit sum (the product lines go away)
  const [t] = await query<{ credit: number }>('SELECT credit FROM delivery_totals WHERE id = ?', [d.id]);
  const credit = d.returns_done ? Math.min(Number(t?.credit ?? 0), amount) : null;
  await runSet([
    { statement: 'DELETE FROM delivery_lines WHERE delivery_id = ?', values: [d.id] },
    {
      statement: 'UPDATE deliveries SET delivery_date = ?, manual_amount = ?, manual_returnable = ?, note = ?, manual_credit = ? WHERE id = ?',
      values: [deliveryDate, amount, returnable ? 1 : 0, note.trim() || null, credit, d.id],
    },
  ]);
}

/** How this agent's previous delivery was recorded, to open the screen the same way. */
export async function lastDeliveryOf(agentId: number, beforeWeek: string): Promise<{ manual: boolean; received: number; returnable: boolean } | null> {
  const [r] = await query<{ manual_amount: number | null; received: number; manual_returnable: number }>(
    'SELECT manual_amount, received, manual_returnable FROM delivery_totals WHERE agent_id = ? AND week_start < ? ORDER BY week_start DESC LIMIT 1',
    [agentId, beforeWeek],
  );
  return r ? { manual: r.manual_amount != null, received: Number(r.received), returnable: !!Number(r.manual_returnable) } : null;
}

/** What I owe one agent right now (negative = the agent owes me). */
export async function balanceOf(agentId: number): Promise<number> {
  return (await balances()).get(agentId) ?? 0;
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
  /** the delivery was one sum (no products), so returns can only be a sum too */
  manual_amount: number | null;
  /** the returns were recorded as one credit sum */
  manual_credit: number | null;
  received: number;
  credit: number;
  /** anything that can come back at all */
  returnable: boolean;
  note: string | null;
};

export async function returnsForWeek(weekStart: string): Promise<ReturnsAgent[]> {
  const ds = await query<{
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
       FROM delivery_totals t JOIN agents a ON a.id = t.agent_id
      WHERE t.week_start = ? ORDER BY t.returns_done, a.name`,
    [weekStart],
  );
  const out: ReturnsAgent[] = [];
  for (const d of ds) {
    const items = d.manual_amount != null ? [] : (await deliveryItems(d.agent_id, weekStart)).filter((i) => i.inLine);
    out.push({
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
    });
  }
  return out;
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

/** Weeks before the current one that still wait for returns, most recent first. */
export async function pendingReturnsWeeks(): Promise<{ week: string; agents: number }[]> {
  const current = iso(startOfWeek(new Date()));
  const rows = await query<{ week_start: string; n: number }>(
    `SELECT t.week_start, COUNT(*) AS n FROM delivery_totals t
      WHERE t.returns_done = 0 AND t.week_start < ? AND t.returnable_lines > 0 AND t.received > 0
      GROUP BY t.week_start ORDER BY t.week_start DESC`,
    [current],
  );
  return rows.map((r) => ({ week: r.week_start, agents: Number(r.n) }));
}

/** The week the returns screen should open on: the latest week still waiting (agents collect on Sunday). */
export async function pendingReturnsWeek(): Promise<string | null> {
  return (await pendingReturnsWeeks())[0]?.week ?? null;
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

/** Payment methods to show for a day: the active ones, plus hidden ones that already have an amount that day. */
export async function methodsForDay(date: string): Promise<Method[]> {
  return query<Method>(
    `SELECT * FROM payment_methods m
      WHERE m.active = 1 OR EXISTS (SELECT 1 FROM daily_income i WHERE i.method_id = m.id AND i.date = ? AND i.amount <> 0)
      ORDER BY m.sort, m.id`,
    [date],
  );
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

/** Records a payment to the agent and returns its id (for the payment confirmation). */
export async function addPayment(agentId: number, date: string, amount: number, method: string, note: string): Promise<number> {
  const res = await run('INSERT INTO agent_payments (agent_id, date, amount, method, note) VALUES (?, ?, ?, ?, ?)', [agentId, date, amount, method, note.trim()]);
  return res.lastId;
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
  /** what I owe the agent right after this entry (negative = the agent owes me) */
  balance: number;
  /** delivery / returns recorded as one sum (no products) */
  manual?: boolean;
  /** payments only */
  method?: string | null;
  note?: string | null;
};

export async function agentLedger(agentId: number): Promise<LedgerEntry[]> {
  const ds = await query<{
    id: number;
    week_start: string;
    delivery_date: string;
    returns_done: number;
    returns_date: string | null;
    received: number;
    credit: number;
    lines: number;
    returnable: number;
    manual_amount: number | null;
    manual_credit: number | null;
    note: string | null;
  }>(
    `SELECT id, week_start, delivery_date, returns_done, returns_date, received, credit, lines,
            returnable_lines AS returnable, manual_amount, manual_credit, note
       FROM delivery_totals WHERE agent_id = ?`,
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
      sub:
        d.manual_amount != null
          ? `שבוע ${wl} · לפי סכום${d.note ? ` · ${d.note}` : ''}`
          : `שבוע ${wl} · ${Number(d.lines) === 1 ? 'מוצר אחד' : `${d.lines} מוצרים`}`,
      manual: d.manual_amount != null,
      note: d.note,
      pendingReturns: !d.returns_done && Number(d.returnable) > 0,
      weekStart: d.week_start,
      balance: 0,
    });
    if (d.returns_done) {
      out.push({
        key: `r${d.id}`,
        kind: 'returns',
        id: d.id,
        date: d.returns_date ?? d.delivery_date,
        amount: -Number(d.credit),
        title: 'החזרות',
        sub: d.manual_credit != null ? `שבוע ${wl} · זיכוי לפי סכום` : `שבוע ${wl}`,
        manual: d.manual_credit != null,
        weekStart: d.week_start,
        balance: 0,
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
      balance: 0,
      method: p.method,
      note: p.note,
    });
  }
  // oldest first to run the balance: on the same day goods arrive, then returns, then the payment
  const order = { delivery: 0, returns: 1, payment: 2 };
  out.sort((a, b) => (a.date === b.date ? order[a.kind] - order[b.kind] || a.id - b.id : a.date < b.date ? -1 : 1));
  let bal = 0;
  for (const e of out) {
    bal += e.amount;
    e.balance = Math.round(bal * 100) / 100;
  }
  return out.reverse();
}

/* ======================= statement & payment confirmation (sent to the agent) ======================= */

export type DocLine = { name: string; qty: number; unit_cost: number };
export type StatementRow = LedgerEntry & { lines: DocLine[] };
export type StatementRange = 'since-payment' | 'month' | '3months' | 'all';
export type Statement = {
  range: StatementRange;
  /** first day shown, null = from the beginning */
  from: string | null;
  opening: number;
  rows: StatementRow[];
  closing: number;
  delivered: number;
  credit: number;
  paid: number;
  /** weeks whose returns are not recorded yet (the balance will still go down) */
  pendingWeeks: string[];
  lastPayment: { date: string; amount: number } | null;
};

async function linesOf(deliveryIds: number[]): Promise<Map<number, { name: string; qty_received: number; qty_returned: number; unit_cost: number }[]>> {
  const map = new Map<number, { name: string; qty_received: number; qty_returned: number; unit_cost: number }[]>();
  if (deliveryIds.length === 0) return map;
  const rows = await query<{ delivery_id: number; name: string; qty_received: number; qty_returned: number; unit_cost: number }>(
    `SELECT l.delivery_id, p.name, l.qty_received, l.qty_returned, l.unit_cost
       FROM delivery_lines l JOIN products p ON p.id = l.product_id
      WHERE l.delivery_id IN (${deliveryIds.map(() => '?').join(',')})
      ORDER BY p.name`,
    deliveryIds,
  );
  for (const r of rows) {
    const list = map.get(r.delivery_id) ?? [];
    list.push({ name: r.name, qty_received: Number(r.qty_received), qty_returned: Number(r.qty_returned), unit_cost: Number(r.unit_cost) });
    map.set(r.delivery_id, list);
  }
  return map;
}

/** Account statement for one agent, oldest first, from the chosen point until today. */
export async function agentStatement(agentId: number, range: StatementRange): Promise<Statement> {
  const all = (await agentLedger(agentId)).reverse(); // oldest first
  const lastPayIdx = all.map((e) => e.kind).lastIndexOf('payment');
  const t = new Date();
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
  const opening = start > 0 ? all[start - 1].balance : 0;
  const closing = all.length ? all[all.length - 1].balance : 0;
  const lines = await linesOf([...new Set(shown.filter((e) => e.kind !== 'payment').map((e) => e.id))]);
  const rows: StatementRow[] = shown.map((e) => {
    const ls = e.kind === 'payment' ? [] : lines.get(e.id) ?? [];
    return {
      ...e,
      lines:
        e.kind === 'delivery'
          ? ls.filter((l) => l.qty_received > 0).map((l) => ({ name: l.name, qty: l.qty_received, unit_cost: l.unit_cost }))
          : e.kind === 'returns' && !e.manual
            ? ls.filter((l) => l.qty_returned > 0).map((l) => ({ name: l.name, qty: l.qty_returned, unit_cost: l.unit_cost }))
            : [],
    };
  });
  const sum = (k: LedgerEntry['kind']) => shown.filter((e) => e.kind === k).reduce((s, e) => s + Math.abs(e.amount), 0);
  const last = lastPayIdx >= 0 ? all[lastPayIdx] : null;
  return {
    range,
    from,
    opening,
    rows,
    closing,
    delivered: sum('delivery'),
    credit: sum('returns'),
    paid: sum('payment'),
    pendingWeeks: all.filter((e) => e.pendingReturns && e.weekStart).map((e) => e.weekStart!),
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
  /** what I owed the agent just before / just after this payment (negative = the agent owes me) */
  before: number;
  after: number;
  /** what I owe the agent today, after everything recorded since */
  now: number;
  pendingWeeks: string[];
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
    now: ledger[0]?.balance ?? 0,
    pendingWeeks: ledger.filter((x) => x.pendingReturns && x.weekStart && x.date <= e.date).map((x) => x.weekStart!),
  };
}

export async function balances(): Promise<Map<number, number>> {
  const rows = await query<{ agent_id: number; bal: number }>(
    `SELECT a.id AS agent_id,
            COALESCE((SELECT SUM(t.received - t.credit) FROM delivery_totals t WHERE t.agent_id = a.id), 0)
          - COALESCE((SELECT SUM(p.amount) FROM agent_payments p WHERE p.agent_id = a.id), 0) AS bal
       FROM agents a`,
  );
  return new Map(rows.map((r) => [r.agent_id, Number(r.bal)]));
}

/* ======================= helpers for screens ======================= */

export function weekDays(weekStart: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => iso(addDays(weekStart, i)));
}
