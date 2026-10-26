/** The mark: a bird over open fields, in a soft green square. app/icon.svg is the same drawing. */
export const Mark = ({ size = 24 }: { size?: number }) => (
  <svg className="mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <rect width="24" height="24" rx="7" />
    <path d="M5 11.4C7.3 9.3 9.7 9.6 12 12.8 14.3 9.6 16.7 9.3 19 11.4" />
  </svg>
);

/** Mark and name, top left on the big screens. */
export const Brand = () => <span className="brand"><Mark />Life is short</span>;
