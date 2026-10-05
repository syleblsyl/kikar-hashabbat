/*
 * Money per agent and month, without the database (so it can be tested on its own).
 *
 * Two sources:
 *  - stock ("מלאי"): goods that arrived (by delivery date) and return credits (by the date of the returns);
 *  - invoices: the sum the agent bills once a month, for one month of goods ("חשבונית על ספטמבר").
 * A month that has an invoice is charged by the invoice; a month without one is charged by the stock,
 * until the invoice arrives. The difference between them is the "check" (בדיקה).
 */
import { addDays, addMonthKey, dm, fromIso, iso, monthLast, monthName, monthOf } from '../lib/dates';
import { shekelSmart } from '../lib/money';

/** Under this many shekels, an invoice "matches" the stock. */
export const MATCH = 1;

const c = (n: number) => Math.round(n * 100);
const fromC = (n: number) => n / 100;

export type StockEntry = {
  id: number;
  agentId: number;
  date: string;
  received: number;
  credit: number;
  returnsDone: boolean;
  returnsDate: string | null;
  /** anything in it can come back */
  returnable: boolean;
  /** recorded as one sum, without products */
  manual: boolean;
  lines: number;
  note: string | null;
};

export type InvoiceRec = { id: number; agentId: number; month: string; date: string; amount: number; number: string | null; note: string | null };
export type PaymentRec = { id: number; agentId: number; date: string; amount: number; method: string | null; note: string | null };

export const goodsMonth = (e: StockEntry) => monthOf(e.date);
/** the month a return credit counts in (old returns without a date count with their goods) */
export const creditMonth = (e: StockEntry) => monthOf(e.returnsDate ?? e.date);
export const waitsForReturns = (e: StockEntry) => !e.returnsDone && e.returnable && e.received > 0;

export type AgentMonth = {
  agentId: number;
  month: string;
  /** goods that arrived this month */
  goods: number;
  /** return credits dated this month */
  credit: number;
  /** goods − credit: what the stock says the agent should bill */
  expected: number;
  /** stock of the month before, whose invoice of 0 ₪ says it is billed in this month's invoice */
  carried: number;
  /** what this month's invoice is compared with: expected + carried */
  compare: number;
  invoiced: number;
  invoiceCount: number;
  /** this month got an invoice of 0 ₪: its goods are billed with the next month (that month) */
  mergedInto: string | null;
  /** what this month costs: the invoices if there are any, otherwise the stock */
  charge: number;
  source: 'invoice' | 'stock';
  /** deliveries that arrived this month */
  stockCount: number;
  /** returns recorded this month */
  creditCount: number;
  /** deliveries of this month still waiting for returns that agents collect within this month */
  openReturns: number;
};

const key = (agentId: number, month: string) => `${agentId}|${month}`;
/** returns are collected on the Sunday after the goods arrived */
const returnsSunday = (d: string) => {
  const x = fromIso(d);
  return iso(addDays(x, 7 - x.getDay()));
};

export function buildMonths(stock: StockEntry[], invoices: InvoiceRec[]): AgentMonth[] {
  type Acc = {
    agentId: number;
    month: string;
    goods: number;
    credit: number;
    carried: number;
    invoiced: number;
    invoiceCount: number;
    mergedInto: string | null;
    stockCount: number;
    creditCount: number;
    openReturns: number;
  };
  const map = new Map<string, Acc>();
  const get = (agentId: number, month: string) => {
    const k = key(agentId, month);
    let a = map.get(k);
    if (!a) {
      a = { agentId, month, goods: 0, credit: 0, carried: 0, invoiced: 0, invoiceCount: 0, mergedInto: null, stockCount: 0, creditCount: 0, openReturns: 0 };
      map.set(k, a);
    }
    return a;
  };
  for (const e of stock) {
    const g = get(e.agentId, goodsMonth(e));
    g.goods += c(e.received);
    g.stockCount++;
    if (waitsForReturns(e) && monthOf(returnsSunday(e.date)) === g.month) g.openReturns++;
    if (c(e.credit) !== 0) {
      const r = get(e.agentId, creditMonth(e));
      r.credit += c(e.credit);
      r.creditCount++;
    }
  }
  for (const i of invoices) {
    const m = get(i.agentId, i.month);
    m.invoiced += c(i.amount);
    m.invoiceCount++;
  }
  // an invoice of 0 ₪ on a month with stock: that stock is billed with the next month
  for (const a of [...map.values()].sort((x, y) => (x.month < y.month ? -1 : 1))) {
    const own = a.goods - a.credit + a.carried;
    if (a.invoiceCount > 0 && a.invoiced === 0 && (a.stockCount > 0 || a.creditCount > 0 || a.carried !== 0)) {
      const next = get(a.agentId, addMonthKey(a.month, 1));
      next.carried += own;
      a.mergedInto = next.month;
    }
  }
  return [...map.values()]
    .map((a) => {
      const expected = a.goods - a.credit;
      const compare = expected + a.carried;
      const source: AgentMonth['source'] = a.invoiceCount > 0 ? 'invoice' : 'stock';
      return {
        agentId: a.agentId,
        month: a.month,
        goods: fromC(a.goods),
        credit: fromC(a.credit),
        expected: fromC(expected),
        carried: fromC(a.carried),
        compare: fromC(compare),
        invoiced: fromC(a.invoiced),
        invoiceCount: a.invoiceCount,
        mergedInto: a.mergedInto,
        charge: fromC(source === 'invoice' ? a.invoiced : compare),
        source,
        stockCount: a.stockCount,
        creditCount: a.creditCount,
        openReturns: a.openReturns,
      };
    })
    .sort((x, y) => (x.month === y.month ? x.agentId - y.agentId : x.month < y.month ? -1 : 1));
}

/** What I owe each agent: every month's charge minus every payment. */
export function balancesOf(months: AgentMonth[], payments: { agentId: number; amount: number }[]): Map<number, number> {
  const acc = new Map<number, number>();
  for (const m of months) acc.set(m.agentId, (acc.get(m.agentId) ?? 0) + c(m.charge));
  for (const p of payments) acc.set(p.agentId, (acc.get(p.agentId) ?? 0) - c(p.amount));
  return new Map([...acc.entries()].map(([k, v]) => [k, fromC(v)]));
}

/* ======================= the check: invoice against stock ======================= */

export type CheckState = 'empty' | 'waiting' | 'no-stock' | 'match' | 'mismatch' | 'checked' | 'merged';

export function checkOf(m: AgentMonth | undefined, ackDiff: number | null | undefined): { state: CheckState; diff: number } {
  if (!m) return { state: 'empty', diff: 0 };
  if (m.mergedInto) return { state: 'merged', diff: 0 };
  const diff = fromC(c(m.invoiced) - c(m.compare));
  const hasStock = m.stockCount > 0 || m.creditCount > 0 || c(m.carried) !== 0;
  if (m.invoiceCount === 0) return { state: hasStock ? 'waiting' : 'empty', diff: 0 };
  if (!hasStock) return { state: 'no-stock', diff: 0 };
  if (Math.abs(diff) < MATCH) return { state: 'match', diff };
  if (ackDiff != null && Math.abs(ackDiff - diff) < 0.01) return { state: 'checked', diff };
  return { state: 'mismatch', diff };
}

export type Hint = {
  key: string;
  /** an exact explanation (amount equals the difference) rather than a general idea */
  strong: boolean;
  title: string;
  text: string;
  link?: { to: string; label: string };
};

export type PriceChange = { productId: number; name: string; recorded: number; now: number; qty: number };

type HintInput = {
  agentId: number;
  month: string;
  diff: number;
  /** this agent's stock (all months; only the neighbours of `month` are used) */
  stock: StockEntry[];
  /** this agent's months */
  months: AgentMonth[];
  /** this month's invoices */
  invoices: InvoiceRec[];
  /** products in this month's stock whose recorded price differs from the agent's price today */
  prices: PriceChange[];
};

const near = (x: number, target: number) => Math.abs(x - target) <= Math.max(MATCH, Math.abs(target) * 0.01);
const money = (n: number) => shekelSmart(Math.abs(n));

/** Possible reasons for a difference between the invoice and the stock, best first. */
export function invoiceHints(h: HintInput): Hint[] {
  const { agentId, month, diff, stock } = h;
  if (Math.abs(diff) < MATCH) return [];
  const prev = addMonthKey(month, -1);
  const next = addMonthKey(month, 1);
  const out: Hint[] = [];
  const used = new Set<string>();
  const add = (x: Hint) => {
    if (used.has(x.key)) return;
    used.add(x.key);
    out.push(x);
  };
  const stockLink = (e: StockEntry) => ({ to: `/stock/${e.id}`, label: 'לסחורה' });
  const returnsLink = (e: StockEntry) => ({ to: `/returns?invoice=${e.id}`, label: 'להחזרות' });
  // the last three days of the month
  const edgeFrom = iso(addDays(fromIso(monthLast(month)), -2));
  const lastDays = (d: string) => monthOf(d) === month && d >= edgeFrom;

  // 1. one entry that is exactly the difference (goods count after their own returns of the same month)
  for (const e of stock) {
    const gm = goodsMonth(e);
    const cm = creditMonth(e);
    const ownCredit = cm === gm ? e.credit : 0;
    const net = e.received - ownCredit;
    const after = c(ownCredit) !== 0 ? ', אחרי ההחזרות שלה' : '';
    if (gm === month && diff < 0 && c(net) > 0 && near(net, -diff)) {
      add({
        key: `g${e.id}`,
        strong: true,
        title: `הסחורה מ-${dm(e.date)} (${money(net)}${after}) – בדיוק ההפרש`,
        text: lastDays(e.date) ? `אולי הסוכן יחייב עליה בחשבונית של ${monthName(next)}.` : 'אולי הסוכן לא חייב עליה, או שהיא נרשמה פעמיים.',
        link: stockLink(e),
      });
    }
    if ((gm === prev || gm === next) && diff > 0 && c(net) > 0 && near(net, diff)) {
      add({
        key: `g${e.id}`,
        strong: true,
        title: `הסחורה מ-${dm(e.date)} (${money(net)}${after}) – בדיוק ההפרש`,
        text: `היא נרשמה על ${monthName(gm)}. אולי הסוכן חייב עליה כבר בחשבונית הזו.`,
        link: stockLink(e),
      });
    }
    if (c(e.credit) > 0 && cm === month && diff > 0 && near(e.credit, diff)) {
      add({
        key: `c${e.id}`,
        strong: true,
        title: `ההחזרות מ-${dm(e.returnsDate ?? e.date)} (${money(e.credit)}) – בדיוק ההפרש`,
        text: 'אולי הסוכן עוד לא הוריד אותן מהחשבונית. כדאי לשאול אותו.',
        link: returnsLink(e),
      });
    }
    if (c(e.credit) > 0 && cm === next && gm === month && diff < 0 && near(e.credit, -diff)) {
      add({
        key: `c${e.id}`,
        strong: true,
        title: `ההחזרות מ-${dm(e.returnsDate ?? e.date)} על סחורה מ-${dm(e.date)} (${money(e.credit)})`,
        text: `הן נרשמו על ${monthName(next)}, אבל הסוכן כנראה כבר הוריד אותן בחשבונית הזו.`,
        link: returnsLink(e),
      });
    }
  }

  // 2. the whole previous month, if it never got an invoice of its own
  const pm = h.months.find((m) => m.agentId === agentId && m.month === prev);
  if (pm && pm.invoiceCount === 0 && c(pm.compare) > 0 && diff > 0 && near(pm.compare, diff)) {
    add({
      key: 'prev-month',
      strong: true,
      title: `אולי החשבונית כוללת גם את ${monthName(prev)}`,
      text: `ל${monthName(prev)} עוד אין חשבונית, והמלאי שלו (${money(pm.compare)}) הוא בדיוק ההפרש. אם הסוכן חייב את שני החודשים יחד – רושמים ל${monthName(prev)} חשבונית של 0 ₪, והמלאי שלו ייבדק מול החשבונית הזו.`,
      link: { to: `/invoices/new?agent=${agentId}&month=${prev}&amount=0&from=check`, label: 'חשבונית 0 ₪' },
    });
  }

  // 3. VAT: the invoice is about 17–18% above the stock
  if (diff > 0) {
    const m = h.months.find((x) => x.agentId === agentId && x.month === month);
    const ratio = m && m.compare > 0 ? m.invoiced / m.compare : 0;
    if (ratio >= 1.165 && ratio <= 1.19) {
      add({
        key: 'vat',
        strong: true,
        title: `החשבונית גבוהה ב-${Math.round((ratio - 1) * 100)}% מהמלאי`,
        text: 'זה בערך מע״מ. אולי המחירים במחירון רשומים בלי מע״מ.',
        link: { to: '/catalog', label: 'למחירון' },
      });
    }
  }

  // 4. prices that changed since the goods were recorded
  const priceEffect = h.prices.reduce((s, p) => s + p.qty * (p.now - p.recorded), 0);
  const pricesExplain = h.prices.length > 0 && near(priceEffect, diff);
  for (const p of [...h.prices].sort((a, b) => Math.abs(b.qty * (b.now - b.recorded)) - Math.abs(a.qty * (a.now - a.recorded))).slice(0, 2)) {
    add({
      key: `p${p.productId}`,
      strong: pricesExplain,
      title: `המחיר של ${p.name} השתנה`,
      text: `בסחורה נרשם ${shekelSmart(p.recorded)} ליחידה, ועכשיו במחירון ${shekelSmart(p.now)}. אולי הסוכן חייב במחיר אחר.`,
      link: { to: `/product/${p.productId}`, label: 'למוצר' },
    });
  }

  // 5. returns that were never recorded make the stock too high
  if (diff < 0) {
    for (const e of stock.filter((x) => goodsMonth(x) === month && waitsForReturns(x)).slice(0, 2)) {
      add({
        key: `r${e.id}`,
        strong: false,
        title: `לא נרשמו החזרות על הסחורה מ-${dm(e.date)}`,
        text: 'אם הסוכן לקח החזרות – צריך לרשום אותן, ואז המלאי ירד.',
        link: returnsLink(e),
      });
    }
    // the same goods twice on one day
    const byDay = new Map<string, StockEntry[]>();
    for (const e of stock.filter((x) => goodsMonth(x) === month)) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
    for (const [d, list] of byDay) {
      if (list.length < 2) continue;
      add({ key: `dup${d}`, strong: false, title: `נרשמה סחורה פעמיים ב-${dm(d)}`, text: 'אולי אותה סחורה נרשמה פעמיים.', link: stockLink(list[1]) });
    }
  }

  // 6. the same invoice twice
  if (diff > 0) {
    const inv = h.invoices;
    for (let i = 0; i < inv.length; i++) {
      for (let j = i + 1; j < inv.length; j++) {
        if (Math.abs(inv[i].amount - inv[j].amount) < MATCH) {
          add({
            key: `dupinv${inv[j].id}`,
            strong: near(inv[j].amount, diff),
            title: 'רשומות שתי חשבוניות באותו סכום',
            text: 'אולי אותה חשבונית נרשמה פעמיים.',
            link: { to: `/invoices/${inv[j].id}?from=check`, label: 'לחשבונית' },
          });
        }
      }
    }
  }

  // 7. goods at the edge of the month (when nothing exact was found)
  if (!out.some((x) => x.strong)) {
    const edge = stock.filter((e) => {
      const gm = goodsMonth(e);
      if (gm === month) return lastDays(e.date);
      if (gm === next) return Number(e.date.slice(8)) <= 3;
      return false;
    });
    for (const e of edge.slice(0, 2)) {
      add({
        key: `g${e.id}`,
        strong: false,
        title: `סחורה מ-${dm(e.date)} – ${goodsMonth(e) === month ? 'בסוף החודש' : `בתחילת ${monthName(next)}`} (${money(e.received)})`,
        text: 'יכול להיות שהסוכן חייב עליה בחודש אחר.',
        link: stockLink(e),
      });
    }
  }

  // 8. small differences
  const m = h.months.find((x) => x.agentId === agentId && x.month === month);
  if (Math.abs(diff) <= Math.max(5, Math.abs(m?.compare ?? 0) * 0.005)) {
    add({ key: 'round', strong: false, title: 'הפרש קטן', text: 'אולי עיגול אגורות או הנחה קטנה.' });
  }

  // 9. nothing specific
  if (!out.some((x) => x.strong)) {
    if (diff > 0) {
      add({
        key: 'missing-goods',
        strong: false,
        title: 'אולי הגיעה סחורה שלא רשמתי',
        text: `בחשבונית יש ${money(diff)} יותר ממה שרשום במלאי.`,
        link: { to: `/stock/new?agent=${agentId}&date=${monthLast(month)}`, label: '+ קבלת סחורה' },
      });
    } else {
      add({
        key: 'missing-invoice',
        strong: false,
        title: `אולי יש על ${monthName(month)} עוד חשבונית`,
        text: `בחשבונית יש ${money(diff)} פחות ממה שרשום במלאי. אם הסוכן שלח שתי חשבוניות – רושמים גם את השנייה.`,
        link: { to: `/invoices/new?agent=${agentId}&month=${month}&from=check`, label: '+ חשבונית' },
      });
    }
  }

  return [...out.filter((x) => x.strong), ...out.filter((x) => !x.strong)];
}

/* ======================= money ledger (agent card, statement, payment confirmation) ======================= */

export type LedgerEntry = {
  key: string;
  /** goods / returns: stock of a month that has no invoice yet (it counts until the invoice arrives) */
  kind: 'invoice' | 'goods' | 'returns' | 'payment';
  /** invoice / payment id, or the stock entry's id for goods and returns */
  id: number;
  date: string;
  /** + raises what I owe, − lowers it */
  amount: number;
  /** invoices: the month of goods it bills; goods / returns: the month they count in */
  month?: string;
  /** what I owe the agent right after this entry, stock of un-invoiced months included (negative = he owes me) */
  balance: number;
  /** the same without that stock (only what was billed) */
  billed: number;
  number?: string | null;
  method?: string | null;
  note?: string | null;
  /** goods: recorded as one sum / product lines; returns: credit given as a sum */
  manual?: boolean;
  productCount?: number;
  /** goods still waiting for their returns */
  pendingReturns?: boolean;
  /** returns: the date of the goods they came back from */
  goodsDate?: string;
};

export const isStock = (e: LedgerEntry) => e.kind === 'goods' || e.kind === 'returns';

/**
 * Invoices, the stock of months that have no invoice yet (each delivery and return on its own date),
 * and payments – oldest first, with running balances.
 */
export function buildLedger(months: AgentMonth[], stock: StockEntry[], invoices: InvoiceRec[], payments: PaymentRec[]): LedgerEntry[] {
  // months whose stock is covered by an invoice (a 0 ₪ month counts as covered only once the next month has one)
  const byKey = new Map(months.map((m) => [`${m.agentId}|${m.month}`, m]));
  const covered = (m: AgentMonth): boolean => {
    if (m.source !== 'invoice') return false;
    if (!m.mergedInto) return true;
    const next = byKey.get(`${m.agentId}|${m.mergedInto}`);
    return !!next && covered(next);
  };
  const billedMonth = new Set(months.filter(covered).map((m) => `${m.agentId}|${m.month}`));
  const out: LedgerEntry[] = [];
  for (const i of invoices) {
    out.push({ key: `i${i.id}`, kind: 'invoice', id: i.id, date: i.date, amount: i.amount, month: i.month, balance: 0, billed: 0, number: i.number, note: i.note });
  }
  for (const e of stock) {
    const gm = goodsMonth(e);
    if (!billedMonth.has(`${e.agentId}|${gm}`)) {
      out.push({
        key: `g${e.id}`,
        kind: 'goods',
        id: e.id,
        date: e.date,
        amount: e.received,
        month: gm,
        balance: 0,
        billed: 0,
        note: e.note,
        manual: e.manual,
        productCount: e.lines,
        pendingReturns: waitsForReturns(e),
      });
    }
    const cm = creditMonth(e);
    if (c(e.credit) !== 0 && !billedMonth.has(`${e.agentId}|${cm}`)) {
      out.push({
        key: `r${e.id}`,
        kind: 'returns',
        id: e.id,
        date: e.returnsDate ?? e.date,
        amount: -e.credit,
        month: cm,
        balance: 0,
        billed: 0,
        goodsDate: e.date,
      });
    }
  }
  for (const p of payments) {
    out.push({ key: `p${p.id}`, kind: 'payment', id: p.id, date: p.date, amount: -p.amount, balance: 0, billed: 0, method: p.method, note: p.note });
  }
  // on one day: goods arrive, then returns, then the invoice, then the payment
  const order = { goods: 0, returns: 1, invoice: 2, payment: 3 };
  out.sort((a, b) => (a.date === b.date ? order[a.kind] - order[b.kind] || a.id - b.id : a.date < b.date ? -1 : 1));
  let all = 0;
  let billed = 0;
  for (const e of out) {
    all += c(e.amount);
    if (!isStock(e)) billed += c(e.amount);
    e.balance = fromC(all);
    e.billed = fromC(billed);
  }
  return out;
}

/* ======================= old data (before version 4) ======================= */

type Row = Record<string, unknown>;

/**
 * Before 1.0.15 there were no agent invoices: some agents' monthly invoice was typed in as one sum.
 * An agent whose entries are all sums, at most one a month, gets those as invoices for the month before
 * their date (the amount after any credit, so what I owe stays the same). Everyone else stays as stock.
 * The database migration (schema v4) does the same in SQL; this one is for restoring an old backup.
 */
export function convertLegacyTables(tables: Record<string, Row[]>): Record<string, Row[]> {
  const deliveries = tables.deliveries ?? [];
  const lines = tables.delivery_lines ?? [];
  const byAgent = new Map<number, Row[]>();
  for (const d of deliveries) byAgent.set(Number(d.agent_id), [...(byAgent.get(Number(d.agent_id)) ?? []), d]);
  const convert = new Set<number>();
  for (const [agentId, list] of byAgent) {
    if (list.some((d) => d.manual_amount == null)) continue;
    const perMonth = new Map<string, number>();
    for (const d of list) perMonth.set(String(d.delivery_date).slice(0, 7), (perMonth.get(String(d.delivery_date).slice(0, 7)) ?? 0) + 1);
    if ([...perMonth.values()].every((n) => n <= 1)) convert.add(agentId);
  }
  if (convert.size === 0) return tables;
  const moved = deliveries.filter((d) => convert.has(Number(d.agent_id)));
  const movedIds = new Set(moved.map((d) => Number(d.id)));
  let nextId = Math.max(0, ...(tables.agent_invoices ?? []).map((r) => Number(r.id) || 0)) + 1;
  const invoices: Row[] = moved
    .sort((a, b) => String(a.delivery_date).localeCompare(String(b.delivery_date)) || Number(a.id) - Number(b.id))
    .map((d) => {
      const received = Number(d.manual_amount ?? 0);
      const credit = d.manual_credit != null ? Number(d.manual_credit) : 0;
      const note = `${d.note ?? ''}${credit > 0 ? ` (כולל זיכוי החזרות ${credit.toFixed(2)})` : ''}`.trim();
      return {
        id: nextId++,
        agent_id: d.agent_id,
        month: addMonthKey(String(d.delivery_date).slice(0, 7), -1),
        date: d.delivery_date,
        amount: c(received - credit) / 100,
        number: null,
        note: note || null,
      };
    });
  return {
    ...tables,
    deliveries: deliveries.filter((d) => !movedIds.has(Number(d.id))),
    delivery_lines: lines.filter((l) => !movedIds.has(Number(l.delivery_id))),
    agent_invoices: [...(tables.agent_invoices ?? []), ...invoices],
  };
}
