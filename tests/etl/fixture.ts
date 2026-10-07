import type { LegacyRows, LegacyTable } from "../../scripts/etl/legacy/types";

/** Small, fully synthetic Concept500 data set (shapes as in the test dump; no real personal data). */
const d = (s: string) => new Date(`${s}Z`);
const photos = (...ids: string[]) => JSON.stringify(JSON.stringify(ids)); // double-encoded like the dump
export const CF = ["aaaaaaaa-1111-4111-8111-000000000001", "aaaaaaaa-1111-4111-8111-000000000002", "aaaaaaaa-1111-4111-8111-000000000003"];
export const BCRYPT = "$2y$10$" + "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0".slice(0, 53);

const product = (id: number, over: Partial<LegacyRows["products"]> = {}): LegacyRows["products"] => ({
  id,
  product_id: null,
  purchase_record_id: null,
  category_id: null,
  title: `Item ${id}`,
  slug: `item-${id}`,
  description: "Description",
  price: 4462,
  purchase_price: 2000,
  weight: 500,
  quantity: 1,
  stock_control: "RESERVED",
  notes: null,
  age_restricted: 0,
  sale_item: 0,
  active: "ACTIVE",
  photos: null,
  photo_count: 0,
  blur: 0,
  sold_on: null,
  sku: null,
  product_reserved_on: null,
  created_at: d("2026-01-01T10:00:00"),
  updated_at: d("2026-01-02T10:00:00"),
  specifications: null,
  importance: 0,
  ...over,
});

const order = (id: number, over: Partial<LegacyRows["orders"]> = {}): LegacyRows["orders"] => ({
  id,
  uuid: `bbbbbbbb-2222-4222-8222-${String(id).padStart(12, "0")}`,
  customer_id: null,
  name: "Test Buyer",
  address: "Teststraat 1",
  phone: "000",
  email: `buyer${id % 2}@example.test`,
  currency: "EUR",
  delivery: 5000,
  total: 9462,
  payment_method: "BANK_TRANSFER",
  payment_status: "paid",
  payment_id: null,
  archive: 0,
  email_sent_on: d("2026-02-01T00:00:00"),
  created_at: d("2026-02-01T10:00:00"),
  updated_at: d("2026-02-01T11:00:00"),
  order_paid_on: d("2026-02-01T11:00:00"),
  zip: "1234 AB",
  city: "Teststad",
  state: null,
  country: "Netherlands",
  region: "Europe",
  notes: null,
  is_order_placed_event_fired: 1,
  ...over,
});

export function legacyFixture(): Partial<{ [K in LegacyTable]: LegacyRows[K][] }> {
  return {
    categories: [
      { id: 2, parent_id: 1, title: "Helmets", slug: "helmets", active: 1, created_at: null },
      { id: 1, parent_id: null, title: "Headgear", slug: "Head Gear", active: 1, created_at: null },
    ],
    tags: [
      { id: 1, name: "WW2", description: null, deleted_at: null, created_at: null },
      { id: 2, name: "Luftwaffe", description: "LW", deleted_at: null, created_at: null },
    ],
    product_tag: [
      { product_id: 50000, tag_id: 1 },
      { product_id: 50000, tag_id: 1 }, // duplicate pivot
      { product_id: 50001, tag_id: 2 },
    ],
    related_products: [
      { id: 1, product_id: 50000, related_product_id: 50001 },
      { id: 2, product_id: 50000, related_product_id: 50000 }, // self → skipped
    ],
    products: [
      product(50000, { category_id: 2, photos: photos(CF[0], CF[1]), photo_count: 2, sku: "A1", specifications: JSON.stringify([{ key: "Maker", value: "EF" }]) }),
      product(50001, { slug: "item-50000", photos: JSON.stringify([CF[2]]), sku: "A1" }), // duplicate slug + sku
      product(50002, { quantity: 0, sold_on: d("2026-02-01T11:00:00"), stock_control: "SOLD", price: 175 }),
      product(50003, { active: "INACTIVE", slug: "test" }),
      product(50004, { active: "INACTIVE", slug: "test" }),
    ],
    orders: [
      order(1, {}), // paid, 1 line (rounded 45 → 4462)
      order(2, { payment_status: "manual", order_paid_on: null, total: 14099 }), // unpaid bank transfer, 2× + 1×
      order(3, { payment_status: "manual" }), // manual + order_paid_on → still PENDING (owner decision)
      order(4, { payment_status: "failed", payment_method: "MOLLIE", order_paid_on: null, is_order_placed_event_fired: 0, archive: 1 }),
      order(5, { total: 200, delivery: 100, order_paid_on: d("2026-02-02T00:00:00") }), // no lines
      order(6, { customer_id: 2, email: "Customer@Example.test", total: 5175, payment_status: "paid", country: "Atlantis" }),
    ],
    order_details: [
      { id: 1, order_id: 1, product_id: 50000, quantity: 1, price: 45 },
      { id: 2, order_id: 2, product_id: 50000, quantity: 2, price: 89 },
      { id: 3, order_id: 2, product_id: 50002, quantity: 1, price: 2 },
      { id: 4, order_id: 3, product_id: 50001, quantity: 1, price: 45 },
      { id: 5, order_id: 4, product_id: 50001, quantity: 1, price: 45 },
      { id: 6, order_id: 6, product_id: 50002, quantity: 1, price: 2 },
    ],
    users: [
      { id: 1, name: "Shop Owner", email: "owner@example.test", email_verified_at: d("2026-01-01T00:00:00"), password: BCRYPT, created_at: null },
      { id: 2, name: "Some Customer", email: "customer@example.test", email_verified_at: null, password: BCRYPT, created_at: null },
    ],
    user_roles: [
      { model_id: 1, role: "owner" },
      { model_id: 2, role: "user" },
    ],
    addresses: [{ id: 1, user_id: 2, firstname: "Some", lastname: "Customer", address: "Kerkstraat 12a", city: "Teststad", state: null, zip: "1234 AB", country: "België" }],
    wishlist: [{ user_id: 2, product_id: 50001, created_at: null }],
    regions: [
      { id: 1, title: "Europe" },
      { id: 2, title: "Pickup in store" },
    ],
    weights: [
      { id: 1, weight: 1000 },
      { id: 2, weight: 5000 },
    ],
    region_weights: [
      { region_id: 1, weight_id: 1, delivery_charge: "12.50" },
      { region_id: 1, weight_id: 2, delivery_charge: "50.00" },
      { region_id: 2, weight_id: 1, delivery_charge: "0.00" },
    ],
    payment_methods: [
      { id: 1, name: "Bank transfer", surcharge: null, visible: 1, active: 1 },
      { id: 2, name: "Paypal", surcharge: "5.00", visible: 1, active: 1 },
    ],
    currencies: [{ code: "EUR" }, { code: "USD" }],
    settings: [
      { key: "shop_name", setting_type: "string", value: null, string_value: "Fixture Shop", boolean_value: null, int_value: null, list_value: null, image_value: null, list: null },
      { key: "currency", setting_type: "enum", value: null, string_value: null, boolean_value: null, int_value: null, list_value: "EUR", image_value: null, list: null },
      { key: "reserved_time", setting_type: "enum", value: null, string_value: null, boolean_value: null, int_value: null, list_value: "600", image_value: null, list: null },
      { key: "terms", setting_type: "boolean", value: null, string_value: null, boolean_value: "1", int_value: null, list_value: null, image_value: null, list: null },
      { key: "news", setting_type: "boolean", value: null, string_value: null, boolean_value: "0", int_value: null, list_value: null, image_value: null, list: null },
    ],
    contents: [
      { id: 1, page: "TERMS", title: "Payment", content: "<p>All payments in <b>EUR</b><br></p>", url: null, start_date: null, end_date: null, active: null, contact: null, lft: 1 },
      { id: 2, page: "NEWS", title: "Fair", content: "See [shop](https://old.example.test/shop)", url: null, start_date: d("2026-03-01T00:00:00"), end_date: null, active: 1, contact: null, lft: 0 },
      { id: 3, page: "BANNER", title: "Banner", content: "x", url: null, start_date: null, end_date: null, active: 1, contact: null, lft: 0 },
    ],
    content_pages: [
      { id: 1, url: "home", title: "Home", slug: "home", created_at: null },
      { id: 2, url: "shop", title: "Our shop", slug: "shop", created_at: null }, // reserved slug → shop-2
    ],
    content_blocks: [
      { id: 1, content_page_id: 1, product_id: null, type: "HERO", title: "Fixture", content: null, author: null, media_type: null, image: null, background_color: null, button_link: "https://old.example.test/shop", site_link: null, link_text: "View", amount: null, order: 1 },
      { id: 2, content_page_id: 1, product_id: null, type: "NEW_ITEMS", title: "New", content: null, author: null, media_type: null, image: null, background_color: null, button_link: null, site_link: null, link_text: null, amount: 3, order: 2 },
      { id: 3, content_page_id: 1, product_id: null, type: "EMAILER", title: "Email", content: null, author: null, media_type: null, image: null, background_color: null, button_link: null, site_link: null, link_text: "Subscribe", amount: null, order: 3 },
      { id: 4, content_page_id: 2, product_id: 50000, type: "TEXT_PRODUCT", title: "Featured", content: "**Nice**", author: null, media_type: "IMAGE", image: JSON.stringify(["cf-x"]), background_color: null, button_link: null, site_link: null, link_text: null, amount: null, order: 1 },
    ],
    menu_items: [
      { id: 1, location: "HEADER", main_name: "Shop", url: "https://old.example.test/shop", sub_name: null, sub_url: null, order: 0, parent_id: null },
      { id: 2, location: "HEADER", main_name: "Contact", url: "https://old.example.test/contact", sub_name: null, sub_url: null, order: 1, parent_id: null },
      { id: 3, location: "FOOTER", main_name: null, url: null, sub_name: null, sub_url: null, order: 0, parent_id: null },
      { id: 4, location: "FOOTER", main_name: null, url: null, sub_name: "Terms", sub_url: "https://old.example.test/terms", order: 1, parent_id: 2 },
    ],
    emailer_subscribers: [
      { id: 1, email_address: "fan@example.test", verification_status: "active", email_sent_at: null, email_verified_at: d("2026-01-05T00:00:00"), created_at: d("2026-01-01T00:00:00"), updated_at: null },
      { id: 2, email_address: "old@example.test", verification_status: "pending", email_sent_at: null, email_verified_at: null, created_at: d("2025-01-01T00:00:00"), updated_at: null },
      { id: 3, email_address: "gone@example.test", verification_status: "unsubscribed", email_sent_at: null, email_verified_at: d("2026-01-05T00:00:00"), created_at: d("2026-01-01T00:00:00"), updated_at: d("2026-02-01T00:00:00") },
    ],
    emailer_mails: [
      { id: 1, subject: "Spring list", content: "New items", sent_at: d("2026-03-01T00:00:00"), sent_count: 2, created_at: d("2026-02-28T00:00:00") },
      { id: 2, subject: "Draft", content: "…", sent_at: null, sent_count: null, created_at: d("2026-03-02T00:00:00") },
    ],
  };
}
