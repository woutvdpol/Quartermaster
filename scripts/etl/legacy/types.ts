/**
 * Row shapes of the Concept500 (Laravel 12, MariaDB) tables the ETL reads, as returned by mysql2
 * (BIGINT → number, TINYINT(1) → 0/1, DECIMAL → string, DATETIME/TIMESTAMP → Date in UTC).
 * Only the columns the ETL uses are listed; readers select exactly these columns.
 */

export type Bool01 = number; // TINYINT(1): 0 | 1

export type LegacyProduct = {
  id: number; // StockCode (decision 26)
  product_id: number | null;
  purchase_record_id: number | null;
  category_id: number | null;
  title: string;
  slug: string;
  description: string | null;
  price: number; // minor units
  purchase_price: number | null; // minor units
  weight: number; // grams
  quantity: number;
  stock_control: string; // RESERVED | SOLD | STOLEN | NOT_IN_SHOP
  notes: string | null;
  age_restricted: Bool01;
  sale_item: Bool01;
  active: string; // ACTIVE | INACTIVE | ARCHIVED
  photos: string | null; // (double) JSON-encoded Cloudflare image ids
  photo_count: number;
  blur: Bool01;
  sold_on: Date | null;
  sku: string | null;
  product_reserved_on: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
  specifications: string | null; // JSON [{key, value}] (possibly double-encoded)
  importance: number;
};

export type LegacyCategory = {
  id: number;
  parent_id: number | null;
  title: string;
  slug: string;
  active: Bool01;
  created_at: Date | null;
};

export type LegacyTag = { id: number; name: string; description: string | null; deleted_at: Date | null; created_at: Date | null };
export type LegacyProductTag = { product_id: number; tag_id: number };
export type LegacyRelatedProduct = { id: number; product_id: number; related_product_id: number };
export type LegacyProductOrigin = { id: number; name: string };
export type LegacyPurchaseRecord = { id: number; product_origin_id: number | null; invoice_number: string | null; created_at: Date | null };

export type LegacyOrder = {
  id: number;
  uuid: string;
  customer_id: number | null;
  name: string;
  address: string;
  phone: string;
  email: string;
  currency: string;
  delivery: number; // minor
  total: number; // minor, incl. delivery (+ surcharge)
  payment_method: string;
  payment_status: string; // paid | manual | failed (| pending)
  payment_id: string | null;
  archive: Bool01;
  email_sent_on: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
  order_paid_on: Date | null;
  zip: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  region: string | null;
  notes: string | null;
  is_order_placed_event_fired: Bool01;
};

export type LegacyOrderDetail = { id: number; order_id: number; product_id: number; quantity: number; price: number };

export type LegacyUser = {
  id: number;
  name: string;
  email: string;
  email_verified_at: Date | null;
  password: string;
  created_at: Date | null;
};
export type LegacyUserRole = { model_id: number; role: string }; // model_has_roles ⋈ roles (App\Models\User only)

export type LegacyAddress = {
  id: number;
  user_id: number;
  firstname: string;
  lastname: string;
  address: string;
  city: string;
  state: string | null;
  zip: string | null;
  country: string;
};

export type LegacyWishlist = { user_id: number; product_id: number; created_at: Date | null };
export type LegacyRegion = { id: number; title: string };
export type LegacyWeight = { id: number; weight: number };
export type LegacyRegionWeight = { region_id: number; weight_id: number; delivery_charge: string }; // DECIMAL major units
export type LegacyPaymentMethod = { id: number; name: string; surcharge: string | null; visible: Bool01; active: Bool01 };
export type LegacyCurrency = { code: string };

export type LegacySetting = {
  key: string;
  setting_type: string | null;
  value: string | null;
  string_value: string | null;
  boolean_value: string | null;
  int_value: string | null;
  list_value: string | null;
  image_value: string | null;
  list: string | null;
};

export type LegacyContent = {
  id: number;
  page: string; // ShopPageEnum value
  title: string | null;
  content: string | null; // HTML (summernote) or Markdown
  url: string | null;
  start_date: Date | null;
  end_date: Date | null;
  active: Bool01 | null;
  contact: string | null;
  lft: number;
};

export type LegacyContentPage = { id: number; url: string; title: string; slug: string; created_at: Date | null };

export type LegacyContentBlock = {
  id: number;
  content_page_id: number;
  product_id: number | null;
  type: string;
  title: string | null;
  content: string | null;
  author: string | null;
  media_type: string | null;
  image: string | null;
  background_color: string | null;
  button_link: string | null;
  site_link: string | null;
  link_text: string | null;
  amount: number | null;
  order: number;
};

export type LegacyMenuItem = {
  id: number;
  location: string | null;
  main_name: string | null;
  url: string | null;
  sub_name: string | null;
  sub_url: string | null;
  order: number;
  parent_id: number | null;
};

export type LegacySubscriber = {
  id: number;
  email_address: string;
  verification_status: string; // pending | active | unsubscribed
  email_sent_at: Date | null;
  email_verified_at: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
};

export type LegacyMail = { id: number; subject: string; content: string; sent_at: Date | null; sent_count: number | null; created_at: Date | null };

/** Table name → row type. Keys are logical names; readers map them to SQL. */
export type LegacyRows = {
  products: LegacyProduct;
  categories: LegacyCategory;
  tags: LegacyTag;
  product_tag: LegacyProductTag;
  related_products: LegacyRelatedProduct;
  product_origins: LegacyProductOrigin;
  purchase_records: LegacyPurchaseRecord;
  orders: LegacyOrder;
  order_details: LegacyOrderDetail;
  users: LegacyUser;
  user_roles: LegacyUserRole;
  addresses: LegacyAddress;
  wishlist: LegacyWishlist;
  regions: LegacyRegion;
  weights: LegacyWeight;
  region_weights: LegacyRegionWeight;
  payment_methods: LegacyPaymentMethod;
  currencies: LegacyCurrency;
  settings: LegacySetting;
  contents: LegacyContent;
  content_pages: LegacyContentPage;
  content_blocks: LegacyContentBlock;
  menu_items: LegacyMenuItem;
  emailer_subscribers: LegacySubscriber;
  emailer_mails: LegacyMail;
};

export type LegacyTable = keyof LegacyRows;

/**
 * Source of legacy rows. The MariaDB implementation runs one plain SQL query per table; tests use an
 * in-memory implementation fed with fixture rows. A table that does not exist in the source yields [].
 */
export interface LegacyReader {
  read<T extends LegacyTable>(table: T): Promise<LegacyRows[T][]>;
  close(): Promise<void>;
}
