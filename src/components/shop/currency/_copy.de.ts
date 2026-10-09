import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { currencyCopy } from "./_copy";

export const currencyCopyDe: CopyShape<typeof currencyCopy> = {
  label: "Preise auch anzeigen in",
  title: (label: string, currency: string) => `${label} (unverbindlich — Sie bezahlen in ${currency})`,
};
