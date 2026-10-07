// Shop customer accounts (registration, login, profile, addresses, orders, newsletter preference).
export {
  registerCustomer,
  customerLogin,
  ensureCustomer,
  updateCustomerProfile,
  changeCustomerEmail,
  changeCustomerPassword,
  deleteCustomerAccount,
  REGISTER_RULE,
  type RegisterInput,
  type RegisterResult,
  type ProfileResult,
  type ChangeEmailResult,
  type DeleteAccountResult,
  type CustomerUser,
} from "./service";
export { getShopCustomer, requireShopCustomer, hasPendingCustomerTotp, clientIp, type ShopCustomer } from "./current";
export {
  listAddresses,
  getAddress,
  createAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress,
  addressSchema,
  MAX_ADDRESSES,
  type AddressInput,
  type AddressResult,
  type AddressFieldErrors,
} from "./addresses";
export { listCustomerOrders, orderStatusLabel, type CustomerOrderRow, type OrderStatusLabel } from "./orders";
export { getNewsletterPreference, setNewsletterPreference, type NewsletterPreference, type SetNewsletterResult } from "./newsletter";
export { safeShopRedirect, loginHref, DEFAULT_AFTER_LOGIN } from "./redirect";
