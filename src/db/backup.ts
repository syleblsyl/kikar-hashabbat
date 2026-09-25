import { getSetting, setSetting } from './repo';
import { query, runSet } from './sqlite';
import { iso, today } from '../lib/dates';

// parents before children, so a restore can insert in this order
const TABLES = [
  'categories',
  'agents',
  'products',
  'agent_products',
  'price_history',
  'payment_methods',
  'expense_types',
  'deliveries',
  'delivery_lines',
  'daily_income',
  'expenses',
  'agent_payments',
  'settings',
];
const PRIVATE_SETTINGS = ['pin_hash', 'pin_salt'];

export type Backup = {
  app: 'kikar-hashabbat';
  format: 1;
  schema: number;
  created_at: string;
  tables: Record<string, Record<string, unknown>[]>;
};

export async function makeBackup(): Promise<Backup> {
  const [{ user_version }] = await query<{ user_version: number }>('PRAGMA user_version;');
  const tables: Backup['tables'] = {};
  for (const t of TABLES) {
    let rows = await query<Record<string, unknown>>(`SELECT * FROM ${t}`);
    if (t === 'settings') rows = rows.filter((r) => !PRIVATE_SETTINGS.includes(String(r.key)));
    tables[t] = rows;
  }
  return { app: 'kikar-hashabbat', format: 1, schema: Number(user_version), created_at: new Date().toISOString(), tables };
}

export function backupStats(b: Backup) {
  const n = (t: string) => b.tables[t]?.length ?? 0;
  return { products: n('products'), agents: n('agents'), deliveries: n('deliveries'), days: new Set((b.tables.daily_income ?? []).map((r) => r.date)).size };
}

export async function markBackedUp() {
  await setSetting('last_backup', iso(today()));
}

export async function lastBackup(): Promise<string | null> {
  return getSetting('last_backup');
}

/** True when there is data worth protecting and the last backup is older than a week. */
export async function backupDue(): Promise<boolean> {
  const [row] = await query<{ n: number }>('SELECT (SELECT COUNT(*) FROM deliveries) + (SELECT COUNT(*) FROM daily_income) AS n');
  if (Number(row?.n ?? 0) === 0) return false;
  const last = await lastBackup();
  if (!last) return true;
  return Date.now() - new Date(last).getTime() > 7 * 24 * 3600 * 1000;
}

export function parseBackup(text: string): Backup {
  const b = JSON.parse(text) as Backup;
  if (b?.app !== 'kikar-hashabbat' || !b.tables) throw new Error('not a backup');
  return b;
}

/** Replaces all data with the backup's (the PIN stays as it is on this phone). */
export async function restoreBackup(b: Backup) {
  const set: { statement: string; values?: unknown[] }[] = [];
  for (const t of [...TABLES].reverse()) {
    set.push({ statement: t === 'settings' ? `DELETE FROM settings WHERE key NOT IN ('pin_hash', 'pin_salt')` : `DELETE FROM ${t}` });
  }
  for (const t of TABLES) {
    for (const row of b.tables[t] ?? []) {
      if (t === 'settings' && PRIVATE_SETTINGS.includes(String(row.key))) continue;
      const cols = Object.keys(row).filter((c) => /^[a-z_]+$/.test(c));
      set.push({
        statement: `INSERT OR REPLACE INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        values: cols.map((c) => row[c]),
      });
    }
  }
  await runSet(set);
}
