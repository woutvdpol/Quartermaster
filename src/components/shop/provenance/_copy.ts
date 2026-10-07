/* Storefront copy for provenance, documents and certificate verification (English). */

export const provenanceShopCopy = {
  block: {
    title: "Provenance",
    documents: "Documents",
    certificateIncluded: "Certificate of authenticity included",
    certificateIncludedBody: "This item comes with a numbered certificate of authenticity that anyone can verify online.",
    guaranteed: "Lifetime authenticity guarantee",
    verifyLink: "Verify a certificate",
    kinds: {
      PROVENANCE: "Provenance",
      DEACTIVATION_CERT: "Deactivation certificate",
      INVOICE_HISTORIC: "Historic invoice",
      OTHER: "Document",
    },
  },
  verify: {
    title: "Verify a certificate",
    intro: "Enter the code printed on the certificate of authenticity (for example QM-7K4P-2XQ9), or scan its QR code.",
    label: "Certificate code",
    placeholder: "QM-XXXX-XXXX",
    submit: "Verify",
    invalidCode: "That does not look like a certificate code. Codes look like QM-7K4P-2XQ9.",
    checkAnother: "Check another certificate",
    valid: {
      title: "Valid certificate",
      body: (shop: string) => `This certificate was issued by ${shop} and is valid.`,
    },
    revoked: {
      title: "Certificate revoked",
      body: (shop: string) => `This certificate was issued by ${shop} but has since been revoked. It is no longer valid.`,
    },
    unknown: {
      title: "Certificate not found",
      body: "We could not find a certificate with this code in this shop. Check the code for typing errors; letters O and I are read as 0 and 1.",
    },
    rateLimited: {
      title: "Too many lookups",
      body: "You have checked a lot of codes in a short time. Please wait a few minutes and try again.",
    },
    code: "Certificate no.",
    item: "Item",
    stockCode: "Stock code",
    issuedOn: "Issued on",
    revokedOn: "Revoked on",
    issuedBy: "Issued by",
    guaranteed: "Covered by a lifetime authenticity guarantee",
    photoAlt: (title: string) => `Photo of ${title} at the time of certification`,
  },
} as const;
