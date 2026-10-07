/**
 * Pure helpers for facet value hierarchies (no DB, no server-only): shared by the admin services,
 * the admin screens (client components) and the storefront catalog.
 */

export const FACET_KINDS = ["PERIOD", "COUNTRY", "BRANCH", "UNIT", "TYPE", "MAKER", "CUSTOM"] as const;
export type FacetKindName = (typeof FACET_KINDS)[number];

export const FACET_KIND_LABELS: Record<FacetKindName, string> = {
  PERIOD: "Period",
  COUNTRY: "Country",
  BRANCH: "Branch",
  UNIT: "Unit",
  TYPE: "Type",
  MAKER: "Maker",
  CUSTOM: "Custom",
};

export type ValueLike = { id: string; parentId: string | null; name: string; sortOrder: number };
export type ValueNode<T extends ValueLike> = T & { depth: number; children: ValueNode<T>[] };

const byOrder = (a: ValueLike, b: ValueLike) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

/**
 * Builds the value tree of one facet. Values whose parent is missing (or would form a cycle) become
 * roots. Siblings are ordered by sortOrder, then name.
 */
export function buildValueTree<T extends ValueLike>(values: readonly T[]): ValueNode<T>[] {
  const nodes = new Map<string, ValueNode<T>>(values.map((v) => [v.id, { ...v, depth: 0, children: [] }]));
  const roots: ValueNode<T>[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent && !isAncestor(nodes, node.id, parent.id)) parent.children.push(node);
    else roots.push(node);
  }
  const finish = (list: ValueNode<T>[], depth: number) => {
    list.sort(byOrder);
    for (const n of list) {
      n.depth = depth;
      finish(n.children, depth + 1);
    }
  };
  finish(roots, 0);
  return roots;
}

/** True when `candidate` is `id` or reachable from `id` via children (i.e. `id` is an ancestor of candidate). */
function isAncestor(nodes: Map<string, { parentId: string | null }>, id: string, candidate: string): boolean {
  let cur: string | null | undefined = candidate;
  const seen = new Set<string>();
  while (cur) {
    if (cur === id) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = nodes.get(cur)?.parentId;
  }
  return false;
}

/** Depth-first flattening (keeps depth). */
export function flattenValueTree<T extends ValueLike>(tree: readonly ValueNode<T>[]): ValueNode<T>[] {
  return tree.flatMap((n) => [n, ...flattenValueTree(n.children)]);
}

/** Ids of `id` and all its descendants among `values`. */
export function descendantIds(values: readonly { id: string; parentId: string | null }[], id: string): string[] {
  const children = new Map<string, string[]>();
  for (const v of values) {
    if (!v.parentId) continue;
    const list = children.get(v.parentId) ?? [];
    list.push(v.id);
    children.set(v.parentId, list);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (cur: string) => {
    if (seen.has(cur)) return;
    seen.add(cur);
    out.push(cur);
    for (const c of children.get(cur) ?? []) walk(c);
  };
  walk(id);
  return out;
}

/** True when `candidate` is `id` itself or one of its descendants (parent map: id → parentId). */
export function isSelfOrDescendant(parents: Map<string, string | null>, id: string, candidate: string): boolean {
  let cur: string | null | undefined = candidate;
  const seen = new Set<string>();
  while (cur) {
    if (cur === id) return true;
    if (seen.has(cur)) return true; // corrupt data: treat as cycle
    seen.add(cur);
    cur = parents.get(cur);
  }
  return false;
}

/** "Germany › Heer › Infantry" path labels for every value id. */
export function valuePaths(values: readonly { id: string; parentId: string | null; name: string }[]): Map<string, string[]> {
  const byId = new Map(values.map((v) => [v.id, v]));
  const out = new Map<string, string[]>();
  for (const v of values) {
    const path: string[] = [];
    const seen = new Set<string>();
    let cur: typeof v | undefined = v;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      path.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    out.set(v.id, path);
  }
  return out;
}
