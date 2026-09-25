import type { MonthReport } from '../db/report';
import { DAY_NAMES, fromIso, MONTHS } from './dates';
import { hebDate, weekInfo } from './hebrew';

const MONEY = '#,##0.00 "₪"';
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7A2A1C' } } as const;
const TITLE_FONT = { name: 'Arial', size: 16, bold: true, color: { argb: 'FF7A2A1C' } };

const dmy = (s: string) => {
  const d = fromIso(s);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
};

/** Builds a right-to-left Excel workbook for the month. */
export async function buildMonthWorkbook(r: MonthReport): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'כיכר השבת';
  wb.created = new Date();
  const title = `כיכר השבת – דוח ${MONTHS[r.month]} ${r.year} (${r.hebMonths})`;

  type Col = { header: string; key: string; width: number; money?: boolean };
  function sheet(name: string, cols: Col[], rows: Record<string, unknown>[], totals?: Record<string, unknown>) {
    const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 3 }] });
    ws.getCell('A1').value = title;
    ws.getCell('A1').font = TITLE_FONT;
    ws.getRow(2).height = 6;
    ws.columns = cols.map((c) => ({ key: c.key, width: c.width }));
    const head = ws.getRow(3);
    cols.forEach((c, i) => {
      const cell = head.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = HEAD_FILL;
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    head.height = 22;
    for (const row of rows) ws.addRow(row);
    if (totals) {
      const t = ws.addRow(totals);
      t.font = { bold: true };
      t.eachCell((c) => (c.border = { top: { style: 'thin' } }));
    }
    cols.forEach((c, i) => {
      if (c.money) ws.getColumn(i + 1).numFmt = MONEY;
    });
    return ws;
  }

  // 1. summary
  const sum = sheet(
    'סיכום',
    [
      { header: 'נושא', key: 'k', width: 34 },
      { header: 'סכום', key: 'v', width: 18, money: true },
    ],
    [
      { k: 'הכנסות', v: r.income },
      ...r.byMethod.map((m) => ({ k: `   ${m.name}`, v: m.total })),
      { k: 'סחורה שהגיעה (מחיר קנייה)', v: r.received },
      { k: 'זיכוי מהחזרות', v: -r.credit },
      { k: 'עלות סחורה נטו', v: r.goodsNet },
      { k: 'הוצאות כלליות', v: r.expenses },
      ...r.byType.map((t) => ({ k: `   ${t.name}`, v: t.total })),
      { k: 'רווח נקי', v: r.net },
      { k: 'שולם לסוכנים החודש', v: r.paid },
    ],
  );
  sum.eachRow((row, n) => {
    if (n > 3 && String(row.getCell(1).value).startsWith('רווח נקי')) row.font = { bold: true, size: 13 };
  });
  sum.addRow({});
  const wh = sum.addRow({ k: 'לפי שבועות' });
  wh.font = { bold: true, size: 13 };
  const hdr = sum.addRow(['שבוע', 'הכנסות', 'סחורה נטו', 'הוצאות', 'רווח נקי']);
  hdr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hdr.eachCell((c) => (c.fill = HEAD_FILL));
  for (const w of r.weeks) {
    const row = sum.addRow([`${w.title} (${dmy(w.from)}–${dmy(w.to)})`, w.income, w.goods, w.expenses, w.net]);
    [2, 3, 4, 5].forEach((i) => (row.getCell(i).numFmt = MONEY));
  }
  [3, 4, 5].forEach((i) => (sum.getColumn(i).width = 16));

  // 2. daily income
  sheet(
    'הכנסות יומיות',
    [
      { header: 'תאריך', key: 'date', width: 13 },
      { header: 'יום', key: 'day', width: 9 },
      { header: 'תאריך עברי', key: 'heb', width: 18 },
      ...r.methods.map((m, i) => ({ header: m, key: `m${i}`, width: 14, money: true })),
      { header: 'סה״כ', key: 'total', width: 15, money: true },
    ],
    r.daily.map((d) => ({
      date: dmy(d.date),
      day: DAY_NAMES[fromIso(d.date).getDay()],
      heb: hebDate(fromIso(d.date)),
      ...Object.fromEntries(r.methods.map((m, i) => [`m${i}`, d.amounts[m] ?? 0])),
      total: d.total,
    })),
    { date: 'סה״כ', ...Object.fromEntries(r.byMethod.map((m, i) => [`m${i}`, m.total])), total: r.income },
  );

  // 3. deliveries
  sheet(
    'אספקות',
    [
      { header: 'תאריך', key: 'date', width: 12 },
      { header: 'שבוע', key: 'week', width: 20 },
      { header: 'סוכן', key: 'agent', width: 18 },
      { header: 'מוצר', key: 'product', width: 22 },
      { header: 'הגיע', key: 'received', width: 8 },
      { header: 'הוחזר', key: 'returned', width: 8 },
      { header: 'נמכר', key: 'sold', width: 8 },
      { header: 'מחיר קנייה', key: 'cost', width: 12, money: true },
      { header: 'עלות נטו', key: 'net', width: 14, money: true },
      { header: 'הערה', key: 'note', width: 16 },
    ],
    r.deliveryRows.map((l) => ({
      date: dmy(l.date),
      week: weekInfo(fromIso(l.weekStart)).title,
      agent: l.agent,
      product: l.product,
      received: l.received,
      returned: l.returned,
      sold: l.received - l.returned,
      cost: l.unitCost,
      net: (l.received - l.returned) * l.unitCost,
      note: !l.returnable ? 'ללא החזרה' : !l.returnsDone ? 'החזרות לא נרשמו' : '',
    })),
    { date: 'סה״כ', net: r.goodsNet },
  );

  // 4. agents
  sheet(
    'לפי סוכן',
    [
      { header: 'סוכן', key: 'name', width: 22 },
      { header: 'סחורה שהגיעה', key: 'received', width: 15, money: true },
      { header: 'זיכוי החזרות', key: 'returned', width: 15, money: true },
      { header: 'עלות נטו', key: 'net', width: 15, money: true },
      { header: 'שולם החודש', key: 'paid', width: 15, money: true },
    ],
    r.agents.map((a) => ({ name: a.name, received: a.received, returned: a.returned, net: a.net, paid: a.paid })),
    { name: 'סה״כ', received: r.received, returned: r.credit, net: r.goodsNet, paid: r.paid },
  );

  // 5. products
  sheet(
    'לפי מוצר',
    [
      { header: 'מוצר', key: 'name', width: 24 },
      { header: 'הגיע', key: 'received', width: 10 },
      { header: 'הוחזר', key: 'returned', width: 10 },
      { header: 'נמכר', key: 'sold', width: 10 },
      { header: 'עלות נטו', key: 'cost', width: 15, money: true },
    ],
    r.products.map((p) => ({ name: p.name, received: p.received, returned: p.returned, sold: p.sold, cost: p.cost })),
  );

  // 6. expenses
  sheet(
    'הוצאות',
    [
      { header: 'תאריך', key: 'date', width: 12 },
      { header: 'סוג', key: 'type', width: 18 },
      { header: 'סכום', key: 'amount', width: 14, money: true },
      { header: 'הערה', key: 'note', width: 30 },
    ],
    r.expenseRows.map((e) => ({ date: dmy(e.date), type: e.type, amount: e.amount, note: e.note })),
    { date: 'סה״כ', amount: r.expenses },
  );

  // 7. payments to agents
  sheet(
    'תשלומים לסוכנים',
    [
      { header: 'תאריך', key: 'date', width: 12 },
      { header: 'סוכן', key: 'agent', width: 22 },
      { header: 'סכום', key: 'amount', width: 14, money: true },
      { header: 'אמצעי', key: 'method', width: 12 },
      { header: 'הערה', key: 'note', width: 28 },
    ],
    r.paymentRows.map((p) => ({ ...p, date: dmy(p.date) })),
    { date: 'סה״כ', amount: r.paid },
  );

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
