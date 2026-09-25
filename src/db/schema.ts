/**
 * Database migrations. Each entry runs once, in order, and bumps PRAGMA user_version.
 * Never edit an entry that has shipped — add a new one instead.
 */
export const MIGRATIONS: string[] = [
  // v1 — full schema
  `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT,
    sort INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    color TEXT,
    delivery_day INTEGER,
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category_id INTEGER REFERENCES categories(id),
    image TEXT,
    sale_price REAL NOT NULL DEFAULT 0,
    returnable INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS agent_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    cost_price REAL NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE (agent_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    agent_id INTEGER REFERENCES agents(id),
    kind TEXT NOT NULL CHECK (kind IN ('cost', 'sale')),
    price REAL NOT NULL,
    changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    week_start TEXT NOT NULL,
    delivery_date TEXT NOT NULL,
    returns_date TEXT,
    returns_done INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    UNIQUE (agent_id, week_start)
  );

  CREATE TABLE IF NOT EXISTS delivery_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_id INTEGER NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty_received REAL NOT NULL DEFAULT 0,
    qty_returned REAL NOT NULL DEFAULT 0,
    unit_cost REAL NOT NULL,
    returnable INTEGER NOT NULL,
    UNIQUE (delivery_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS payment_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS daily_income (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    method_id INTEGER NOT NULL REFERENCES payment_methods(id),
    amount REAL NOT NULL DEFAULT 0,
    UNIQUE (date, method_id)
  );

  CREATE TABLE IF NOT EXISTS expense_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    type_id INTEGER REFERENCES expense_types(id),
    amount REAL NOT NULL,
    note TEXT
  );

  CREATE TABLE IF NOT EXISTS agent_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    method TEXT,
    note TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_deliveries_week ON deliveries (week_start);
  CREATE INDEX IF NOT EXISTS idx_deliveries_date ON deliveries (delivery_date);
  CREATE INDEX IF NOT EXISTS idx_income_date ON daily_income (date);
  CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (date);
  CREATE INDEX IF NOT EXISTS idx_payments_agent ON agent_payments (agent_id, date);

  INSERT INTO payment_methods (name, sort) VALUES ('מזומן', 1), ('אשראי', 2), ('אחר', 3);
  `,
];
