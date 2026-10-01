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

  // v2 — a delivery or its returns can be recorded as one sum instead of per product
  `
  ALTER TABLE deliveries ADD COLUMN manual_amount REAL;
  ALTER TABLE deliveries ADD COLUMN manual_credit REAL;
  ALTER TABLE deliveries ADD COLUMN manual_returnable INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE deliveries ADD COLUMN note TEXT;

  CREATE VIEW IF NOT EXISTS delivery_totals AS
  SELECT d.id, d.agent_id, d.week_start, d.delivery_date, d.returns_done, d.returns_date,
         d.manual_amount, d.manual_credit, d.manual_returnable, d.note,
         COALESCE(d.manual_amount, (SELECT SUM(l.qty_received * l.unit_cost) FROM delivery_lines l WHERE l.delivery_id = d.id), 0) AS received,
         COALESCE(d.manual_credit, (SELECT SUM(l.qty_returned * l.unit_cost) FROM delivery_lines l WHERE l.delivery_id = d.id), 0) AS credit,
         (SELECT COUNT(*) FROM delivery_lines l WHERE l.delivery_id = d.id AND l.qty_received > 0) AS lines,
         CASE WHEN d.manual_amount IS NOT NULL THEN d.manual_returnable
              ELSE (SELECT COUNT(*) FROM delivery_lines l WHERE l.delivery_id = d.id AND l.returnable = 1 AND l.qty_received > 0) END AS returnable_lines
    FROM deliveries d;
  `,

  // v3 — monthly: any number of invoices per agent (no more one-per-week), recurring and workers' expenses.
  // Rebuilding "deliveries" drops the old table; with foreign keys on, that cascades to its lines, so the
  // lines are copied aside first and put back after. The _guard row fails the whole step if anything is missing.
  `
  CREATE TEMP TABLE _lines AS SELECT * FROM delivery_lines;
  CREATE TEMP TABLE _count AS SELECT (SELECT COUNT(*) FROM delivery_lines) AS lines, (SELECT COUNT(*) FROM deliveries) AS dels;
  DROP VIEW IF EXISTS delivery_totals;
  CREATE TABLE deliveries_v3 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    week_start TEXT NOT NULL,
    delivery_date TEXT NOT NULL,
    returns_date TEXT,
    returns_done INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    manual_amount REAL,
    manual_credit REAL,
    manual_returnable INTEGER NOT NULL DEFAULT 1,
    note TEXT
  );
  INSERT INTO deliveries_v3 (id, agent_id, week_start, delivery_date, returns_date, returns_done, notes, manual_amount, manual_credit, manual_returnable, note)
    SELECT id, agent_id, week_start, delivery_date, returns_date, returns_done, notes, manual_amount, manual_credit, manual_returnable, note FROM deliveries;
  DROP TABLE deliveries;
  ALTER TABLE deliveries_v3 RENAME TO deliveries;
  INSERT OR IGNORE INTO delivery_lines SELECT * FROM _lines;
  CREATE INDEX IF NOT EXISTS idx_deliveries_week ON deliveries (week_start);
  CREATE INDEX IF NOT EXISTS idx_deliveries_date ON deliveries (delivery_date);
  CREATE INDEX IF NOT EXISTS idx_deliveries_agent ON deliveries (agent_id, delivery_date);
  CREATE TEMP TABLE _guard (ok INTEGER CHECK (ok = 1));
  INSERT INTO _guard SELECT ((SELECT COUNT(*) FROM delivery_lines) = (SELECT lines FROM _count)) AND ((SELECT COUNT(*) FROM deliveries) = (SELECT dels FROM _count));
  DROP TABLE _guard;
  DROP TABLE _count;
  DROP TABLE _lines;

  CREATE VIEW delivery_totals AS
  SELECT d.id, d.agent_id, d.week_start, d.delivery_date, d.returns_done, d.returns_date,
         d.manual_amount, d.manual_credit, d.manual_returnable, d.note,
         COALESCE(d.manual_amount, (SELECT SUM(l.qty_received * l.unit_cost) FROM delivery_lines l WHERE l.delivery_id = d.id), 0) AS received,
         COALESCE(d.manual_credit, (SELECT SUM(l.qty_returned * l.unit_cost) FROM delivery_lines l WHERE l.delivery_id = d.id), 0) AS credit,
         (SELECT COUNT(*) FROM delivery_lines l WHERE l.delivery_id = d.id AND l.qty_received > 0) AS lines,
         CASE WHEN d.manual_amount IS NOT NULL THEN d.manual_returnable
              ELSE (SELECT COUNT(*) FROM delivery_lines l WHERE l.delivery_id = d.id AND l.returnable = 1 AND l.qty_received > 0) END AS returnable_lines
    FROM deliveries d;

  CREATE TABLE IF NOT EXISTS recurring_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_id INTEGER REFERENCES expense_types(id),
    amount REAL NOT NULL,
    note TEXT,
    start_month TEXT NOT NULL,
    end_month TEXT
  );
  ALTER TABLE expenses ADD COLUMN recurring_id INTEGER REFERENCES recurring_expenses(id);
  ALTER TABLE expenses ADD COLUMN kind TEXT NOT NULL DEFAULT 'general';
  CREATE INDEX IF NOT EXISTS idx_expenses_recurring ON expenses (recurring_id, date);
  `,
];
