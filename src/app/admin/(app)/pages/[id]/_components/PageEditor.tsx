"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { Button, Card, EmptyState, toast } from "@/components/admin/ui";
import type { ContentBlockType } from "@/server/content/blocks";
import { copy } from "../../_copy";
import { toDraft, type BlockDraft } from "../../_lib/block-fields";
import { addBlockAction, moveBlockAction, setBlockVisibleAction } from "../actions";
import { BlockCard } from "./BlockCard";
import { AddBlockDrawer, ImagePickerDrawer, ProductPickerDrawer } from "./Pickers";
import { PagePreview, type PreviewBlock } from "./Preview";
import { SettingsForm } from "./SettingsForm";
import type { EditorBlock, EditorCategory, EditorContextValue, EditorPage, PickerProduct } from "./types";

const t = copy.editor;

type Optimistic = { kind: "visible"; id: string; visible: boolean } | { kind: "move"; id: string; to: number };

function applyOptimistic(blocks: EditorBlock[], op: Optimistic): EditorBlock[] {
  if (op.kind === "visible") return blocks.map((b) => (b.id === op.id ? { ...b, isVisible: op.visible } : b));
  const from = blocks.findIndex((b) => b.id === op.id);
  if (from === -1) return blocks;
  const next = blocks.filter((b) => b.id !== op.id);
  next.splice(op.to, 0, blocks[from]);
  return next;
}

type Props = {
  page: EditorPage;
  blocks: EditorBlock[];
  categories: EditorCategory[];
  products: Record<string, PickerProduct>;
  newsletterEnabled: boolean;
  roleHolders: Record<string, { id: string; title: string }>;
  tenantId: string;
};

export function PageEditor({ page, blocks: serverBlocks, categories, products: initialProducts, newsletterEnabled, roleHolders, tenantId }: Props) {
  const [blocks, applyOp] = useOptimistic(serverBlocks, applyOptimistic);
  const [, startTransition] = useTransition();
  /** Unsaved edits per block id. Saved data comes from the server props. */
  const [drafts, setDrafts] = useState<Record<string, BlockDraft>>({});
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(serverBlocks.filter((b) => !b.valid).map((b) => b.id)));
  const [products, setProducts] = useState(initialProducts);

  const [imagePick, setImagePick] = useState<((key: string) => void) | null>(null);
  const [productPick, setProductPick] = useState<((p: PickerProduct) => void) | null>(null);
  const [addState, setAddState] = useState<{ open: boolean; afterId?: string | null }>({ open: false });
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, startAdding] = useTransition();

  const editor: EditorContextValue = useMemo(
    () => ({
      pageId: page.id,
      categories,
      products,
      pickImage: (onPick) => setImagePick(() => onPick),
      pickProduct: (onPick) =>
        setProductPick(() => (p: PickerProduct) => {
          setProducts((cur) => ({ ...cur, [p.id]: p }));
          onPick(p);
        }),
    }),
    [page.id, categories, products],
  );

  const hasHero = blocks.some((b) => b.type === "HERO");

  function setOpen(id: string, open: boolean) {
    setOpenIds((cur) => {
      const next = new Set(cur);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function setDraft(id: string, draft: BlockDraft | null) {
    setDrafts((cur) => {
      const next = { ...cur };
      if (draft) next[id] = draft;
      else delete next[id];
      return next;
    });
  }

  function toggleVisible(id: string, visible: boolean) {
    startTransition(async () => {
      applyOp({ kind: "visible", id, visible });
      const res = await setBlockVisibleAction(page.id, id, visible);
      if (!res.ok) toast.crit(res.message ?? "Could not change visibility.");
    });
  }

  function move(id: string, to: number) {
    startTransition(async () => {
      applyOp({ kind: "move", id, to });
      const res = await moveBlockAction(page.id, id, to);
      if (!res.ok) toast.crit(res.message ?? "Could not move the block.");
    });
  }

  function add(type: ContentBlockType) {
    setAddError(null);
    startAdding(async () => {
      const res = await addBlockAction(page.id, type, addState.afterId);
      if (res.ok && res.data) {
        setAddState({ open: false });
        setOpen(res.data.id, true);
        toast.ok(res.message ?? "Block added.");
      } else setAddError(res.message ?? "Could not add the block.");
    });
  }

  const openAdd = (afterId?: string | null) => {
    setAddError(null);
    setAddState({ open: true, afterId });
  };

  const previewBlocks: PreviewBlock[] = blocks.map((b) => {
    const draft = drafts[b.id];
    return { id: b.id, type: b.type, isVisible: b.isVisible, data: draft ?? (b.valid ? toDraft(b.type, b.data) : null) };
  });

  return (
    <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
      <div className="grid min-w-0 content-start gap-4">
        <SettingsForm page={page} roleHolders={roleHolders} />

        <section aria-labelledby="blocks-heading" className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="blocks-heading" className="type-label text-sm text-ink">
              {t.blocks} <span className="font-mono text-muted">({blocks.length})</span>
            </h2>
            <Button variant="primary" aria-haspopup="dialog" onClick={() => openAdd(undefined)}>
              {t.addBlock}
            </Button>
          </div>

          {blocks.length === 0 ? (
            <Card>
              <EmptyState
                compact
                title={t.blocksEmptyTitle}
                body={t.blocksEmptyBody}
                action={
                  <Button variant="primary" aria-haspopup="dialog" onClick={() => openAdd(undefined)}>
                    {t.addBlock}
                  </Button>
                }
              />
            </Card>
          ) : (
            <ol className="grid gap-3">
              {blocks.map((b, i) => {
                const heroTop = blocks[0]?.type === "HERO";
                const canUp = b.type !== "HERO" && i > (heroTop ? 1 : 0);
                const canDown = b.type !== "HERO" && i < blocks.length - 1;
                return (
                  <li key={b.id}>
                    <BlockCard
                      index={i}
                      block={b}
                      draft={drafts[b.id]}
                      open={openIds.has(b.id)}
                      onOpenChange={(o) => setOpen(b.id, o)}
                      onDraftChange={(d) => setDraft(b.id, d)}
                      onToggleVisible={(v) => toggleVisible(b.id, v)}
                      onMoveUp={canUp ? () => move(b.id, i - 1) : undefined}
                      onMoveDown={canDown ? () => move(b.id, i + 1) : undefined}
                      onAddBelow={() => openAdd(b.id)}
                      editor={editor}
                    />
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      <aside aria-labelledby="preview-heading" className="min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto">
        <Card title={<span id="preview-heading">{t.preview}</span>} aside={t.previewNote}>
          <PagePreview title={page.title} blocks={previewBlocks} ctx={{ categories, products }} />
        </Card>
      </aside>

      <AddBlockDrawer
        open={addState.open}
        onOpenChange={(o) => setAddState((s) => ({ ...s, open: o }))}
        onAdd={add}
        hasHero={hasHero}
        newsletterEnabled={newsletterEnabled}
        pending={adding}
        error={addError}
      />
      <ImagePickerDrawer
        open={imagePick !== null}
        onOpenChange={(o) => !o && setImagePick(null)}
        onPick={(key) => imagePick?.(key)}
        pageId={page.id}
        tenantId={tenantId}
      />
      <ProductPickerDrawer open={productPick !== null} onOpenChange={(o) => !o && setProductPick(null)} onPick={(p) => productPick?.(p)} />
    </div>
  );
}
