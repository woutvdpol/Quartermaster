import type { CopyShape } from "@/lib/i18n/shop-copy";
import type { currencyCopy } from "./_copy";

export const currencyCopyNl: CopyShape<typeof currencyCopy> = {
  label: "Prijzen ook tonen in",
  title: (label: string, currency: string) => `${label} (indicatief — u betaalt in ${currency})`,
};
