/** The logo in colour: a train window onto the summer meadow. public/brand/logo.svg; app/icon.svg is the same drawing. */
export const Logo = ({ size = 26 }: { size?: number }) => (
  <img className="logo" src="/brand/logo.svg" width={size} height={size} alt="" />
);

/** The logo as a line drawing, for small marks printed on things (the postcard's stamp). */
export const Mark = ({ size = 24 }: { size?: number }) => (
  <svg className="mark" width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
    <rect x="3" y="3" width="20" height="20" rx="7" />
    <path d="M3 15c4-2 7-2.4 10-1.2s6 1 10-1" />
    <circle cx="17" cy="10.5" r="2.2" />
  </svg>
);

/** Logo and name, top left on the big screens. */
export const Brand = () => <span className="brand"><Logo />Life is short</span>;
