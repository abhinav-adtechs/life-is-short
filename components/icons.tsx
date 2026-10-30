// Icons from the design files: a 16×16 grid, 1.5–1.6 strokes, round caps and joins.
type P = { size?: number };
const svg = (size: number, w: number) => ({
  width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: w,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
});

export const CheckIcon = ({ size = 14, w = 2 }: P & { w?: number }) => (
  <svg {...svg(size, w)}><path d="M3.5 8.5l3 3 6-7" /></svg>
);
export const CalendarIcon = ({ size = 14 }: P) => (
  <svg {...svg(size, 1.5)}><rect x="2" y="3" width="12" height="11" rx="2" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" /></svg>
);
export const ChevronLeft = ({ size = 14 }: P) => (
  <svg {...svg(size, 1.6)}><path d="M10 3.5L5.5 8l4.5 4.5" /></svg>
);
export const ChevronRight = ({ size = 14 }: P) => (
  <svg {...svg(size, 1.6)}><path d="M6 3.5L10.5 8 6 12.5" /></svg>
);
export const ChevronDown = ({ size = 12 }: P) => (
  <svg {...svg(size, 1.6)}><path d="M3.5 6l4.5 4.5L12.5 6" /></svg>
);
export const XIcon = ({ size = 14 }: P) => (
  <svg {...svg(size, 1.6)}><path d="M4 4l8 8M12 4l-8 8" /></svg>
);
export const TrashIcon = ({ size = 14 }: P) => (
  <svg {...svg(size, 1.5)}><path d="M2.5 4.5h11M6.5 4.5V3a1 1 0 011-1h1a1 1 0 011 1v1.5M4 4.5l.6 8.6a1 1 0 001 .9h4.8a1 1 0 001-.9l.6-8.6M6.75 7v4.5M9.25 7v4.5" /></svg>
);
export const ChatIcon = ({ size = 17 }: P) => (
  <svg {...svg(size, 1.5)}><path d="M2.5 3.5h11v7.5h-6.5l-3.25 2.5v-2.5h-1.25z" /></svg>
);
export const MicIcon = ({ size = 15 }: P) => (
  <svg {...svg(size, 1.5)}><rect x="6" y="1.75" width="4" height="8" rx="2" /><path d="M3.5 7.5a4.5 4.5 0 009 0M8 12v2.25" /></svg>
);
export const StopIcon = ({ size = 14 }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" /></svg>
);
export const ArrowUpIcon = ({ size = 14 }: P) => (
  <svg {...svg(size, 1.8)}><path d="M8 13V3M4 7l4-4 4 4" /></svg>
);
export const ArrowIcon = ({ size = 14 }: P) => (
  <svg {...svg(size, 1.6)}><path d="M3 8h10M9 4l4 4-4 4" /></svg>
);
export const HistoryIcon = ({ size = 14 }: P) => (
  <svg {...svg(size, 1.5)}><circle cx="8" cy="8" r="6" /><path d="M8 4.75V8l2 1.5" /></svg>
);
export const AnalyticsIcon = ({ size = 15 }: P) => (
  <svg {...svg(size, 1.6)}><path d="M3 13.5V9M8 13.5V2.5M13 13.5V6.5" /></svg>
);
export const ShareIcon = ({ size = 15 }: P) => (
  <svg {...svg(size, 1.5)}><path d="M8 10V2.5M5 5.25L8 2.5l3 2.75" /><path d="M3 8.5v4.5a1 1 0 001 1h8a1 1 0 001-1V8.5" /></svg>
);
export const SettingsIcon = ({ size = 15 }: P) => (
  <svg {...svg(size, 1.5)}><path d="M2.5 5h4M9.5 5h4M2.5 11h7M12.5 11h1" /><circle cx="8" cy="5" r="1.6" /><circle cx="11" cy="11" r="1.6" /></svg>
);
export const MoreIcon = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="12.5" cy="8" r="1.4" /></svg>
);
