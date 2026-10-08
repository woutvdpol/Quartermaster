"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { Button, ConfirmDialog, InlineAlert, PageHeader, Select, cx, toast } from "@/components/admin/ui";
import { FONT_ALLOWLIST, SHOP_BUTTON_SHAPES, SHOP_CORNERS, SHOP_DENSITIES } from "@/server/settings/schema";
import {
  PRESET_ORDER,
  THEME_PRESETS,
  applyPreset,
  contrastWarnings,
  themeChanges,
  type Theme,
} from "@/server/theme/presets";
import type { ThemeState } from "@/server/theme";
import { THEME_PREVIEW_MESSAGE, THEME_PREVIEW_PARAM } from "@/lib/theme-preview";
import { discardThemeDraftAction, publishThemeAction, saveThemeDraftAction, uploadThemeLogoAction } from "../actions";

export type ThemeBuilderProps = {
  /** "page": full admin page with header bar (Website → Theme). "embedded": inside another page (wizard). */
  variant?: "page" | "embedded";
  /** From getThemeState (src/server/theme). */
  initialState: ThemeState;
  shopName: string;
  /** A product detail path for the "Product" preview tab, or null when the shop has no products yet. */
  productPath: string | null;
  /** Set when the admin host is not this tenant's shop host: the iframe cannot preview it. */
  previewHostMismatch?: { primaryHost: string | null } | null;
  /** Called after a successful publish (client parents only, e.g. the wizard advancing a step). */
  onPublished?: (state: ThemeState) => void;
};

type PreviewPage = "home" | "catalog" | "product";
type SaveStatus = "idle" | "saving" | "saved" | "error";

const SAVE_DEBOUNCE_MS = 600;
const DESKTOP_WIDTH = 1280;
const MOBILE_WIDTH = 390;

const label = (v: string) => v[0].toUpperCase() + v.slice(1);
const FONT_OPTIONS = FONT_ALLOWLIST.map((f) => ({ value: f, label: f }));

/**
 * The theme builder (design: docs/design/onboarding/Main.dc.html). Every change is applied to the
 * preview iframe immediately (postMessage → ThemePreviewBridge in the shop) and saved as the draft
 * after a short debounce; the live shop changes only on Publish.
 */
export function ThemeBuilder({ variant = "page", initialState, shopName, productPath, previewHostMismatch, onPublished }: ThemeBuilderProps) {
  const [live, setLive] = useState<Theme>(initialState.live);
  const [theme, setTheme] = useState<Theme>(initialState.draft ?? initialState.live);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [page, setPage] = useState<PreviewPage>("home");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [frameKey, setFrameKey] = useState(0);
  const [publishing, startPublish] = useTransition();

  const frameRef = useRef<HTMLIFrameElement>(null);
  const themeRef = useRef(theme);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Promise<boolean> | null>(null);
  const reloadAfterSave = useRef(false);

  const changes = useMemo(() => themeChanges(theme, live), [theme, live]);
  const warnings = useMemo(() => contrastWarnings(theme), [theme]);

  const postToPreview = useCallback((t: Theme) => {
    const win = frameRef.current?.contentWindow;
    if (win) win.postMessage({ type: THEME_PREVIEW_MESSAGE, theme: t }, window.location.origin);
  }, []);

  // The preview announces itself after every (re)load; answer with the current, possibly unsaved, theme.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin || e.source !== frameRef.current?.contentWindow) return;
      if ((e.data as { type?: string } | null)?.type === `${THEME_PREVIEW_MESSAGE}:ready`) postToPreview(themeRef.current);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [postToPreview]);

  const save = useCallback(async (t: Theme): Promise<boolean> => {
    setStatus("saving");
    const result = await saveThemeDraftAction(t);
    if (!result.ok) {
      setStatus("error");
      setSaveError(result.message ?? "The draft could not be saved.");
      return false;
    }
    setLive(result.state.live);
    setStatus("saved");
    setSaveError(null);
    if (reloadAfterSave.current) {
      reloadAfterSave.current = false;
      setFrameKey((k) => k + 1);
    }
    return true;
  }, []);

  /** Runs any scheduled save now; resolves false when saving failed. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      pending.current = save(themeRef.current);
    }
    return pending.current ? pending.current : true;
  }, [save]);

  const update = useCallback(
    (next: Theme, opts: { reload?: boolean } = {}) => {
      themeRef.current = next;
      setTheme(next);
      postToPreview(next);
      if (opts.reload) reloadAfterSave.current = true;
      setStatus("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        pending.current = save(themeRef.current);
      }, SAVE_DEBOUNCE_MS);
    },
    [postToPreview, save],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Warn before leaving with a save still queued.
  useEffect(() => {
    if (status !== "saving") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [status]);

  function publish() {
    startPublish(async () => {
      if (!(await flush())) {
        toast.crit("Save the draft first: it has errors.");
        return;
      }
      const result = await publishThemeAction();
      if (!result.ok) {
        toast.crit(result.message ?? "Publishing failed.");
        return;
      }
      setLive(result.state.live);
      themeRef.current = result.state.live;
      setTheme(result.state.live);
      setFrameKey((k) => k + 1);
      toast.ok(result.message ?? "Theme published.");
      onPublished?.(result.state);
    });
  }

  async function discard() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    await pending.current;
    const result = await discardThemeDraftAction();
    if (result.ok) {
      setLive(result.state.live);
      themeRef.current = result.state.live;
      setTheme(result.state.live);
      setStatus("idle");
      setFrameKey((k) => k + 1);
    }
    return result;
  }

  const previewPath = page === "home" ? "/" : page === "catalog" ? "/shop" : (productPath ?? "/shop");
  const previewSrc = `${previewPath}?${THEME_PREVIEW_PARAM}=1`;
  const dirty = changes.length > 0;

  const statusLine =
    status === "error"
      ? "Draft not saved"
      : dirty
        ? `Draft · ${changes.length} unpublished ${changes.length === 1 ? "change" : "changes"} · the live shop is unchanged until you publish`
        : "No unpublished changes · this is the live theme";

  const actions = (
    <>
      <ConfirmDialog
        trigger="Discard draft"
        triggerVariant="secondary"
        disabled={!dirty || publishing}
        title="Discard the draft?"
        description="All unpublished theme changes are removed. The live shop is not affected."
        confirmLabel="Discard draft"
        action={discard}
      />
      <a className={cx("inline-flex h-9 items-center rounded-control border border-line bg-panel px-3.5 text-[13px] text-ink hover:bg-panel-2", previewHostMismatch && "pointer-events-none opacity-50")} href={previewSrc} target="_blank" rel="noopener">
        Open preview in new tab
      </a>
      <Button variant="primary" onClick={publish} disabled={!dirty || publishing || status === "error"}>
        {publishing ? "Publishing…" : "Publish theme"}
      </Button>
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {variant === "page" ? (
        <PageHeader crumb={<StatusText status={status} text={statusLine} />} title="Theme" actions={actions} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel px-4 py-3">
          <StatusText status={status} text={statusLine} />
          <div className="flex flex-wrap gap-2">{actions}</div>
        </div>
      )}

      <div className="grid flex-1 lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <section aria-label="Theme settings" className="grid content-start gap-6 border-line bg-panel px-4 py-5 md:px-6 lg:border-r">
          {saveError ? (
            <InlineAlert tone="crit" live="alert">
              {saveError}
            </InlineAlert>
          ) : null}

          <Group title="1 · Preset">
            <div className="grid grid-cols-2 gap-2.5">
              {PRESET_ORDER.map((id) => {
                const p = THEME_PRESETS[id];
                const on = theme.theme === id;
                const third = p.defaults.colors.accent === p.defaults.colors.primary ? p.palette.ink : p.defaults.colors.accent;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => update(applyPreset(theme, id))}
                    className={cx(
                      "flex flex-col gap-1.5 rounded-card border bg-panel p-2.5 text-left transition-colors hover:border-line-strong",
                      on ? "border-accent ring-1 ring-accent" : "border-line",
                    )}
                  >
                    <span aria-hidden="true" className="flex h-[34px] overflow-hidden rounded-control border border-line">
                      <span className="flex-[2]" style={{ background: p.palette.bg }} />
                      <span className="flex-1" style={{ background: p.defaults.colors.primary }} />
                      <span className="flex-1" style={{ background: third }} />
                    </span>
                    <span className="text-sm font-semibold text-ink">{p.name}</span>
                    <span className="text-xs leading-snug text-muted">{p.blurb}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted">Picking a preset fills in its colours, fonts and shape. Tune them below.</p>
          </Group>

          <Group title="2 · Colours">
            <div className="grid grid-cols-3 gap-2">
              <ColorField label="Primary" value={theme.colors.primary} warn={warnings.some((w) => w.key === "primary")} onChange={(v) => update({ ...theme, colors: { ...theme.colors, primary: v } })} />
              <ColorField label="Background tint" value={theme.colors.secondary} warn={warnings.some((w) => w.key === "secondary")} onChange={(v) => update({ ...theme, colors: { ...theme.colors, secondary: v } })} />
              <ColorField label="Accent" value={theme.colors.accent} warn={warnings.some((w) => w.key === "accent")} onChange={(v) => update({ ...theme, colors: { ...theme.colors, accent: v } })} />
            </div>
            {warnings.length === 0 ? (
              <p className="text-xs text-ok">✓ All text passes contrast (AA)</p>
            ) : (
              <ul className="grid gap-1 text-xs text-warn" aria-live="polite">
                {warnings.map((w, i) => (
                  <li key={i}>⚠ {w.message}</li>
                ))}
              </ul>
            )}
          </Group>

          <Group title="3 · Type">
            <Select label="Headings" name="headingFont" value={theme.headingFont} options={FONT_OPTIONS} onChange={(e) => update({ ...theme, headingFont: e.target.value as Theme["headingFont"] })} />
            <Select label="Body text" name="textFont" value={theme.textFont} options={FONT_OPTIONS} onChange={(e) => update({ ...theme, textFont: e.target.value as Theme["textFont"] })} />
          </Group>

          <Group title="4 · Shape & density">
            <Segmented legend="Corners" value={theme.corners} options={SHOP_CORNERS} onChange={(v) => update({ ...theme, corners: v })} />
            <Segmented legend="Buttons" value={theme.buttonShape} options={SHOP_BUTTON_SHAPES} onChange={(v) => update({ ...theme, buttonShape: v })} />
            <Segmented legend="Density" value={theme.density} options={SHOP_DENSITIES} onChange={(v) => update({ ...theme, density: v })} />
          </Group>

          <Group title="5 · Logo">
            <LogoField shopName={shopName} path={theme.logoPath} onChange={(p) => update({ ...theme, logoPath: p }, { reload: true })} />
          </Group>
        </section>

        <section aria-label="Live preview" className="flex min-w-0 flex-col gap-3 px-4 py-5 md:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="type-label text-xs text-muted">Live preview · {dirty ? "draft" : "live theme"}</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Preview page">
              {(["home", "catalog", "product"] as const).map((p) => (
                <ToggleButton key={p} on={page === p} onClick={() => setPage(p)} disabled={p === "product" && !productPath}>
                  {label(p)}
                </ToggleButton>
              ))}
              <span className="mx-1 w-px self-stretch bg-line" aria-hidden="true" />
              <ToggleButton on={device === "desktop"} onClick={() => setDevice("desktop")}>
                Desktop
              </ToggleButton>
              <ToggleButton on={device === "mobile"} onClick={() => setDevice("mobile")}>
                Mobile
              </ToggleButton>
            </div>
          </div>
          {previewHostMismatch ? (
            <InlineAlert tone="info" title="Preview not available on this address">
              The preview shows the shop of the address you are on.{" "}
              {previewHostMismatch.primaryHost ? (
                <>
                  Open the admin on the shop&apos;s own address,{" "}
                  <a className="font-mono text-accent underline-offset-2 hover:underline" href={`//${previewHostMismatch.primaryHost}/admin/theme`}>
                    {previewHostMismatch.primaryHost}/admin/theme
                  </a>
                  , to see it.
                </>
              ) : (
                "This shop has no domain yet."
              )}{" "}
              Changes are still saved as a draft.
            </InlineAlert>
          ) : (
            <PreviewFrame key={`${previewSrc}-${frameKey}`} frameRef={frameRef} src={previewSrc} device={device} />
          )}
        </section>
      </div>
    </div>
  );
}

function StatusText({ status, text }: { status: SaveStatus; text: string }) {
  return (
    <span className={cx("text-xs", status === "error" ? "text-crit" : "text-muted")} aria-live="polite">
      {text}
      {status === "saving" ? " · saving…" : status === "saved" ? " · saved" : ""}
    </span>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-2.5">
      <h2 className="type-label text-xs tracking-[0.12em] text-muted uppercase">{title}</h2>
      {children}
    </div>
  );
}

function ToggleButton({ on, onClick, disabled, children }: { on: boolean; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "h-[30px] rounded-control border px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        on ? "border-ink bg-ink text-panel" : "border-line bg-panel text-ink hover:bg-panel-2",
      )}
    >
      {children}
    </button>
  );
}

function Segmented<T extends string>({ legend, value, options, onChange }: { legend: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[13px] text-ink">
      <span id={`seg-${legend}`}>{legend}</span>
      <div role="group" aria-labelledby={`seg-${legend}`} className="flex overflow-hidden rounded-control border border-line">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={o === value}
            onClick={() => onChange(o)}
            className={cx("h-[30px] border-r border-line px-2.5 text-xs last:border-r-0", o === value ? "bg-ink text-panel" : "bg-panel text-ink hover:bg-panel-2")}
          >
            {label(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

function ColorField({ label: text, value, warn, onChange }: { label: string; value: string; warn: boolean; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setDraft(value);
  }
  return (
    <div className="grid min-w-0 gap-1 text-xs text-muted">
      <label className="grid gap-1">
        {text}
        <span className={cx("relative block h-9 overflow-hidden rounded-control border", warn ? "border-warn" : "border-line")} style={{ background: value }}>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value.toLowerCase())} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </span>
      </label>
      <input
        aria-label={`${text} (hex)`}
        value={draft}
        maxLength={7}
        spellCheck={false}
        onChange={(e) => {
          const v = e.target.value.trim();
          setDraft(v);
          if (HEX.test(v)) onChange(v.toLowerCase());
        }}
        onBlur={() => setDraft(value)}
        className="h-7 w-full min-w-0 rounded-control border border-line bg-panel px-1.5 font-mono text-[11.5px] text-ink"
      />
    </div>
  );
}

function LogoField({ shopName, path, onChange }: { shopName: string; path: string | null; onChange: (p: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading(true);
    const fd = new FormData();
    fd.set("logo", file);
    const result = await uploadThemeLogoAction(fd);
    setUploading(false);
    if (!result.ok) setError(result.message ?? "Upload failed.");
    else onChange(result.path);
  }

  return (
    <div className="grid gap-2">
      {path ? (
        <div className="flex items-center justify-between gap-3 rounded-control border border-line bg-panel p-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- stored branding asset */}
          <img src={path} alt={`${shopName} logo`} className="h-10 w-auto max-w-[200px] object-contain" />
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Remove
          </Button>
        </div>
      ) : null}
      <div
        onDragOver={(e: DragEvent) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          setOver(false);
          void upload(e.dataTransfer.files[0]);
        }}
        className={cx("rounded-control border border-dashed p-4 text-center text-[13px] text-muted", over ? "border-accent bg-panel-2" : "border-line-strong")}
      >
        {uploading ? (
          "Uploading…"
        ) : (
          <>
            Drop a PNG, JPEG or WebP · or{" "}
            <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => input.current?.click()}>
              browse
            </button>
            <span className="mt-1 block text-xs">Max 2 MB. Without a logo the shop name is shown.</span>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          tabIndex={-1}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            void upload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="text-xs text-crit">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The real shop in an iframe; desktop renders at 1280px and is scaled down to fit the panel. */
function PreviewFrame({ frameRef, src, device }: { frameRef: React.RefObject<HTMLIFrameElement | null>; src: string; device: "desktop" | "mobile" }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = 760;
  const virtual = device === "desktop" ? DESKTOP_WIDTH : MOBILE_WIDTH;
  const scale = width ? Math.min(1, width / virtual) : 1;

  return (
    <div ref={box} className="min-w-0">
      <div
        className="mx-auto overflow-hidden rounded-card border border-line bg-panel shadow-pop"
        style={{ width: virtual * scale, height: height }}
      >
        <div className="flex h-7 items-center gap-1.5 border-b border-line bg-panel-2 px-2.5">
          <span className="size-[9px] rounded-full bg-line-strong" />
          <span className="size-[9px] rounded-full bg-line-strong" />
          <span className="size-[9px] rounded-full bg-line-strong" />
          <span className="ml-2.5 truncate font-mono text-[11px] text-muted">{src.split("?")[0]} · draft preview</span>
        </div>
        <iframe
          ref={frameRef}
          src={src}
          title="Shop preview"
          className="origin-top-left border-0 bg-panel"
          style={{ width: virtual, height: (height - 28) / scale, transform: `scale(${scale})` }}
        />
      </div>
    </div>
  );
}
