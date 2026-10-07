import type { BlockIssue, ContentBlockType } from "@/server/content/blocks";
import type { PickerProduct } from "../_data";

export type { PickerImage, PickerProduct } from "../_data";

export type EditorBlock = {
  id: string;
  type: ContentBlockType;
  isVisible: boolean;
  data: unknown;
  valid: boolean;
  issues: BlockIssue[];
};

export type EditorCategory = { id: string; title: string; depth: number; isActive: boolean };

export type EditorPage = {
  id: string;
  title: string;
  slug: string;
  systemKey: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  published: boolean;
  publicHref: string;
};

/** Opens the shared pickers from any field. */
export type PickerApi = {
  pickImage: (onPick: (key: string) => void) => void;
  pickProduct: (onPick: (product: PickerProduct) => void) => void;
};

export type EditorContextValue = PickerApi & {
  pageId: string;
  categories: EditorCategory[];
  products: Record<string, PickerProduct>;
};
