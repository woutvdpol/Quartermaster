/** Storefront paths of the alerts feature (pure; mails build absolute URLs from these). */
export const ALERT_PATHS = {
  /** Page with a "Confirm" button (POST). GET never confirms: mail scanners follow links. */
  confirm: "/alerts/confirm",
  /** Page with an "Unsubscribe" button (POST) — `?t&s&sig` (saved search) or `?t&c&p&sig` (wishlist item). */
  unsubscribe: "/alerts/unsubscribe",
  /** RFC 8058 one-click endpoint (POST only), same query as `unsubscribe`. */
  oneClick: "/alerts/unsubscribe/one-click",
  /** Lists every alert of an email address — `?t&s&sig` (signed with purpose "manage"). */
  manage: "/alerts/manage",
  /** Outcome page: `?status=confirmed|invalid|expired|unsubscribed`. */
  status: "/alerts",
  /** Signed-in customers. */
  account: "/account/alerts",
  wishlist: "/wishlist",
} as const;
