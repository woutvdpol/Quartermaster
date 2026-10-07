import type { Metadata } from "next";
import { PageHeader, ViewTabs, getParam } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { listCategoryTree, type CategoryNode } from "@/server/catalog/categories";
import { listMenu } from "@/server/content/menus";
import { listPages } from "@/server/content/pages";
import { MENU_ROOT_LIMITS } from "@/server/content/rules";
import { copy } from "./_copy";
import { MenuEditor, type MenuCategoryOption } from "./_components/MenuEditor";

export const metadata: Metadata = { title: copy.title };

function flatten(nodes: CategoryNode[], depth = 0, out: MenuCategoryOption[] = []): MenuCategoryOption[] {
  for (const n of nodes) {
    out.push({ id: n.id, title: n.title, depth, isActive: n.isActive });
    flatten(n.children, depth + 1, out);
  }
  return out;
}

export default async function MenusPage({ searchParams }: PageProps<"/admin/menus">) {
  const sp = await searchParams;
  const basePath = "/admin/menus";
  const location = getParam(sp, "menu") === "footer" ? "FOOTER" : "HEADER";
  const ctx = await requireStaffContext();
  const [header, footer, pages, tree] = await Promise.all([listMenu(ctx, "HEADER"), listMenu(ctx, "FOOTER"), listPages(ctx), listCategoryTree(ctx)]);
  const items = location === "HEADER" ? header : footer;

  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} />
      <ViewTabs
        param="menu"
        label={copy.tabsLabel}
        basePath={basePath}
        searchParams={sp}
        active={location === "FOOTER" ? "footer" : null}
        className="bg-panel"
        views={[
          { value: null, label: `${copy.tabs.HEADER} ${header.length}/${MENU_ROOT_LIMITS.HEADER}` },
          { value: "footer", label: `${copy.tabs.FOOTER} ${footer.length}/${MENU_ROOT_LIMITS.FOOTER}` },
        ]}
      />
      <div className="grid max-w-4xl content-start gap-4 p-4 md:px-[22px] md:py-5">
        <MenuEditor
          key={location}
          location={location}
          items={items}
          refs={{
            pages: pages.map((p) => ({ id: p.id, title: p.title, published: p.publishedAt !== null })),
            categories: flatten(tree),
          }}
        />
      </div>
    </>
  );
}
