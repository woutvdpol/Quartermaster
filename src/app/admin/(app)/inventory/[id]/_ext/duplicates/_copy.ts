import type { ProductStatus } from "@/generated/prisma/enums";

/** UI copy of the duplicate photo check and product lineage (English UI). */
export const dupCopy = {
  titleVeryClose: "These photos look very much like a piece you already had",
  titleClose: "These photos look like a piece you already had",
  band: { very_close: "Very close match", close: "Close match" } as const,
  linked: "linked as earlier listing",
  open: (no: number) => `Open No. ${no}`,
  legend: "What is it?",
  cameBack: "The same piece came back",
  cameBackHint: (no: number) => `(bought back, returned) — link it to No. ${no} so its history and provenance carry over`,
  whichOne: "Earlier listing",
  link: (no: number) => `Link to No. ${no}`,
  linking: "Linking…",
  linkedToast: (no: number) => `Linked to No. ${no}.`,
  alreadyListed: "I already listed it",
  alreadyListedHint: (no: number) => `— stop here and open No. ${no}`,
  alreadyListedNote: "Decide what to do with this draft: delete it in the danger zone below, or keep it.",
  different: "A different piece",
  differentHint: "— just similar. Carry on.",
  footer: "Checked against your own stock, drafts and sold archive. Photos are compared on your own server.",
  status: (status: ProductStatus, soldLabel: string | null) =>
    status === "SOLD"
      ? soldLabel
        ? `sold ${soldLabel}`
        : "sold"
      : ({ DRAFT: "draft", ACTIVE: "in stock", RESERVED: "reserved", ARCHIVED: "archived", STOLEN: "stolen" } as const)[status],
  earlier: "Earlier listing:",
  later: "Later listing:",
  copyProvenance: (no: number) => `Copy provenance from No. ${no}`,
  copying: "Copying…",
  copied: "Provenance copied. Review it in the provenance card.",
  nothingToCopy: "Nothing new to copy.",
  unlink: "Remove link",
  unlinked: "Link removed.",
  failed: "Could not save. Try again.",
};
