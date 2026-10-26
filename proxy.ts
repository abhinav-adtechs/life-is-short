import { NextResponse, type NextRequest } from 'next/server';

/**
 * Strict Content-Security-Policy with a fresh nonce per request: only our own scripts run,
 * the page only talks to itself and Supabase, and nothing can frame it.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV === 'development';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabase = supabaseUrl ? `${supabaseUrl} ${supabaseUrl.replace(/^http/, 'ws')}` : '';
  const https = request.nextUrl.protocol === 'https:';
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com`,
    // React sets positions with inline style attributes; they can't run code.
    `style-src-attr 'unsafe-inline'`,
    `font-src https://fonts.gstatic.com`,
    `img-src 'self' data:`,
    `connect-src 'self' ${supabase}`.trim(),
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
