"use client";

import Link from "next/link";
import { startTransition, useState, type FormEvent } from "react";
import {
  ActionMessage,
  Button,
  Card,
  FormActions,
  MoneyInput,
  NumberInput,
  Select,
  TextInput,
  buttonClasses,
  useActionForm,
  type SelectOption,
} from "@/components/admin/ui";
import { copy } from "../[id]/_copy";
import { createProductAction } from "./actions";

const f = copy.fields;

export function NewProductForm({ categories, currency }: { categories: SelectOption[]; currency: string }) {
  const { state, formAction, pending, error } = useActionForm(createProductAction);
  const [price, setPrice] = useState<number | null>(null);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // Manual dispatch keeps the typed values when validation fails.
    startTransition(() => formAction(fd));
  }

  return (
    <Card className="max-w-xl">
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <p className="text-[13px] text-ink-2">{copy.newIntro}</p>
        <ActionMessage state={state} showSuccess={false} />
        <TextInput label={f.title} name="title" required maxLength={300} autoFocus error={error("title")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyInput label={f.price} name="price" currency={currency} value={price} onValueChange={setPrice} showOptional error={error("price")} />
          <NumberInput label={f.quantity} name="quantity" defaultValue="1" inputMode="numeric" hint={f.quantityHint} error={error("quantity")} />
        </div>
        <Select label={f.category} name="categoryId" defaultValue="" options={[{ value: "", label: f.noCategory }, ...categories]} error={error("categoryId")} />
        <FormActions>
          <Link href="/admin/inventory" className={buttonClasses()}>
            Cancel
          </Link>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? copy.creating : copy.create}
          </Button>
        </FormActions>
      </form>
    </Card>
  );
}
