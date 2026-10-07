import { Button } from "@/components/shop/ui";
import { TextInput } from "@/components/shop/ui/Field";
import { provenanceShopCopy } from "./_copy";

const t = provenanceShopCopy.verify;

/** Read-only GET form → /verify?code=… (the page normalises and redirects to /verify/[code]). */
export function VerifyForm({ defaultValue, error }: { defaultValue?: string; error?: string | null }) {
  return (
    <form method="get" action="/verify" role="search" className="flex flex-col gap-1.5">
      <label htmlFor="verify-code" className="text-sm font-medium text-shop-ink">
        {t.label}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          id="verify-code"
          name="code"
          defaultValue={defaultValue}
          placeholder={t.placeholder}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={32}
          required
          invalid={!!error}
          aria-describedby={error ? "verify-code-error" : undefined}
          className="font-shop-mono tracking-wider uppercase"
        />
        <Button type="submit" variant="primary" className="shrink-0 sm:px-7">
          {t.submit}
        </Button>
      </div>
      {error ? (
        <p id="verify-code-error" className="text-xs font-medium text-shop-crit">
          {error}
        </p>
      ) : null}
    </form>
  );
}
