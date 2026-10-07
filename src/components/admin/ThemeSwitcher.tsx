"use client";

import { setAdminThemeAction } from "@/app/admin/actions";
import { ADMIN_THEMES, COLOR_MODES, type AdminThemePreference } from "@/lib/admin-theme";
import { getDictionary } from "@/lib/i18n";

const t = getDictionary().theme;

const selectClass =
  "w-full cursor-pointer rounded-[3px] border border-rail-line bg-rail px-1.5 py-1 text-xs text-rail-ink [&>option]:bg-panel [&>option]:text-ink";

/**
 * Design (A/B/C) and colour mode picker. Submits on change; the server action stores the choice in
 * the `qm_admin_theme` cookie and the admin layout re-renders with the new attributes.
 */
export function ThemeSwitcher({ current }: { current: AdminThemePreference }) {
  return (
    // Keyed on the preference: React resets a form after its action runs, so remount it to pick up
    // the new defaults instead of snapping back to the old ones.
    <form key={`${current.theme}.${current.mode}`} action={setAdminThemeAction}>
      <fieldset className="grid grid-cols-2 gap-1.5">
        <legend className="type-label mb-1 text-[10px] text-rail-muted">{t.legend}</legend>
        <label className="grid gap-0.5">
          <span className="sr-only">{t.designLabel}</span>
          <select
            name="theme"
            defaultValue={current.theme}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className={selectClass}
          >
            {ADMIN_THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {t.themes[theme]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-0.5">
          <span className="sr-only">{t.modeLabel}</span>
          <select
            name="mode"
            defaultValue={current.mode}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className={selectClass}
          >
            {COLOR_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t.modes[mode]}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <noscript>
        <button type="submit" className="mt-1 text-xs underline">
          {t.apply}
        </button>
      </noscript>
    </form>
  );
}
