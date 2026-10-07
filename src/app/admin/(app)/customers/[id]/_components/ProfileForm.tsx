"use client";

import { ActionMessage, ActionToast, FormActions, SubmitButton, TextInput, Textarea, useActionForm } from "@/components/admin/ui";
import { customerCopy } from "../../_copy";
import { updateCustomerAction } from "../actions";

const t = customerCopy.profile;

type Profile = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone: string | null;
  notes: string | null;
  registered: boolean;
};

/** Profile edit (updateCustomer). A registered customer's email is their login and is read-only here. */
export function ProfileForm({ customer, disabled }: { customer: Profile; disabled?: boolean }) {
  const { state, formAction, error } = useActionForm(updateCustomerAction);

  return (
    <form action={formAction} className="grid gap-3" noValidate>
      <input type="hidden" name="id" value={customer.id} />
      <ActionMessage state={state} showSuccess={false} />
      <ActionToast state={state} errors={false} />
      <fieldset disabled={disabled} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            label={t.firstName}
            name="firstName"
            defaultValue={customer.firstName ?? ""}
            maxLength={100}
            autoComplete="off"
            error={error("firstName")}
          />
          <TextInput
            label={t.lastName}
            name="lastName"
            defaultValue={customer.lastName ?? ""}
            maxLength={100}
            autoComplete="off"
            error={error("lastName")}
          />
        </div>
        {customer.registered ? (
          <TextInput label={t.email} defaultValue={customer.email} readOnly hint={t.emailLocked} />
        ) : (
          <TextInput
            label={t.email}
            name="email"
            type="email"
            defaultValue={customer.email}
            required
            maxLength={254}
            autoComplete="off"
            error={error("email")}
          />
        )}
        <TextInput
          label={t.phone}
          name="phone"
          type="tel"
          defaultValue={customer.phone ?? ""}
          maxLength={40}
          autoComplete="off"
          error={error("phone")}
        />
        <Textarea
          label={t.notes}
          name="notes"
          defaultValue={customer.notes ?? ""}
          rows={3}
          hint={t.notesHint}
          maxLength={5000}
          error={error("notes")}
        />
        <FormActions>
          <SubmitButton>{t.save}</SubmitButton>
        </FormActions>
      </fieldset>
    </form>
  );
}
