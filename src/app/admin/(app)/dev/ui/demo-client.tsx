"use client";

import { useState } from "react";
import {
  ActionMessage,
  ActionToast,
  Button,
  Checkbox,
  ConfirmDialog,
  DateInput,
  Drawer,
  Dropzone,
  FormActions,
  KeyValue,
  MoneyInput,
  NumberInput,
  RadioGroup,
  SegmentedControl,
  Select,
  SubmitButton,
  Switch,
  Tabs,
  TagInput,
  Textarea,
  TextInput,
  toast,
  useActionForm,
  type DropzoneItem,
} from "@/components/admin/ui";
import { demoArchiveAction, demoSaveAction } from "./actions";

export function DemoForm() {
  const { state, formAction, error } = useActionForm(demoSaveAction);
  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <ActionMessage state={state} showSuccess={false} />
      <ActionToast state={state} errors={false} />
      <TextInput label="Title" name="title" required error={error("title")} hint="Shown as the product heading." />
      <div className="grid gap-3 sm:grid-cols-2">
        <MoneyInput label="Price" name="price" required defaultValue={12500} error={error("price")} hint="Try 1.234,56 or 1,234.56." />
        <NumberInput label="Weight" name="weight" trailing="g" min={0} showOptional />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Category"
          name="category"
          placeholder
          options={[
            { label: "Headgear", options: [{ value: "helmets", label: "Helmets" }, { value: "caps", label: "Caps" }] },
            { value: "medals", label: "Medals" },
          ]}
        />
        <DateInput label="Acquired on" name="acquiredOn" />
      </div>
      <Textarea label="Description" name="description" rows={3} />
      <TagInput label="Tags" name="tags" defaultValue={["WW2", "Wehrmacht"]} suggestions={["Luftwaffe", "Kriegsmarine", "Field gear"]} maxTags={8} />
      <SegmentedControl
        legend="Condition"
        name="condition"
        required
        error={error("condition")}
        options={[
          { value: "mint", label: "Mint" },
          { value: "good", label: "Good" },
          { value: "worn", label: "Worn" },
        ]}
      />
      <RadioGroup
        legend="Shipping"
        name="shipping"
        defaultValue="ship"
        options={[
          { value: "ship", label: "Ship", description: "PostNL, insured" },
          { value: "pickup", label: "Pickup only", description: "Collect at the shop" },
        ]}
      />
      <div className="grid gap-1">
        <Checkbox name="featured" label="Feature on the home page" description="Shows in the 'New in' strip." />
        <Switch name="published" label="Published" description="Visible in the shop." layout="row" defaultChecked />
        <Switch name="offers" label="Accept offers" layout="row" />
      </div>
      <FormActions start="Submit empty to see field errors.">
        <Button variant="ghost" type="reset">
          Reset
        </Button>
        <SubmitButton>Save product</SubmitButton>
      </FormActions>
    </form>
  );
}

export function FeedbackDemo() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => toast.ok("Product saved", { description: "Visible in the shop." })}>Toast ok</Button>
        <Button onClick={() => toast.info("Export started")}>Toast info</Button>
        <Button onClick={() => toast.warn("Stock is low", { action: { label: "Undo", onClick: () => toast("Undone") } })}>
          Toast warn + action
        </Button>
        <Button onClick={() => toast.crit("Payment failed", { description: "Mollie returned an error." })}>Toast crit</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <ConfirmDialog
          trigger="Archive item"
          title="Archive this item?"
          description="It disappears from the shop. You can restore it from the archive view."
          confirmLabel="Archive"
          action={demoArchiveAction}
          fields={{ id: "QM-1042" }}
        >
          <TextInput label="Reason" name="reason" hint='Type "fail" to see an error.' />
        </ConfirmDialog>
        <Drawer trigger="Open drawer (uncontrolled)" title="Order #1042" description="Paid · 07-10-2026">
          <KeyValue
            items={[
              { label: "Customer", value: "J. de Vries" },
              { label: "Total", value: "€412.50", mono: true },
            ]}
          />
        </Drawer>
        <Button onClick={() => setDrawerOpen(true)}>Open drawer (controlled)</Button>
        <Drawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          title="Edit stock"
          size="lg"
          footer={
            <>
              <Button onClick={() => setDrawerOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => setDrawerOpen(false)}>
                Done
              </Button>
            </>
          }
        >
          <TextInput label="Location" name="loc" defaultValue="Shelf B-3" />
        </Drawer>
      </div>
      <Tabs
        label="Product sections"
        items={[
          { id: "details", label: "Details", content: <p className="text-[13px]">Details panel. Use ←/→ to switch.</p> },
          { id: "media", label: "Media", badge: 6, content: <p className="text-[13px]">Media panel.</p> },
          { id: "seo", label: "SEO", content: <p className="text-[13px]">SEO panel.</p> },
          { id: "history", label: "History", disabled: true, content: null },
        ]}
      />
    </div>
  );
}

export function DropzoneDemo() {
  const [items, setItems] = useState<DropzoneItem[]>([]);
  return (
    <div className="grid gap-3">
      <Dropzone
        label="Photos"
        hint="JPEG, PNG or WebP up to 10 MB. The first photo is the cover."
        accept="image/jpeg,image/png,image/webp"
        maxSizeBytes={10 * 1024 * 1024}
        maxFiles={12}
        items={items}
        onItemsChange={setItems}
        onFilesAdded={(files) => toast.info(`${files.length} file(s) ready to upload`)}
      />
      <p className="font-mono text-xs text-muted">order: {items.map((i) => i.name).join(", ") || "—"}</p>
    </div>
  );
}
