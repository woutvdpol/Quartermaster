"use client";

import { useEffect, useState } from "react";
import {
  ActionMessage,
  Checkbox,
  Drawer,
  Select,
  SubmitButton,
  TextInput,
  buttonClasses,
  toast,
  useActionForm,
} from "@/components/admin/ui";
import { CARRIERS, findCarrier, trackingUrlFor } from "@/server/fulfillment/carriers";
import { markShippedAction } from "../actions";
import { boardCopy } from "../_copy";

const t = boardCopy.ship;

export type ShipTarget = {
  id: string;
  number: number;
  pickup: boolean;
  destination: { postalCode: string | null; countryCode: string | null };
  carrier: string | null;
  trackingNumber: string | null;
};

/** "Mark shipped" side panel: carrier preset (or other), tracking code/link, notify customer. */
export function ShipDrawer({ target, onClose }: { target: ShipTarget | null; onClose: () => void }) {
  return (
    <Drawer
      open={target !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={target ? t.title(target.number) : ""}
      description={target?.pickup ? t.pickupDescription : t.description}
    >
      {target && <ShipForm key={target.id} target={target} onDone={onClose} />}
    </Drawer>
  );
}

function ShipForm({ target, onDone }: { target: ShipTarget; onDone: () => void }) {
  const { state, formAction, error } = useActionForm(markShippedAction);
  const preset = findCarrier(target.carrier);
  const [carrier, setCarrier] = useState<string>(preset ? preset.name : target.carrier ? "__other" : target.pickup ? "" : "PostNL");
  const [code, setCode] = useState(target.trackingNumber ?? "");
  const [url, setUrl] = useState("");
  const [urlTouched, setUrlTouched] = useState(false);
  const auto = carrier && carrier !== "__other" ? trackingUrlFor(carrier, code, target.destination) : null;
  const shownUrl = urlTouched ? url : (auto ?? "");

  useEffect(() => {
    if (state?.ok) {
      toast.ok(state.message ?? "Saved.");
      onDone();
    }
  }, [state, onDone]);

  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <input type="hidden" name="id" value={target.id} />
      <input type="hidden" name="number" value={target.number} />
      <ActionMessage state={state} showSuccess={false} />
      <Select
        label={t.carrier}
        name="carrier"
        value={carrier}
        onChange={(e) => setCarrier(e.target.value)}
        error={error("carrier")}
        options={[
          { value: "", label: t.none },
          ...CARRIERS.map((c) => ({ value: c.name, label: c.name })),
          { value: "__other", label: t.carrierOther },
        ]}
      />
      {carrier === "__other" && (
        <TextInput label={t.carrierName} name="carrierOther" defaultValue={preset ? "" : (target.carrier ?? "")} maxLength={100} error={error("carrier")} />
      )}
      <TextInput
        label={t.trackingNumber}
        name="trackingNumber"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        maxLength={200}
        inputClassName="font-mono"
        autoComplete="off"
        error={error("trackingNumber")}
      />
      <TextInput
        label={t.trackingUrl}
        name="trackingUrl"
        type="url"
        inputMode="url"
        value={shownUrl}
        onChange={(e) => {
          setUrlTouched(true);
          setUrl(e.target.value);
        }}
        placeholder="https://"
        hint={t.trackingUrlHint(!!auto && !urlTouched)}
        error={error("trackingUrl")}
      />
      <Checkbox name="notify" label={t.notify} description={t.notifyHint} defaultChecked={!target.pickup} />
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <button type="button" className={buttonClasses()} onClick={onDone}>
          {t.cancel}
        </button>
        <SubmitButton>{t.submit}</SubmitButton>
      </div>
    </form>
  );
}
