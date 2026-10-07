import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, EmptyState, PageHeader, StatusPill, ViewTabs, buttonClasses, cx, getParam, hrefWith, type SearchParamsRecord } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { listTags } from "@/server/catalog/tags";
import { FACET_KIND_LABELS, buildValueTree, descendantIds, flattenValueTree, getFacet, getTaxonomy, listFacets, valuePaths, type FacetValueRow, type ValueNode } from "@/server/facets";
import { facetValueHref } from "@/server/storefront-catalog/urls";
import { copy } from "./_copy";
import { ConvertTagsForm } from "./_components/ConvertTagsForm";
import { FacetDrawer } from "./_components/FacetDrawer";
import { MoveButtons } from "./_components/MoveButtons";
import { SeedButton } from "./_components/SeedButton";
import { ValueDrawer } from "./_components/ValueDrawer";

export const metadata: Metadata = { title: copy.title };

const BASE = "/admin/facets";

export default async function FacetsPage({ searchParams }: PageProps<"/admin/facets">) {
  const sp = (await searchParams) as SearchParamsRecord;
  const ctx = await requireStaffContext();
  const tab = getParam(sp, "tab") === "convert" ? "convert" : "values";
  const facets = await listFacets(ctx);

  if (facets.length === 0) {
    return (
      <>
        <PageHeader crumb={copy.crumb} title={copy.title} />
        <div className="grid content-start gap-3 p-4 md:px-[22px] md:py-5">
          <div className="rounded-card border border-line bg-panel shadow-card">
            <EmptyState
              title={copy.empty.title}
              body={copy.empty.body}
              action={
                <div className="flex flex-wrap items-start justify-center gap-2">
                  <SeedButton />
                  <Link href={hrefWith(BASE, {}, { newFacet: 1 })} scroll={false} className={buttonClasses({ variant: "secondary" })}>
                    {copy.facets.new}
                  </Link>
                </div>
              }
            />
          </div>
        </div>
        {getParam(sp, "newFacet") === "1" && (
          <FacetDrawer initial={{ name: "", kind: "CUSTOM", slug: "", isFilterable: true }} closeHref={BASE} deletedHref={BASE} />
        )}
      </>
    );
  }

  const selectedId = facets.some((f) => f.id === getParam(sp, "facet")) ? getParam(sp, "facet")! : facets[0].id;
  const facet = await getFacet(ctx, selectedId);
  const keep: Record<string, string> = tab === "convert" ? { tab: "convert", facet: selectedId } : { facet: selectedId };

  // ── Drawers (URL driven) ──
  let drawer: ReactNode = null;
  const close = hrefWith(BASE, {}, keep);
  const editFacetId = getParam(sp, "editFacet");
  const editValueId = getParam(sp, "value");
  if (getParam(sp, "newFacet") === "1") {
    drawer = <FacetDrawer initial={{ name: "", kind: "CUSTOM", slug: "", isFilterable: true }} closeHref={close} deletedHref={BASE} />;
  } else if (editFacetId) {
    const f = facets.find((x) => x.id === editFacetId);
    if (f) {
      drawer = (
        <FacetDrawer
          key={f.id}
          initial={{ id: f.id, name: f.name, kind: f.kind, slug: f.slug, isFilterable: f.isFilterable, valueCount: f.valueCount, productCount: f.productCount }}
          closeHref={close}
          deletedHref={BASE}
        />
      );
    }
  } else if (getParam(sp, "newValue") === "1") {
    const parent = getParam(sp, "parent");
    const parentId = parent && facet.values.some((v) => v.id === parent) ? parent : null;
    drawer = (
      <ValueDrawer
        key={`new-${parentId ?? "root"}`}
        initial={{ facetId: facet.id, name: "", slug: "", parentId }}
        parentOptions={pathOptions(facet.values, facet.values)}
        mergeOptions={[]}
        closeHref={close}
      />
    );
  } else if (editValueId) {
    const v = facet.values.find((x) => x.id === editValueId);
    if (v) {
      const excluded = new Set(descendantIds(facet.values, v.id));
      const allowed = facet.values.filter((x) => !excluded.has(x.id));
      drawer = (
        <ValueDrawer
          key={v.id}
          initial={{
            id: v.id,
            facetId: facet.id,
            name: v.name,
            slug: v.slug,
            parentId: v.parentId,
            productCount: v.productCount,
            childCount: facet.values.filter((x) => x.parentId === v.id).length,
          }}
          parentOptions={pathOptions(facet.values, allowed)}
          mergeOptions={pathOptions(facet.values, allowed)}
          closeHref={close}
        />
      );
    }
  }

  const tabs = (
    <ViewTabs
      basePath={BASE}
      searchParams={{ facet: selectedId }}
      param="tab"
      label={copy.tabs.label}
      active={tab === "convert" ? "convert" : null}
      views={[
        { value: null, label: copy.tabs.values, count: facet.valueCount },
        { value: "convert", label: copy.tabs.convert },
      ]}
      className="border-b border-line bg-panel"
    />
  );

  const facetList = (
    <Card title={copy.facets.listLabel} padded={false} aside={<SeedButtonLink />}>
      <ul className="grid">
        {facets.map((f, i) => {
          const current = f.id === selectedId;
          return (
            <li key={f.id} className={cx("flex items-center gap-2 border-b border-line py-2 pr-2 pl-1.5 last:border-b-0", current && "bg-panel-2")}>
              <MoveButtons kind="facet" id={f.id} index={i} count={facets.length} upLabel={copy.facets.moveUp(f.name)} downLabel={copy.facets.moveDown(f.name)} />
              <Link href={hrefWith(BASE, {}, tab === "convert" ? { tab: "convert", facet: f.id } : { facet: f.id })} aria-current={current ? "true" : undefined} className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={cx("truncate font-medium text-ink", current && "underline underline-offset-4")}>{f.name}</span>
                  <span className="font-mono text-[11px] text-muted">{FACET_KIND_LABELS[f.kind]}</span>
                  {!f.isFilterable && <StatusPill tone="mute">{copy.facets.hidden}</StatusPill>}
                </span>
                <span className="block text-xs text-muted tabular-nums">{copy.facets.summary(f.valueCount, f.productCount)}</span>
              </Link>
              <Link
                href={hrefWith(BASE, {}, { ...keep, editFacet: f.id })}
                scroll={false}
                className={buttonClasses({ variant: "ghost", size: "sm" })}
                aria-label={copy.facets.editLabel(f.name)}
              >
                {copy.facets.edit}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );

  let main: ReactNode;
  if (tab === "convert") {
    const [tags, taxonomy] = await Promise.all([listTags(ctx), getTaxonomy(ctx)]);
    main = (
      <Card title={copy.convert.heading}>
        <p className="mb-4 text-sm text-muted">{copy.convert.intro}</p>
        <ConvertTagsForm
          tags={tags.map((tg) => ({ id: tg.id, name: tg.name, productCount: tg.productCount }))}
          facets={taxonomy.map((f) => ({ id: f.id, name: f.name, values: f.values.map((v) => ({ id: v.id, label: v.path })) }))}
        />
      </Card>
    );
  } else {
    const newValueHref = hrefWith(BASE, {}, { ...keep, newValue: 1 });
    main = (
      <Card
        title={copy.values.heading(facet.name)}
        padded={false}
        aside={
          <Link href={newValueHref} scroll={false} className={buttonClasses({ variant: "secondary", size: "sm" })}>
            <span aria-hidden="true">+</span> {copy.values.new}
          </Link>
        }
      >
        {facet.tree.length === 0 ? (
          <EmptyState compact title={copy.values.emptyTitle} body={copy.values.emptyBody} />
        ) : (
          <ValueTree nodes={facet.tree} keep={keep} facetSlug={facet.slug} filterable={facet.isFilterable} />
        )}
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        crumb={copy.crumb}
        title={copy.title}
        actions={
          <Link href={hrefWith(BASE, {}, { ...keep, newFacet: 1 })} scroll={false} className={buttonClasses({ variant: "primary" })}>
            <span aria-hidden="true">+</span> {copy.facets.new}
          </Link>
        }
      />
      {tabs}
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
        <div className="min-w-0">{facetList}</div>
        <div className="min-w-0">{main}</div>
      </div>
      {drawer}
    </>
  );
}

/** "Add missing standard facets" in the list header (idempotent). */
function SeedButtonLink() {
  return <SeedButton label={copy.facets.addStandard} variant="ghost" />;
}

/** Select options with " › " paths, depth-first, limited to `allowed`. */
function pathOptions(all: FacetValueRow[], allowed: FacetValueRow[]) {
  const paths = valuePaths(all);
  const ok = new Set(allowed.map((v) => v.id));
  const order = flattenValueTree(buildTree(all));
  return order.filter((v) => ok.has(v.id)).map((v) => ({ value: v.id, label: (paths.get(v.id) ?? [v.name]).join(" › ") }));
}

function buildTree(values: FacetValueRow[]) {
  return buildValueTree(values);
}

function ValueTree({ nodes, keep, facetSlug, filterable }: { nodes: ValueNode<FacetValueRow>[]; keep: Record<string, string>; facetSlug: string; filterable: boolean }) {
  return (
    <ul className="grid">
      {nodes.map((n, i) => (
        <li key={n.id}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2 pr-3 hover:bg-panel-2" style={{ paddingLeft: `calc(0.5rem + ${n.depth} * 1.5rem)` }}>
            <MoveButtons kind="value" id={n.id} parentId={n.parentId} index={i} count={nodes.length} upLabel={copy.values.moveUp(n.name)} downLabel={copy.values.moveDown(n.name)} />
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
              {n.depth > 0 && (
                <span aria-hidden="true" className="text-muted">
                  └
                </span>
              )}
              <Link href={hrefWith(BASE, {}, { ...keep, value: n.id })} scroll={false} className="truncate font-medium text-ink hover:underline" aria-label={copy.values.editLabel(n.name)}>
                {n.name}
              </Link>
              <span className="hidden truncate font-mono text-xs text-muted sm:inline">{n.slug}</span>
              {n.legacyTagId !== null && <span className="hidden text-xs text-muted md:inline">{copy.values.legacy(n.legacyTagId)}</span>}
            </div>
            <span className="text-xs whitespace-nowrap text-muted tabular-nums">{copy.values.products(n.productCount)}</span>
            <span className="flex items-center gap-1">
              {filterable && (
                <a href={facetValueHref(facetSlug, n.slug)} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "ghost", size: "sm" })}>
                  <span className="max-md:sr-only">{copy.values.viewInShop}</span>
                  <span aria-hidden="true">↗</span>
                </a>
              )}
              <Link href={hrefWith(BASE, {}, { ...keep, newValue: 1, parent: n.id })} scroll={false} className={buttonClasses({ variant: "ghost", size: "sm" })} aria-label={copy.values.addChildLabel(n.name)}>
                <span aria-hidden="true">+</span>
                <span className="max-md:sr-only">{copy.values.addChild}</span>
              </Link>
              <Link href={hrefWith(BASE, {}, { ...keep, value: n.id })} scroll={false} className={buttonClasses({ variant: "secondary", size: "sm" })} aria-label={copy.values.editLabel(n.name)}>
                {copy.values.edit}
              </Link>
            </span>
          </div>
          {n.children.length > 0 && <ValueTree nodes={n.children} keep={keep} facetSlug={facetSlug} filterable={filterable} />}
        </li>
      ))}
    </ul>
  );
}
