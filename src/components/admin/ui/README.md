# Admin UI kit

Shared building blocks for admin screens, styled after design A ("Depot") and themed through the
semantic tokens in `src/app/globals.css`. B and C restyle everything automatically.

```ts
import { DataTable, TextInput, MoneyInput, SubmitButton, toast } from "@/components/admin/ui";
```

Kitchen sink (dev only): **`/admin/dev/ui`** (`src/app/admin/(app)/dev/ui/page.tsx`).

## Ground rules

- **Semantic utilities only**: `bg-panel`, `text-muted`, `border-line`, `bg-accent`, `text-on-accent`,
  `text-ok|warn|crit|info`, `rounded-card|control`, `shadow-card|pop`, `type-display`, `type-label`,
  `font-mono`. Never a hex value or a theme-specific font. In arbitrary values use `var(--qm-*)`
  (for example `var(--qm-img-a)`). `var(--color-*)` is **not** emitted because the theme uses
  `@theme inline`.
- **Server first.** Everything without `"use client"` below works in server components. Client
  components can be rendered from server components as usual.
- **Fixed UI copy** lives in `src/lib/i18n/en.ts` (`ui.*` for the kit). Screen-specific copy goes in
  your own key.
- **Money** is always an integer in minor units (cents) plus a currency (`Tenant.currency`).
  **Dates** are shown in `Tenant.timezone`. Defaults: `EUR`, `Europe/Amsterdam`, locale `en-NL`
  ("€1,234.50").
- Focus rings come from the global `:focus-visible` rule. Do not remove outlines. Motion is turned off
  under `prefers-reduced-motion` globally.

## Mount the toaster (one time, shell owner)

`toast()` needs one `<Toaster/>` inside the admin theme root. Add it to
`src/app/admin/(app)/layout.tsx`:

```tsx
<AdminShell sidebar={…}>
  <main className="flex min-w-0 flex-1 flex-col">{children}</main>
  <Toaster />
</AdminShell>
```

Only the first mounted `<Toaster/>` renders, so the extra one in the kitchen sink does no harm.

---

## Forms with server actions

The convention: actions return `ActionResult` = `{ ok, message?, fieldErrors? }`.

```ts
// app/admin/(app)/inventory/actions.ts
"use server";
import { z } from "zod";
import { actionFail, actionOk, zodFieldErrors, type ActionResult, type ActionState } from "@/components/admin/ui";

const schema = z.object({ title: z.string().trim().min(3, "Enter at least 3 characters."), price: z.coerce.number().int().min(0) });

export async function saveProduct(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const parsed = schema.safeParse({ title: formData.get("title"), price: formData.get("price") });
  if (!parsed.success) return actionFail("Check the highlighted fields.", zodFieldErrors(parsed.error));
  // …authorise, tenant-scope, write, revalidatePath(…)
  return actionOk("Product saved.");
}
```

```tsx
"use client";
import { ActionMessage, ActionToast, FormActions, MoneyInput, SubmitButton, TextInput, useActionForm } from "@/components/admin/ui";
import { saveProduct } from "./actions";

export function ProductForm({ product }: { product: { title: string; price: number } }) {
  const { state, formAction, error } = useActionForm(saveProduct);
  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <ActionMessage state={state} showSuccess={false} /> {/* error summary, role=alert */}
      <ActionToast state={state} errors={false} />        {/* success as toast */}
      <TextInput label="Title" name="title" defaultValue={product.title} required error={error("title")} />
      <MoneyInput label="Price" name="price" defaultValue={product.price} required error={error("price")} />
      <FormActions>
        <SubmitButton>Save</SubmitButton>
      </FormActions>
    </form>
  );
}
```

- `useActionForm(action)` wraps `useActionState(action, null)` and returns `{ state, formAction, pending, error(name) }`.
  Without the hook, use `useActionState` and `fieldError(state, "title")`.
- `fieldErrors` keys are field names; nested zod paths are joined with dots (`variants.0.price`).
- React resets uncontrolled fields after a form action finishes. If a failed submit must keep the typed
  values, return them in the result and pass them as `defaultValue`, or make the fields controlled.
  (`MoneyInput`, `TagInput` and `Dropzone` keep their own state.)
- `formString(formData, name)` reads a trimmed string.

## Form controls

All controls take the field props `label`, `hint`, `error` (string or string[]), `required`,
`showOptional`, `labelHidden`, `id`, `className`. With `label` they render a full `Field` that wires up
`id`, `aria-describedby` (error + hint) and `aria-invalid`. Without `label` you get the bare control
(give it an `aria-label`). All other native attributes pass through.

| Component | Client | Key props |
| --- | --- | --- |
| `Field` | – | field props + `children` (node or `(controlProps) => node` for custom controls) |
| `TextInput` | – | native input props, `leading`, `trailing` (adornments such as "cm"), `inputClassName` |
| `NumberInput` | – | as TextInput, mono tabular figures, `inputMode="decimal"` |
| `DateInput` | – | `kind`: `date` \| `datetime-local` \| `time` \| `month` |
| `Textarea` | – | native textarea props (`rows` default 4) |
| `Select` | – | `options` (`{value,label,disabled}` or groups `{label, options}`), `placeholder` (true or text), or `children` |
| `Checkbox` | – | `label`, `description`, `error`, native checkbox props |
| `Switch` | – | as Checkbox, `layout="inline" \| "row"` (row = settings row with divider). Submits `"on"` like a checkbox |
| `RadioGroup` | – | `name`, `legend`, `options` (`{value,label,description,disabled}`), `defaultValue` or `value`+`onValueChange` |
| `SegmentedControl` | – | same as RadioGroup, design A `.seg`; `size="sm"` |
| `MoneyInput` | yes | `name` (hidden input with **minor units**), `defaultValue`/`value` (minor), `onValueChange`, `currency`, `locale`, `allowNegative` |
| `TagInput` | yes | `name` (one entry per tag: `formData.getAll(name)`), `defaultValue`/`value`, `onValueChange`, `suggestions`, `maxTags`, `normalize` |
| `SubmitButton` | yes | Button props + `pendingLabel` (uses `useFormStatus`; disabled + spinner while pending) |
| `FormActions` | – | `children` (buttons, primary last), `start` (left content), `sticky` |

`MoneyInput` accepts `12,50`, `12.50`, `1.234,56`, `1,234.56`, `€ 12`, `12,-`. One separator followed by
exactly three digits is read as a thousands separator (`1.234` → €1,234.00). Server side, read the
hidden value with `Number(formData.get("price"))`, or parse free text with `parseMoney(text, currencyDigits(currency))`.

Class helpers for custom controls: `controlClass`, `labelClass`, `hintClass`, `errorClass`, `groupClass`.

## Lists (inventory, orders, customers)

List state lives in the URL: `?view=…&q=…&status=…&sort=-price&page=2`. Pages receive
`searchParams` as a Promise. Await it and pass the object down.

```tsx
// app/admin/(app)/inventory/page.tsx (server component)
import { DataTable, FilterBar, FilterChip, FilterSelect, ClearFiltersLink, Money, Pagination, ProductStatusPill,
  SearchInput, Thumb, ViewTabs, parsePage, parseSort, getParam, buttonClasses, type Column } from "@/components/admin/ui";
import { archiveProducts } from "./actions";

export default async function InventoryPage({ searchParams }: PageProps<"/admin/inventory">) {
  const sp = await searchParams;
  const basePath = "/admin/inventory";
  const page = parsePage(sp.page);
  const sort = parseSort(sp.sort, ["title", "price", "updatedAt"] as const); // { key, dir } | null
  const { rows, total, counts } = await listProducts({ page, sort, q: getParam(sp, "q"), view: getParam(sp, "view") });

  const columns: Column<Row>[] = [
    { key: "title", header: "Item", sortKey: "title", cell: (r) => <><Thumb src={r.thumb} alt="" /> {r.title}</> },
    { key: "status", header: "Status", cell: (r) => <ProductStatusPill status={r.status} /> },
    { key: "price", header: "Price", numeric: true, sortKey: "price", cell: (r) => <Money amount={r.price} currency={r.currency} mono /> },
  ];

  return (
    <DataTable
      caption="Inventory"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      rowLabel={(r) => r.title}
      selectable
      bulkAction={archiveProducts}  // receives formData.getAll("ids")
      bulkActions={<button type="submit" name="op" value="archive" className={buttonClasses({ size: "sm" })}>Archive</button>}
      sorting={{ sort: getParam(sp, "sort"), basePath, searchParams: sp }}
      toolbar={<>
        <ViewTabs basePath={basePath} searchParams={sp} active={getParam(sp, "view")}
          views={[{ value: null, label: "All", count: counts.all }, { value: "for-sale", label: "For sale", count: counts.forSale }]} />
        <FilterBar end={<ClearFiltersLink params={["q", "status"]} basePath={basePath} searchParams={sp} />}>
          <SearchInput placeholder="Search title or SKU…" />
          <FilterSelect param="status" label="Status" options={[{ value: "SOLD", label: "Sold" }]} />
          <FilterChip param="q" label="Search" basePath={basePath} searchParams={sp} />
        </FilterBar>
      </>}
      footer={<Pagination page={page} pageSize={25} total={total} basePath={basePath} searchParams={sp} />}
    />
  );
}
```

| Component | Client | Key props |
| --- | --- | --- |
| `DataTable<T>` | – (renders client bits) | `columns: Column<T>[]`, `rows`, `rowKey`, `caption` (accessible name), `selectable`, `rowLabel`, `bulkActions`, `bulkAction`, `sorting`, `empty`, `stickyHeader` (default true), `maxHeight` (scroll inside the table, so the header sticks), `rowClassName`, `toolbar`, `footer` |
| `Column<T>` | – | `key`, `header`, `cell(row, i)`, `numeric` (right-aligned, tabular), `align`, `width`, `sortKey`, `hideBelow: "sm"\|"md"\|"lg"`, `className`, `headerClassName` |
| `DataTableSkeleton` | – | `columns`, `rows`, `selectable`, `toolbar`, `label`. Use it in `loading.tsx` |
| `Pagination` | – | `page`, `pageSize`, `total`, `basePath`, `searchParams`, `param="page"` |
| `ViewTabs` | – | `views: {value: string \| null, label, count?}[]`, `active`, `basePath`, `searchParams`, `param="view"`. Resets the page |
| `FilterBar` | – | `children`, `end` (right side) |
| `FilterChip` | – | `param`, `label`, `valueLabel?`, `basePath`, `searchParams`, `addHref?` (dashed "+ label" chip when unset). Set chips get a remove link |
| `ClearFiltersLink` | – | `params`, `basePath`, `searchParams` |
| `FilterSelect` | yes | `param`, `label`, `options`, `anyLabel`. Writes the URL param on change |
| `SearchInput` | yes | `param="q"`, `label`, `placeholder`, `debounceMs=300`. Uses `router.replace` and resets the page |
| `SortLink` / `ariaSort` | – | Header link (DataTable adds it for columns with `sortKey`). `?sort=key` ascending, `?sort=-key` descending |
| `SelectionProvider`, `useSelection()`, `RowCheckbox`, `SelectAllCheckbox`, `BulkActionBar` | yes | Use these to build selection outside DataTable. `useSelection()` returns `{ ids, selected, toggle, setAll, clear }` |

Bulk bar: while rows are selected, a dark bar shows "N selected" and your buttons. The buttons sit
inside a `<form>` that holds one hidden `ids` input per selected row. Use `bulkAction` (form action)
with `name="op" value="…"` buttons, or set `formAction={…}` on each button. For destructive bulk
operations, use a `ConfirmDialog` inside `bulkActions` instead of a plain submit button.

Helpers: `hrefWith(basePath, searchParams, patch)` (`null` removes a param), `getParam`, `parsePage`,
`parseSort`. `SearchInput` and `FilterSelect` call `useSearchParams`. Admin pages render dynamically,
so they work as they are. On a statically rendered page, wrap them in `<Suspense>`.

## Feedback

| Component | Client | Key props |
| --- | --- | --- |
| `toast(title, opts)`, `toast.ok/info/warn/crit`, `toast.dismiss(id?)` | call from client code | `opts`: `description`, `duration` (ms, 0 = sticky; default 5s, crit 8s), `action: {label, onClick}` |
| `Toaster` | yes | mount one time (see above). Polite live region; crit toasts use `role=alert`. Toasts are click-through (only their buttons take the pointer), so they never block controls underneath; hovering or focusing a toast button pauses dismissal |
| `ActionToast` | yes | `state` (ActionResult), `errors` (also toast failures, default true) |
| `InlineAlert` | – | `tone: info\|ok\|warn\|crit`, `title`, `children`, `action`, `live: "none"\|"status"\|"alert"` |
| `ActionMessage` | – | `state`, `showSuccess`. Shows ActionResult message as an InlineAlert |
| `EmptyState` | – | `title`, `body`, `action`, `icon`, `compact` |
| `ConfirmDialog` | yes | `trigger` (label), `title`, `description`, `confirmLabel`, `tone: "danger"\|"primary"`, `action` (server action / fn of FormData), `fields` (hidden inputs), `children` (extra inputs), `triggerVariant`, `triggerSize`, `triggerLabel`, `disabled` |
| `Drawer` | yes | `title`, `description`, `children`, `footer`, `size: md\|lg\|xl`, `open`+`onOpenChange` **or** `trigger`, `dismissible` |
| `Tabs` | yes | `items: {id, label, content, badge?, disabled?}[]`, `label`, `defaultValue` / `value`+`onValueChange`. Inactive panels stay mounted |
| `Tooltip` | – | `content`, one focusable child, `side`. Supplementary text only |
| `Skeleton`, `SkeletonText` | – | `className` (size), `rounded`; `lines` |
| `Spinner` | – | `label` (optional, makes it a status) |

`ConfirmDialog` is for destructive or irreversible steps (archive, delete, refund, cancel order).
If `action` returns `{ ok: false, message }`, the dialog stays open and shows the message. If it
returns `{ ok: true, message }`, the dialog closes and shows a success toast. A `redirect()` in the
action navigates as usual.

```tsx
<ConfirmDialog trigger="Archive" title="Archive this item?" description="It disappears from the shop."
  confirmLabel="Archive" action={archiveProduct} fields={{ id: product.id }} />
```

Both dialogs use native `<dialog>.showModal()`: the page behind becomes inert, Esc closes, and focus
returns to the trigger. ConfirmDialog focuses Cancel first.

## Display

| Component | Client | Key props |
| --- | --- | --- |
| `Money` | – | `amount` (minor units; null → "—"), `currency`, `locale`, `signed`, `mono` |
| `DateTime` | – | `value` (Date/ISO/ms), `format: "datetime"\|"date"\|"time"\|"long"\|"relative"`, `timeZone`, `locale`, `now`. The `title` always holds the full date |
| `ProductStatusPill`, `PaymentStatusPill`, `FulfillmentStatusPill` | – | `status` (Prisma enum). Tone maps `PRODUCT_STATUS_TONE` etc. and labels `productStatusLabel()` etc. are exported |
| `Thumb` | – | `src?`, `alt` ("" when decorative), `size: xs\|sm\|md\|lg\|xl\|fill`, `placeholderLabel`. Shows striped placeholder when no `src` |
| `KeyValue` | – | `items: {label, value, mono?}[]`, `layout: "split"\|"stacked"` |
| `Timeline` | – | `items: {id?, title, meta?, body?, highlight?, tone?}[]` |

Format helpers: `formatMoney(minor, currency, locale)`, `formatMoneyInput`, `parseMoney`,
`currencyDigits`, `currencySymbol`, `formatDate(date, format, timeZone, locale)`, `formatRelative`.

`DateTime format="relative"` is computed at render time. In a server component, pass one `now` to
every row of a list so they use the same reference time.

## Media

`Dropzone` (client) accepts drag and drop, paste (⌘V / Ctrl+V anywhere on the page, but not while
typing in another field) and a file picker. It shows previews in a grid. The first image is the cover.
Reorder by dragging, or with the ← → buttons on each tile for keyboard users. Moves are announced.

| Prop | |
| --- | --- |
| `label`, `hint`, `error`, `required` | field chrome |
| `items` + `onItemsChange` **or** `defaultItems` | `DropzoneItem = { id, url, name, file?, status?: "uploading"\|"error", error? }` |
| `onFilesAdded(files, addedItems)` | start uploads here; then update the item `status` through controlled `items` |
| `onRemove(item)`, `onReorder(ids)` | persist removals and order |
| `accept` (default `image/*`), `multiple`, `maxFiles`, `maxSizeBytes` | rejected files are listed with reasons |
| `name`, `orderName` | plain-form fallback: new files go into a file input `name`; the id order goes into hidden `orderName` (comma separated) |
| `cover`, `pasteScope: "document"\|"zone"`, `disabled` | |

The component does not upload. The media agent's server action decides whether to use the callbacks
(upload each file, then replace `new-…` ids with media ids) or the plain-form fallback.

## Existing primitives

Also re-exported from the kit: `Button`, `buttonClasses`, `Card`, `KpiCard`, `PageHeader`,
`StatusPill`, `WipBadge`.
