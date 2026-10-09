"use client";

import { useTransition } from "react";
import { Button, toast } from "@/components/admin/ui";
import type { TranslationLocale } from "@/server/translations/fields";
import { retranslateAction } from "../actions";

/** After glossary changes: queue every unreviewed proposal of a language for a fresh machine translation. */
export function RetranslateButton({ locale, label }: { locale: TranslationLocale; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      title="Use after changing the glossary. Approved translations are not touched."
      onClick={() =>
        start(async () => {
          const res = await retranslateAction(locale);
          (res.ok ? toast.ok : toast.crit)(res.message ?? "");
        })
      }
    >
      {pending ? "Queueing…" : label}
    </Button>
  );
}
