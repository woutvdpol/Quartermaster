import type { ReactNode } from "react";
import { ModuleGate } from "@/components/admin/ModuleGate";

/** Paid module "insights" (docs/modules.md): without it, the module's screens show what it offers instead. */
export default function Layout({ children }: { children: ReactNode }) {
  return <ModuleGate module="insights">{children}</ModuleGate>;
}
