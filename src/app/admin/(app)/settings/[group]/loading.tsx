import { SystemPageSkeleton } from "../../_system/skeleton";

export default function Loading() {
  return <SystemPageSkeleton crumb="System · Settings" title="Settings" cards={3} aside />;
}
