"use client";

import { useState } from "react";
import {
  ActionMessage,
  ActionToast,
  Card,
  FormActions,
  InlineAlert,
  Select,
  SubmitButton,
  Switch,
  TextInput,
  Textarea,
  useActionForm,
} from "@/components/admin/ui";
import { SYSTEM_PAGE_KEYS } from "@/server/content/rules";
import { copy } from "../../_copy";
import { updatePageSettingsAction } from "../actions";
import type { EditorPage } from "./types";

const t = copy.editor;

type Values = { title: string; slug: string; seoTitle: string; seoDescription: string; published: boolean; systemKey: string };

const fromPage = (p: EditorPage): Values => ({
  title: p.title,
  slug: p.slug,
  seoTitle: p.seoTitle ?? "",
  seoDescription: p.seoDescription ?? "",
  published: p.published,
  systemKey: p.systemKey ?? "",
});

/**
 * Page settings. Fields are controlled so a failed save keeps what was typed; when the saved values
 * change on the server (after a save, or another editor) the form follows them.
 */
export function SettingsForm({ page, roleHolders }: { page: EditorPage; roleHolders: Record<string, { id: string; title: string }> }) {
  const server = fromPage(page);
  const serverKey = JSON.stringify(server);
  const [synced, setSynced] = useState(serverKey);
  const [values, setValues] = useState(server);
  if (synced !== serverKey) {
    setSynced(serverKey);
    setValues(server);
  }
  const { state, formAction, error } = useActionForm(updatePageSettingsAction);
  const set = <K extends keyof Values>(k: K, v: Values[K]) => setValues((cur) => ({ ...cur, [k]: v }));
  const isHome = page.systemKey === "HOME";

  return (
    <Card title={t.settings}>
      <form action={formAction} className="grid gap-4" noValidate>
        <ActionMessage state={state} showSuccess={false} />
        <ActionToast state={state} errors={false} />
        <input type="hidden" name="id" value={page.id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label={t.fieldTitle} name="title" required maxLength={200} value={values.title} error={error("title")} onChange={(e) => set("title", e.target.value)} />
          <TextInput
            label={t.fieldSlug}
            name="slug"
            maxLength={80}
            leading="/"
            readOnly={isHome}
            hint={isHome ? t.homeSlugHint : t.slugHint}
            inputClassName="font-mono"
            spellCheck={false}
            value={values.slug}
            error={error("slug")}
            onChange={(e) => set("slug", e.target.value)}
          />
        </div>
        <TextInput label={t.seoTitle} name="seoTitle" maxLength={200} hint={t.seoTitleHint} showOptional value={values.seoTitle} error={error("seoTitle")} onChange={(e) => set("seoTitle", e.target.value)} />
        <Textarea
          label={t.seoDescription}
          name="seoDescription"
          rows={2}
          maxLength={500}
          showOptional
          hint={`${t.seoDescriptionHint} ${values.seoDescription.length}/500`}
          value={values.seoDescription}
          error={error("seoDescription")}
          onChange={(e) => set("seoDescription", e.target.value)}
        />
        <Switch layout="row" label={t.published} description={t.publishedHint} name="published" checked={values.published} onChange={(e) => set("published", e.target.checked)} />
        {page.systemKey ? (
          <InlineAlert tone="info" title={`${t.role}: ${copy.roles[page.systemKey] ?? page.systemKey}`}>
            {t.roleLocked(copy.roles[page.systemKey] ?? page.systemKey)}
          </InlineAlert>
        ) : (
          <Select
            label={t.role}
            name="systemKey"
            hint={t.roleHint}
            value={values.systemKey}
            error={error("systemKey")}
            onChange={(e) => set("systemKey", e.target.value)}
            options={[
              { value: "", label: t.roleNone },
              ...SYSTEM_PAGE_KEYS.map((k) => ({
                value: k,
                label: roleHolders[k] ? `${copy.roles[k]} (now: ${roleHolders[k].title})` : copy.roles[k],
              })),
            ]}
          />
        )}
        <FormActions>
          <SubmitButton pendingLabel={t.saving}>{t.save}</SubmitButton>
        </FormActions>
      </form>
    </Card>
  );
}
