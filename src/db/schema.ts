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

  // v4 — monthly invoices from agents (billed per month of goods) next to the stock, and "checked" differences.
  // Agents whose entries were all one-a-month sums had their invoice typed in as stock: those become invoices
  // for the month before (see convertLegacyTables in money.ts, which does the same for old backups).
  // Written for both SQL runners: no comments, no ";" or line breaks inside quotes, every line indented
  // (on the web a script with DELETE FROM is joined into one line), and a guard that fails the whole step
  // if any agent's total would change.
  `
  CREATE TABLE agent_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    number TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_agent_invoices_agent ON agent_invoices (agent_id, month);
  CREATE INDEX idx_agent_invoices_month ON agent_invoices (month);
  CREATE TABLE invoice_checks (
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    month TEXT NOT NULL,
    diff REAL NOT NULL,
    checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (agent_id, month)
  );
  CREATE INDEX IF NOT EXISTS idx_deliveries_returns ON deliveries (returns_date);
  CREATE TEMP TABLE _v4_before AS SELECT agent_id, SUM(received - credit) AS total FROM delivery_totals GROUP BY agent_id;
  CREATE TEMP TABLE _v4_conv AS
    SELECT agent_id FROM deliveries GROUP BY agent_id
    HAVING SUM(CASE WHEN manual_amount IS NULL THEN 1 ELSE 0 END) = 0
       AND agent_id NOT IN (SELECT agent_id FROM deliveries GROUP BY agent_id, substr(delivery_date, 1, 7) HAVING COUNT(*) > 1);
  INSERT INTO agent_invoices (agent_id, month, date, amount, number, note)
    SELECT t.agent_id, strftime('%Y-%m', t.delivery_date, 'start of month', '-1 month'), t.delivery_date, t.received - t.credit, NULL,
           NULLIF(trim(COALESCE(t.note, '') || CASE WHEN t.credit > 0 THEN ' (כולל זיכוי החזרות ' || printf('%.2f', t.credit) || ')' ELSE '' END), '')
      FROM delivery_totals t
     WHERE t.agent_id IN (SELECT agent_id FROM _v4_conv)
     ORDER BY t.delivery_date, t.id;
  DELETE FROM delivery_lines WHERE delivery_id IN (SELECT id FROM deliveries WHERE agent_id IN (SELECT agent_id FROM _v4_conv));
  DELETE FROM deliveries WHERE agent_id IN (SELECT agent_id FROM _v4_conv);
  CREATE TEMP TABLE _v4_guard (ok INTEGER CHECK (ok = 1));
  INSERT INTO _v4_guard SELECT NOT EXISTS (
    SELECT 1 FROM _v4_before b
     WHERE abs(b.total
       - COALESCE((SELECT SUM(t.received - t.credit) FROM delivery_totals t WHERE t.agent_id = b.agent_id), 0)
       - COALESCE((SELECT SUM(i.amount) FROM agent_invoices i WHERE i.agent_id = b.agent_id), 0)) > 0.005);
  DROP TABLE _v4_guard;
  DROP TABLE _v4_conv;
  DROP TABLE _v4_before;
  `,

  // v5 — daily income per source: the store and the mikveh, each with its own cash / card amounts.
  // daily_income has no children, so it is rebuilt directly; the guard fails the step if a row went missing.
  // "אחר" is hidden when it was never used (the income screen shows cash and card only).
  `
  CREATE TABLE income_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );
  INSERT INTO income_sources (id, name, sort) VALUES (1, 'חנות כיכר השבת', 1), (2, 'מקווה ויזניץ', 2);
  CREATE TEMP TABLE _v5_count AS SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM daily_income;
  CREATE TABLE daily_income_v5 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    source_id INTEGER NOT NULL DEFAULT 1 REFERENCES income_sources(id),
    method_id INTEGER NOT NULL REFERENCES payment_methods(id),
    amount REAL NOT NULL DEFAULT 0,
    UNIQUE (date, source_id, method_id)
  );
  INSERT INTO daily_income_v5 (id, date, source_id, method_id, amount) SELECT id, date, 1, method_id, amount FROM daily_income;
  DROP TABLE daily_income;
  ALTER TABLE daily_income_v5 RENAME TO daily_income;
  CREATE INDEX IF NOT EXISTS idx_income_date ON daily_income (date);
  CREATE TEMP TABLE _v5_guard (ok INTEGER CHECK (ok = 1));
  INSERT INTO _v5_guard SELECT (SELECT COUNT(*) FROM daily_income) = (SELECT n FROM _v5_count)
     AND abs((SELECT COALESCE(SUM(amount), 0) FROM daily_income) - (SELECT total FROM _v5_count)) < 0.005;
  DROP TABLE _v5_guard;
  DROP TABLE _v5_count;
  UPDATE payment_methods SET active = 0 WHERE name = 'אחר' AND id NOT IN (SELECT method_id FROM daily_income);
  `,

  // v6 — income in two parts of the selling day: the night before ("ליל שישי") and the day itself ("יום שישי").
  // Both parts are dated with the day itself (Friday); old amounts are the day part.
  `
  CREATE TEMP TABLE _v6_count AS SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM daily_income;
  CREATE TABLE daily_income_v6 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    source_id INTEGER NOT NULL DEFAULT 1 REFERENCES income_sources(id),
    part TEXT NOT NULL DEFAULT 'day' CHECK (part IN ('night', 'day')),
    method_id INTEGER NOT NULL REFERENCES payment_methods(id),
    amount REAL NOT NULL DEFAULT 0,
    UNIQUE (date, source_id, part, method_id)
  );
  INSERT INTO daily_income_v6 (id, date, source_id, part, method_id, amount) SELECT id, date, source_id, 'day', method_id, amount FROM daily_income;
  DROP TABLE daily_income;
  ALTER TABLE daily_income_v6 RENAME TO daily_income;
  CREATE INDEX IF NOT EXISTS idx_income_date ON daily_income (date);
  CREATE TEMP TABLE _v6_guard (ok INTEGER CHECK (ok = 1));
  INSERT INTO _v6_guard SELECT (SELECT COUNT(*) FROM daily_income) = (SELECT n FROM _v6_count)
     AND abs((SELECT COALESCE(SUM(amount), 0) FROM daily_income) - (SELECT total FROM _v6_count)) < 0.005;
  DROP TABLE _v6_guard;
  DROP TABLE _v6_count;
  `,
];
