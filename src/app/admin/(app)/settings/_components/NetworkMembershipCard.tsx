"use client";

import { useState, useTransition } from "react";
import { Card, InlineAlert, Switch } from "@/components/admin/ui";
import type { NetworkMembership } from "@/server/network/admin";
import { setNetworkOptInAction } from "../network-actions";

/**
 * Settings → General: opt in to the Quartermaster network (docs/network.md). One switch; saved at once
 * (outside the settings form), audited, and visible on the network within seconds.
 */
export function NetworkMembershipCard({ initial }: { initial: NetworkMembership }) {
  const [data, setData] = useState(initial);
  const [message, setMessage] = useState<{ tone: "ok" | "crit"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const toggle = (on: boolean) =>
    start(async () => {
      const res = await setNetworkOptInAction(on);
      if (res.ok && res.data) setData(res.data);
      setMessage({ tone: res.ok ? "ok" : "crit", text: res.message ?? (res.ok ? "Saved." : "Could not save.") });
    });

  return (
    <Card title="Quartermaster network" aside={data.networkUrl ? <a href={data.networkUrl} className="text-accent underline-offset-2 hover:underline" target="_blank" rel="noreferrer">Open the network</a> : undefined}>
      <div className="grid gap-3 text-[13px]">
        <Switch
          label="Show my stock in the Quartermaster network"
          description="Collectors search the stock of every participating dealer at once. Each result links to the item in your own shop: buyers check out with you, at your prices and terms. Sensitive items (blurred, age-restricted or with restricted symbols), items on a fair and items your country rules restrict are never shown."
          checked={data.optIn}
          disabled={pending || (data.blocked && !data.optIn)}
          onChange={(e) => toggle(e.currentTarget.checked)}
        />
        {data.optIn && data.blockers.length ? (
          <InlineAlert tone="warn">Your stock is not visible yet: {data.blockers.join(" ")}</InlineAlert>
        ) : null}
        {!data.optIn && data.blocked ? <InlineAlert tone="crit">{data.blockers[0]}</InlineAlert> : null}
        {message ? <InlineAlert tone={message.tone}>{message.text}</InlineAlert> : null}
      </div>
    </Card>
  );
}
