import mysql from "mysql2/promise";
import type { LegacyReader, LegacyRows, LegacyTable } from "./types";

/**
 * Plain SQL per legacy table (no ORM). Column lists match ./types.ts; every query is ordered by its
 * primary key so the ETL is deterministic (slug de-duplication, sort orders).
 */
export const LEGACY_SQL: Record<LegacyTable, string> = {
  products: `SELECT id, product_id, purchase_record_id, category_id, title, slug, description, price, purchase_price,
      weight, quantity, stock_control, notes, age_restricted, sale_item, active, photos, photo_count, blur, sold_on,
      sku, product_reserved_on, created_at, updated_at, specifications, importance
    FROM products ORDER BY id`,
  categories: "SELECT id, parent_id, title, slug, active, created_at FROM categories ORDER BY id",
  tags: "SELECT id, name, description, deleted_at, created_at FROM tags ORDER BY id",
  product_tag: "SELECT product_id, tag_id FROM product_tag ORDER BY id",
  related_products: "SELECT id, product_id, related_product_id FROM related_products ORDER BY id",
  product_origins: "SELECT id, name FROM product_origins ORDER BY id",
  purchase_records: "SELECT id, product_origin_id, invoice_number, created_at FROM purchase_records ORDER BY id",
  orders: `SELECT id, uuid, customer_id, name, address, phone, email, currency, delivery, total, payment_method,
      payment_status, payment_id, archive, email_sent_on, created_at, updated_at, order_paid_on, zip, city, state,
      country, region, notes, is_order_placed_event_fired
    FROM orders ORDER BY id`,
  order_details: "SELECT id, order_id, product_id, quantity, price FROM order_details ORDER BY order_id, id",
  users: "SELECT id, name, email, email_verified_at, password, created_at FROM users ORDER BY id",
  user_roles: `SELECT mhr.model_id, r.name AS role
    FROM model_has_roles mhr JOIN roles r ON r.id = mhr.role_id
    WHERE mhr.model_type LIKE '%User' ORDER BY mhr.model_id, r.id`,
  addresses: "SELECT id, user_id, firstname, lastname, address, city, state, zip, country FROM addresses ORDER BY id",
  wishlist: "SELECT user_id, product_id, created_at FROM wishlist ORDER BY id",
  regions: "SELECT id, title FROM regions ORDER BY id",
  weights: "SELECT id, weight FROM weights ORDER BY weight, id",
  region_weights: "SELECT region_id, weight_id, delivery_charge FROM region_weights ORDER BY region_id, weight_id",
  payment_methods: "SELECT id, name, surcharge, visible, active FROM payment_methods ORDER BY id",
  currencies: "SELECT code FROM currencies ORDER BY id",
  settings: `SELECT \`key\`, setting_type, value, string_value, boolean_value, int_value, list_value, image_value, list
    FROM settings ORDER BY id`,
  contents: "SELECT id, page, title, content, url, start_date, end_date, active, contact, lft FROM contents ORDER BY page, lft, id",
  content_pages: "SELECT id, url, title, slug, created_at FROM content_pages ORDER BY id",
  content_blocks: `SELECT id, content_page_id, product_id, type, title, content, author, media_type, image, background_color,
      button_link, site_link, link_text, amount, \`order\`
    FROM content_blocks ORDER BY content_page_id, \`order\`, id`,
  menu_items: "SELECT id, location, main_name, url, sub_name, sub_url, `order`, parent_id FROM menu_items ORDER BY id",
  emailer_subscribers: `SELECT id, email_address, verification_status, email_sent_at, email_verified_at, created_at, updated_at
    FROM emailer_subscribers ORDER BY id`,
  emailer_mails: "SELECT id, subject, content, sent_at, sent_count, created_at FROM emailer_mails ORDER BY id",
};

/** Reads the legacy MariaDB with mysql2. Dates are interpreted as UTC (Laravel app timezone). */
export class MysqlLegacyReader implements LegacyReader {
  private constructor(private readonly pool: mysql.Pool) {}

  static connect(url: string): MysqlLegacyReader {
    const parsed = new URL(url);
    if (parsed.protocol !== "mysql:" && parsed.protocol !== "mariadb:") {
      throw new Error("LEGACY_DATABASE_URL must be a mysql:// URL");
    }
    const pool = mysql.createPool({
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 3306,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, ""),
      timezone: "Z",
      dateStrings: false,
      supportBigNumbers: true,
      bigNumberStrings: false,
      charset: "utf8mb4",
      connectionLimit: 2,
    });
    return new MysqlLegacyReader(pool);
  }

  async read<T extends LegacyTable>(table: T): Promise<LegacyRows[T][]> {
    try {
      const [rows] = await this.pool.query(LEGACY_SQL[table]);
      return rows as LegacyRows[T][];
    } catch (err) {
      // ER_NO_SUCH_TABLE: older installs may lack optional tables — treat as empty.
      if ((err as { code?: string }).code === "ER_NO_SUCH_TABLE") return [];
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** In-memory reader for tests: rows are returned as given (copied). Missing tables yield []. */
export class MemoryLegacyReader implements LegacyReader {
  constructor(private readonly data: Partial<{ [K in LegacyTable]: LegacyRows[K][] }>) {}

  async read<T extends LegacyTable>(table: T): Promise<LegacyRows[T][]> {
    return ((this.data[table] ?? []) as LegacyRows[T][]).map((r) => ({ ...r }));
  }

  async close(): Promise<void> {}
}

/** Caches every table for the duration of a run (several steps read the same table). */
export class CachingLegacyReader implements LegacyReader {
  private readonly cache = new Map<LegacyTable, Promise<unknown[]>>();

  constructor(private readonly inner: LegacyReader) {}

  read<T extends LegacyTable>(table: T): Promise<LegacyRows[T][]> {
    let hit = this.cache.get(table);
    if (!hit) {
      hit = this.inner.read(table);
      this.cache.set(table, hit);
    }
    return hit as Promise<LegacyRows[T][]>;
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}
