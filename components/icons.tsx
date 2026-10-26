// Icons copied from the design files.
type P = { size?: number };
const base = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export const CalendarIcon = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={1.8} {...base}><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
);
export const CalendarPlusIcon = ({ size = 17 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={1.8} {...base}><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M3.5 10h17M12 13v5M9.5 15.5h5" /></svg>
);
export const CheckIcon = ({ size = 11 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={3.6} {...base}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const MicIcon = ({ size = 22 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={2} {...base}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
);
export const StopIcon = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" /></svg>
);
export const XIcon = ({ size = 14 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={2.2} {...base}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const ChevronLeft = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={2} {...base}><path d="M15 6l-6 6 6 6" /></svg>
);
export const ChevronRight = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={2} {...base}><path d="M9 6l6 6-6 6" /></svg>
);
export const BackIcon = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={1.8} {...base}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
);
export const MoreIcon = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="6" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18" cy="12" r="1.6" /></svg>
);
export const CaretIcon = ({ size = 12 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={2.4} {...base}><path d="M9 6l6 6-6 6" /></svg>
);
