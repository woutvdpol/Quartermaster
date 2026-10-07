/*
 * Shared wording for certificates (PDF, verify page, product page). English (UI copy rule); kept in
 * one place so the printed certificate and the website say the same thing. Pure module.
 */

export const provenanceCopy = {
  certificateTitle: "Certificate of Authenticity",
  guaranteeTitle: "Lifetime authenticity guarantee",
  guaranteeText:
    "We guarantee that this item is an authentic original as described. Should it ever be shown otherwise by a recognised independent expert, we will take it back and refund the full purchase price — for as long as you own it.",
  certificateStatement: (shopName: string) =>
    `${shopName} certifies that the item described on this certificate has been examined and is, to the best of our knowledge and expertise, an authentic period original as described.`,
  verifyHint: "Scan the code or visit the address below to verify this certificate online.",
  signatureLine: "Signature",
  issuedOn: "Issued on",
  certificateNo: "Certificate no.",
  stockCode: "Stock code",
  revokedBanner: "REVOKED — this certificate is no longer valid",
} as const;
