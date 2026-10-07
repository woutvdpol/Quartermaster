import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmDialog, PageHeader, StatusPill } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { listCategoryTree, type CategoryNode } from "@/server/catalog/categories";
import { getPage, listPages } from "@/server/content/pages";
import { contentPageHref } from "@/server/content/rules";
import { getSettings } from "@/server/settings";
import { copy } from "../_copy";
import { isNotFound } from "../_lib/errors";
import { productSummaries } from "./_data";
import { deletePageFromEditorAction } from "./actions";
import { PageEditor } from "./_components/PageEditor";
import type { EditorCategory } from "./_components/types";

const t = copy.editor;

async function load(id: string) {
  const ctx = await requireStaffContext();
  try {
    return { ctx, page: await getPage(ctx, id) };
  } catch (err) {
    if (isNotFound(err)) notFound();
    throw err;
  }
}

export async function generateMetadata({ params }: PageProps<"/admin/pages/[id]">): Promise<Metadata> {
  const { page } = await load((await params).id);
  return { title: `${page.title} · ${copy.title}` };
}

function flatten(nodes: CategoryNode[], depth = 0, out: EditorCategory[] = []): EditorCategory[] {
  for (const n of nodes) {
    out.push({ id: n.id, title: n.title, depth, isActive: n.isActive });
    flatten(n.children, depth + 1, out);
  }
  return out;
}

export default async function PageEditorPage({ params }: PageProps<"/admin/pages/[id]">) {
  const { id } = await params;
  const { ctx, page } = await load(id);

  const productIds = page.blocks.flatMap((b) =>
    b.type === "TEXT_PRODUCT" && b.data && typeof (b.data as { productId?: unknown }).productId === "string" ? [(b.data as { productId: string }).productId] : [],
  );
  const [tree, products, platform, allPages] = await Promise.all([
    listCategoryTree(ctx),
    productSummaries(ctx, productIds),
    getSettings(ctx.tenantId, "platform"),
    listPages(ctx),
  ]);

  const roleHolders = Object.fromEntries(allPages.filter((p) => p.systemKey && p.id !== page.id).map((p) => [p.systemKey!, { id: p.id, title: p.title }]));
  const published = page.publishedAt !== null;

  return (
    <>
      <PageHeader
        crumb={
          <Link href="/admin/pages" className="hover:underline">
            {t.crumb}
          </Link>
        }
        title={page.title}
        actions={
          <>
            {page.systemKey && (
              <span className="type-label rounded-[3px] border border-line-strong bg-panel-2 px-1.5 py-px text-[11px] tracking-[0.08em] text-ink-2">
                {page.systemKey}
              </span>
            )}
            {published ? <StatusPill tone="ok">{copy.list.published}</StatusPill> : <StatusPill tone="mute">{copy.list.draft}</StatusPill>}
            <span className="font-mono text-xs text-muted">{contentPageHref(page)}</span>
            {!page.systemKey && (
              <ConfirmDialog
                trigger={t.deletePage}
                title={copy.list.deleteTitle(page.title)}
                description={copy.list.deleteBody}
                confirmLabel={copy.list.delete}
                action={deletePageFromEditorAction}
                fields={{ id: page.id }}
              />
            )}
          </>
        }
      />
      <PageEditor
        page={{
          id: page.id,
          title: page.title,
          slug: page.slug,
          systemKey: page.systemKey,
          seoTitle: page.seoTitle,
          seoDescription: page.seoDescription,
          published,
          publicHref: contentPageHref(page),
        }}
        blocks={page.blocks.map((b) => ({ id: b.id, type: b.type, isVisible: b.isVisible, data: b.data, valid: b.valid, issues: b.issues }))}
        categories={flatten(tree)}
        products={products}
        newsletterEnabled={platform.newsletterEnabled === true}
        roleHolders={roleHolders}
        tenantId={ctx.tenantId}
      />
    </>
  );
}
