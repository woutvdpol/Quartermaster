import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ClearFiltersLink,
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  SearchInput,
  StatusPill,
  ViewTabs,
  buttonClasses,
  getParam,
  hrefWith,
  type Column,
  type SearchParamsRecord,
} from "@/components/admin/ui";
import { requireStaffContext, ServiceError } from "@/server/context";
import { getCategory, listCategoryTree, type CategoryNode } from "@/server/catalog/categories";
import { listTags, type TagRow } from "@/server/catalog/tags";
import { flattenCategories } from "../inventory/_data";
import { copy } from "./_copy";
import { CategoryDrawer, type CategoryFormValues } from "./_components/CategoryDrawer";
import { MoveButtons } from "./_components/MoveButtons";
import { NewTagForm } from "./_components/NewTagForm";
import { TagBulkActions } from "./_components/TagBulkActions";
import { TagDrawer } from "./_components/TagDrawer";

export const metadata: Metadata = { title: copy.title };

const BASE = "/admin/categories";
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Ids of `node` and all its descendants. */
function subtreeIds(node: CategoryNode): Set<string> {
  const out = new Set<string>([node.id]);
  const walk = (n: CategoryNode) => n.children.forEach((c) => (out.add(c.id), walk(c)));
  walk(node);
  return out;
}

function findNode(nodes: CategoryNode[], id: string): CategoryNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

export default async function CategoriesPage({ searchParams }: PageProps<"/admin/categories">) {
  const sp = (await searchParams) as SearchParamsRecord;
  const ctx = await requireStaffContext();
  const tab = getParam(sp, "tab") === "tags" ? "tags" : "categories";
  const q = getParam(sp, "q")?.trim().slice(0, 100) || undefined;

  const [tree, allTags] = await Promise.all([listCategoryTree(ctx), listTags(ctx)]);
  const tags = q && tab === "tags" ? await listTags(ctx, { search: q }) : allTags;
  const flat = flattenCategories(tree);
  const categorisedProducts = tree.reduce((s, n) => s + n.totalProductCount, 0);

  const tabs = (
    <ViewTabs
      basePath={BASE}
      searchParams={{}}
      param="tab"
      label={copy.tabs.label}
      active={tab === "tags" ? "tags" : null}
      views={[
        { value: null, label: copy.tabs.categories, count: flat.length },
        { value: "tags", label: copy.tabs.tags, count: allTags.length },
      ]}
      className="border-b border-line bg-panel"
    />
  );

  if (tab === "tags") {
    const editId = getParam(sp, "tag");
    const editing = editId ? allTags.find((tg) => tg.id === editId) : undefined;
    const closeHref = hrefWith(BASE, sp, { tag: null });
    const columns: Column<TagRow>[] = [
      {
        key: "name",
        header: copy.tags.name,
        cell: (tg) => (
          <Link href={hrefWith(BASE, sp, { tag: tg.id })} scroll={false} className="font-medium text-ink hover:underline" aria-label={copy.tags.editLabel(tg.name)}>
            {tg.name}
          </Link>
        ),
      },
      { key: "slug", header: copy.tags.slug, hideBelow: "sm", cell: (tg) => <span className="font-mono text-xs text-muted">{tg.slug}</span> },
      {
        key: "products",
        header: copy.tags.products,
        numeric: true,
        cell: (tg) =>
          tg.productCount > 0 ? (
            <Link href={`/admin/inventory?view=all&tag=${encodeURIComponent(tg.id)}`} className="font-mono text-ink hover:underline">
              {tg.productCount}
            </Link>
          ) : (
            <span className="font-mono text-muted">0</span>
          ),
      },
    ];

    return (
      <>
        <PageHeader crumb={copy.crumb} title={copy.title} />
        {tabs}
        <div className="grid content-start gap-3 p-4 md:px-[22px] md:py-5">
          <DataTable
            caption={copy.tags.caption}
            columns={columns}
            rows={tags}
            rowKey={(tg) => tg.id}
            rowLabel={(tg) => tg.name}
            selectable
            empty={
              <EmptyState compact title={q ? copy.tags.emptySearch : copy.tags.emptyTitle} body={q ? undefined : copy.tags.emptyBody} />
            }
            toolbar={
              <>
                <FilterBar end={<ClearFiltersLink params={["q"]} basePath={BASE} searchParams={sp} />}>
                  <NewTagForm />
                  <SearchInput label={copy.tags.searchLabel} placeholder={copy.tags.searchPlaceholder} />
                </FilterBar>
                <TagBulkActions tags={allTags.map(({ id, name, productCount }) => ({ id, name, productCount }))} />
              </>
            }
          />
        </div>
        {editing && <TagDrawer key={editing.id} tag={editing} closeHref={closeHref} />}
      </>
    );
  }

  // ── Categories tab ──
  const editId = getParam(sp, "edit");
  const creating = getParam(sp, "new") === "1";
  const parentParam = getParam(sp, "parent");
  const closeHref = hrefWith(BASE, sp, { edit: null, new: null, parent: null });

  let drawer: ReactNode = null;
  if (editId && ID_RE.test(editId)) {
    const node = findNode(tree, editId);
    const cat = node
      ? await getCategory(ctx, editId).catch((err) => {
          if (err instanceof ServiceError && err.code === "NOT_FOUND") return null;
          throw err;
        })
      : null;
    if (node && cat) {
      const excluded = subtreeIds(node);
      const options = flat.filter((c) => !excluded.has(c.id)).map((c) => ({ value: c.id, label: c.path }));
      const initial: CategoryFormValues = {
        id: cat.id,
        title: cat.title,
        parentId: cat.parentId,
        slug: cat.slug,
        isActive: cat.isActive,
        description: cat.description ?? "",
        seoTitle: cat.seoTitle ?? "",
        seoDescription: cat.seoDescription ?? "",
      };
      drawer = (
        <CategoryDrawer
          key={cat.id}
          initial={initial}
          parentOptions={options}
          reassignOptions={options}
          contents={{ products: node.productCount, children: node.children.length }}
          closeHref={closeHref}
        />
      );
    }
  } else if (creating) {
    const parentId = parentParam && flat.some((c) => c.id === parentParam) ? parentParam : null;
    drawer = (
      <CategoryDrawer
        key={`new-${parentId ?? "root"}`}
        initial={{ title: "", parentId, slug: "", isActive: true, description: "", seoTitle: "", seoDescription: "" }}
        parentOptions={flat.map((c) => ({ value: c.id, label: c.path }))}
        reassignOptions={[]}
        closeHref={closeHref}
      />
    );
  }

  const newHref = hrefWith(BASE, {}, { new: 1 });

  function renderNodes(nodes: CategoryNode[], depth: number) {
    return (
      <ul className="grid">
        {nodes.map((n, i) => (
          <li key={n.id}>
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2 pr-3 hover:bg-panel-2"
              style={{ paddingLeft: `calc(0.875rem + ${depth} * 1.5rem)` }}
            >
              <MoveButtons id={n.id} title={n.title} parentId={n.parentId} index={i} siblingCount={nodes.length} />
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                {depth > 0 && (
                  <span aria-hidden="true" className="text-muted">
                    └
                  </span>
                )}
                <Link
                  href={hrefWith(BASE, {}, { edit: n.id })}
                  scroll={false}
                  className="truncate font-medium text-ink hover:underline"
                  aria-label={copy.categories.editLabel(n.title)}
                >
                  {n.title}
                </Link>
                <span className="hidden truncate font-mono text-xs text-muted sm:inline">/{n.slug}</span>
                {!n.isActive && <StatusPill tone="mute">{copy.categories.inactive}</StatusPill>}
              </div>
              <Link
                href={`/admin/inventory?view=all&category=${encodeURIComponent(n.id)}`}
                className="text-xs whitespace-nowrap text-muted tabular-nums hover:text-ink hover:underline"
                aria-label={`${copy.categories.viewProductsLabel(n.title)}: ${copy.categories.products(n.productCount, n.totalProductCount)}`}
              >
                {copy.categories.products(n.productCount, n.totalProductCount)}
              </Link>
              <span className="flex items-center gap-1">
                <Link
                  href={hrefWith(BASE, {}, { new: 1, parent: n.id })}
                  scroll={false}
                  className={buttonClasses({ variant: "ghost", size: "sm" })}
                  aria-label={copy.categories.addChildLabel(n.title)}
                >
                  <span aria-hidden="true">+</span>
                  <span className="max-md:sr-only">{copy.categories.addChild}</span>
                </Link>
                <Link
                  href={hrefWith(BASE, {}, { edit: n.id })}
                  scroll={false}
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                  aria-label={copy.categories.editLabel(n.title)}
                >
                  {copy.categories.edit}
                </Link>
              </span>
            </div>
            {n.children.length > 0 && renderNodes(n.children, depth + 1)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <PageHeader
        crumb={copy.crumb}
        title={copy.title}
        actions={
          <Link href={newHref} scroll={false} className={buttonClasses({ variant: "primary" })}>
            <span aria-hidden="true">+</span> {copy.categories.new}
          </Link>
        }
      />
      {tabs}
      <div className="grid content-start gap-3 p-4 md:px-[22px] md:py-5">
        {tree.length === 0 ? (
          <div className="rounded-card border border-line bg-panel shadow-card">
            <EmptyState
              title={copy.categories.emptyTitle}
              body={copy.categories.emptyBody}
              action={
                <Link href={newHref} scroll={false} className={buttonClasses({ variant: "primary" })}>
                  {copy.categories.new}
                </Link>
              }
            />
          </div>
        ) : (
          <section aria-label={copy.categories.treeLabel} className="overflow-hidden rounded-card border border-line bg-panel shadow-card">
            <p className="border-b border-line px-3.5 py-2 text-xs text-muted">{copy.categories.summary(flat.length, categorisedProducts)}</p>
            <div className="-mb-px">{renderNodes(tree, 0)}</div>
          </section>
        )}
      </div>
      {drawer}
    </>
  );
}
