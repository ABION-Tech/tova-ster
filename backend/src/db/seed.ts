import { pool } from "./pool.js";
import { SETTINGS_DEFAULTS, SETTINGS_KEYS } from "../settings/defaults.js";

// Tova-Ster launch catalogue. Prices are the working figures from the demo
// and must be confirmed by the client before launch; nutrient amounts marked
// "To confirm" are read off the final labels.
//
// Idempotent: products upsert on slug (content fields are refreshed only
// while the product is still untouched by the admin, see `seeded` below),
// settings rows are only inserted if missing, bundles/codes upsert on name/code.
// No reviews or customers are seeded: the live shop must never show invented
// reviews.

interface SeedProduct {
  slug: string;
  name: string;
  category: string;
  short: string;
  description: string;
  pack: string;
  format: string;
  servings: number;
  price: number;
  stock: number;
  needs: string[];
  audiences: string[];
  badge: string | null;
  benefits: string[];
  how: string;
  ingredients: string;
  facts: [string, string][];
  warnings: string;
  images: string[];
  sort: number;
}

const STD_WARNING =
  "Food supplements should not be used as a substitute for a varied and balanced diet and a healthy lifestyle. Do not exceed the recommended daily dose. If you are pregnant, breastfeeding, taking medication or under medical supervision, consult your doctor before use. Keep out of sight and reach of young children.";

const CODES = [
  { code: "WELCOME10", pct: 10, active: true, note: "First order (newsletter sign-up)", firstOrderOnly: true },
  { code: "WINTER15", pct: 15, active: false, note: "Seasonal, not started", firstOrderOnly: false },
];

// The launch range is exactly these five products. Nothing else is seeded.
const CATEGORIES = [
  { slug: "vitamins", name: "Vitamins" },
  { slug: "gummies", name: "Gummies" },
  { slug: "sports-nutrition", name: "Sports nutrition" },
];

const PRODUCTS: SeedProduct[] = [
  {
    slug: "creatine-monohydrate", name: "Creatine Monohydrate Complex Powder", category: "sports-nutrition", sort: 1,
    short: "Unflavoured creatine monohydrate, 3 g per serving",
    description: "100% creatine monohydrate powder. Unflavoured, so it mixes into water or a shake. One 3 g scoop a day.",
    pack: "500 g powder", format: "Powder", servings: 166, price: 24.99, stock: 33,
    needs: ["training"], audiences: ["training", "men", "women"], badge: null,
    benefits: ["Creatine increases physical performance in successive bursts of short-term, high-intensity exercise", "The beneficial effect is obtained with a daily intake of 3 g of creatine", "Unflavoured, mixes into water or a shake"],
    how: "Mix one 3 g scoop into water or a shake, once a day.",
    ingredients: "Creatine monohydrate (micronised). Full ingredient list to be confirmed from the label.",
    facts: [["Creatine monohydrate", "3 g per scoop"]], warnings: STD_WARNING, images: ["/brand/creatine.jpg", "/brand/hero-creatine.jpg"],
  },
  {
    slug: "kids-multivitamin-mineral", name: "Multivitamin and Mineral for Children", category: "gummies", sort: 2,
    short: "Nine nutrients in a chewable berry gummy",
    description: "Nine vitamins and minerals in a chewable berry-flavour gummy for children.",
    pack: "150 gummies", format: "Gummies", servings: 75, price: 14.99, stock: 7,
    needs: ["kids", "immunity"], audiences: ["kids"], badge: "Best seller",
    benefits: ["Vitamin D is needed for normal growth and development of bone in children", "Zinc contributes to the normal function of the immune system", "Berry flavour, chewable, nothing to swallow whole"],
    how: "Children: chew two gummies a day. Keep out of sight and reach of young children.",
    ingredients: "Vitamins B3, B5, B6, B12, C, D2, E, folic acid, zinc. Amounts to be confirmed from the label.",
    facts: [["Vitamin D2", "To confirm"], ["Zinc", "To confirm"], ["Vitamin C", "To confirm"]], warnings: STD_WARNING, images: ["/brand/kids-multivitamin.jpg", "/brand/hero-kids-multivitamin.jpg"],
  },
  {
    slug: "iron-vitamin-c", name: "Iron & Vitamin C", category: "gummies", sort: 3,
    short: "Berry-flavour gummies with iron and vitamin C",
    description: "Iron and vitamin C in a berry-flavour gummy. Vitamin C increases iron absorption.",
    pack: "90 gummies", format: "Gummies", servings: 90, price: 9.99, stock: 18,
    needs: ["energy", "immunity"], audiences: ["women", "men"], badge: null,
    benefits: ["Iron contributes to the reduction of tiredness and fatigue", "Iron contributes to normal formation of red blood cells and haemoglobin", "Vitamin C increases iron absorption"],
    how: "Chew one gummy a day. Amount to be confirmed from the label.",
    ingredients: "Iron, vitamin C. Amounts to be confirmed from the label.",
    facts: [["Iron", "To confirm"], ["Vitamin C", "To confirm"]], warnings: STD_WARNING, images: ["/brand/iron-vitamin-c.jpg", "/brand/hero-iron-vitamin-c.jpg"],
  },
  {
    slug: "collagen-complex", name: "Collagen Complex", category: "gummies", sort: 4,
    short: "Orange-flavour gummies with biotin and selenium",
    description: "Collagen with vitamins, biotin and selenium in an orange-flavour gummy. Two a day.",
    pack: "90 orange flavour gummies", format: "Gummies", servings: 45, price: 17.99, stock: 51,
    needs: ["beauty"], audiences: ["women", "men"], badge: null,
    benefits: ["Vitamin C contributes to normal collagen formation for the normal function of skin", "Biotin and selenium contribute to the maintenance of normal hair", "Selenium contributes to the maintenance of normal nails"],
    how: "Chew two gummies a day.",
    ingredients: "Collagen, vitamins A, C, E, B6, B12, biotin, selenium. Amounts to be confirmed from the label.",
    facts: [["Collagen", "To confirm"], ["Biotin", "To confirm"], ["Selenium", "To confirm"]], warnings: STD_WARNING, images: ["/brand/collagen.jpg", "/brand/hero-collagen.jpg"],
  },
  {
    slug: "vitamin-d3-4000iu", name: "Vitamin D3 4000iu", category: "vitamins", sort: 5,
    short: "High-strength vitamin D, one tablet a day",
    description: "High-strength vitamin D3. One small tablet a day, taken with food. For adults; not for children.",
    pack: "365 tablets", format: "Tablets", servings: 365, price: 12.99, stock: 142,
    needs: ["immunity"], audiences: ["women", "men", "training"], badge: "Best seller",
    benefits: ["Vitamin D contributes to the normal function of the immune system", "Vitamin D contributes to the maintenance of normal bones and normal muscle function", "One small tablet a day"],
    how: "Adults: take one tablet a day with food. Do not exceed the stated dose. Not suitable for children.",
    ingredients: "Vitamin D3 (cholecalciferol) 100 µg (4000 IU). Full ingredient list to be confirmed from the label.",
    facts: [["Vitamin D3", "100 µg (4000 IU)"]], warnings: STD_WARNING, images: [],
  },
];

const BUNDLES = [
  { name: "Winter essentials", slugs: ["vitamin-d3-4000iu", "iron-vitamin-c"], pct: 15, blurb: "Vitamin D for the darker months, plus iron with vitamin C.", sort: 1 },
  { name: "Family essentials", slugs: ["kids-multivitamin-mineral", "vitamin-d3-4000iu"], pct: 15, blurb: "Berry gummies for the children and vitamin D for you.", sort: 2 },
  { name: "Daily duo", slugs: ["collagen-complex", "iron-vitamin-c"], pct: 15, blurb: "Collagen Complex plus Iron & Vitamin C. Vitamin C contributes to normal collagen formation for the normal function of skin.", sort: 3 },
  { name: "Active essentials", slugs: ["creatine-monohydrate", "vitamin-d3-4000iu"], pct: 15, blurb: "Creatine for training, plus vitamin D, which contributes to normal muscle function.", sort: 4 },
];

// `npm run seed -- --refresh` rewrites the five products (words, prices, photos) from this file.
const REFRESH = process.argv.includes("--refresh");

async function seedCategories(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const c of CATEGORIES) {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO categories (name, slug) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [c.name, c.slug],
    );
    ids.set(c.slug, r.rows[0].id);
  }
  return ids;
}

async function seedProducts(categoryIds: Map<string, string>): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const p of PRODUCTS) {
    const existing = await pool.query<{ id: string }>(`SELECT id FROM products WHERE slug = $1`, [p.slug]);
    let id = existing.rows[0]?.id;
    if (id && REFRESH) {
      await pool.query(
        `UPDATE products SET category_id = $2, name = $3, description = $4, base_price = $5, short_description = $6, pack_size = $7, format = $8,
           servings = $9, needs = $10, audiences = $11, badge = $12, benefits = $13, how_to_take = $14, ingredients = $15, facts = $16,
           warnings = $17, sort_order = $18, status = 'active' WHERE id = $1`,
        [id, categoryIds.get(p.category), p.name, p.description, p.price, p.short, p.pack, p.format, p.servings, p.needs, p.audiences, p.badge,
          JSON.stringify(p.benefits), p.how, p.ingredients, JSON.stringify(p.facts), p.warnings, p.sort],
      );
      await pool.query(`DELETE FROM product_images WHERE product_id = $1`, [id]);
      for (const [i, url] of p.images.entries()) {
        await pool.query(`INSERT INTO product_images (product_id, url, alt_text, sort_order, is_primary) VALUES ($1,$2,$3,$4,$5)`, [id, url, `Tova-Ster ${p.name}`, i, i === 0]);
      }
    }
    if (!id) {
      const r = await pool.query<{ id: string }>(
        `INSERT INTO products (category_id, name, slug, description, base_price, has_variants, stock, status, low_stock_threshold,
           short_description, pack_size, format, servings, needs, audiences, badge, benefits, how_to_take, ingredients, facts, warnings, sort_order)
         VALUES ($1,$2,$3,$4,$5,false,$6,'active',10,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         RETURNING id`,
        [categoryIds.get(p.category), p.name, p.slug, p.description, p.price, p.stock,
          p.short, p.pack, p.format, p.servings, p.needs, p.audiences, p.badge, JSON.stringify(p.benefits),
          p.how, p.ingredients, JSON.stringify(p.facts), p.warnings, p.sort],
      );
      id = r.rows[0].id;
      await pool.query(
        `INSERT INTO inventory (product_id, change_type, quantity_delta, quantity_after, note) VALUES ($1, 'initial', $2, $2, 'Launch stock (seed)')`,
        [id, p.stock],
      );
      for (const [i, url] of p.images.entries()) {
        await pool.query(
          `INSERT INTO product_images (product_id, url, alt_text, sort_order, is_primary) VALUES ($1,$2,$3,$4,$5)`,
          [id, url, `Tova-Ster ${p.name}`, i, i === 0],
        );
      }
    }
    ids.set(p.slug, id);
  }
  return ids;
}

async function seedSettings(): Promise<number> {
  let added = 0;
  for (const key of SETTINGS_KEYS) {
    const r = await pool.query(
      `INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(SETTINGS_DEFAULTS[key])],
    );
    added += r.rowCount ?? 0;
  }
  return added;
}

async function seedOffers(productIds: Map<string, string>): Promise<void> {
  for (const b of BUNDLES) {
    const pids = b.slugs.map((s) => productIds.get(s)).filter(Boolean);
    await pool.query(
      `INSERT INTO bundles (name, blurb, product_ids, discount_pct, active, sort_order)
       SELECT $1, $2, $3::uuid[], $4, true, $5
       WHERE NOT EXISTS (SELECT 1 FROM bundles WHERE name = $1)`,
      [b.name, b.blurb, pids, b.pct, b.sort],
    );
    if (REFRESH) {
      await pool.query(`UPDATE bundles SET blurb = $2, product_ids = $3::uuid[], discount_pct = $4, sort_order = $5 WHERE name = $1 AND kind = 'standard'`,
        [b.name, b.blurb, pids, b.pct, b.sort]);
    }
  }
  for (const c of CODES) {
    await pool.query(
      `INSERT INTO discount_codes (code, pct, active, note, first_order_only) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (code) DO NOTHING`,
      [c.code, c.pct, c.active, c.note, c.firstOrderOnly],
    );
  }
}

/**
 * Anything outside the launch range is removed. Past orders keep their own
 * copy of names and prices (order_items), so deleting a product never
 * changes an order or receipt.
 */
async function removeOthers(): Promise<number> {
  const keep = PRODUCTS.map((p) => p.slug);
  const gone = await pool.query<{ id: string }>(`SELECT id FROM products WHERE slug <> ALL($1::text[])`, [keep]);
  const ids = gone.rows.map((r) => r.id);
  if (ids.length) {
    await pool.query(`DELETE FROM bundles WHERE product_ids && $1::uuid[]`, [ids]);
    await pool.query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [ids]);
  }
  await pool.query(`DELETE FROM bundles WHERE kind = 'standard' AND name <> ALL($1::text[])`, [BUNDLES.map((b) => b.name)]);
  return ids.length;
}

async function run(): Promise<void> {
  const cats = await seedCategories();
  const products = await seedProducts(cats);
  const settings = await seedSettings();
  await seedOffers(products);
  const removed = await removeOthers();
  console.log(`Seeded ${CATEGORIES.length} categories, ${PRODUCTS.length} products, ${BUNDLES.length} bundles, ${CODES.length} codes, ${settings} new settings groups.`);
  if (removed) console.log(`Removed ${removed} products that are not in the launch range.`);
  console.log(`Create the first admin with: npm run create-admin`);
}

run()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end().finally(() => process.exit(1));
  });
