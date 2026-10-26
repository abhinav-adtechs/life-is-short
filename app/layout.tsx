import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Dump & Slot',
  description: 'Dump tasks the moment they come to mind; the screen tells you the one thing to do now.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
    { media: '(prefers-color-scheme: dark)', color: '#0B0B0C' },
  ],
};

// Replay the saved look (colours, font, sizes, light/dark) before first paint so there's no flash.
// components/prefs.ts writes it; older builds only saved the theme.
const themeScript = `try{var r=document.documentElement,L=JSON.parse(localStorage.getItem('ds.look')||'null');`
  + `if(L){for(var k in L.vars)r.style.setProperty(k,L.vars[k]);for(var a in L.attrs)if(L.attrs[a]!=null)r.setAttribute(a,L.attrs[a]);`
  + `if(L.font){var l=document.createElement('link');l.id='ds-font';l.rel='stylesheet';l.href=L.font;document.head.appendChild(l)}}`
  + `else{var t=localStorage.getItem('ds.theme');if(t==='light'||t==='dark')r.dataset.theme=t}}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The CSP nonce from proxy.ts; reading headers also makes every page render per request.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" nonce={nonce} href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
