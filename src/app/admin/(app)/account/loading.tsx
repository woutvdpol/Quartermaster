import { SystemPageSkeleton } from "../_system/skeleton";

export default function Loading() {
  return <SystemPageSkeleton crumb="Your account" title="Account" cards={3} />;
}
