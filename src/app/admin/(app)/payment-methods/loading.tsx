import { SystemPageSkeleton } from "../_system/skeleton";

export default function Loading() {
  return <SystemPageSkeleton crumb="System" title="Payment methods" cards={2} />;
}
