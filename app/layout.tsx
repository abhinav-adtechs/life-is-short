import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';

// The icons, the install manifest and the link preview are files next to this one (icon.svg, favicon.ico,
// apple-icon.png, manifest.ts, opengraph-image.png); scripts/brand/README.md says how they're made.
export const metadata: Metadata = {
  title: 'Life is short',
  description: 'Dump a task the moment it comes to mind; the screen tells you the one thing to do now.',
  applicationName: 'Life is short',
  appleWebApp: { title: 'Life is short', capable: true, statusBarStyle: 'default' },
  openGraph: {
    title: 'Life is short',
    description: 'One box to dump things into, one answer on the screen. Dump it, slot it, do it.',
    siteName: 'Life is short',
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title: 'Life is short', description: 'One box to dump things into, one answer on the screen. Dump it, slot it, do it.' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Tide's wall by day, Night train's in the dark; components/prefs.ts changes it to match the theme you pick.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#E5EBEE' },
    { media: '(prefers-color-scheme: dark)', color: '#0A0D12' },
  ],
};

// Replay the saved look (theme, accent, font, sizes) before first paint so there's no flash. components/prefs.ts writes
// it. With no theme picked, or a look saved before the themes, the device's light or dark picks Tide or Night train.
const themeScript = `try{var r=document.documentElement,D=matchMedia('(prefers-color-scheme: dark)').matches,L=JSON.parse(localStorage.getItem('ds.look')||'null');`
  + `if(L&&L.attrs&&'data-ambient' in L.attrs){for(var k in L.vars)r.style.setProperty(k,L.vars[k]);for(var a in L.attrs)if(L.attrs[a]!=null)r.setAttribute(a,L.attrs[a]);`
  + `if(L.auto)r.setAttribute('data-theme',D?'night':'tide');`
  + `if(L.font){var l=document.createElement('link');l.id='ds-font';l.rel='stylesheet';l.href=L.font;document.head.appendChild(l)}}`
  + `else{var m=L&&L.attrs?L.attrs['data-theme']:localStorage.getItem('ds.theme');r.setAttribute('data-theme',m==='dark'||(m!=='light'&&D)?'night':'tide')}}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The CSP nonce from proxy.ts; reading headers also makes every page render per request.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    // Tide until the startup script picks this device's theme, before first paint.
    <html lang="en" data-theme="tide" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" nonce={nonce} href="https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
