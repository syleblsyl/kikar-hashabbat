import { getSetting, setSetting } from './repo';
import { query, runSet } from './sqlite';
import { MIGRATIONS } from './schema';
import { fromIso, iso, today } from '../lib/dates';

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
// belong to this phone, not to the store's data
const PRIVATE_SETTINGS = ['pin_hash', 'pin_salt', 'lock_on', 'pin_fails', 'pin_wait_until'];

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
  return today().getTime() - fromIso(last).getTime() > 7 * 24 * 3600 * 1000;
}

export class BackupError extends Error {
  constructor(public reason: 'not-backup' | 'newer' | 'broken') {
    super(reason);
  }
}

/** Reads a backup file and checks that it really is one, from this app, that this version can read. */
export function parseBackup(text: string): Backup {
  let b: Backup;
  try {
    b = JSON.parse(text) as Backup;
  } catch {
    throw new BackupError('not-backup');
  }
  if (!b || typeof b !== 'object' || b.app !== 'kikar-hashabbat' || !b.tables || typeof b.tables !== 'object') throw new BackupError('not-backup');
  if (b.format !== 1 || !Number.isInteger(b.schema)) throw new BackupError('broken');
  if (b.schema > MIGRATIONS.length) throw new BackupError('newer');
  if (!b.created_at || Number.isNaN(new Date(b.created_at).getTime())) throw new BackupError('broken');
  for (const t of TABLES) {
    const rows = b.tables[t];
    if (rows !== undefined && (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== 'object'))) throw new BackupError('broken');
  }
  if (!Array.isArray(b.tables.agents) || !Array.isArray(b.tables.products)) throw new BackupError('broken');
  return b;
}

/** Replaces all data with the backup's (the PIN stays as it is on this phone). */
export async function restoreBackup(b: Backup) {
  // only columns that exist in this version's tables (an older backup may have fewer)
  const known = new Map<string, Set<string>>();
  for (const t of TABLES) {
    const cols = await query<{ name: string }>(`PRAGMA table_info(${t})`);
    known.set(t, new Set(cols.map((c) => c.name)));
  }
  const set: { statement: string; values?: unknown[] }[] = [];
  for (const t of [...TABLES].reverse()) {
    set.push({ statement: t === 'settings' ? `DELETE FROM settings WHERE key NOT IN (${PRIVATE_SETTINGS.map((k) => `'${k}'`).join(', ')})` : `DELETE FROM ${t}` });
  }
  for (const t of TABLES) {
    for (const row of b.tables[t] ?? []) {
      if (t === 'settings' && PRIVATE_SETTINGS.includes(String(row.key))) continue;
      const cols = Object.keys(row).filter((c) => /^[a-z_]+$/.test(c) && known.get(t)?.has(c));
      if (cols.length === 0) continue;
      set.push({
        statement: `INSERT OR REPLACE INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        values: cols.map((c) => row[c]),
      });
    }
  }
  // the phone now holds exactly what is in the backup file, so there is nothing new to back up
  set.push({
    statement: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    values: ['last_backup', iso(today())],
  });
  await runSet(set);
}
