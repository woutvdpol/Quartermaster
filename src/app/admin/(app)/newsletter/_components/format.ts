import { DEFAULT_FORMAT_LOCALE } from "@/components/admin/ui";

const nf = new Intl.NumberFormat(DEFAULT_FORMAT_LOCALE);

/** Integer with thousands separators ("1,234"). */
export function formatCount(n: number): string {
  return nf.format(n);
}
