/* Inline stroke icons for the platform landing (same style as src/components/shop/layout/icons.tsx). Decorative: aria-hidden. */
type P = { className?: string };
const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const CheckIcon = ({ className = "size-4" }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...base} strokeWidth={2}><path d="M20 6 9 17l-5-5" /></svg>
);
export const StoreIcon = ({ className = "size-5" }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><path d="M3 9h18l-1.5-5h-15z" /><path d="M5 9v11h14V9" /><path d="M10 20v-6h4v6" /></svg>
);
export const GlobeIcon = ({ className = "size-5" }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
);
export const TableIcon = ({ className = "size-5" }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><path d="M3 8h18M5 8v12M19 8v12M8 4h8l1 4H7z" /></svg>
);
export const GavelIcon = ({ className = "size-5" }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><path d="m14 13-7.5 7.5a2.1 2.1 0 0 1-3-3L11 10" /><path d="m16 16 6-6M8 8l6-6M9 7l8 8M21 11l-8-8" /></svg>
);
export const BoxIcon = ({ className = "size-5" }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="m3 8 9 5 9-5M12 13v8" /></svg>
);
export const GridIcon = ({ className = "size-5" }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
);
export const ReceiptIcon = ({ className = "size-5" }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 8h6M9 12h6" /></svg>
);
export const UsersIcon = ({ className = "size-5" }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></svg>
);
export const LockIcon = ({ className = "size-4" }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
);
export const ShieldIcon = ({ className = "size-5" }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6z" /><path d="m9 12 2 2 4-4" /></svg>
);
export const WifiOffIcon = ({ className = "size-4" }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><path d="M2 2l20 20M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 4.2-2.4M15 10.6A10 10 0 0 1 19 13M2 8.8a15 15 0 0 1 4.4-2.7M10.7 5a15 15 0 0 1 11.3 3.8" /><circle cx="12" cy="20" r=".6" /></svg>
);
export const CardIcon = ({ className = "size-5" }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19" /></svg>
);
export const FileIcon = ({ className = "size-5" }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><path d="M14 3H6v18h12V7z" /><path d="M14 3v4h4M9 13h6M9 17h6" /></svg>
);
export const AlertIcon = ({ className = "size-4" }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...base} strokeWidth={1.8}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></svg>
);
export const PlusIcon = ({ className = "size-5" }: P) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><path d="M12 5v14M5 12h14" /></svg>
);
