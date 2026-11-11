import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Connect from '@/components/Connect';
import { mcpConfigured, originOf } from '@/lib/server/mcp/config';
import { authorize } from '@/lib/server/mcp/endpoints';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Connect · Life is short',
  robots: { index: false, follow: false },
};

/**
 * OAuth 2.1's authorization endpoint: checks Claude's request on the server (lib/server/mcp/endpoints.ts), then asks
 * you behind the planner's sign-in. A request it can't trust is shown here, never sent anywhere.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!mcpConfigured()) return <Connect problem="Connecting Claude isn’t set up on this server yet: it needs Supabase and MCP_SERVER_KEY (docs/setup.md)." />;
  const sp = await searchParams;
  // OAuth: a parameter given twice is a malformed request.
  if (Object.values(sp).some(v => Array.isArray(v))) return <Connect problem="This link to connect is malformed. Start again from Claude." />;
  const q = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === 'string'));
  const a = authorize(originOf(await headers()), q);
  if (a.kind === 'redirect') redirect(a.url);
  if (a.kind === 'error') return <Connect problem={a.message} />;
  return <Connect request={a.request} clientName={a.clientName} redirectHost={a.redirectHost} denyUrl={a.denyUrl} />;
}
