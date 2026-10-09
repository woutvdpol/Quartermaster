"use client";

import Link from "next/link";
import { startTransition, useEffect, useState, useTransition, type FormEvent, type ReactNode } from "react";
import {
  ActionMessage,
  ActionToast,
  Button,
  Card,
  Checkbox,
  DateTime,
  KeyValue,
  Money,
  MoneyInput,
  NumberInput,
  PageHeader,
  Select,
  Switch,
  TagInput,
  TextInput,
  Textarea,
  toast,
  useActionForm,
  type SelectOption,
} from "@/components/admin/ui";
import { duplicateProductAction, saveProductAction } from "../actions";
import { copy } from "../_copy";
import type { PurchaseRecordOption } from "../_lib/options";
import { SpecificationsEditor } from "./SpecificationsEditor";

export const PRODUCT_FORM_ID = "product-form";
const F = PRODUCT_FORM_ID;
const f = copy.fields;

export type EditorProduct = {
  id: string;
  stockCode: number;
  title: string;
  slug: string;
  description: string;
  specifications: { label: string; value: string }[];
  sku: string;
  price: number;
  purchasePrice: number | null;
  weightGrams: number;
  notes: string;
  seoTitle: string;
  seoDescription: string;
  categoryId: string;
  purchaseRecordId: string;
  ageRestricted: boolean;
  blurred: boolean;
  acceptsOffers: boolean;
  restrictedSymbols: boolean;
  requiresDeactivationCert: boolean;
  onSale: boolean;
  /** Sold archive (docs/sold-archive.md). */
  sold: boolean;
  archiveHidden: boolean;
  showSoldPrice: boolean;
  tags: string[];
  updatedAt: Date;
};

type Slots = {
  /** Photos card (immediate actions; outside the Save form). */
  photos: ReactNode;
  status: ReactNode;
  /** Quantity + "Adjust stock" drawer, rendered inside the Price & stock card. */
  stock: ReactNode;
  danger: ReactNode;
  /** Public provenance, documents and certificates (server card with its own actions). */
  provenance?: ReactNode;
  /** Facet values (server card, saves immediately). */
  facets?: ReactNode;
  /** Translations per shop language (server card, own actions; empty without extra languages). */
  translations?: ReactNode;
};

/** Markdown → rough plain text for the SERP preview. */
function plain(md: string) {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

/**
 * The product edit screen: header (Save / Duplicate / View in shop), main column (photos,
 * description, provenance) and a 300px side column (status, price & stock, visibility, SEO).
 *
 * All editable product fields belong to ONE form (`#product-form`) through the `form` attribute, so
 * cards with their own actions (photos, status, stock drawer, dialogs) can sit between them without
 * nesting forms. The form is submitted manually (no automatic reset), so a failed Save keeps every
 * typed value.
 */
export function ProductEditor({
  product,
  currency,
  timeZone,
  shopHost,
  shopName,
  categories,
  purchaseRecords,
  tagSuggestions,
  slots,
}: {
  product: EditorProduct;
  currency: string;
  timeZone: string;
  shopHost: string;
  shopName: string;
  categories: SelectOption[];
  purchaseRecords: PurchaseRecordOption[];
  tagSuggestions: string[];
  slots: Slots;
}) {
  const { state, formAction, pending, error } = useActionForm(saveProductAction);
  const [dirty, setDirty] = useState(false);
  const [version, setVersion] = useState(0);
  const [duplicating, startDuplicate] = useTransition();

  const [title, setTitle] = useState(product.title);
  const [description, setDescription] = useState(product.description);
  const [seoTitle, setSeoTitle] = useState(product.seoTitle);
  const [seoDescription, setSeoDescription] = useState(product.seoDescription);
  const [slug, setSlug] = useState(product.slug);
  const [price, setPrice] = useState<number | null>(product.price);
  const [purchasePrice, setPurchasePrice] = useState<number | null>(product.purchasePrice);
  const [tags, setTags] = useState(product.tags);
  const [recordId, setRecordId] = useState(product.purchaseRecordId);

  // After a successful save: clear dirty, reset one-shot controls (version key).
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) {
      setDirty(false);
      setVersion((v) => v + 1);
    }
  }
  // The server may change the slug (regenerate); follow it.
  const [lastSlug, setLastSlug] = useState(product.slug);
  if (product.slug !== lastSlug) {
    setLastSlug(product.slug);
    setSlug(product.slug);
  }

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  }

  function duplicate() {
    if (dirty) toast.info(copy.unsaved, { description: "Duplicate copies the last saved version." });
    startDuplicate(async () => {
      const r = await duplicateProductAction(product.id);
      if (r && !r.ok) toast.crit(r.message ?? copy.errors.generic);
    });
  }

  const fe = (!state || state.ok ? {} : (state.fieldErrors ?? {})) as Record<string, string[] | undefined>;
  const margin = price !== null && purchasePrice !== null ? price - purchasePrice : null;
  const marginPct = margin !== null && price ? Math.round((margin / price) * 1000) / 10 : null;
  const record = purchaseRecords.find((r) => r.id === recordId) ?? null;
  const serpTitle = clip(`${seoTitle || title}${shopName ? ` | ${shopName}` : ""}`, 70);
  const serpDescription = clip(seoDescription || plain(description), 160);

  return (
    <div
      className="flex min-w-0 flex-1 flex-col"
      onChange={(e) => {
        // getAttribute: `form.id` would return the hidden input named "id".
        if ((e.target as HTMLInputElement).form?.getAttribute("id") === F) setDirty(true);
      }}
    >
      <PageHeader
        crumb={
          <>
            <Link href="/admin/inventory" className="hover:text-ink hover:underline">
              {copy.crumbInventory}
            </Link>{" "}
            › <span className="font-mono">#{product.stockCode}</span>
          </>
        }
        title={title.trim() || product.title}
        actions={
          <>
            <span className="text-xs text-muted" aria-live="polite">
              {dirty ? (
                <span className="text-warn">{copy.unsaved}</span>
              ) : (
                <>
                  {copy.saved} <DateTime value={product.updatedAt} format="time" timeZone={timeZone} />
                </>
              )}
            </span>
            <Button aria-disabled="true" title={copy.viewInShopHint} onClick={() => toast.info(copy.viewInShopHint)}>
              {copy.viewInShop}
            </Button>
            <Button onClick={duplicate} disabled={duplicating}>
              {duplicating ? copy.duplicating : copy.duplicate}
            </Button>
            <Button type="submit" form={F} variant="primary" disabled={pending}>
              {pending ? copy.saving : copy.save}
            </Button>
          </>
        }
      />

      <form id={F} onSubmit={submit} noValidate hidden>
        <input type="hidden" name="id" value={product.id} />
      </form>

      <div className="grid gap-4 p-4 md:p-[22px]">
        <ActionMessage state={state} showSuccess={false} />
        <ActionToast state={state} errors={false} />

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* Main column */}
          <div className="grid min-w-0 gap-4">
            {slots.photos}

            <Card title={copy.cards.description}>
              <div className="grid gap-3">
                <TextInput
                  form={F}
                  label={f.title}
                  name="title"
                  required
                  maxLength={300}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  error={error("title")}
                />
                <Textarea
                  form={F}
                  label={f.description}
                  name="description"
                  rows={8}
                  hint={f.descriptionHint}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  error={error("description")}
                />
                <SpecificationsEditor form={F} defaultValue={product.specifications} errors={fe} />
                <TagInput
                  label={f.tags}
                  name="tagsDisplay"
                  hint={f.tagsHint}
                  value={tags}
                  onValueChange={(next) => {
                    setTags(next);
                    setDirty(true);
                  }}
                  suggestions={tagSuggestions}
                  maxTags={100}
                  error={error("tags")}
                />
                {tags.map((tag) => (
                  <input key={tag} type="hidden" form={F} name="tags" value={tag} />
                ))}
                <Select form={F} label={f.category} name="categoryId" defaultValue={product.categoryId} options={[{ value: "", label: f.noCategory }, ...categories]} error={error("categoryId")} />
              </div>
            </Card>

            {slots.provenance}

            <Card title={copy.cards.provenance} aside={copy.cards.provenanceAside}>
              <div className="grid gap-3">
                <Select
                  form={F}
                  label={f.purchaseRecord}
                  name="purchaseRecordId"
                  value={recordId}
                  onChange={(e) => setRecordId(e.target.value)}
                  options={[{ value: "", label: f.noPurchaseRecord }, ...purchaseRecords.map((r) => ({ value: r.id, label: r.label }))]}
                  error={error("purchaseRecordId")}
                />
                {record && (
                  <Link href={`/admin/sourcing/records/${record.id}`} className="justify-self-start text-xs text-info hover:underline">
                    {copy.provenance.openRecord}
                  </Link>
                )}
                {record && (
                  <KeyValue
                    items={[
                      { label: copy.provenance.supplier, value: record.supplier ?? "—" },
                      { label: copy.provenance.purchasedAt, value: record.purchasedAt, mono: true },
                      { label: copy.provenance.invoice, value: record.invoiceNumber ?? "—", mono: true },
                      { label: copy.provenance.totalCost, value: <Money amount={record.totalCost} currency={record.currency} />, mono: true },
                    ]}
                  />
                )}
                <Textarea form={F} label={f.notes} name="notes" rows={3} hint={f.notesHint} defaultValue={product.notes} showOptional error={error("notes")} />
                <p className="text-xs text-muted">{copy.provenance.publicElsewhere}</p>
              </div>
            </Card>

            {slots.facets}

            {slots.translations}

            {slots.danger}
          </div>

          {/* Side column */}
          <div className="grid min-w-0 gap-4">
            {slots.status}

            <Card title={copy.cards.priceStock}>
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <MoneyInput
                    form={F}
                    label={f.price}
                    name="priceDisplay"
                    currency={currency}
                    value={price}
                    onValueChange={setPrice}
                    required
                    error={error("price")}
                  />
                  <MoneyInput
                    form={F}
                    label={f.purchasePrice}
                    name="purchasePriceDisplay"
                    currency={currency}
                    value={purchasePrice}
                    onValueChange={setPurchasePrice}
                    error={error("purchasePrice")}
                  />
                  <input type="hidden" form={F} name="price" value={price ?? ""} />
                  <input type="hidden" form={F} name="purchasePrice" value={purchasePrice ?? ""} />
                </div>
                <KeyValue
                  items={[
                    {
                      label: copy.margin.label,
                      value:
                        margin === null ? (
                          <span className="font-sans text-xs text-muted">{copy.margin.unknown}</span>
                        ) : (
                          <span className={margin >= 0 ? "text-ok" : "text-crit"}>
                            <Money amount={margin} currency={currency} signed />
                            {marginPct !== null && ` · ${marginPct}%`}
                          </span>
                        ),
                      mono: true,
                    },
                  ]}
                />
                {slots.stock}
                <div className="grid grid-cols-2 gap-3">
                  <NumberInput
                    form={F}
                    label={f.weight}
                    name="weightGrams"
                    inputMode="numeric"
                    defaultValue={String(product.weightGrams)}
                    trailing="g"
                    error={error("weightGrams")}
                  />
                  <TextInput form={F} label={f.sku} name="sku" defaultValue={product.sku} maxLength={100} inputClassName="font-mono" error={error("sku")} />
                </div>
                <Switch form={F} label={f.acceptsOffers} name="acceptsOffers" defaultChecked={product.acceptsOffers} layout="row" />
              </div>
            </Card>

            <Card title={copy.cards.visibility}>
              <div className="grid">
                <Switch form={F} label={f.blurred} description={f.blurredHint} name="blurred" defaultChecked={product.blurred} layout="row" />
                <Switch
                  form={F}
                  label={f.restrictedSymbols}
                  description={f.restrictedSymbolsHint}
                  name="restrictedSymbols"
                  defaultChecked={product.restrictedSymbols}
                  layout="row"
                />
                <Switch
                  form={F}
                  label={f.requiresDeactivationCert}
                  description={f.requiresDeactivationCertHint}
                  name="requiresDeactivationCert"
                  defaultChecked={product.requiresDeactivationCert}
                  layout="row"
                />
                <Switch form={F} label={f.ageRestricted} name="ageRestricted" defaultChecked={product.ageRestricted} layout="row" />
                <Switch form={F} label={f.onSale} name="onSale" defaultChecked={product.onSale} layout="row" />
              </div>
            </Card>

            <Card title={copy.cards.soldArchive} aside={product.sold ? undefined : copy.cards.soldArchiveAside}>
              <div className="grid">
                <Switch
                  form={F}
                  label={f.showInArchive}
                  description={f.showInArchiveHint}
                  name="showInArchive"
                  defaultChecked={!product.archiveHidden}
                  layout="row"
                />
                <Switch
                  form={F}
                  label={f.showSoldPrice}
                  description={f.showSoldPriceHint}
                  name="showSoldPrice"
                  defaultChecked={product.showSoldPrice}
                  layout="row"
                />
              </div>
            </Card>

            <Card title={copy.cards.seo}>
              <div className="grid gap-3">
                <TextInput
                  key={`slug-${product.slug}`}
                  form={F}
                  label={f.slug}
                  name="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  maxLength={120}
                  inputClassName="font-mono"
                  error={error("slug")}
                />
                <Checkbox key={`regen-${version}`} form={F} label={f.regenerateSlug} name="regenerateSlug" />
                <TextInput
                  form={F}
                  label={f.seoTitle}
                  name="seoTitle"
                  hint={f.seoTitleHint}
                  maxLength={200}
                  value={seoTitle}
                  onChange={(e) => setSeoTitle(e.target.value)}
                  showOptional
                  error={error("seoTitle")}
                />
                <Textarea
                  form={F}
                  label={f.seoDescription}
                  name="seoDescription"
                  hint={f.seoDescriptionHint}
                  rows={3}
                  maxLength={500}
                  value={seoDescription}
                  onChange={(e) => setSeoDescription(e.target.value)}
                  showOptional
                  error={error("seoDescription")}
                />
                <figure className="grid gap-1">
                  <figcaption className="type-label text-[11.5px] text-muted">{copy.seo.preview}</figcaption>
                  <div className="grid gap-0.5 rounded-control border border-line p-2.5 text-[12.5px]" title={copy.seo.shopNotLive}>
                    <span className="truncate font-mono text-xs text-ok">
                      {shopHost}/product/{product.stockCode}/{slug || product.slug}
                    </span>
                    <span className="text-[15px] leading-snug text-info">{serpTitle}</span>
                    <span className="text-muted">{serpDescription || "—"}</span>
                  </div>
                </figure>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
