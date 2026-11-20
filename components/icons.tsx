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
export const KeyIcon = ({ size = 15 }: P) => (
  <svg {...svg(size, 1.5)}><circle cx="5" cy="11" r="3" /><path d="M7.2 8.8L13.5 2.5M11.5 4.5l1.6 1.6M9.6 6.4l1.4 1.4" /></svg>
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
export const RepeatIcon = ({ size = 12 }: P) => (
  <svg {...svg(size, 1.5)}><path d="M2.75 7.25V6.5a2.5 2.5 0 012.5-2.5h7.5M10.5 1.75L12.75 4 10.5 6.25M13.25 8.75v.75a2.5 2.5 0 01-2.5 2.5h-7.5M5.5 14.25L3.25 12 5.5 9.75" /></svg>
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
/** A goal: a target with its centre. */
export const TargetIcon = ({ size = 15 }: P) => (
  <svg {...svg(size, 1.5)}><circle cx="8" cy="8" r="5.75" /><circle cx="8" cy="8" r="2.75" /><circle cx="8" cy="8" r=".6" fill="currentColor" /></svg>
);
export const ChevronUp = ({ size = 12 }: P) => (
  <svg {...svg(size, 1.6)}><path d="M3.5 10l4.5-4.5L12.5 10" /></svg>
);
export const PlusIcon = ({ size = 14 }: P) => (
  <svg {...svg(size, 1.6)}><path d="M8 3v10M3 8h10" /></svg>
);
export const LockIcon = ({ size = 12 }: P) => (
  <svg {...svg(size, 1.6)}><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 015 0v2" /></svg>
);
export const HourglassIcon = ({ size = 14 }: P) => (
  <svg {...svg(size, 1.5)}><path d="M4 2.5h8M4 13.5h8M5 2.5c0 3 6 3 6 5.5s-6 2.5-6 5.5M11 2.5c0 1.6-1.4 2.4-3 3.2" /></svg>
);
export const FlagIcon = ({ size = 14 }: P) => (
  <svg {...svg(size, 1.5)}><path d="M3.5 14V2.5M3.5 3h7.5l-1.8 3 1.8 3H3.5" /></svg>
);
export const MapIcon = ({ size = 14 }: P) => (
  <svg {...svg(size, 1.5)}><path d="M2 4l4-1.5 4 1.5 4-1.5v9.5L10 13.5 6 12l-4 1.5zM6 2.5V12M10 4v9.5" /></svg>
);
export const RouteIcon = ({ size = 14 }: P) => (
  <svg {...svg(size, 1.5)}><circle cx="4" cy="3.5" r="1.5" /><circle cx="12" cy="12.5" r="1.5" /><path d="M5.5 3.5H10a2.5 2.5 0 010 5H6a2.5 2.5 0 000 5h4.5" /></svg>
);
export const PlayIcon = ({ size = 9 }: P) => (
  <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1.2v7.6L8.6 5z" fill="currentColor" /></svg>
);
export const TrophyIcon = ({ size = 12 }: P) => (
  <svg {...svg(size, 1.5)}><path d="M5 2.5h6v3.5a3 3 0 01-6 0zM5 3.5H3a2 2 0 002 3M11 3.5h2a2 2 0 01-2 3M8 9v2.5M5.5 13.5h5M6.5 11.5h3v2h-3z" /></svg>
);
export const SparkIcon = ({ size = 15 }: P) => (
  <svg {...svg(size, 1.5)}><path d="M8 2l1.3 3.7L13 7l-3.7 1.3L8 12l-1.3-3.7L3 7l3.7-1.3z" /><path d="M13 11.5l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z" /></svg>
);
export const UndoIcon = ({ size = 15 }: P) => (
  <svg {...svg(size, 1.5)}><path d="M5.5 3L2.5 6l3 3" /><path d="M2.5 6h7a4 4 0 010 8h-2" /></svg>
);
export const FitIcon = ({ size = 15 }: P) => (
  <svg {...svg(size, 1.5)}><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" /></svg>
);
export const MinusIcon = ({ size = 15 }: P) => (
  <svg {...svg(size, 1.6)}><path d="M3.5 8h9" /></svg>
);
export const InboxIcon = ({ size = 16 }: P) => (
  <svg {...svg(size, 1.5)}><path d="M2.5 9.5h3l1 1.5h3l1-1.5h3" /><path d="M2.5 9.5l1.6-5.2A1 1 0 015.05 3.5h5.9a1 1 0 01.95.8l1.6 5.2v3a1 1 0 01-1 1h-9a1 1 0 01-1-1z" /></svg>
);
export const OpenIcon = ({ size = 14 }: P) => (
  <svg {...svg(size, 1.5)}><path d="M6 3.5H3.5v9h9V10M9 2.5h4.5V7M13.5 2.5L7.5 8.5" /></svg>
);
export const ClockIcon = ({ size = 12 }: P) => (
  <svg {...svg(size, 1.5)}><circle cx="8" cy="8" r="6" /><path d="M8 4.75V8l2 1.5" /></svg>
);
