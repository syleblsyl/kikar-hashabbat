const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const upTo2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

const NBSP = ' ';
// U+2066 … U+2069 isolate the signed number so the minus stays attached to it inside Hebrew text
const iso = (s: string) => `⁦${s}⁩`;

/** Rounds half away from zero, after clearing floating-point noise (29595.499999999996 → 29595.5 → 29596). */
export function roundMoney(n: number, digits = 0): number {
  const f = 10 ** digits;
  const clean = Math.round(n * 100000) / 100000;
  return (Math.sign(clean) * Math.round(Math.abs(clean) * f + 1e-9)) / f;
}

/** 15110 → "15,110 ₪"; signed: +1,200 ₪ / -1,200 ₪ */
export function shekel(n: number, opts: { signed?: boolean } = {}): string {
  const r = roundMoney(n);
  const sign = r < 0 ? '-' : opts.signed && r > 0 ? '+' : '';
  return `${iso(sign + whole.format(Math.abs(r)))}${NBSP}₪`;
}

/** 8.5 → "8.50 ₪" (prices) */
export function shekelCents(n: number, opts: { signed?: boolean } = {}): string {
  const r = roundMoney(n, 2);
  const sign = r < 0 ? '-' : opts.signed && r > 0 ? '+' : '';
  return `${iso(sign + cents.format(Math.abs(r)))}${NBSP}₪`;
}

/** Totals: whole shekels when round, otherwise agorot. 2571 → "2,571 ₪", 2571.5 → "2,571.50 ₪" */
export function shekelSmart(n: number, opts: { signed?: boolean } = {}): string {
  const r = roundMoney(n, 2);
  return Number.isInteger(r) ? shekel(r, opts) : shekelCents(r, opts);
}

/** Quantity for display: 7.5 → "7.5", 20 → "20" */
export function qty(n: number): string {
  return upTo2.format(n);
}

/**
 * Reads a typed amount. Accepts "1,250", "1250.5", "12,5" / "12,50" (comma as decimal point), "₪ 90".
 * Returns null when the text is not a valid non-negative number.
 */
export function parseAmountStrict(v: string): number | null {
  let s = String(v ?? '').replace(/[₪\s ⁦-⁩]/g, '');
  if (s === '') return 0;
  // a single comma followed by 1–2 digits at the end, and no dot → decimal comma
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,(?=\d{3}(\D|$))/g, '');
  if (!/^\d+(\.\d*)?$/.test(s)) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) && n <= 1e9 ? n : null;
}

/** Lenient version for places that only need a number: invalid → 0. */
export function parseAmount(v: string): number {
  return parseAmountStrict(v) ?? 0;
}

/** 1 -> "מוצר אחד", 5 -> "5 מוצרים" */
export function products(n: number): string {
  return n === 1 ? 'מוצר אחד' : `${n} מוצרים`;
}
