// Alerts ("notify me"): saved searches + wishlist alerts. Safe to import from Next.js server code —
// nothing here renders mail (that is ./mail.tsx, loaded by the worker through MAIL_BUILDERS).
export {
  createSavedSearch,
  confirmSavedSearch,
  unsubscribeSavedSearchSigned,
  manageViewSigned,
  stopFromManageLink,
  listCustomerSearches,
  updateCustomerSearch,
  deleteCustomerSearch,
  adminListSavedSearches,
  adminDisableSavedSearch,
  adminAlertStats,
  purgeExpiredPending,
  savedSearchStatus,
  maskEmail,
  CONFIRM_TTL_DAYS,
  MAX_ACTIVE_PER_EMAIL,
  FREQUENCIES,
  CREATE_RULES,
  type CreateSavedSearchInput,
  type CreateSavedSearchResult,
  type ConfirmSavedSearchResult,
  type UnsubscribeResult,
  type PublicSearchRow,
  type AdminSearchRow,
  type AdminSearchListQuery,
  type AlertStats,
  type SavedSearchStatus,
  type CustomerOwner,
} from "./saved-searches";
export { matchProduct, matchRecentProducts, runMatchingNow, sendDueDigests, loadMatchLookups, type MatchResult } from "./matching";
export { processBackAvailable, processPriceDrop, scanReleasedReservations, stopWishlistAlertSigned, claimWishlistDelivery, COOLDOWN_MS } from "./wishlist-alerts";
export { onProductPublished, onProductsPublished, onReservationReleased, onPriceChanged } from "./hooks";
export {
  queryFromCatalogInput,
  resolveQuery,
  describeQuery,
  describeQueries,
  summarizeDescription,
  suggestedQueryForProduct,
  type CatalogSearchInput,
  type QueryDescription,
} from "./query";
export { normalizeQuery, isEmptyQuery, matchesQuery, EMPTY_QUERY, type SavedSearchQuery } from "./match";
export { signAlertLink, verifyAlertLink, searchLinkQuery, wishlistLinkQuery, verifyWishlistLink } from "./signing";
export { ALERT_PATHS } from "./paths";
