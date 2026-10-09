// Display names of Mollie payment method ids (pure: shared by server, admin client components and the ETL).

export const METHOD_LABELS: Record<string, string> = {
  ideal: "iDEAL",
  bancontact: "Bancontact",
  creditcard: "Credit card",
  paypal: "PayPal",
  applepay: "Apple Pay",
  googlepay: "Google Pay",
  banktransfer: "Bank transfer",
  belfius: "Belfius",
  kbc: "KBC/CBC",
  eps: "EPS",
  giropay: "giropay",
  przelewy24: "Przelewy24",
  sofort: "SOFORT",
  klarna: "Klarna",
  klarnapaylater: "Klarna Pay later",
  klarnapaynow: "Klarna Pay now",
  klarnasliceit: "Klarna Slice it",
  in3: "in3",
  giftcard: "Gift card",
  mybank: "MyBank",
  twint: "TWINT",
  blik: "BLIK",
  trustly: "Trustly",
  riverty: "Riverty",
  billie: "Billie",
  alma: "Alma",
  satispay: "Satispay",
  paybybank: "Pay by Bank",
  bacs: "Bacs Direct Debit",
  swish: "Swish",
  mbway: "MB WAY",
  multibanco: "Multibanco",
  // Fair-mode sales (registered only, no Mollie — docs/fair-mode.md)
  card: "Card (fair)",
  cash: "Cash",
  invoice: "Invoice",
};

export function methodLabel(id: string): string {
  return METHOD_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}
