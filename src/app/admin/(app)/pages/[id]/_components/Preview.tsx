import type { ReactNode } from "react";
import { cx } from "@/components/admin/ui";
import { catalogEntry, type ContentBlockType } from "@/server/content/blocks";
import { copy } from "../../_copy";
import { Markdown } from "../../_components/Markdown";
import { storageImageUrl, type BlockDraft } from "../../_lib/block-fields";
import type { EditorCategory, PickerProduct } from "./types";

/*
 * Simplified, token-styled rendering of blocks for the editor's preview panel. It shows structure
 * and content, not the final storefront design (phase 3). Links are inert.
 */

export type PreviewBlock = { id: string; type: ContentBlockType; isVisible: boolean; data: BlockDraft | null };

type Ctx = { categories: EditorCategory[]; products: Record<string, PickerProduct> };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const link = (v: unknown) => (v && typeof v === "object" ? { label: str((v as { label?: unknown }).label), href: str((v as { href?: unknown }).href) } : null);

function Img({ k, className, label }: { k: unknown; className?: string; label?: string }) {
  const key = str(k);
  if (!key) {
    return (
      <div
        aria-hidden="true"
        className={cx("rounded-[4px] border border-line [background:repeating-linear-gradient(135deg,var(--qm-img-a)_0_6px,var(--qm-img-b)_6px_12px)]", className)}
      >
        {label && <span className="m-1 inline-block rounded-[3px] bg-panel px-1 font-mono text-[10px] text-muted">{label}</span>}
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={storageImageUrl(key, "card")} alt="" loading="lazy" className={cx("rounded-[4px] bg-panel-3 object-cover", className)} />;
}

function Btn({ children }: { children: ReactNode }) {
  return <span className="inline-flex rounded-control bg-accent px-2.5 py-1 text-[11.5px] font-medium text-on-accent">{children}</span>;
}

function Title({ children }: { children: ReactNode }) {
  return children ? <p className="type-display text-[17px] leading-tight text-ink">{children}</p> : null;
}

function body(type: ContentBlockType, d: BlockDraft, ctx: Ctx): ReactNode {
  const cta = link(d.cta);
  const ctaNode = cta?.label ? <Btn>{cta.label}</Btn> : null;
  switch (type) {
    case "HERO":
      return (
        <div className="relative overflow-hidden rounded-[4px]">
          <Img k={d.imageKey} className="h-36 w-full" />
          <div className="absolute inset-0 grid content-end gap-1.5 bg-linear-to-t from-rail/90 to-transparent p-3 text-rail-ink">
            <p className="type-display text-xl leading-tight">{str(d.title)}</p>
            {str(d.subtitle) && <p className="text-[12px] opacity-90">{str(d.subtitle)}</p>}
            {ctaNode && <div>{ctaNode}</div>}
          </div>
        </div>
      );
    case "TEXT":
      return (
        <div className="grid gap-2">
          <Title>{str(d.title)}</Title>
          <Markdown source={str(d.markdown)} className="text-[12.5px]" />
          {ctaNode && <div>{ctaNode}</div>}
        </div>
      );
    case "TEXT_HORIZONTAL":
      return (
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <Title>{str(d.title)}</Title>
          <Markdown source={str(d.markdown)} className="text-[12.5px]" />
        </div>
      );
    case "TEXT_IMAGE": {
      const right = d.imagePosition === "right";
      return (
        <div className="grid grid-cols-2 items-center gap-3">
          <Img k={d.imageKey} className={cx("aspect-[4/3] w-full", right && "order-2")} />
          <div className="grid gap-2">
            <Title>{str(d.title)}</Title>
            <Markdown source={str(d.markdown)} className="text-[12.5px]" />
            {ctaNode && <div>{ctaNode}</div>}
          </div>
        </div>
      );
    }
    case "TEXT_PRODUCT": {
      const p = ctx.products[str(d.productId)];
      return (
        <div className="grid grid-cols-2 items-center gap-3">
          <div className="grid gap-1 rounded-[4px] border border-line p-2">
            {p?.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.thumbUrl} alt="" className="aspect-square w-full rounded-[3px] object-cover" />
            ) : (
              <Img k={null} className="aspect-square w-full" />
            )}
            <span className="truncate text-[11.5px] font-medium">{p ? p.title : copy.product.none}</span>
          </div>
          <div className="grid gap-2">
            <Title>{str(d.title)}</Title>
            <Markdown source={str(d.markdown)} className="text-[12.5px]" />
          </div>
        </div>
      );
    }
    case "TEXT_CAROUSEL": {
      const keys = Array.isArray(d.imageKeys) ? (d.imageKeys as string[]) : [];
      return (
        <div className="grid grid-cols-2 items-center gap-3">
          <div className="grid gap-1">
            <Img k={keys[0]} className="aspect-[4/3] w-full" label={keys.length ? `1 / ${keys.length}` : undefined} />
          </div>
          <div className="grid gap-2">
            <Title>{str(d.title)}</Title>
            <Markdown source={str(d.markdown)} className="text-[12.5px]" />
          </div>
        </div>
      );
    }
    case "QUOTE":
      return (
        <figure className="grid gap-1 border-l-2 border-accent pl-3">
          <blockquote className="type-display text-[16px] leading-snug text-ink">“{str(d.quote)}”</blockquote>
          {str(d.author) && <figcaption className="text-[12px] text-muted">— {str(d.author)}</figcaption>}
        </figure>
      );
    case "CTA":
      return (
        <div className="relative overflow-hidden rounded-[4px] border border-line bg-panel-2">
          {str(d.imageKey) && <Img k={d.imageKey} className="absolute inset-0 h-full w-full opacity-30" />}
          <div className="relative grid justify-items-center gap-1.5 p-4 text-center">
            <Title>{str(d.title)}</Title>
            {str(d.text) && <p className="text-[12.5px] text-ink-2">{str(d.text)}</p>}
            {str(d.buttonLabel) && <Btn>{str(d.buttonLabel)}</Btn>}
          </div>
        </div>
      );
    case "GALLERY": {
      const keys = Array.isArray(d.imageKeys) ? (d.imageKeys as string[]) : [];
      return (
        <div className="grid gap-2">
          <Title>{str(d.title)}</Title>
          <div className="grid grid-cols-4 gap-1.5">
            {(keys.length ? keys.slice(0, 8) : [null, null, null, null]).map((k, i) => (
              <Img key={i} k={k} className="aspect-square w-full" />
            ))}
          </div>
          {keys.length > 8 && <p className="text-[11.5px] text-muted">+{keys.length - 8} more</p>}
        </div>
      );
    }
    case "TESTIMONIAL": {
      const l = link(d.link);
      return (
        <figure className="grid gap-1.5 rounded-[4px] border border-line bg-panel-2 p-3">
          <p aria-hidden="true" className="text-warn">★★★★★</p>
          <blockquote className="text-[13px] text-ink">“{str(d.quote)}”</blockquote>
          <figcaption className="text-[12px] text-muted">
            — {str(d.author)}
            {l?.label && <span className="ml-2 text-accent underline">{l.label}</span>}
          </figcaption>
        </figure>
      );
    }
    case "CATEGORIES": {
      const ids = Array.isArray(d.categoryIds) ? (d.categoryIds as string[]) : [];
      const names = ids.length
        ? ids.map((id) => ctx.categories.find((c) => c.id === id)?.title ?? "—")
        : ctx.categories.filter((c) => c.depth === 0 && c.isActive).map((c) => c.title);
      return (
        <div className="grid gap-2">
          <Title>{str(d.title)}</Title>
          <div className="flex gap-1.5 overflow-hidden">
            {(names.length ? names : ["Category", "Category", "Category"]).slice(0, 6).map((n, i) => (
              <div key={i} className="grid w-20 shrink-0 gap-1">
                <Img k={null} className="aspect-square w-full" />
                <span className="truncate text-[11px] text-ink-2">{n}</span>
              </div>
            ))}
          </div>
          {!ids.length && <p className="text-[11px] text-muted">All active top-level categories</p>}
        </div>
      );
    }
    case "NEW_ITEMS": {
      const n = typeof d.count === "number" && d.count > 0 ? Math.min(d.count, 24) : 0;
      return (
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <Title>{str(d.title)}</Title>
            {cta?.label && <span className="text-[11.5px] text-accent underline">{cta.label}</span>}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {Array.from({ length: Math.min(n, 8) }, (_, i) => (
              <Img key={i} k={null} className="aspect-square w-full" />
            ))}
          </div>
          <p className="text-[11px] text-muted">The {n} newest active products</p>
        </div>
      );
    }
    case "NEWSLETTER_SIGNUP":
      return (
        <div className="grid gap-2 rounded-[4px] bg-panel-2 p-3">
          <Title>{str(d.title)}</Title>
          {str(d.text) && <p className="text-[12.5px] text-ink-2">{str(d.text)}</p>}
          <div className="flex gap-1.5">
            <span className="flex-1 rounded-control border border-line bg-panel px-2 py-1 text-[11.5px] text-muted">Email address</span>
            <Btn>Subscribe</Btn>
          </div>
        </div>
      );
  }
}

/** The preview panel: every block in order; hidden ones dimmed, invalid ones flagged. */
export function PagePreview({ title, blocks, ctx }: { title: string; blocks: PreviewBlock[]; ctx: Ctx }) {
  const t = copy.editor;
  return (
    <div className="grid gap-3">
      <p className="type-display border-b border-line pb-2 text-lg">{title}</p>
      {blocks.length === 0 && <p className="text-[13px] text-muted">{t.previewEmpty}</p>}
      {blocks.map((b) => (
        <section
          key={b.id}
          aria-label={catalogEntry(b.type).label}
          className={cx("relative grid gap-1", !b.isVisible && "opacity-45")}
        >
          {!b.isVisible && (
            <span className="type-label absolute top-1 right-1 z-10 rounded-[3px] border border-line bg-panel px-1 text-[10px] text-muted">
              {t.hiddenTag}
            </span>
          )}
          {b.data ? (
            body(b.type, b.data, ctx)
          ) : (
            <p className="rounded-[4px] border border-dashed border-warn bg-warn-soft px-2 py-1.5 text-[12px] text-warn">
              {catalogEntry(b.type).label}: {copy.block.invalidTitle.toLowerCase()}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
