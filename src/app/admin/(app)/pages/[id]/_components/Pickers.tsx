"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  Button,
  Drawer,
  EmptyState,
  Field,
  FileInput,
  InlineAlert,
  Spinner,
  SubmitButton,
  Tabs,
  TextInput,
  Thumb,
  buttonClasses,
  cx,
  productStatusLabel,
} from "@/components/admin/ui";
import { BLOCK_CATALOG, imageKeySchema, type BlockCatalogEntry, type ContentBlockType } from "@/server/content/blocks";
import type { ProductStatus } from "@/generated/prisma/enums";
import { copy } from "../../_copy";
import { searchImagesAction, searchProductsAction, uploadBlockImageAction } from "../actions";
import type { PickerImage, PickerProduct } from "./types";

const ti = copy.image;
const MAX_UPLOAD = 25 * 1024 * 1024;

/** Debounced search through a server action; results for the latest query win. */
function useSearch<T>(open: boolean, search: (q: string) => Promise<{ ok: boolean; message?: string; data?: unknown }>) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const latest = useRef(0);

  useEffect(() => {
    if (!open) return;
    const ticket = ++latest.current;
    const timer = setTimeout(() => {
      startTransition(async () => {
        const res = await search(query);
        if (ticket !== latest.current) return;
        if (res.ok) {
          setResults((res.data as T[]) ?? []);
          setError(null);
        } else setError(res.message ?? "Search failed.");
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [open, query, search]);

  return { query, setQuery, results, error, pending };
}

// ─── Image picker ────────────────────────────────────────────────────────────

export function ImagePickerDrawer({
  open,
  onOpenChange,
  onPick,
  pageId,
  tenantId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (key: string) => void;
  pageId: string;
  tenantId: string;
}) {
  const pick = (key: string) => {
    onPick(key);
    onOpenChange(false);
  };
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title={ti.drawerTitle} description={ti.drawerDescription} size="lg">
      {open && (
        <Tabs
          label={ti.drawerTitle}
          items={[
            { id: "products", label: ti.tabProducts, content: <ProductPhotos open={open} onPick={pick} /> },
            { id: "upload", label: ti.tabUpload, content: <UploadImage pageId={pageId} onPick={pick} /> },
            { id: "key", label: ti.tabKey, content: <KeyInput tenantId={tenantId} onPick={pick} /> },
          ]}
        />
      )}
    </Drawer>
  );
}

function ProductPhotos({ open, onPick }: { open: boolean; onPick: (key: string) => void }) {
  const { query, setQuery, results, error, pending } = useSearch<PickerImage>(open, searchImagesAction);
  return (
    <div className="grid gap-3 pt-3">
      <TextInput label={ti.search} labelHidden placeholder={ti.search} type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div aria-live="polite" className="min-h-5 text-xs text-muted">
        {pending ? <Spinner label={ti.searching} /> : results ? `${results.length} photo${results.length === 1 ? "" : "s"}` : null}
      </div>
      {error && <InlineAlert tone="crit">{error}</InlineAlert>}
      {results && results.length === 0 && !pending && <EmptyState compact title={ti.noResults} />}
      {results && results.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">
          {results.map((img) => (
            <li key={img.key}>
              <button
                type="button"
                onClick={() => onPick(img.key)}
                className="grid w-full gap-1 rounded-control border border-line p-1 text-left hover:border-accent focus-visible:border-accent"
              >
                <Thumb src={img.thumbUrl} alt="" size="fill" />
                <span className="line-clamp-2 text-[11.5px] text-ink-2">{img.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UploadImage({ pageId, onPick }: { pageId: string; onPick: (key: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-3 pt-3"
      action={async (formData) => {
        setError(null);
        const file = formData.get("file");
        if (file instanceof File && file.size > MAX_UPLOAD) {
          setError(ti.tooLarge);
          return;
        }
        const res = await uploadBlockImageAction(null, formData);
        if (res.ok && res.data) onPick(res.data.key);
        else setError(res.message ?? "Upload failed.");
      }}
    >
      <input type="hidden" name="pageId" value={pageId} />
      <Field label={ti.uploadLabel} hint={ti.uploadHint} error={error ?? undefined} required>
        {(control) => (
          <FileInput
            {...control}
            name="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            onChange={(e) => {
              const file = e.target.files?.[0];
              setError(file && file.size > MAX_UPLOAD ? ti.tooLarge : null);
            }}
          />
        )}
      </Field>
      <div>
        <SubmitButton pendingLabel={ti.uploading}>{ti.uploadSubmit}</SubmitButton>
      </div>
    </form>
  );
}

function KeyInput({ tenantId, onPick }: { tenantId: string; onPick: (key: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const key = value.trim();
    if (!imageKeySchema.safeParse(key).success || !key.startsWith(`${tenantId}/`)) {
      setError(ti.invalidKey);
      return;
    }
    onPick(key);
  };
  return (
    <div className="grid gap-3 pt-3">
      <TextInput
        label={ti.keyLabel}
        value={value}
        hint={ti.keyHint.replace("{shop}", tenantId)}
        error={error}
        inputClassName="font-mono"
        spellCheck={false}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div>
        <Button variant="primary" onClick={submit}>
          {ti.keySubmit}
        </Button>
      </div>
    </div>
  );
}

// ─── Product picker ──────────────────────────────────────────────────────────

export function ProductPickerDrawer({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (product: PickerProduct) => void;
}) {
  const tp = copy.product;
  const { query, setQuery, results, error, pending } = useSearch<PickerProduct>(open, searchProductsAction);
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title={tp.drawerTitle} size="md">
      <div className="grid gap-3">
        <TextInput label={tp.search} labelHidden placeholder={tp.search} type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div aria-live="polite" className="min-h-5 text-xs text-muted">
          {pending ? <Spinner label={ti.searching} /> : null}
        </div>
        {error && <InlineAlert tone="crit">{error}</InlineAlert>}
        {results && results.length === 0 && !pending && <EmptyState compact title={tp.noResults} />}
        {results && results.length > 0 && (
          <ul className="grid divide-y divide-line rounded-control border border-line">
            {results.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                <Thumb src={p.thumbUrl} alt="" size="sm" />
                <div className="grid min-w-0 flex-1">
                  <span className="truncate text-[13.5px]">{p.title}</span>
                  <span className="font-mono text-xs text-muted">
                    #{p.stockCode} · {productStatusLabel(p.status as ProductStatus)}
                  </span>
                </div>
                <Button
                  size="sm"
                  aria-label={`${tp.select} ${p.title}`}
                  onClick={() => {
                    onPick(p);
                    onOpenChange(false);
                  }}
                >
                  {tp.select}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}

// ─── Add block ───────────────────────────────────────────────────────────────

const GROUP_ORDER: BlockCatalogEntry["group"][] = ["text", "media", "shop", "engagement"];

export function AddBlockDrawer({
  open,
  onOpenChange,
  onAdd,
  hasHero,
  newsletterEnabled,
  pending,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (type: ContentBlockType) => void;
  hasHero: boolean;
  newsletterEnabled: boolean;
  pending: boolean;
  error: string | null;
}) {
  const tp = copy.picker;
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title={tp.title} description={tp.description} size="lg">
      <div className="grid gap-5">
        {error && (
          <InlineAlert tone="crit" live="alert">
            {error}
          </InlineAlert>
        )}
        {GROUP_ORDER.map((group) => (
          <section key={group} aria-labelledby={`grp-${group}`} className="grid gap-2">
            <h3 id={`grp-${group}`} className="type-label text-xs text-muted">
              {tp.groups[group]}
            </h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {BLOCK_CATALOG.filter((e) => e.group === group).map((entry) => {
                const reason = entry.firstOnly && hasHero ? tp.heroTaken : entry.requiresFeature === "newsletter" && !newsletterEnabled ? tp.needsNewsletter : null;
                const reasonId = `why-${entry.type}`;
                return (
                  <li key={entry.type}>
                    <button
                      type="button"
                      disabled={!!reason || pending}
                      aria-describedby={reason ? reasonId : undefined}
                      onClick={() => onAdd(entry.type)}
                      className={cx(
                        "grid h-full w-full content-start gap-1 rounded-card border border-line bg-panel p-3 text-left transition-colors",
                        "enabled:hover:border-accent enabled:hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60",
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[13.5px] font-semibold text-ink">{entry.label}</span>
                        <span className="font-mono text-[10.5px] text-muted" title={copy.picker.iconLabel}>
                          {entry.icon}
                        </span>
                      </span>
                      <span className="text-[12.5px] text-ink-2">{entry.description}</span>
                      {reason && (
                        <span id={reasonId} className="text-[12px] text-warn">
                          {reason}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        <div>
          <button type="button" className={buttonClasses()} onClick={() => onOpenChange(false)}>
            Cancel
          </button>
        </div>
      </div>
    </Drawer>
  );
}
