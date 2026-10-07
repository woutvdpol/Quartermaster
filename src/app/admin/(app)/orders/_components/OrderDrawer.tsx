"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Drawer } from "@/components/admin/ui";

/**
 * Order quick-view (design C side panel). Open while `?order=<id>` is in the URL; closing removes
 * the param again so the list underneath keeps its view, filters and page.
 */
export function OrderDrawer({
  title,
  description,
  footer,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(true);

  function close() {
    setOpen(false);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("order");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(value) => (value ? setOpen(true) : close())}
      title={title}
      description={description}
      footer={footer}
      size="md"
    >
      {children}
    </Drawer>
  );
}
