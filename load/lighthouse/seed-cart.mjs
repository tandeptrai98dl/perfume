// Seeds one guest cart (demo SKU) for Lighthouse CI and prints its `cart_token` cookie value,
// so the cart and checkout pages are measured with an item instead of their empty state.
// Usage: DATABASE_URL=… node load/lighthouse/seed-cart.mjs
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import pg from 'pg';

const SKU = process.env.LHCI_SKU ?? 'ATEL-HOA--EDP-10';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const cartId = randomUUID();
  await client.query(
    `insert into carts (id, token_hash, locale, gift_wrap, expires_at)
     values ($1, $2, 'vi', false, now() + interval '1 day')`,
    [cartId, tokenHash],
  );
  const { rowCount } = await client.query(
    `insert into cart_items (id, cart_id, variant_id, quantity, price_when_added)
     select $1, $2, v.id, 1, v.price from product_variants v where v.sku = $3`,
    [randomUUID(), cartId, SKU],
  );
  if (rowCount !== 1) throw new Error(`SKU ${SKU} not found (seed the demo catalogue first)`);
  process.stdout.write(token);
} finally {
  await client.end();
}
