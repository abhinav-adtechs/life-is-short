import { appSiteAssociation } from '@/lib/aasa';

export const dynamic = 'force-dynamic';

/** Links the Apple apps to this site for passkeys (lib/aasa.ts). JSON at this exact path, no redirects. */
export function GET() {
  const body = appSiteAssociation({ APPLE_TEAM_ID: process.env.APPLE_TEAM_ID, LIS_BUNDLE_ID: process.env.LIS_BUNDLE_ID });
  if (!body) return new Response('Not found', { status: 404 });
  return Response.json(body, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
