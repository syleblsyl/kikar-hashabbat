import { query, run } from './sqlite';

export type Category = { id: number; name: string; color: string | null; sort: number; count?: number };
export type Agent = {
  id: number;
  name: string;
  phone: string | null;
  color: string | null;
  delivery_day: number | null;
  notes: string | null;
  active: number;
  products?: number;
};
export type AgentPrice = { agent_id: number; name: string; color: string | null; cost_price: number };
export type Product = {
  id: number;
  name: string;
  category_id: number | null;
  category: string | null;
  image: string | null;
  sale_price: number;
  returnable: number;
  active: number;
  agents: AgentPrice[];
};

export const PALETTE = ['#A8521D', '#1F6F78', '#4A7A2E', '#2F5D9A', '#7A2A1C', '#6B4E9B', '#8A6A1A', '#3E5C5A', '#9C3B6E', '#50606F'];
export const CATEGORY_TINTS = ['#FBEFD6', '#F6E3CC', '#E5F0DC', '#DFEAF2', '#EDE3F3', '#F2E6E0', '#E6EFEA', '#F1EDE2'];

/* ---------- categories ---------- */

export async function listCategories(): Promise<Category[]> {
  return query<Category>(
    `SELECT c.id, c.name, c.color, c.sort,
            (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS count
       FROM categories c WHERE c.active = 1 ORDER BY c.sort, c.id`,
  );
}

export async function addCategory(name: string): Promise<number> {
  const cats = await listCategories();
  const tint = CATEGORY_TINTS[cats.length % CATEGORY_TINTS.length];
  const res = await run('INSERT INTO categories (name, color, sort) VALUES (?, ?, ?)', [name.trim(), tint, cats.length + 1]);
  return res.lastId;
}

export async function renameCategory(id: number, name: string) {
  await run('UPDATE categories SET name = ? WHERE id = ?', [name.trim(), id]);
}

export async function removeCategory(id: number) {
  await run('UPDATE products SET category_id = NULL WHERE category_id = ?', [id]);
  await run('UPDATE categories SET active = 0 WHERE id = ?', [id]);
}

/* ---------- agents ---------- */

export async function listAgents(): Promise<Agent[]> {
  return query<Agent>(
    `SELECT a.*,
            (SELECT COUNT(*) FROM agent_products ap JOIN products p ON p.id = ap.product_id
              WHERE ap.agent_id = a.id AND ap.active = 1 AND p.active = 1) AS products
       FROM agents a WHERE a.active = 1 ORDER BY a.name`,
  );
}

export async function getAgent(id: number): Promise<Agent | null> {
  const rows = await query<Agent>('SELECT * FROM agents WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function saveAgent(a: { id?: number; name: string; phone: string; color: string; delivery_day: number | null; notes: string }): Promise<number> {
  if (a.id) {
    await run('UPDATE agents SET name = ?, phone = ?, color = ?, delivery_day = ?, notes = ? WHERE id = ?', [
      a.name.trim(), a.phone.trim(), a.color, a.delivery_day, a.notes.trim(), a.id,
    ]);
    return a.id;
  }
  const res = await run('INSERT INTO agents (name, phone, color, delivery_day, notes) VALUES (?, ?, ?, ?, ?)', [
    a.name.trim(), a.phone.trim(), a.color, a.delivery_day, a.notes.trim(),
  ]);
  return res.lastId;
}

export async function hideAgent(id: number) {
  await run('UPDATE agents SET active = 0 WHERE id = ?', [id]);
}

export async function nextAgentColor(): Promise<string> {
  const [row] = await query<{ n: number }>('SELECT COUNT(*) AS n FROM agents');
  return PALETTE[Number(row?.n ?? 0) % PALETTE.length];
}

/* ---------- products ---------- */

type ProductRow = Omit<Product, 'agents'>;

async function attachAgents(rows: ProductRow[]): Promise<Product[]> {
  if (rows.length === 0) return [];
  const prices = await query<AgentPrice & { product_id: number }>(
    `SELECT ap.product_id, ap.agent_id, ap.cost_price, a.name, a.color
       FROM agent_products ap JOIN agents a ON a.id = ap.agent_id
      WHERE ap.active = 1 AND a.active = 1
      ORDER BY a.name`,
  );
  const byProduct = new Map<number, AgentPrice[]>();
  for (const p of prices) {
    const list = byProduct.get(p.product_id) ?? [];
    list.push({ agent_id: p.agent_id, name: p.name, color: p.color, cost_price: Number(p.cost_price) });
    byProduct.set(p.product_id, list);
  }
  return rows.map((r) => ({ ...r, sale_price: Number(r.sale_price), agents: byProduct.get(r.id) ?? [] }));
}

export async function listProducts(): Promise<Product[]> {
  const rows = await query<ProductRow>(
    `SELECT p.id, p.name, p.category_id, c.name AS category, p.image, p.sale_price, p.returnable, p.active
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.active = 1 ORDER BY COALESCE(c.sort, 999), p.name`,
  );
  return attachAgents(rows);
}

export async function getProduct(id: number): Promise<Product | null> {
  const rows = await query<ProductRow>(
    `SELECT p.id, p.name, p.category_id, c.name AS category, p.image, p.sale_price, p.returnable, p.active
       FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`,
    [id],
  );
  return (await attachAgents(rows))[0] ?? null;
}

export type ProductInput = {
  id?: number;
  name: string;
  category_id: number | null;
  image: string | null;
  sale_price: number;
  returnable: boolean;
  agents: { agent_id: number; cost_price: number }[];
};

/** Saves a product and its agent prices. Every price change is written to price_history. */
export async function saveProduct(p: ProductInput): Promise<number> {
  let id = p.id ?? 0;
  const before = id ? await getProduct(id) : null;
  if (id) {
    await run('UPDATE products SET name = ?, category_id = ?, image = ?, sale_price = ?, returnable = ? WHERE id = ?', [
      p.name.trim(), p.category_id, p.image, p.sale_price, p.returnable ? 1 : 0, id,
    ]);
  } else {
    const res = await run('INSERT INTO products (name, category_id, image, sale_price, returnable) VALUES (?, ?, ?, ?, ?)', [
      p.name.trim(), p.category_id, p.image, p.sale_price, p.returnable ? 1 : 0,
    ]);
    id = res.lastId;
  }

  if (!before || before.sale_price !== p.sale_price) {
    await run("INSERT INTO price_history (product_id, kind, price) VALUES (?, 'sale', ?)", [id, p.sale_price]);
  }

  const keep = new Set(p.agents.map((a) => a.agent_id));
  for (const old of before?.agents ?? []) {
    if (!keep.has(old.agent_id)) {
      await run('UPDATE agent_products SET active = 0 WHERE agent_id = ? AND product_id = ?', [old.agent_id, id]);
    }
  }
  for (const a of p.agents) {
    const prev = before?.agents.find((x) => x.agent_id === a.agent_id);
    await run(
      `INSERT INTO agent_products (agent_id, product_id, cost_price, active) VALUES (?, ?, ?, 1)
       ON CONFLICT(agent_id, product_id) DO UPDATE SET cost_price = excluded.cost_price, active = 1`,
      [a.agent_id, id, a.cost_price],
    );
    if (!prev || prev.cost_price !== a.cost_price) {
      await run("INSERT INTO price_history (product_id, agent_id, kind, price) VALUES (?, ?, 'cost', ?)", [id, a.agent_id, a.cost_price]);
    }
  }
  return id;
}

export async function hideProduct(id: number) {
  await run('UPDATE products SET active = 0 WHERE id = ?', [id]);
}

export async function productsOfAgent(agentId: number): Promise<Product[]> {
  const all = await listProducts();
  return all.filter((p) => p.agents.some((a) => a.agent_id === agentId));
}

export async function priceHistory(productId: number) {
  return query<{ kind: string; price: number; changed_at: string; agent: string | null }>(
    `SELECT h.kind, h.price, h.changed_at, a.name AS agent
       FROM price_history h LEFT JOIN agents a ON a.id = h.agent_id
      WHERE h.product_id = ? ORDER BY h.changed_at DESC, h.id DESC LIMIT 30`,
    [productId],
  );
}
