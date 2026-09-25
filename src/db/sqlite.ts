import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import { MIGRATIONS } from './schema';

const DB_NAME = 'kikar';
const sqlite = new SQLiteConnection(CapacitorSQLite);
const isWeb = Capacitor.getPlatform() === 'web';

let db: SQLiteDBConnection | null = null;
let opening: Promise<SQLiteDBConnection> | null = null;

async function initWebStore() {
  const { defineCustomElements } = await import('jeep-sqlite/loader');
  await defineCustomElements(window);
  if (!document.querySelector('jeep-sqlite')) {
    const el = document.createElement('jeep-sqlite');
    el.setAttribute('autosave', 'true');
    document.body.appendChild(el);
  }
  await customElements.whenDefined('jeep-sqlite');
  await sqlite.initWebStore();
}

async function migrate(conn: SQLiteDBConnection) {
  const res = await conn.query('PRAGMA user_version;');
  const current = Number(res.values?.[0]?.user_version ?? 0);
  for (let v = current; v < MIGRATIONS.length; v++) {
    await conn.execute(MIGRATIONS[v], true);
    await conn.execute(`PRAGMA user_version = ${v + 1};`, false);
  }
}

async function openDb(): Promise<SQLiteDBConnection> {
  if (isWeb) await initWebStore();
  await sqlite.checkConnectionsConsistency().catch(() => undefined);
  const exists = (await sqlite.isConnection(DB_NAME, false)).result;
  const conn = exists
    ? await sqlite.retrieveConnection(DB_NAME, false)
    : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
  await conn.open();
  await conn.execute('PRAGMA foreign_keys = ON;', false);
  await migrate(conn);
  await persist();
  return conn;
}

export async function getDb(): Promise<SQLiteDBConnection> {
  if (db) return db;
  if (!opening) {
    opening = openDb().then((c) => {
      db = c;
      return c;
    });
  }
  return opening;
}

/** On web the database lives in memory until saved to IndexedDB. */
export async function persist() {
  if (isWeb) await sqlite.saveToStore(DB_NAME).catch(() => undefined);
}

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const conn = await getDb();
  const res = await conn.query(sql, params as never[]);
  return (res.values ?? []) as T[];
}

export async function run(sql: string, params: unknown[] = []): Promise<{ changes: number; lastId: number }> {
  const conn = await getDb();
  const res = await conn.run(sql, params as never[], true);
  await persist();
  return { changes: res.changes?.changes ?? 0, lastId: res.changes?.lastId ?? 0 };
}

/** Runs many statements in one transaction (fast, all-or-nothing). */
export async function runSet(set: { statement: string; values?: unknown[] }[]) {
  if (set.length === 0) return;
  const conn = await getDb();
  await conn.executeSet(set.map((s) => ({ statement: s.statement, values: (s.values ?? []) as never[] })), true);
  await persist();
}
