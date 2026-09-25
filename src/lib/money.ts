const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 15110 -> "15,110 ₪" */
export function shekel(n: number): string {
  const r = Math.round(n);
  // U+2066/U+2069 isolate the signed number so the minus stays attached in RTL text
  return `\u2066${r < 0 ? '-' : ''}${whole.format(Math.abs(r))}\u2069 ₪`;
}

/** 8.5 -> "8.50 ₪" */
export function shekelCents(n: number): string {
  return `\u2066${n < 0 ? '-' : ''}${cents.format(Math.abs(n))}\u2069 ₪`;
}

export function parseAmount(v: string): number {
  const n = parseFloat(String(v).replace(/[,₪\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** 1 -> "מוצר אחד", 5 -> "5 מוצרים" */
export function products(n: number): string {
  return n === 1 ? 'מוצר אחד' : `${n} מוצרים`;
}
