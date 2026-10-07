"use client";

import { useState, useTransition } from "react";
import {
  ActionMessage,
  Button,
  ConfirmDialog,
  Drawer,
  EmptyState,
  FormActions,
  InlineAlert,
  SegmentedControl,
  Select,
  SubmitButton,
  TextInput,
  buttonClasses,
  cx,
  toast,
  type ActionState,
} from "@/components/admin/ui";
import type { MenuItemView, MenuTarget } from "@/server/content/menus";
import { MENU_CHILD_LIMIT, MENU_ROOT_LIMITS, SYSTEM_ROUTES, SYSTEM_ROUTE_KEYS } from "@/server/content/rules";
import { sanitizeUrl } from "@/server/content/url";
import { copy } from "../_copy";
import { deleteMenuItemAction, reorderMenuAction, saveMenuItemAction } from "../actions";

type Location = "HEADER" | "FOOTER";
export type MenuPageOption = { id: string; title: string; published: boolean };
export type MenuCategoryOption = { id: string; title: string; depth: number; isActive: boolean };

type Refs = { pages: MenuPageOption[]; categories: MenuCategoryOption[] };

// ─── Target description ──────────────────────────────────────────────────────

function describe(target: MenuTarget | null, refs: Refs): { kind: string; text: string; warn?: string } {
  const tt = copy.target;
  if (!target) return { kind: tt.none, text: copy.noLink };
  switch (target.kind) {
    case "page": {
      const p = refs.pages.find((x) => x.id === target.pageId);
      return p ? { kind: tt.page, text: p.title, warn: p.published ? undefined : tt.draftPage } : { kind: tt.page, text: "—", warn: tt.missingPage };
    }
    case "category": {
      const c = refs.categories.find((x) => x.id === target.categoryId);
      return c ? { kind: tt.category, text: c.title, warn: c.isActive ? undefined : tt.inactiveCategory } : { kind: tt.category, text: "—", warn: tt.missingCategory };
    }
    case "route":
      return { kind: tt.route, text: `${SYSTEM_ROUTES[target.route].label} (${SYSTEM_ROUTES[target.route].href})` };
    case "url":
      return { kind: tt.url, text: target.url };
  }
}

// ─── Item form drawer ────────────────────────────────────────────────────────

type FormMode = { location: Location; parent: MenuItemView | null; item?: MenuItemView };

function ItemForm({ mode, refs, onDone, onCancel }: { mode: FormMode; refs: Refs; onDone: (message?: string) => void; onCancel: () => void }) {
  const f = copy.form;
  const { location, parent, item } = mode;
  const isRoot = !parent && !item?.parentId;
  const allowNone = location === "FOOTER" && isRoot;
  const initial = item?.target ?? null;
  const [kind, setKind] = useState<string>(initial ? initial.kind : allowNone && item ? "none" : "page");
  const [label, setLabel] = useState(item?.label ?? "");
  const [url, setUrl] = useState(initial?.kind === "url" ? initial.url : "");
  // All fields are controlled: React resets uncontrolled fields after every form action.
  const [pageId, setPageId] = useState(initial?.kind === "page" ? initial.pageId : "");
  const [categoryId, setCategoryId] = useState(initial?.kind === "category" ? initial.categoryId : "");
  const [route, setRoute] = useState<string>(initial?.kind === "route" ? initial.route : "");
  const [state, setState] = useState<ActionState>(null);
  const err = (name: string) => (state && !state.ok ? state.fieldErrors?.[name] : undefined);
  const urlInline = url.trim() && !sanitizeUrl(url) ? f.unsafeUrl : undefined;

  const kinds = [
    ...(allowNone ? [{ value: "none", label: copy.target.none }] : []),
    { value: "page", label: f.page },
    { value: "category", label: f.category },
    { value: "route", label: f.route },
    { value: "url", label: f.url },
  ];

  return (
    <form
      className="grid gap-4"
      noValidate
      action={async (formData) => {
        const res = await saveMenuItemAction(null, formData);
        if (res.ok) onDone(res.message);
        else setState(res);
      }}
    >
      <ActionMessage state={state} showSuccess={false} />
      {item && <input type="hidden" name="id" value={item.id} />}
      <input type="hidden" name="location" value={location} />
      {parent && <input type="hidden" name="parentId" value={parent.id} />}
      <input type="hidden" name="kind" value={kind} />
      <TextInput label={f.label} name="label" required maxLength={50} hint={f.labelHint} value={label} error={err("label")} onChange={(e) => setLabel(e.target.value)} />
      <SegmentedControl name="kind-choice" legend={f.linkTo} size="sm" value={kind} onValueChange={setKind} options={kinds} error={err("kind")} />
      {kind === "page" && (
        <Select
          label={f.page}
          name="pageId"
          required
          placeholder={f.choosePage}
          value={pageId}
          onChange={(e) => setPageId(e.target.value)}
          error={err("pageId")}
          options={refs.pages.map((p) => ({ value: p.id, label: p.published ? p.title : `${p.title} (draft)` }))}
        />
      )}
      {kind === "category" && (
        <Select
          label={f.category}
          name="categoryId"
          required
          placeholder={f.chooseCategory}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          error={err("categoryId")}
          options={refs.categories.map((c) => ({ value: c.id, label: `${"— ".repeat(c.depth)}${c.title}${c.isActive ? "" : " (inactive)"}` }))}
        />
      )}
      {kind === "route" && (
        <Select
          label={f.route}
          name="route"
          required
          placeholder={f.chooseRoute}
          value={route}
          onChange={(e) => setRoute(e.target.value)}
          error={err("route")}
          options={SYSTEM_ROUTE_KEYS.map((k) => ({ value: k, label: `${SYSTEM_ROUTES[k].label} (${SYSTEM_ROUTES[k].href})` }))}
        />
      )}
      {kind === "url" && (
        <TextInput
          label={f.url}
          name="url"
          required
          maxLength={2048}
          hint={f.urlHint}
          inputClassName="font-mono"
          spellCheck={false}
          value={url}
          error={urlInline ?? err("url")}
          onChange={(e) => setUrl(e.target.value)}
        />
      )}
      <FormActions>
        <button type="button" className={buttonClasses()} onClick={onCancel}>
          {f.cancel}
        </button>
        <SubmitButton pendingLabel={f.saving}>{item ? f.save : f.add}</SubmitButton>
      </FormActions>
    </form>
  );
}

// ─── Tree ────────────────────────────────────────────────────────────────────

type Props = { location: Location; items: MenuItemView[]; refs: Refs };

export function MenuEditor({ location, items, refs }: Props) {
  const [form, setForm] = useState<FormMode | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [pending, startTransition] = useTransition();
  const rootMax = MENU_ROOT_LIMITS[location];
  const rootFull = items.length >= rootMax;

  const openForm = (mode: FormMode) => {
    setFormKey((k) => k + 1);
    setForm(mode);
  };

  function move(siblings: MenuItemView[], parentId: string | null, index: number, dir: -1 | 1) {
    const ids = siblings.map((s) => s.id);
    [ids[index], ids[index + dir]] = [ids[index + dir], ids[index]];
    startTransition(async () => {
      const res = await reorderMenuAction(location, parentId, ids);
      if (!res.ok) toast.crit(res.message ?? "Could not reorder the menu.");
    });
  }

  const formTitle = !form
    ? ""
    : form.item
      ? copy.form.editTitle(form.item.label)
      : form.parent
        ? copy.form.newChildTitle(form.parent.label)
        : copy.form.newTitle[location];

  function row(item: MenuItemView, siblings: MenuItemView[], index: number, parent: MenuItemView | null) {
    const d = describe(item.target, refs);
    const isRoot = !parent;
    const childFull = item.children.length >= MENU_CHILD_LIMIT;
    return (
      <div className={cx("flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5", !isRoot && "pl-8 sm:pl-10")}>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className={cx("truncate text-ink", isRoot ? "text-[14px] font-semibold" : "text-[13.5px]")}>
            {!isRoot && (
              <span aria-hidden="true" className="mr-1.5 text-muted">
                └
              </span>
            )}
            {item.label}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted">
            <span className="type-label">{d.kind}</span>
            <span className={cx("truncate", item.target?.kind === "url" && "font-mono")}>{d.text}</span>
            {d.warn && <span className="text-warn">· {d.warn}</span>}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" disabled={pending || index === 0} aria-label={`${copy.moveUp}: ${item.label}`} onClick={() => move(siblings, parent?.id ?? null, index, -1)}>
            ↑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || index === siblings.length - 1}
            aria-label={`${copy.moveDown}: ${item.label}`}
            onClick={() => move(siblings, parent?.id ?? null, index, 1)}
          >
            ↓
          </Button>
          {isRoot && (
            <Button
              size="sm"
              aria-haspopup="dialog"
              disabled={childFull}
              title={childFull ? copy.limits.childFull(MENU_CHILD_LIMIT) : undefined}
              onClick={() => openForm({ location, parent: item })}
            >
              + {copy.addChild[location]}
            </Button>
          )}
          <Button size="sm" aria-haspopup="dialog" aria-label={`${copy.edit}: ${item.label}`} onClick={() => openForm({ location, parent, item })}>
            {copy.edit}
          </Button>
          <ConfirmDialog
            trigger={copy.delete}
            triggerSize="sm"
            triggerLabel={`${copy.delete}: ${item.label}`}
            title={copy.deleteTitle(item.label)}
            description={copy.deleteBody(item.children.length)}
            confirmLabel={copy.delete}
            action={deleteMenuItemAction}
            fields={{ id: item.id }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <p className="text-[13px] text-ink-2">{copy.intro[location]}</p>
          <p className="font-mono text-xs text-muted">{copy.limits[location](items.length, rootMax, MENU_CHILD_LIMIT)}</p>
        </div>
        <Button variant="primary" aria-haspopup="dialog" disabled={rootFull} onClick={() => openForm({ location, parent: null })}>
          + {copy.addRoot[location]}
        </Button>
      </div>
      {rootFull && <InlineAlert tone="info">{copy.limits.full[location]}</InlineAlert>}

      {items.length === 0 ? (
        <div className="rounded-card border border-line bg-panel">
          <EmptyState
            title={copy.emptyTitle[location]}
            body={copy.emptyBody[location]}
            action={
              <Button variant="primary" aria-haspopup="dialog" onClick={() => openForm({ location, parent: null })}>
                + {copy.addRoot[location]}
              </Button>
            }
          />
        </div>
      ) : (
        <ol className="grid gap-2" aria-label={copy.tabs[location]} aria-busy={pending || undefined}>
          {items.map((root, i) => (
            <li key={root.id} className="rounded-card border border-line bg-panel shadow-card">
              {row(root, items, i, null)}
              {root.children.length > 0 && (
                <ol className="border-t border-line" aria-label={`${root.label}: sub-items`}>
                  {root.children.map((child, j) => (
                    <li key={child.id} className="border-b border-line last:border-b-0">
                      {row(child, root.children, j, root)}
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ol>
      )}

      <Drawer open={form !== null} onOpenChange={(o) => !o && setForm(null)} title={formTitle}>
        {form && (
          <ItemForm
            key={formKey}
            mode={form}
            refs={refs}
            onCancel={() => setForm(null)}
            onDone={(message) => {
              setForm(null);
              toast.ok(message ?? copy.saved);
            }}
          />
        )}
      </Drawer>
    </div>
  );
}
